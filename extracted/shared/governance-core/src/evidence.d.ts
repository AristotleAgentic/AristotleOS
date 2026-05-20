/**
 * Portable governance evidence bundles.
 *
 * A commercial governance OS must be able to hand an auditor or regulator a
 * self-contained, offline-verifiable record of what happened and under whose
 * authority. An EvidenceBundle packages the GEL chain plus a bundle-level hash
 * and signature, so a third party can verify it WITHOUT access to the live
 * system: recompute the bundle hash, check the signature, and re-verify the
 * internal hash-chain.
 */
import { type Keyring, type Signature } from "./hash.js";
import { type ValidationResult } from "./errors.js";
import type { GELRecord } from "./types.js";
import type { GovernanceStore } from "./store.js";
export interface EvidenceBundle {
    bundle_id: string;
    generated_at: string;
    record_count: number;
    genesis_hash: string;
    head_hash: string;
    /** Whether the chain verified at export time. */
    chain_intact: boolean;
    records: GELRecord[];
    /** Hash over the bundle content (excludes bundle_id, bundle_hash, signature). */
    bundle_hash: string;
    signature: Signature;
}
/** Export the GEL chain as a signed, self-verifying evidence bundle. */
export declare function exportEvidence(store: GovernanceStore, keyring: Keyring, signKeyId: string): EvidenceBundle;
/**
 * Verify an evidence bundle offline: bundle hash integrity, bundle signature,
 * internal GEL hash-chain, and the count/head consistency. A keyring holding the
 * relevant public key (or HMAC secret) is required.
 */
export declare function verifyEvidenceBundle(bundle: EvidenceBundle, keyring: Keyring): ValidationResult;
