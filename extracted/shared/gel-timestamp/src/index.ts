/**
 * @aristotle/gel-timestamp
 *
 * External timestamp anchoring for AristotleOS GEL records.
 *
 * Closes the shippable portion of LIMITATIONS.md § 3 ("No external
 * timestamp authority"). A determined adversary with the operator's
 * signing key can backdate or forward-date GEL records — the chain
 * verifies, but the timestamp is operator-asserted. An external
 * timestamp authority (TSA) cuts the trust dependency by signing
 * (record_hash, ts) tuples with a key the operator does NOT control,
 * so backdating becomes detectable as a TSA-signature mismatch.
 *
 * This package ships:
 *
 *   - TimestampAuthority interface — the contract any TSA satisfies.
 *
 *   - TimestampAnchor data type — the externally-signed attestation
 *     that gets attached to a GEL record (or stored alongside it).
 *
 *   - LocalTimestampAuthority — a filesystem-backed TSA that
 *     Ed25519-signs (record_hash, ts) tuples with its own keypair and
 *     persists every anchor to a JSONL file. Useful for tests, local
 *     development, and as the reference implementation operators can
 *     use to validate the integration before pointing it at a real TSA.
 *
 *   - verifyTimestampAnchor — pure verification function: given a
 *     record_hash, an anchor, and the TSA's public key, returns
 *     { ok: boolean, reason?: string }.
 *
 * Real TSAs come in two flavours:
 *
 *   - RFC 3161 (CAdES / Authenticode / OpenSSL ts) — DER-encoded ASN.1
 *     TimeStampResp blobs from a network endpoint. A future
 *     @aristotle/gel-timestamp-rfc3161 package can implement the same
 *     TimestampAuthority interface and produce TimestampAnchors whose
 *     `kind: "rfc3161"` payload is the base64 of the TST.
 *
 *   - Sigstore Rekor / Fulcio — JSON-formatted transparency-log
 *     entries. A future @aristotle/gel-timestamp-sigstore package can
 *     implement the same interface and produce
 *     `kind: "sigstore"` anchors.
 *
 * Today the local implementation gives the substrate's verifier
 * something concrete to consume; swapping in a network TSA is a
 * one-package, no-substrate-change replacement.
 */

import { appendFileSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  type AristotleSigner,
  createEd25519Signer,
  deriveKeyId
} from "@aristotle/execution-control-runtime";
import {
  generateKeyPairSync,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify
} from "node:crypto";

// ---------------------------------------------------------------------------
// Anchor type
// ---------------------------------------------------------------------------

/**
 * A timestamp anchor is the externally-signed proof that a GEL record's
 * record_hash was witnessed by the TSA at a particular wall-clock time.
 * Attach it to a GEL record (via a `timestamp_anchor` field) or store
 * it alongside the chain.
 */
export interface TimestampAnchor {
  /** Implementation tag. "local-ed25519", "rfc3161", "sigstore", ... */
  kind: string;
  /** TSA-asserted wall-clock time the anchor was issued (ISO 8601). */
  timestamp: string;
  /** Stable id of the TSA's signing key (matches AristotleSigner.key_id format). */
  tsa_key_id: string;
  /** Record hash that this anchor witnesses (the GEL record's record_hash). */
  record_hash: string;
  /**
   * Base64-encoded signature over canonical-bytes(record_hash || timestamp).
   * For RFC 3161 implementations: base64 of the DER TimeStampToken.
   * For Sigstore: base64 of the bundle's signature.
   */
  signature: string;
}

// ---------------------------------------------------------------------------
// TimestampAuthority interface
// ---------------------------------------------------------------------------

export interface TimestampAuthority {
  /** Implementation tag — surfaces in TimestampAnchor.kind. */
  readonly kind: string;
  /** Stable id of the TSA's signing key. */
  readonly keyId: string;
  /** SPKI PEM of the TSA's public key for offline verification. */
  readonly publicKeyPem: string;
  /**
   * Witness a record_hash. Returns a TimestampAnchor that any holder of
   * the TSA's public key can later verify.
   */
  anchor(recordHash: string): Promise<TimestampAnchor> | TimestampAnchor;
}

// ---------------------------------------------------------------------------
// LocalTimestampAuthority — filesystem-backed reference implementation
// ---------------------------------------------------------------------------

export interface LocalTimestampAuthorityOptions {
  /** Path to the append-only JSONL anchor log. */
  ledgerPath: string;
  /**
   * The TSA's signer. If omitted, a fresh ephemeral Ed25519 keypair is
   * generated (clearly marked ephemeral; not suitable for production).
   */
  signer?: AristotleSigner;
  /**
   * Clock. Defaults to `() => new Date().toISOString()`. Provide a
   * deterministic clock for tests.
   */
  now?: () => string;
  /** fsync after each append. Default true. */
  fsync?: boolean;
}

