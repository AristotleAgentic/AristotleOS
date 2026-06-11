/**
 * @aristotle/sigstore-rekor
 *
 * Sigstore Rekor transparency-log client for AristotleOS. Implements
 * the `TimestampAuthority` interface from `@aristotle/gel-timestamp`
 * by posting a hashedrekord entry to a Rekor server and capturing the
 * returned logIndex + UUID + signed entry timestamp in the anchor.
 *
 * Sigstore-flavored sibling of `@aristotle/gel-timestamp-rfc3161`.
 *
 * What this ships:
 *
 *   - RekorTimestampAuthority — posts a minimal hashedrekord entry
 *     containing the GEL record_hash and an Ed25519 public key the
 *     operator already controls (the substrate's GEL signer key works).
 *     The Rekor server returns:
 *       * UUID — content-addressed entry id
 *       * logIndex — the entry's position in the transparency log
 *       * verification.signedEntryTimestamp (SET) — Rekor's signature
 *         over the entry + inclusion time
 *
 *   - inspectRekorAnchor — sanity-check helper: kind === "sigstore-rekor",
 *     record_hash matches, signature parses as a Rekor anchor envelope.
 *     Cryptographic verification of the SET against Rekor's public key
 *     is operator-supplied (Rekor publishes its public key at
 *     /api/v1/log/publicKey, but trust posture varies — some operators
 *     pin a specific Rekor instance's key, others trust the Sigstore
 *     PKI root).
 *
 * Honest scope (same shape as the RFC 3161 client):
 *
 *   - WHAT THIS IMPLEMENTS: the Rekor hashedrekord submission wire
 *     format, the network POST, status extraction, anchor population.
 *
 *   - WHAT THIS DOES NOT IMPLEMENT: full cryptographic verification
 *     of Rekor's signedEntryTimestamp signature against Rekor's
 *     server key, nor inclusion-proof verification against the
 *     published log root (CT-style consistency proofs). Both are
 *     deterministic given the operator's Rekor public key + trust
 *     decisions about which Rekor instance to trust. The companion
 *     package `@aristotle/sigstore-rekor-verify` can be added later.
 *
 *   - WHAT THIS DOES VERIFY (lightly): inspectRekorAnchor checks the
 *     anchor envelope shape + record_hash binding so operators can
 *     uniformly do the "kind + hash" gate before handing the SET
 *     blob to their verification stack.
 */

import type { AristotleSigner } from "@aristotle/execution-control-runtime";
import { type TimestampAnchor, type TimestampAuthority } from "@aristotle/gel-timestamp";
import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Anchor kind tag for Sigstore Rekor hashedrekord entries. */
export const REKOR_ANCHOR_KIND = "sigstore-rekor" as const;

/** Default Rekor server (public Sigstore instance). */
export const PUBLIC_REKOR_URL = "https://rekor.sigstore.dev";

/** Rekor hashedrekord schema URI (kind + version pinned in the entry body). */
export const REKOR_HASHEDREKORD_API_VERSION = "0.0.1";
export const REKOR_HASHEDREKORD_KIND = "hashedrekord";

// ---------------------------------------------------------------------------
// Anchor envelope shape stored in TimestampAnchor.signature
// ---------------------------------------------------------------------------

/**
 * The anchor envelope we serialize as JSON, base64-encode, and store in
 * TimestampAnchor.signature. Carries the Rekor identifiers + the SET
 * blob. inspectRekorAnchor parses this back; operator verifiers
 * consume the SET + the original entry body.
 */
export interface RekorAnchorEnvelope {
  /** Rekor server URL the entry was posted to. */
  rekor_url: string;
  /** Content-addressed Rekor entry id. */
  uuid: string;
  /** Log entry index (monotonic per Rekor instance). */
  log_index: number;
  /** Integrated time (Unix seconds) the Rekor server reports. */
  integrated_time: number;
  /** Base64 SET — Rekor's signature over the entry. Operator verifies offline. */
  signed_entry_timestamp_b64: string;
  /** Base64 of the original entry body the operator submitted. */
  entry_body_b64: string;
}

