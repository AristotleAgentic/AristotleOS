/**
 * @aristotle/gel-timestamp-rfc3161
 *
 * RFC 3161 Time-Stamp Protocol client for AristotleOS. Implements the
 * `TimestampAuthority` interface from `@aristotle/gel-timestamp` by
 * posting an ASN.1 DER-encoded TimeStampReq to a configured TSA
 * endpoint and storing the returned TimeStampToken as an opaque blob
 * in the anchor's signature field.
 *
 * Honest scope:
 *
 *   - WHAT THIS IMPLEMENTS: the RFC 3161 wire request, the network
 *     POST (using fetch with the correct Content-Type), the response
 *     status extraction, and the extraction of the embedded
 *     TimeStampToken which we store as base64 in the anchor.
 *
 *   - WHAT THIS DOES NOT IMPLEMENT: full cryptographic verification of
 *     the TimeStampToken's signature against the TSA's X.509
 *     certificate chain. X.509 chain validation is a non-trivial
 *     problem (chain construction, name constraints, CRL/OCSP, root
 *     store policy) whose right answer depends on the operator's
 *     trust store — it would be wrong to ship a one-size-fits-all
 *     verifier here.
 *
 *   - HOW OPERATORS VERIFY: pair this client with whichever validator
 *     matches the operator's chain trust posture:
 *       - `openssl ts -verify` reading the stored TST blob,
 *       - a real ASN.1 + X.509 library (node-forge, pkijs, jsrsasign)
 *         configured against the operator's CA bundle,
 *       - a separate `@aristotle/gel-timestamp-rfc3161-verify` package
 *         (future work) that takes a CA bundle as input.
 *
 *   - WHAT THE SUBSTRATE VERIFIES TODAY: the anchor's kind +
 *     record_hash binding. `verifyTimestampAnchor` from
 *     `@aristotle/gel-timestamp` returns `unsupported anchor kind:
 *     rfc3161` because the substrate's built-in verifier only
 *     understands the local-ed25519 format. Operators using this
 *     RFC 3161 client are expected to wire their own anchor
 *     verification via the operator-side validator above. This is
 *     documented; the substrate doesn't pretend it's verifying what
 *     it can't.
 */

import {
  encodeInteger,
  encodeNull,
  encodeObjectIdentifier,
  encodeOctetString,
  encodeSequence,
  decodeTLV,
  decodeChildren,
  decodeIntegerSafe
} from "./asn1.js";
import {
  type TimestampAnchor,
  type TimestampAuthority
} from "@aristotle/gel-timestamp";
import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Anchor kind tag for RFC 3161 TimeStampTokens. */
export const RFC3161_ANCHOR_KIND = "rfc3161" as const;

/** OID for SHA-256 (id-sha256, RFC 5754). */
export const OID_SHA256 = "2.16.840.1.101.3.4.2.1";

/** RFC 3161 TimeStampReq Content-Type for HTTP POST. */
export const CONTENT_TYPE_TSREQ = "application/timestamp-query";

/** RFC 3161 TimeStampResp Content-Type expected in HTTP response. */
export const CONTENT_TYPE_TSRESP = "application/timestamp-reply";

// ---------------------------------------------------------------------------
// TimeStampReq encoder
// ---------------------------------------------------------------------------

/**
 * Build an ASN.1 DER-encoded TimeStampReq per RFC 3161 § 2.4.1:
 *
 *   TimeStampReq ::= SEQUENCE  {
 *     version                  INTEGER  { v1(1) },
 *     messageImprint           MessageImprint,
 *     reqPolicy                TSAPolicyId              OPTIONAL,
 *     nonce                    INTEGER                  OPTIONAL,
 *     certReq                  BOOLEAN                  DEFAULT FALSE,
 *     extensions               [0] IMPLICIT Extensions  OPTIONAL
 *   }
 *
 *   MessageImprint ::= SEQUENCE  {
 *     hashAlgorithm            AlgorithmIdentifier,
 *     hashedMessage            OCTET STRING
 *   }
 *
 * We always use SHA-256 as the hash algorithm; the messageImprint's
 * hashedMessage is sha256(recordHash). We always include a fresh nonce
 * (16 bytes) to bind request/response. We do NOT request the TSA's
 * cert chain inline (certReq omitted, defaults to FALSE) — operators
 * who need the cert chain configure their TSA endpoint to embed it in
 * the response by default, or fetch the chain out of band.
 */
export interface BuildTimeStampReqInput {
  /** The record_hash being witnessed. Hashed again before being sent. */
  recordHash: string;
  /** Optional nonce buffer; defaults to 16 fresh random bytes. */
  nonce?: Buffer;
  /** Optional caller-supplied OID for reqPolicy. Default: omit. */
  reqPolicyOid?: string;
}

export interface BuiltTimeStampReq {
  /** The DER-encoded request bytes ready for POST. */
  derBytes: Buffer;
  /** The nonce used — caller may want to assert it round-trips in the response. */
  nonce: Buffer;
}

