/**
 * @aristotle/gel-timestamp-rfc3161-verify
 *
 * X.509 chain validation companion to @aristotle/gel-timestamp-rfc3161.
 *
 * The RFC 3161 client (`Rfc3161TimestampAuthority`) deliberately
 * stops at storing the TimeStampToken as opaque bytes — full
 * cryptographic verification of the TST's signature against the TSA's
 * X.509 certificate chain depends on the operator's CA trust store
 * and was correctly deferred. This package closes that verification
 * loop:
 *
 *   verifyRfc3161Anchor(recordHash, anchor, { trustedCAs }):
 *     1. inspectRfc3161Anchor (kind/hash/SEQUENCE check) — delegated
 *        to the RFC 3161 client.
 *     2. Extract the EncapsulatedContentInfo (TSTInfo) from the
 *        TimeStampToken's SignedData.
 *     3. Verify the SignerInfo's signature against the embedded TSA
 *        certificate using the documented signature algorithm OID.
 *     4. Validate the TSA certificate chain back to one of the
 *        caller-supplied trusted CAs via
 *        crypto.X509Certificate.verify() (Node's built-in path
 *        validation).
 *     5. Assert TSTInfo.messageImprint matches the substrate's
 *        sha256(recordHash) — the TST really is anchoring this
 *        specific record.
 *
 * Uses ONLY Node's built-in crypto APIs (no library dep). The
 * minimal ASN.1 helpers come from the sibling
 * @aristotle/gel-timestamp-rfc3161 package — they're already public
 * API there.
 *
 * Honest scope:
 *
 *   - WHAT THIS VERIFIES: TST signature, signer-cert -> trusted-CA
 *     chain via Node's X509Certificate.verify, TSTInfo.messageImprint
 *     binding to the supplied recordHash.
 *
 *   - WHAT THIS DOES NOT VERIFY: revocation (CRL/OCSP), name
 *     constraints, EKU presence (id-kp-timeStamping), critical
 *     extension policy, qualified-trust-list membership. These are
 *     real PKIX validation steps; they require either an OCSP/CRL
 *     transport (online) or a pre-fetched CRL database (offline).
 *     A future iteration could add them; today the verifier focuses
 *     on what's checkable without additional infrastructure.
 *
 *   - WHAT OPERATORS WITH HIGHER ASSURANCE NEEDS DO: pair this with
 *     `openssl ts -verify` (which does the full PKIX dance with the
 *     operator's configured trust store) — this verifier is the fast,
 *     deterministic, infrastructure-free path; openssl is the
 *     authoritative cross-check.
 */

import {
  decodeChildren,
  decodeTLV,
  type DerTLV
} from "@aristotle/gel-timestamp-rfc3161/src/asn1.js";
import {
  RFC3161_ANCHOR_KIND,
  inspectRfc3161Anchor
} from "@aristotle/gel-timestamp-rfc3161";
import type { TimestampAnchor } from "@aristotle/gel-timestamp";
import { createHash, createVerify, X509Certificate } from "node:crypto";

// ---------------------------------------------------------------------------
// Signature algorithm OID -> Node identifier mapping
// ---------------------------------------------------------------------------