/**
 * Filesystem-backed reference TSA. Holds its own Ed25519 keypair (or
 * accepts one from the caller), signs (record_hash || timestamp), and
 * appends each issued anchor to a JSONL ledger so a separate audit
 * process can reconstruct the witness history.
 *
 * The "external" guarantee comes from key custody: in production, the
 * TSA's private key must live in a separate operational domain from
 * the GEL signer. If the same operator holds both, the threat model
 * collapses back to the LIMITATIONS § 3 case. Document this when
 * deploying.
 */
export class LocalTimestampAuthority implements TimestampAuthority {
  readonly kind = "local-ed25519";
  readonly keyId: string;
  readonly publicKeyPem: string;
  private readonly signer: AristotleSigner;
  private readonly ledgerPath: string;
  private readonly clock: () => string;
  private readonly fsyncOnWrite: boolean;
  private writerFd: number | null = null;

  constructor(opts: LocalTimestampAuthorityOptions) {
    this.ledgerPath = opts.ledgerPath;
    this.clock = opts.now ?? (() => new Date().toISOString());
    this.fsyncOnWrite = opts.fsync ?? true;
    this.signer = opts.signer ?? (() => {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      return createEd25519Signer({
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
      });
    })();
    this.keyId = this.signer.key_id;
    this.publicKeyPem = this.signer.public_key_pem;
    mkdirSync(dirname(this.ledgerPath), { recursive: true });
  }

  anchor(recordHash: string): TimestampAnchor {
    const timestamp = this.clock();
    const material = canonicalAnchorMessage(recordHash, timestamp);
    const signature = this.signer.sign(material);
    const anchor: TimestampAnchor = {
      kind: this.kind,
      timestamp,
      tsa_key_id: this.keyId,
      record_hash: recordHash,
      signature
    };
    this.persist(anchor);
    return anchor;
  }

  close(): void {
    if (this.writerFd !== null) { closeSync(this.writerFd); this.writerFd = null; }
  }

  /** Load all anchors from the ledger. Useful for audit replay. */
  static loadLedger(path: string): TimestampAnchor[] {
    if (!existsSync(path)) return [];
    const data = readFileSync(path, "utf8");
    const out: TimestampAnchor[] = [];
    for (const line of data.split("\n")) {
      if (!line) continue;
      try {
        const a = JSON.parse(line) as TimestampAnchor;
        if (typeof a.record_hash === "string" && typeof a.signature === "string") out.push(a);
      } catch { /* skip truncated trailing line */ }
    }
    return out;
  }

  private persist(anchor: TimestampAnchor): void {
    if (this.writerFd === null) this.writerFd = openSync(this.ledgerPath, "a");
    appendFileSync(this.writerFd, JSON.stringify(anchor) + "\n");
    if (this.fsyncOnWrite) {
      try { fsyncSync(this.writerFd); } catch { /* tmpfs */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a TimestampAnchor against the TSA's public key. Does NOT trust
 * any field in the anchor for verification material — the caller must
 * supply the public key out-of-band (this is the whole point of an
 * external TSA).
 */
export function verifyTimestampAnchor(
  recordHash: string,
  anchor: TimestampAnchor,
  tsaPublicKeyPem: string
): { ok: boolean; reason?: string } {
  if (anchor.record_hash !== recordHash) {
    return { ok: false, reason: "record_hash mismatch (anchor witnessed a different record)" };
  }
  if (anchor.kind !== "local-ed25519") {
    // Future: dispatch on kind for RFC 3161 / Sigstore. Today only the
    // local implementation ships, so any other kind is unsupported.
    return { ok: false, reason: `unsupported anchor kind: ${anchor.kind}` };
  }
  let pubKey;
  try { pubKey = createPublicKey({ key: tsaPublicKeyPem, format: "pem" }); }
  catch { return { ok: false, reason: "invalid TSA public key PEM" }; }
  // Verify TSA key_id matches the provided key (catches "wrong TSA's
  // key" mistakes early instead of producing a confusing crypto error).
  const expectedKeyId = deriveKeyId(tsaPublicKeyPem);
  if (anchor.tsa_key_id !== expectedKeyId) {
    return { ok: false, reason: `TSA key id mismatch: anchor=${anchor.tsa_key_id} provided=${expectedKeyId}` };
  }
  let sig: Buffer;
  try { sig = Buffer.from(anchor.signature, "base64"); }
  catch { return { ok: false, reason: "malformed signature" }; }
  const material = canonicalAnchorMessage(anchor.record_hash, anchor.timestamp);
  const ok = cryptoVerify(null, Buffer.from(material, "utf8"), pubKey, sig);
  if (!ok) return { ok: false, reason: "signature verification failed" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Canonical anchor message
// ---------------------------------------------------------------------------

/**
 * The canonical bytes a TSA signs over. Pinned format so RFC 3161 /
 * Sigstore implementations can produce verifier-compatible anchors:
 *
 *   aristotle.gel-timestamp.v1:<record_hash>:<timestamp>
 *
 * Any deviation produces a verification failure, which is the desired
 * behavior — it catches accidental format drift across implementations.
 */
export function canonicalAnchorMessage(recordHash: string, timestamp: string): string {
  return `aristotle.gel-timestamp.v1:${recordHash}:${timestamp}`;
}
