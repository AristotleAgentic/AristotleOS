/**
 * Canonical hashing and signing.
 *
 * Every primitive in the chain is hashable and signable so that the GEL Record
 * can prove authority *lineage*, not merely event occurrence. Hashing is over a
 * canonical (recursively key-sorted) JSON form so that two structurally-equal
 * artifacts always hash identically regardless of key order.
 *
 * Signing is abstracted behind `Keyring`. The default `HmacKeyring` is
 * deterministic and dependency-free (good for fixtures and tests). Ed25519 is
 * supported for deployments that hold real signing keys; the same `Signature`
 * shape carries either. Secrets/private keys live in the keyring, never in the
 * artifacts.
 */

import { createHash, createHmac, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

export type SignatureAlgorithm = "hmac-sha256" | "ed25519";

export interface Signature {
  keyId: string;
  algorithm: SignatureAlgorithm;
  /** hex (hmac) or base64 (ed25519). */
  value: string;
  signedAt: string;
}

/** Recursively sort object keys to produce a stable serialization. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** SHA-256 hex digest of the canonical form of `value`. */
export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

const OMIT_FROM_POLICY_HASH = new Set(["signatures", "policy_hash"]);
const OMIT_FROM_SIGNATURE = new Set(["signatures"]);
const OMIT_FROM_GEL_HASH = new Set(["signatures", "gel_record_hash"]);

function omit(obj: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) if (!keys.has(k)) out[k] = obj[k];
  return out;
}

/** policy_hash = hash over the artifact excluding its own signatures and policy_hash. */
export function computePolicyHash(obj: Record<string, unknown>): string {
  return hashCanonical(omit(obj, OMIT_FROM_POLICY_HASH));
}

/** gel_record_hash = hash over the record excluding its signatures and own hash. */
export function computeGelRecordHash(obj: Record<string, unknown>): string {
  return hashCanonical(omit(obj, OMIT_FROM_GEL_HASH));
}

/** Pluggable signer/verifier. */
export interface Keyring {
  sign(keyId: string, data: string): Signature;
  verify(data: string, signature: Signature): boolean;
  has(keyId: string): boolean;
}

/**
 * Deterministic HMAC keyring. The "public" verification path uses the same shared
 * secret — appropriate for tests/fixtures and single-trust-domain deployments.
 * Cross-domain federation should prefer ed25519 via {@link Ed25519Keyring}.
 */
export class HmacKeyring implements Keyring {
  private readonly secrets = new Map<string, string>();

  constructor(secrets: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(secrets)) this.secrets.set(k, v);
  }

  addKey(keyId: string, secret: string): this {
    this.secrets.set(keyId, secret);
    return this;
  }

  has(keyId: string): boolean {
    return this.secrets.has(keyId);
  }

  sign(keyId: string, data: string): Signature {
    const secret = this.secrets.get(keyId);
    if (!secret) throw new Error(`unknown signing key: ${keyId}`);
    const value = createHmac("sha256", secret).update(data).digest("hex");
    return { keyId, algorithm: "hmac-sha256", value, signedAt: new Date().toISOString() };
  }

  verify(data: string, signature: Signature): boolean {
    if (signature.algorithm !== "hmac-sha256") return false;
    const secret = this.secrets.get(signature.keyId);
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(data).digest("hex");
    return timingSafeEqualHex(expected, signature.value);
  }
}

/** Ed25519 keyring for real cross-domain trust. */
export class Ed25519Keyring implements Keyring {
  private readonly priv = new Map<string, ReturnType<typeof createPrivateKey>>();
  private readonly pub = new Map<string, ReturnType<typeof createPublicKey>>();

  addKeyPair(keyId: string, privatePem: string, publicPem: string): this {
    this.priv.set(keyId, createPrivateKey(privatePem));
    this.pub.set(keyId, createPublicKey(publicPem));
    return this;
  }

  addPublicKey(keyId: string, publicPem: string): this {
    this.pub.set(keyId, createPublicKey(publicPem));
    return this;
  }

  has(keyId: string): boolean {
    return this.pub.has(keyId);
  }

  sign(keyId: string, data: string): Signature {
    const key = this.priv.get(keyId);
    if (!key) throw new Error(`unknown signing key: ${keyId}`);
    const value = edSign(null, Buffer.from(data), key).toString("base64");
    return { keyId, algorithm: "ed25519", value, signedAt: new Date().toISOString() };
  }

  verify(data: string, signature: Signature): boolean {
    if (signature.algorithm !== "ed25519") return false;
    const key = this.pub.get(signature.keyId);
    if (!key) return false;
    return edVerify(null, Buffer.from(data), key, Buffer.from(signature.value, "base64"));
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Produce a signature over an artifact (excluding its `signatures` field). */
export function signObject(keyring: Keyring, keyId: string, obj: Record<string, unknown>): Signature {
  return keyring.sign(keyId, canonicalize(omit(obj, OMIT_FROM_SIGNATURE)));
}

/**
 * Verify every signature on an artifact. Empty signature list => unverifiable => false.
 *
 * `allowedKeyIds` (optional) constrains which `keyId`s the artifact may have been
 * signed by — when provided, any signature whose `keyId` is NOT in the set fails
 * verification BEFORE the cryptographic check is even attempted. This is the
 * issuer→key binding mechanism: it stops a key trusted for tenant B from forging
 * an artifact for tenant A in a multi-tenant deployment, even though both keys
 * live in the same global keyring.
 *
 * Pass `undefined` (or omit) to preserve the legacy behavior of "any key the
 * keyring knows about is acceptable". Validators derive the appropriate set
 * from the parent authority (MAE.signing_keys) and pass it down.
 */
export function verifyObjectSignatures(
  keyring: Keyring,
  obj: { signatures?: Signature[] } & Record<string, unknown>,
  allowedKeyIds?: ReadonlySet<string>,
): boolean {
  const sigs = obj.signatures ?? [];
  if (sigs.length === 0) return false;
  if (allowedKeyIds && sigs.some((s) => !allowedKeyIds.has(s.keyId))) return false;
  const data = canonicalize(omit(obj, OMIT_FROM_SIGNATURE));
  return sigs.every((s) => keyring.verify(data, s));
}

/** Sign a GEL record over its content excluding `signatures` (but including its hash). */
export function signGelRecord(keyring: Keyring, keyId: string, record: Record<string, unknown>): Signature {
  return keyring.sign(keyId, canonicalize(omit(record, OMIT_FROM_SIGNATURE)));
}

export function verifyGelRecordSignatures(keyring: Keyring, record: { signatures?: Signature[] } & Record<string, unknown>): boolean {
  const sigs = record.signatures ?? [];
  if (sigs.length === 0) return false;
  const data = canonicalize(omit(record, OMIT_FROM_SIGNATURE));
  return sigs.every((s) => keyring.verify(data, s));
}