export function buildTimeStampReq(input: BuildTimeStampReqInput): BuiltTimeStampReq {
  const nonce = input.nonce ?? randomBytes(16);
  // hashedMessage = sha256(recordHash). The record_hash arriving here
  // is already a hex string per the substrate; we hash the hex bytes
  // (deterministic, reviewer-reproducible).
  const hashedMessage = createHash("sha256").update(input.recordHash, "utf8").digest();
  // MessageImprint
  const algorithmIdentifier = encodeSequence([
    encodeObjectIdentifier(OID_SHA256),
    encodeNull() // SHA-256 has no parameters; explicit NULL is required by RFC 5754
  ]);
  const messageImprint = encodeSequence([
    algorithmIdentifier,
    encodeOctetString(hashedMessage)
  ]);
  // TimeStampReq fields in order: version, messageImprint, [reqPolicy], nonce
  const fields: Buffer[] = [
    encodeInteger(1), // version v1
    messageImprint
  ];
  if (input.reqPolicyOid) fields.push(encodeObjectIdentifier(input.reqPolicyOid));
  // RFC 3161 nonce is INTEGER; we encode the random bytes as a positive
  // big-endian integer.
  fields.push(encodeInteger(BigInt("0x" + nonce.toString("hex"))));
  const derBytes = encodeSequence(fields);
  return { derBytes, nonce };
}

// ---------------------------------------------------------------------------
// TimeStampResp decoder (minimal — extract status + TimeStampToken)
// ---------------------------------------------------------------------------

/**
 * RFC 3161 § 2.4.2:
 *
 *   TimeStampResp ::= SEQUENCE  {
 *     status                  PKIStatusInfo,
 *     timeStampToken          TimeStampToken     OPTIONAL
 *   }
 *
 *   PKIStatusInfo ::= SEQUENCE {
 *     status        PKIStatus,
 *     statusString  PKIFreeText OPTIONAL,
 *     failInfo      PKIFailureInfo OPTIONAL
 *   }
 *
 *   PKIStatus ::= INTEGER {
 *     granted                (0),
 *     grantedWithMods        (1),
 *     rejection              (2),
 *     waiting                (3),
 *     revocationWarning      (4),
 *     revocationNotification (5)
 *   }
 *
 *   TimeStampToken ::= ContentInfo
 *     -- contentType is id-signedData ({1 2 840 113549 1 7 2})
 *     -- content is SignedData
 *
 * We extract the PKIStatus + (when present) the TimeStampToken as
 * opaque DER bytes for storage in the anchor.
 */
export interface DecodedTimeStampResp {
  status: number;
  statusName: string;
  /** Opaque TimeStampToken DER bytes (the ContentInfo), or null if status != granted. */
  timeStampTokenDer: Buffer | null;
}

const PKI_STATUS_NAMES: Record<number, string> = {
  0: "granted",
  1: "grantedWithMods",
  2: "rejection",
  3: "waiting",
  4: "revocationWarning",
  5: "revocationNotification"
};

export function decodeTimeStampResp(der: Buffer): DecodedTimeStampResp {
  const root = decodeTLV(der, 0);
  if (root.tag !== 0x30) {
    throw new Error(`decodeTimeStampResp: root must be SEQUENCE (0x30), got 0x${root.tag.toString(16)}`);
  }
  const topChildren = decodeChildren(der, root);
  if (topChildren.length === 0) throw new Error("decodeTimeStampResp: empty SEQUENCE");
  const statusInfo = topChildren[0];
  if (statusInfo.tag !== 0x30) throw new Error("decodeTimeStampResp: PKIStatusInfo must be SEQUENCE");
  const statusFields = decodeChildren(der, statusInfo);
  if (statusFields.length === 0) throw new Error("decodeTimeStampResp: empty PKIStatusInfo");
  const status = decodeIntegerSafe(der, statusFields[0]);
  const statusName = PKI_STATUS_NAMES[status] ?? `unknown(${status})`;
  let timeStampTokenDer: Buffer | null = null;
  if (topChildren.length >= 2 && (status === 0 || status === 1)) {
    // The second top-level child is the TimeStampToken (ContentInfo).
    // Slice the full TLV bytes — caller stores them opaquely.
    const tst = topChildren[1];
    const start = tst.valueOffset - (tst.totalLength - tst.length);
    timeStampTokenDer = der.subarray(start, start + tst.totalLength);
  }
  return { status, statusName, timeStampTokenDer };
}

// ---------------------------------------------------------------------------
// Rfc3161TimestampAuthority — the TimestampAuthority impl
// ---------------------------------------------------------------------------

