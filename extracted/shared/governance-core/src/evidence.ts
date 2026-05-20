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

import { hashCanonical, type Keyring, type Signature } from "./hash.js";
import { GENESIS_HASH, verifyGelChain, verifyGelRecords } from "./gel.js";
import { newId, nowIso } from "./ids.js";
import { combine, fromViolations, valid, violation, type ValidationResult } from "./errors.js";
import { scopeSnapshot, type ScopeFilter } from "./tenancy.js";
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

function digestInput(b: Pick<EvidenceBundle, "generated_at" | "record_count" | "genesis_hash" | "head_hash" | "chain_intact" | "scoped" | "records">) {
  return {
    generated_at: b.generated_at,
    record_count: b.record_count,
    genesis_hash: b.genesis_hash,
    head_hash: b.head_hash,
    chain_intact: b.chain_intact,
    scoped: b.scoped,
    records: b.records,
  };
}

/**
 * Export the GEL chain as a signed, self-verifying evidence bundle. With a scope
 * `filter` it exports only one tenant's/MAE's records (verified per-record, since
 * a filtered subset is not a contiguous hash-chain) — so a tenant's compliance
 * export never leaks another tenant's evidence.
 */
export function exportEvidence(store: GovernanceStore, keyring: Keyring, signKeyId: string, filter?: ScopeFilter): EvidenceBundle {
  const scoped = !!(filter && (filter.maeId || filter.tenantId));
  const records = scoped ? scopeSnapshot(store.toSnapshot(), filter).gel : store.getGelChain();
  const head_hash = records.length ? records[records.length - 1].gel_record_hash : GENESIS_HASH;
  const content = {
    generated_at: nowIso(),
    record_count: records.length,
    genesis_hash: GENESIS_HASH,
    head_hash,
    chain_intact: (scoped ? verifyGelRecords(records, keyring) : verifyGelChain(records, keyring)).ok,
    scoped,
    records,
  };
  const bundle_hash = hashCanonical(digestInput(content));
  return {
    bundle_id: newId("evb"),
    ...content,
    bundle_hash,
    signature: keyring.sign(signKeyId, bundle_hash),
  };
}

/**
 * Verify an evidence bundle offline: bundle hash integrity, bundle signature,
 * internal GEL hash-chain, and the count/head consistency. A keyring holding the
 * relevant public key (or HMAC secret) is required.
 */
export function verifyEvidenceBundle(bundle: EvidenceBundle, keyring: Keyring): ValidationResult {
  const results: ValidationResult[] = [];

  const recomputed = hashCanonical(digestInput(bundle));
  if (recomputed !== bundle.bundle_hash) {
    results.push(fromViolations([violation("evidence-bundle-hash", "bundle hash does not match content (tampered)")]));
  }
  if (!keyring.verify(bundle.bundle_hash, bundle.signature)) {
    results.push(fromViolations([violation("evidence-bundle-signature", "bundle signature failed verification")]));
  }
  if (bundle.record_count !== bundle.records.length) {
    results.push(fromViolations([violation("evidence-bundle-count", "record_count does not match records length")]));
  }
  const expectedHead = bundle.records.length ? bundle.records[bundle.records.length - 1].gel_record_hash : GENESIS_HASH;
  if (bundle.head_hash !== expectedHead) {
    results.push(fromViolations([violation("evidence-bundle-head", "head_hash does not match the last record")]));
  }
  // A scoped bundle is a filtered subset (not a contiguous chain): verify each
  // record's own hash + signature. A whole-chain bundle also verifies back-links.
  results.push(bundle.scoped ? verifyGelRecords(bundle.records, keyring) : verifyGelChain(bundle.records, keyring));

  return results.length ? combine(...results) : valid();
}