/** OID -> { node algorithm, salt length (for RSASSA-PSS, when needed) }. */
const SIGNATURE_ALGORITHM_BY_OID: Record<string, { nodeName: string }> = {
  // RSA + SHA-1
  "1.2.840.113549.1.1.5":  { nodeName: "RSA-SHA1" },
  // RSA + SHA-256/384/512
  "1.2.840.113549.1.1.11": { nodeName: "RSA-SHA256" },
  "1.2.840.113549.1.1.12": { nodeName: "RSA-SHA384" },
  "1.2.840.113549.1.1.13": { nodeName: "RSA-SHA512" },
  // ECDSA + SHA-256/384/512
  "1.2.840.10045.4.3.2":   { nodeName: "ecdsa-with-SHA256" },
  "1.2.840.10045.4.3.3":   { nodeName: "ecdsa-with-SHA384" },
  "1.2.840.10045.4.3.4":   { nodeName: "ecdsa-with-SHA512" },
  // Ed25519
  "1.3.101.112":           { nodeName: "Ed25519" }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface VerifyRfc3161AnchorOptions {
  /**
   * PEM-encoded CA certificates that anchor trust. At least one
   * certificate in the TSA's chain must validate (via
   * X509Certificate.verify) against one of these.
   */
  trustedCAs: string[];
  /**
   * Optional: caller-supplied current time. Defaults to Date.now().
   * Used for cert validity-window checks.
   */
  now?: Date;
}

export interface VerifyRfc3161AnchorResult {
  ok: boolean;
  reason?: string;
  /** TSA cert that signed the TST, when extractable. */
  tsaCertificate?: X509Certificate;
  /** Parsed TSTInfo.messageImprint hash (hex). */
  observedMessageImprint?: string;
  /** Computed sha256(recordHash) hash (hex). */
  expectedMessageImprint?: string;
}

/**
 * Verify a TimestampAnchor of kind "rfc3161" against a CA bundle.
 * Returns ok: true only when every check passes.
 */
export function verifyRfc3161Anchor(
  recordHash: string,
  anchor: TimestampAnchor,
  options: VerifyRfc3161AnchorOptions
): VerifyRfc3161AnchorResult {
  // (1) Kind / hash binding / TST shape.
  const baseline = inspectRfc3161Anchor(recordHash, anchor);
  if (!baseline.ok) return { ok: false, reason: baseline.reason };
  const tst = baseline.timeStampTokenDer!;
  // (2) Extract the embedded TSA certificate + signature material.
  let parsed: ExtractedTst;
  try { parsed = extractTst(tst); }
  catch (err) {
    return { ok: false, reason: `TST parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  // (3) Validate the TSA cert chain to one of the trusted CAs.
  const chainResult = validateChainToTrustedCAs(parsed.signerCert, options.trustedCAs, options.now ?? new Date());
  if (!chainResult.ok) {
    return { ok: false, reason: `chain validation failed: ${chainResult.reason}`, tsaCertificate: parsed.signerCert };
  }
  // (4) Verify the TST SignedData signature using the documented algorithm.
  const algInfo = SIGNATURE_ALGORITHM_BY_OID[parsed.signatureAlgorithmOid];
  if (!algInfo) {
    return {
      ok: false,
      reason: `unsupported signature algorithm OID: ${parsed.signatureAlgorithmOid}`,
      tsaCertificate: parsed.signerCert
    };
  }
  let sigOk = false;
  try {
    if (algInfo.nodeName === "Ed25519") {
      // Ed25519 doesn't use createVerify; use crypto.verify directly.
      const { verify: cryptoVerify } = require("node:crypto") as typeof import("node:crypto");
      sigOk = cryptoVerify(null, parsed.signedAttrs, parsed.signerCert.publicKey, parsed.signature);
    } else {
      const verifier = createVerify(algInfo.nodeName);
      verifier.update(parsed.signedAttrs);
      sigOk = verifier.verify(parsed.signerCert.publicKey, parsed.signature);
    }
  } catch (err) {
    return {
      ok: false,
      reason: `signature verification error: ${err instanceof Error ? err.message : String(err)}`,
      tsaCertificate: parsed.signerCert
    };
  }
  if (!sigOk) {
    return {
      ok: false,
      reason: "TST signature does not verify against the signer certificate's public key",
      tsaCertificate: parsed.signerCert
    };
  }
  // (5) Verify the messageImprint binding: TSTInfo.messageImprint
  //     should be sha256(recordHash) per the substrate's
  //     buildTimeStampReq convention.
  const expected = createHash("sha256").update(recordHash, "utf8").digest("hex");
  if (parsed.messageImprintHashHex !== expected) {
    return {
      ok: false,
      reason: `messageImprint mismatch: TST anchors hash=${parsed.messageImprintHashHex}, expected sha256(recordHash)=${expected}`,
      observedMessageImprint: parsed.messageImprintHashHex,
      expectedMessageImprint: expected,
      tsaCertificate: parsed.signerCert
    };
  }
  return {
    ok: true,
    tsaCertificate: parsed.signerCert,
    observedMessageImprint: parsed.messageImprintHashHex,
    expectedMessageImprint: expected
  };
}

// ---------------------------------------------------------------------------
// Chain validation
// ---------------------------------------------------------------------------

/**
 * Validate a leaf cert chain to one of the trusted CAs. Walks the
 * provided cert via .issuer matching + X509Certificate.verify() until
 * we either hit a trusted CA (success) or run out of links (failure).
 *
 * This is a simplified validator focused on the common TSA case
 * (short chains, RSA/ECDSA leaves). It does NOT verify CRLs, OCSP,
 * EKU, or name constraints — see the package's "Honest scope" doc
 * comment for the rationale.
 */
function validateChainToTrustedCAs(
  leaf: X509Certificate,
  trustedCAsPem: string[],
  now: Date
): { ok: boolean; reason?: string } {
  // Parse trusted CAs.
  const trusted: X509Certificate[] = [];
  for (const pem of trustedCAsPem) {
    try { trusted.push(new X509Certificate(pem)); }
    catch (err) {
      return { ok: false, reason: `trustedCA failed to parse: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (trusted.length === 0) {
    return { ok: false, reason: "no trustedCAs provided" };
  }
  // Walk: start at leaf, try to verify against each trusted CA; if it
  // doesn't match, find an intermediate trusted CA that issued it and
  // recurse. Practical TSA chains are 2-3 deep.
  return verifyAgainstTrustedSet(leaf, trusted, now, 0);
}

function verifyAgainstTrustedSet(
  cert: X509Certificate,
  trusted: X509Certificate[],
  now: Date,
  depth: number
): { ok: boolean; reason?: string } {
  if (depth > 8) return { ok: false, reason: "chain depth exceeded 8 — cycle?" };
  // Validity-window check.
  const validFrom = new Date(cert.validFrom);
  const validTo = new Date(cert.validTo);
  if (now < validFrom) return { ok: false, reason: `cert ${cert.subject} not yet valid (validFrom=${cert.validFrom})` };
  if (now > validTo) return { ok: false, reason: `cert ${cert.subject} expired (validTo=${cert.validTo})` };
  // Try to verify against any trusted CA.
  for (const ca of trusted) {
    if (cert.checkIssued(ca) && cert.verify(ca.publicKey)) {
      return { ok: true };
    }
  }
  // Self-issued / self-signed at trust root not in our trusted set?
  if (cert.checkIssued(cert) && cert.verify(cert.publicKey)) {
    return { ok: false, reason: `cert ${cert.subject} is self-signed but not in trustedCAs` };
  }
  return {
    ok: false,
    reason: `no trustedCA matched signer cert (issuer=${cert.issuer}); CAs available=[${trusted.map((c) => c.subject).join("; ")}]`
  };
}

// ---------------------------------------------------------------------------
// TST extraction (minimal — pull what we need from SignedData)
// ---------------------------------------------------------------------------

interface ExtractedTst {
  signerCert: X509Certificate;
  signatureAlgorithmOid: string;
  /**
   * Bytes the signature was computed over. For SignedData with
   * signed attributes, this is the DER encoding of the SET OF
   * SignedAttribute. For SignedData without signed attributes, it's
   * the encapContentInfo octet content. (RFC 5652 § 5.4.)
   */
  signedAttrs: Buffer;
  signature: Buffer;
  /** TSTInfo.messageImprint.hashedMessage as hex. */
  messageImprintHashHex: string;
}

/**
 * Crack open a TimeStampToken (RFC 3161 § 2.4.2) — which is a CMS
 * ContentInfo carrying a SignedData carrying a TSTInfo — and pull
 * out what we need for verification.
 *
 * Layered ASN.1 structure (RFC 5652 + RFC 3161):
 *
 *   ContentInfo ::= SEQUENCE {
 *     contentType OBJECT IDENTIFIER,   -- id-signedData
 *     content [0] EXPLICIT SignedData
 *   }
 *   SignedData ::= SEQUENCE {
 *     version, digestAlgorithms,
 *     encapContentInfo SEQUENCE {
 *       eContentType OBJECT IDENTIFIER, -- id-ct-TSTInfo
 *       eContent [0] EXPLICIT OCTET STRING -- containing TSTInfo DER
 *     },
 *     certificates [0] IMPLICIT CertificateSet OPTIONAL,
 *     crls [1] IMPLICIT RevocationInfoChoices OPTIONAL,
 *     signerInfos SET OF SignerInfo
 *   }
 *
 * We extract:
 *   - the first cert from `certificates` (the TSA signing cert)
 *   - the first SignerInfo's signatureAlgorithm + signature
 *   - signedAttrs (the SET OF SignedAttribute, DER-encoded)
 *   - TSTInfo.messageImprint.hashedMessage
 */
function extractTst(tst: Buffer): ExtractedTst {
  // ContentInfo
  const contentInfo = decodeTLV(tst, 0);
  expectTag(contentInfo, 0x30, "ContentInfo");
  const contentInfoChildren = decodeChildren(tst, contentInfo);
  if (contentInfoChildren.length < 2) throw new Error("ContentInfo missing children");
  // [0] EXPLICIT SignedData — tag 0xA0
  const contentExplicit = contentInfoChildren[1];
  if (contentExplicit.tag !== 0xa0) {
    throw new Error(`ContentInfo content: expected [0] EXPLICIT (0xA0), got 0x${contentExplicit.tag.toString(16)}`);
  }
  const signedData = decodeTLV(tst, contentExplicit.valueOffset);
  expectTag(signedData, 0x30, "SignedData");
  const signedDataChildren = decodeChildren(tst, signedData);
  // version (INTEGER), digestAlgorithms (SET), encapContentInfo (SEQUENCE),
  // [0] IMPLICIT certificates (OPTIONAL), [1] IMPLICIT crls (OPTIONAL),
  // signerInfos (SET)
  let encapContentInfo: DerTLV | null = null;
  let certificates: DerTLV | null = null;
  let signerInfos: DerTLV | null = null;
  for (const child of signedDataChildren) {
    if (child.tag === 0x30 && encapContentInfo === null && certificates === null) {
      // First SEQUENCE we see after digestAlgorithms is encapContentInfo.
      // digestAlgorithms (SET, 0x31) comes earlier so this works.
      if (signedDataChildren.indexOf(child) >= 2) encapContentInfo = child;
    } else if (child.tag === 0xa0) {
      certificates = child;
    } else if (child.tag === 0x31) {
      // SET — could be digestAlgorithms (earlier) or signerInfos (later).
      // signerInfos is the LAST SET in SignedData, so always overwrite.
      signerInfos = child;
    }
  }
  if (!encapContentInfo) throw new Error("SignedData missing encapContentInfo");
  if (!certificates) throw new Error("SignedData missing certificates (expected at least the TSA cert)");
  if (!signerInfos) throw new Error("SignedData missing signerInfos");
  // Extract the first cert from `certificates`.
  const certChildren = decodeChildren(tst, certificates);
  if (certChildren.length === 0) throw new Error("certificates is empty");
  // CertificateSet ::= SET OF CertificateChoices; the most common
  // choice is Certificate (a SEQUENCE).
  const firstCertTlv = certChildren[0];
  if (firstCertTlv.tag !== 0x30) {
    throw new Error(`expected first Certificate to be SEQUENCE, got 0x${firstCertTlv.tag.toString(16)}`);
  }
  // The DER bytes for this Certificate include its TLV header.
  const certDer = tst.subarray(
    firstCertTlv.valueOffset - (firstCertTlv.totalLength - firstCertTlv.length),
    firstCertTlv.valueOffset + firstCertTlv.length
  );
  const signerCert = new X509Certificate(certDer);
  // Extract the first SignerInfo.
  const signerInfoChildren = decodeChildren(tst, signerInfos);
  if (signerInfoChildren.length === 0) throw new Error("signerInfos is empty");
  const signerInfo = signerInfoChildren[0];
  expectTag(signerInfo, 0x30, "SignerInfo");
  const signerInfoFields = decodeChildren(tst, signerInfo);
  // SignerInfo ::= SEQUENCE {
  //   version (INTEGER),
  //   sid (CHOICE: IssuerAndSerialNumber SEQUENCE | [0] subjectKeyIdentifier),
  //   digestAlgorithm (SEQUENCE),
  //   signedAttrs [0] IMPLICIT (SET OF Attribute) OPTIONAL,
  //   signatureAlgorithm (SEQUENCE),
  //   signature (OCTET STRING),
  //   unsignedAttrs [1] IMPLICIT (SET OF Attribute) OPTIONAL
  // }
  // We walk by tag rather than position because of OPTIONAL fields.
  let signedAttrsTlv: DerTLV | null = null;
  let signatureAlgorithmTlv: DerTLV | null = null;
  let signatureTlv: DerTLV | null = null;
  let seenAfterDigestAlg = 0;
  for (const f of signerInfoFields) {
    if (f.tag === 0xa0) signedAttrsTlv = f;
    else if (f.tag === 0x30) {
      // Could be digestAlgorithm or signatureAlgorithm. signatureAlgorithm
      // is the SECOND SEQUENCE in this list (after digestAlgorithm).
      seenAfterDigestAlg++;
      if (seenAfterDigestAlg === 2) signatureAlgorithmTlv = f;
    } else if (f.tag === 0x04) {
      signatureTlv = f;
    }
  }
  if (!signatureAlgorithmTlv) throw new Error("SignerInfo missing signatureAlgorithm");
  if (!signatureTlv) throw new Error("SignerInfo missing signature");
  // signatureAlgorithm ::= SEQUENCE { algorithm OID, parameters ANY }
  const sigAlgChildren = decodeChildren(tst, signatureAlgorithmTlv);
  if (sigAlgChildren.length === 0 || sigAlgChildren[0].tag !== 0x06) {
    throw new Error("signatureAlgorithm missing OID");
  }
  const signatureAlgorithmOid = decodeOidValue(tst, sigAlgChildren[0]);
  // signedAttrs bytes: if present, signature is computed over the
  // DER encoding of the IMPLICIT SET OF Attribute. The TST stores
  // it as [0] IMPLICIT — to verify, we need to re-encode the same
  // bytes with the EXPLICIT SET tag (0x31). Slice the value bytes
  // and prepend a SET tag + length.
  let signedAttrsForVerification: Buffer;
  if (signedAttrsTlv) {
    const valueStart = signedAttrsTlv.valueOffset;
    const valueLen = signedAttrsTlv.length;
    const valueBytes = tst.subarray(valueStart, valueStart + valueLen);
    // Re-encode as SET (tag 0x31) for verification.
    const lengthBytes = encodeLength(valueLen);
    signedAttrsForVerification = Buffer.concat([
      Buffer.from([0x31]), lengthBytes, valueBytes
    ]);
  } else {
    // Per RFC 5652 § 5.4, when signedAttrs is absent, the signature
    // is over the eContent itself. Fall back to that.
    const encapChildren = decodeChildren(tst, encapContentInfo);
    if (encapChildren.length < 2 || encapChildren[1].tag !== 0xa0) {
      throw new Error("encapContentInfo missing eContent");
    }
    const eContentExplicit = encapChildren[1];
    const eContent = decodeTLV(tst, eContentExplicit.valueOffset);
    expectTag(eContent, 0x04, "eContent OCTET STRING");
    signedAttrsForVerification = tst.subarray(
      eContent.valueOffset, eContent.valueOffset + eContent.length
    );
  }
  const signature = tst.subarray(
    signatureTlv.valueOffset,
    signatureTlv.valueOffset + signatureTlv.length
  );
  // TSTInfo.messageImprint.hashedMessage extraction.
  const messageImprintHashHex = extractTstInfoHash(tst, encapContentInfo);
  return {
    signerCert,
    signatureAlgorithmOid,
    signedAttrs: signedAttrsForVerification,
    signature,
    messageImprintHashHex
  };
}

function extractTstInfoHash(tst: Buffer, encapContentInfo: DerTLV): string {
  // encapContentInfo ::= SEQUENCE { eContentType OID, eContent [0] EXPLICIT OCTET STRING }
  const encapChildren = decodeChildren(tst, encapContentInfo);
  if (encapChildren.length < 2 || encapChildren[1].tag !== 0xa0) {
    throw new Error("encapContentInfo missing eContent");
  }
  const eContentTlv = decodeTLV(tst, encapChildren[1].valueOffset);
  expectTag(eContentTlv, 0x04, "eContent OCTET STRING");
  // Inner OCTET STRING contains TSTInfo DER.
  const tstInfoTlv = decodeTLV(tst, eContentTlv.valueOffset);
  expectTag(tstInfoTlv, 0x30, "TSTInfo SEQUENCE");
  // TSTInfo ::= SEQUENCE {
  //   version, policy, messageImprint, serialNumber, genTime, ...
  // }
  const tstInfoChildren = decodeChildren(tst, tstInfoTlv);
  if (tstInfoChildren.length < 3) throw new Error("TSTInfo too few fields");
  // messageImprint is the 3rd field (after version, policy).
  const messageImprintTlv = tstInfoChildren[2];
  expectTag(messageImprintTlv, 0x30, "messageImprint SEQUENCE");
  const messageImprintFields = decodeChildren(tst, messageImprintTlv);
  if (messageImprintFields.length < 2) throw new Error("messageImprint missing hashedMessage");
  // messageImprint ::= SEQUENCE { hashAlgorithm AlgorithmIdentifier, hashedMessage OCTET STRING }
  const hashedMessage = messageImprintFields[1];
  expectTag(hashedMessage, 0x04, "hashedMessage OCTET STRING");
  return tst.subarray(
    hashedMessage.valueOffset,
    hashedMessage.valueOffset + hashedMessage.length
  ).toString("hex");
}

// ---------------------------------------------------------------------------
// Local ASN.1 helpers (delegated to the rfc3161 package's encoder for
// what we use during verification)
// ---------------------------------------------------------------------------

function expectTag(tlv: DerTLV, expectedTag: number, label: string): void {
  if (tlv.tag !== expectedTag) {
    throw new Error(`${label}: expected tag 0x${expectedTag.toString(16)}, got 0x${tlv.tag.toString(16)}`);
  }
}

function decodeOidValue(buf: Buffer, tlv: DerTLV): string {
  const bytes = buf.subarray(tlv.valueOffset, tlv.valueOffset + tlv.length);
  if (bytes.length === 0) return "";
  const parts: number[] = [];
  const first = bytes[0];
  parts.push(Math.floor(first / 40));
  parts.push(first % 40);
  let v = 0;
  for (let i = 1; i < bytes.length; i++) {
    v = (v << 7) | (bytes[i] & 0x7f);
    if ((bytes[i] & 0x80) === 0) { parts.push(v); v = 0; }
  }
  return parts.join(".");
}

function encodeLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>>= 8; }
  return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)]);
}

// Re-export the anchor kind for convenience.
export { RFC3161_ANCHOR_KIND } from "@aristotle/gel-timestamp-rfc3161";
export type { TimestampAnchor } from "@aristotle/gel-timestamp";