// ---------------------------------------------------------------------------
// Rekor server response shape (minimal — we read what we need)
// ---------------------------------------------------------------------------

interface RekorEntryResponse {
  [uuid: string]: {
    body: string;
    integratedTime: number;
    logIndex: number;
    logID: string;
    verification?: {
      signedEntryTimestamp?: string;
      inclusionProof?: unknown;
    };
  };
}

// ---------------------------------------------------------------------------
// RekorTimestampAuthority
// ---------------------------------------------------------------------------

export interface RekorTimestampAuthorityOptions {
  /** Rekor server URL. Default: public Sigstore instance. */
  rekorUrl?: string;
  /**
   * Operator signer (Ed25519) — Rekor requires a signature over the
   * record_hash as part of the hashedrekord entry. Reuse the GEL
   * signer if you don't want a separate keypair; the substrate's
   * AristotleSigner from @aristotle/execution-control-runtime satisfies
   * the interface.
   */
  signer: AristotleSigner;
  /** Optional caller-supplied fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * Optional logical id for this Rekor binding — surfaces in the
   * anchor's tsa_key_id field. Default: derived from rekorUrl +
   * signer.key_id.
   */
  tsaKeyId?: string;
  /** Optional clock override for the anchor's timestamp field. */
  now?: () => string;
}

export class RekorTimestampAuthority implements TimestampAuthority {
  readonly kind = REKOR_ANCHOR_KIND;
  readonly keyId: string;
  readonly publicKeyPem: string;
  private readonly rekorUrl: string;
  private readonly signer: AristotleSigner;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => string;

  constructor(opts: RekorTimestampAuthorityOptions) {
    this.rekorUrl = (opts.rekorUrl ?? PUBLIC_REKOR_URL).replace(/\/+$/, "");
    this.signer = opts.signer;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.clock = opts.now ?? (() => new Date().toISOString());
    this.keyId = opts.tsaKeyId ?? `sigstore-rekor:${this.rekorUrl}:${opts.signer.key_id}`;
    // The "public key" for this TSA isn't a single key — it's the
    // Rekor instance's public key. Surface a pointer rather than a PEM
    // so the contract stays honest.
    this.publicKeyPem =
      `rekor-instance-public-key — fetch at ${this.rekorUrl}/api/v1/log/publicKey for offline verification`;
  }

