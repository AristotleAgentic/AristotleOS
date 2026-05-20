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
import { type ScopeFilter } from "./tenancy.js";
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
    /** True for a per-tenant/per-MAE subset (verified per-record, not by back-links). */
    scoped: boolean;
    records: GELRecord[];
    /** Hash over the bundle content (excludes bundle_id, bundle_hash, signature). */
    bundle_hash: string;
    signature: Signature;
}
/**
 * Export the GEL chain as a signed, self-verifying evidence bundle. With a scope
 * `filter` it exports only one tenant's/MAE's records (verified per-record, since
 * a filtered subset is not a contiguous hash-chain) — so a tenant's compliance
 * export never leaks another tenant's evidence.
 */
export declare function exportEvidence(store: GovernanceStore, keyring: Keyring, signKeyId: string, filter?: ScopeFilter): EvidenceBundle;
/**
 * Verify an evidence bundle offline: bundle hash integrity, bundle signature,
 * internal GEL hash-chain, and the count/head consistency. A keyring holding the
 * relevant public key (or HMAC secret) is required.
 */
export declare function verifyEvidenceBundle(bundle: EvidenceBundle, keyring: Keyring): ValidationResult;