export interface Rfc3161TimestampAuthorityOptions {
  /** TSA endpoint URL, e.g. "https://freetsa.org/tsr" or an internal TSA. */
  endpoint: string;
  /** Optional caller-supplied fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * Optional caller-supplied OID identifying the desired TSA policy.
   * Most operators leave this unset and accept the TSA's default
   * policy; set it when you need a specific policy (e.g., EU eIDAS
   * qualified time-stamps).
   */
  reqPolicyOid?: string;
  /**
   * Optional logical id for the TSA — surfaces in the anchor's
   * `tsa_key_id` field for operator-side audit. Default:
   * derived from the endpoint URL.
   */
  tsaKeyId?: string;
  /** Optional clock override for the anchor's `timestamp` field. */
  now?: () => string;
}

export class Rfc3161TimestampAuthority implements TimestampAuthority {
  readonly kind = RFC3161_ANCHOR_KIND;
  readonly keyId: string;
  /**
   * No public-key PEM ships with the anchor; cert chain validation is
   * operator-supplied. We surface an explanatory string so the
   * `publicKeyPem` field's contract is honest about its meaning here.
   */
  readonly publicKeyPem: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly reqPolicyOid: string | undefined;
  private readonly clock: () => string;

  constructor(opts: Rfc3161TimestampAuthorityOptions) {
    this.endpoint = opts.endpoint;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.reqPolicyOid = opts.reqPolicyOid;
    this.clock = opts.now ?? (() => new Date().toISOString());
    this.keyId = opts.tsaKeyId ?? `rfc3161:${opts.endpoint}`;
    this.publicKeyPem =
      "rfc3161-tst-embedded-cert-chain — verify via openssl ts -verify or a pkijs equivalent";
  }

  async anchor(recordHash: string): Promise<TimestampAnchor> {
    const built = buildTimeStampReq({ recordHash, reqPolicyOid: this.reqPolicyOid });
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "content-type": CONTENT_TYPE_TSREQ, "accept": CONTENT_TYPE_TSRESP },
      body: built.derBytes
    });
    if (!res.ok) {
      throw new Error(
        `Rfc3161TimestampAuthority.anchor: TSA POST failed: ${res.status} ${res.statusText}`
      );
    }
    const respBytes = Buffer.from(await res.arrayBuffer());
    const decoded = decodeTimeStampResp(respBytes);
    if (decoded.status !== 0 && decoded.status !== 1) {
      throw new Error(
        `Rfc3161TimestampAuthority.anchor: TSA rejected request: ${decoded.statusName} (status=${decoded.status})`
      );
    }
    if (!decoded.timeStampTokenDer) {
      throw new Error(
        `Rfc3161TimestampAuthority.anchor: TSA returned ${decoded.statusName} but no TimeStampToken`
      );
    }
    return {
      kind: RFC3161_ANCHOR_KIND,
      timestamp: this.clock(),
      tsa_key_id: this.keyId,
      record_hash: recordHash,
      // Store the entire TimeStampToken ContentInfo as base64 in the
      // signature field; operator-side verifier decodes + chain-validates.
      signature: decoded.timeStampTokenDer.toString("base64")
    };
  }
}

// ---------------------------------------------------------------------------
// Verifier — minimal sanity check + delegation pattern documentation
// ---------------------------------------------------------------------------

/**
 * Sanity-check a TimestampAnchor of kind "rfc3161":
 *   - kind === "rfc3161"
 *   - record_hash matches what the caller supplied
 *   - signature parses as base64 + non-empty
 *
 * Does NOT verify the embedded TimeStampToken's signature or cert
 * chain — that's the operator-supplied step. This function exists so
 * operator code can do the kind + binding check uniformly, then hand
 * the TimeStampToken bytes to their own (openssl ts, pkijs, etc.)
 * validator. Returns the decoded TST bytes on success for that
 * downstream handoff.
 */
export function inspectRfc3161Anchor(
  recordHash: string,
  anchor: TimestampAnchor
): { ok: boolean; reason?: string; timeStampTokenDer?: Buffer } {
  if (anchor.kind !== RFC3161_ANCHOR_KIND) {
    return { ok: false, reason: `expected kind '${RFC3161_ANCHOR_KIND}', got '${anchor.kind}'` };
  }
  if (anchor.record_hash !== recordHash) {
    return { ok: false, reason: "record_hash mismatch (anchor witnessed a different record)" };
  }
  let tst: Buffer;
  try { tst = Buffer.from(anchor.signature, "base64"); }
  catch { return { ok: false, reason: "signature is not valid base64" }; }
  if (tst.length === 0) return { ok: false, reason: "empty TimeStampToken" };
  // Sanity: TST must be a SEQUENCE (ContentInfo).
  try {
    const root = decodeTLV(tst, 0);
    if (root.tag !== 0x30) {
      return { ok: false, reason: `TST root is not SEQUENCE (got 0x${root.tag.toString(16)})` };
    }
  } catch (err) {
    return { ok: false, reason: `TST does not parse: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, timeStampTokenDer: tst };
}
