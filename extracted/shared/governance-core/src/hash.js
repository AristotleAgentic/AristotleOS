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
/** Recursively sort object keys to produce a stable serialization. */
export function canonicalize(value) {
    return JSON.stringify(sortDeep(value));
}
function sortDeep(value) {
    if (Array.isArray(value))
        return value.map(sortDeep);
    if (value && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortDeep(value[key]);
        }
        return out;
    }
    return value;
}
/** SHA-256 hex digest of the canonical form of `value`. */
export function hashCanonical(value) {
    return createHash("sha256").update(canonicalize(value)).digest("hex");
}
const OMIT_FROM_POLICY_HASH = new Set(["signatures", "policy_hash"]);
const OMIT_FROM_SIGNATURE = new Set(["signatures"]);
const OMIT_FROM_GEL_HASH = new Set(["signatures", "gel_record_hash"]);
function omit(obj, keys) {
    const out = {};
    for (const k of Object.keys(obj))
        if (!keys.has(k))
            out[k] = obj[k];
    return out;
}
/** policy_hash = hash over the artifact excluding its own signatures and policy_hash. */
export function computePolicyHash(obj) {
    return hashCanonical(omit(obj, OMIT_FROM_POLICY_HASH));
}
/** gel_record_hash = hash over the record excluding its signatures and own hash. */
export function computeGelRecordHash(obj) {
    return hashCanonical(omit(obj, OMIT_FROM_GEL_HASH));
}
/**
 * Deterministic HMAC keyring. The "public" verification path uses the same shared
 * secret — appropriate for tests/fixtures and single-trust-domain deployments.
 * Cross-domain federation should prefer ed25519 via {@link Ed25519Keyring}.
 */
export class HmacKeyring {
    secrets = new Map();
    constructor(secrets = {}) {
        for (const [k, v] of Object.entries(secrets))
            this.secrets.set(k, v);
    }
    addKey(keyId, secret) {
        this.secrets.set(keyId, secret);
        return this;
    }
    has(keyId) {
        return this.secrets.has(keyId);
    }
    sign(keyId, data) {
        const secret = this.secrets.get(keyId);
        if (!secret)
            throw new Error(`unknown signing key: ${keyId}`);
        const value = createHmac("sha256", secret).update(data).digest("hex");
        return { keyId, algorithm: "hmac-sha256", value, signedAt: new Date().toISOString() };
    }
    verify(data, signature) {
        if (signature.algorithm !== "hmac-sha256")
            return false;
        const secret = this.secrets.get(signature.keyId);
        if (!secret)
            return false;
        const expected = createHmac("sha256", secret).update(data).digest("hex");
        return timingSafeEqualHex(expected, signature.value);
    }
}
/** Ed25519 keyring for real cross-domain trust. */
export class Ed25519Keyring {
    priv = new Map();
    pub = new Map();
    addKeyPair(keyId, privatePem, publicPem) {
        this.priv.set(keyId, createPrivateKey(privatePem));
        this.pub.set(keyId, createPublicKey(publicPem));
        return this;
    }
    addPublicKey(keyId, publicPem) {
        this.pub.set(keyId, createPublicKey(publicPem));
        return this;
    }
    has(keyId) {
        return this.pub.has(keyId);
    }
    sign(keyId, data) {
        const key = this.priv.get(keyId);
        if (!key)
            throw new Error(`unknown signing key: ${keyId}`);
        const value = edSign(null, Buffer.from(data), key).toString("base64");
        return { keyId, algorithm: "ed25519", value, signedAt: new Date().toISOString() };
    }
    verify(data, signature) {
        if (signature.algorithm !== "ed25519")
            return false;
        const key = this.pub.get(signature.keyId);
        if (!key)
            return false;
        return edVerify(null, Buffer.from(data), key, Buffer.from(signature.value, "base64"));
    }
}
function timingSafeEqualHex(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
/** Produce a signature over an artifact (excluding its `signatures` field). */
export function signObject(keyring, keyId, obj) {
    return keyring.sign(keyId, canonicalize(omit(obj, OMIT_FROM_SIGNATURE)));
}
/** Verify every signature on an artifact. Empty signature list => unverifiable => false. */
export function verifyObjectSignatures(keyring, obj) {
    const sigs = obj.signatures ?? [];
    if (sigs.length === 0)
        return false;
    const data = canonicalize(omit(obj, OMIT_FROM_SIGNATURE));
    return sigs.every((s) => keyring.verify(data, s));
}
/** Sign a GEL record over its content excluding `signatures` (but including its hash). */
export function signGelRecord(keyring, keyId, record) {
    return keyring.sign(keyId, canonicalize(omit(record, OMIT_FROM_SIGNATURE)));
}
export function verifyGelRecordSignatures(keyring, record) {
    const sigs = record.signatures ?? [];
    if (sigs.length === 0)
        return false;
    const data = canonicalize(omit(record, OMIT_FROM_SIGNATURE));
    return sigs.every((s) => keyring.verify(data, s));
}
