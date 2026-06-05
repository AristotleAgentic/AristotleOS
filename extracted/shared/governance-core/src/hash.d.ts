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
export type SignatureAlgorithm = "hmac-sha256" | "ed25519";
export interface Signature {
    keyId: string;
    algorithm: SignatureAlgorithm;
    /** hex (hmac) or base64 (ed25519). */
    value: string;
    signedAt: string;
}
/** Recursively sort object keys to produce a stable serialization. */
export declare function canonicalize(value: unknown): string;
/** SHA-256 hex digest of the canonical form of `value`. */
export declare function hashCanonical(value: unknown): string;
/** policy_hash = hash over the artifact excluding its own signatures and policy_hash. */
export declare function computePolicyHash(obj: Record<string, unknown>): string;
/** gel_record_hash = hash over the record excluding its signatures and own hash. */
export declare function computeGelRecordHash(obj: Record<string, unknown>): string;
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
export declare class HmacKeyring implements Keyring {
    private readonly secrets;
    constructor(secrets?: Record<string, string>);
    addKey(keyId: string, secret: string): this;
    has(keyId: string): boolean;
    sign(keyId: string, data: string): Signature;
    verify(data: string, signature: Signature): boolean;
}
/** Ed25519 keyring for real cross-domain trust. */
export declare class Ed25519Keyring implements Keyring {
    private readonly priv;
    private readonly pub;
    addKeyPair(keyId: string, privatePem: string, publicPem: string): this;
    addPublicKey(keyId: string, publicPem: string): this;
    has(keyId: string): boolean;
    sign(keyId: string, data: string): Signature;
    verify(data: string, signature: Signature): boolean;
}
/** Produce a signature over an artifact (excluding its `signatures` field). */
export declare function signObject(keyring: Keyring, keyId: string, obj: Record<string, unknown>): Signature;
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
export declare function verifyObjectSignatures(keyring: Keyring, obj: {
    signatures?: Signature[];
} & Record<string, unknown>, allowedKeyIds?: ReadonlySet<string>): boolean;
/** Sign a GEL record over its content excluding `signatures` (but including its hash). */
export declare function signGelRecord(keyring: Keyring, keyId: string, record: Record<string, unknown>): Signature;
export declare function verifyGelRecordSignatures(keyring: Keyring, record: {
    signatures?: Signature[];
} & Record<string, unknown>): boolean;