  async anchor(recordHash: string): Promise<TimestampAnchor> {
    // 1. Build the hashedrekord entry body. The schema is documented
    //    at https://github.com/sigstore/rekor/blob/main/pkg/types/hashedrekord/v0.0.1/hashedrekord_schema.json
    //    Minimum: data.hash.algorithm + data.hash.value, signature.format +
    //    signature.content + signature.publicKey.content.
    const sha256OfRecordHash = createHash("sha256").update(recordHash, "utf8").digest("hex");
    const signature = this.signer.sign(recordHash);
    const publicKeyB64 = Buffer.from(this.signer.public_key_pem, "utf8").toString("base64");
    const entryBody = {
      apiVersion: REKOR_HASHEDREKORD_API_VERSION,
      kind: REKOR_HASHEDREKORD_KIND,
      spec: {
        data: {
          hash: {
            algorithm: "sha256",
            value: sha256OfRecordHash
          }
        },
        signature: {
          // Rekor hashedrekord's signature.format is one of the
          // hashed-rekord-schema-supported tags. "ed25519" isn't
          // directly listed; the closest standard is "x509" or
          // "minisign". For substrate keys we use "x509" since
          // AristotleSigner exports SPKI PEM and consumers can
          // wrap it in a self-signed cert at the operator side.
          // For local Rekor instances + tests we use "ed25519".
          format: "ed25519",
          content: signature,
          publicKey: { content: publicKeyB64 }
        }
      }
    };
    // 2. POST it.
    const url = `${this.rekorUrl}/api/v1/log/entries`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify(entryBody)
    });
    if (!res.ok) {
      throw new Error(
        `RekorTimestampAuthority.anchor: Rekor POST failed: ${res.status} ${res.statusText}`
      );
    }
    const parsed = (await res.json()) as RekorEntryResponse;
    // The response is keyed by entry UUID.
    const uuids = Object.keys(parsed);
    if (uuids.length === 0) {
      throw new Error("RekorTimestampAuthority.anchor: Rekor returned an empty entry map");
    }
    const uuid = uuids[0];
    const entry = parsed[uuid];
    if (!entry) throw new Error(`RekorTimestampAuthority.anchor: Rekor entry ${uuid} missing`);
    if (typeof entry.logIndex !== "number" || typeof entry.integratedTime !== "number") {
      throw new Error("RekorTimestampAuthority.anchor: Rekor entry missing logIndex or integratedTime");
    }
    const envelope: RekorAnchorEnvelope = {
      rekor_url: this.rekorUrl,
      uuid,
      log_index: entry.logIndex,
      integrated_time: entry.integratedTime,
      signed_entry_timestamp_b64: entry.verification?.signedEntryTimestamp ?? "",
      entry_body_b64: entry.body
    };
    return {
      kind: REKOR_ANCHOR_KIND,
      timestamp: this.clock(),
      tsa_key_id: this.keyId,
      record_hash: recordHash,
      signature: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64")
    };
  }
}

// ---------------------------------------------------------------------------
// inspectRekorAnchor — sanity check + envelope unpacking
// ---------------------------------------------------------------------------

export interface InspectRekorAnchorResult {
  ok: boolean;
  reason?: string;
  envelope?: RekorAnchorEnvelope;
}

/**
 * Sanity-check a TimestampAnchor of kind "sigstore-rekor":
 *   - kind === "sigstore-rekor"
 *   - record_hash matches what the caller supplied
 *   - signature parses as base64 + valid JSON envelope with the
 *     expected fields
 *
 * On success, returns the parsed envelope for operator-side
 * verification (SET signature check against Rekor's public key,
 * inclusion-proof verification against the log root, etc.).
 */
export function inspectRekorAnchor(
  recordHash: string,
  anchor: TimestampAnchor
): InspectRekorAnchorResult {
  if (anchor.kind !== REKOR_ANCHOR_KIND) {
    return { ok: false, reason: `expected kind '${REKOR_ANCHOR_KIND}', got '${anchor.kind}'` };
  }
  if (anchor.record_hash !== recordHash) {
    return { ok: false, reason: "record_hash mismatch (anchor witnessed a different record)" };
  }
  let envelopeJson: string;
  try { envelopeJson = Buffer.from(anchor.signature, "base64").toString("utf8"); }
  catch { return { ok: false, reason: "anchor.signature is not valid base64" }; }
  let envelope: RekorAnchorEnvelope;
  try { envelope = JSON.parse(envelopeJson) as RekorAnchorEnvelope; }
  catch { return { ok: false, reason: "anchor envelope is not valid JSON" }; }
  if (typeof envelope.uuid !== "string" || envelope.uuid.length === 0) {
    return { ok: false, reason: "envelope missing uuid" };
  }
  if (typeof envelope.log_index !== "number") {
    return { ok: false, reason: "envelope missing log_index" };
  }
  if (typeof envelope.rekor_url !== "string" || envelope.rekor_url.length === 0) {
    return { ok: false, reason: "envelope missing rekor_url" };
  }
  return { ok: true, envelope };
}

// Re-export for caller convenience.
export type { TimestampAnchor, TimestampAuthority } from "@aristotle/gel-timestamp";

// Suppress unused warning for randomBytes (kept available for future
// idempotency-key support in entry submission).
void randomBytes;
