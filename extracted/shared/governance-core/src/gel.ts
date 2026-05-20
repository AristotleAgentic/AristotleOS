/**
 * Governance Evidence Ledger (GEL) records.
 *
 * A GEL Record is the Receipt. It is not a log line. Its purpose is to prove the
 * *authority lineage* of an act — under which MAE, inside which Ward, through
 * which Authority Envelope, by what Warrant, at which Commit Gate — and to make
 * that proof tamper-evident by hash-chaining each record to its predecessor.
 *
 * The ledger records three things and keeps them distinct (per the ontology):
 *   - admissibility  : the Commit Gate's allow/deny/escalate/fail-closed decision
 *   - execution      : the outcome of the consequence, recorded after the act
 *   - (attribution is *derived* from these records, never written ahead of them)
 */

import { computeGelRecordHash, signGelRecord, verifyGelRecordSignatures, type Keyring } from "./hash.js";
import { combine, fromViolations, valid, violation, type ValidationResult } from "./errors.js";
import type { GELRecord } from "./types.js";
import type { GovernanceStore } from "./store.js";

/** The hash that precedes the first record in any chain. */
export const GENESIS_HASH = "0".repeat(64);

/** A GEL record before the store assigns its position, hash and signature. */
export type GelDraft = Omit<GELRecord, "sequence" | "previous_gel_hash" | "gel_record_hash" | "signatures">;

/**
 * Finalize a draft into the chain: assign sequence + previous hash, compute the
 * record hash, sign it, and append. This is the only sanctioned way to extend
 * the ledger so the chain invariant cannot be violated by construction.
 */
export function finalizeAndAppend(store: GovernanceStore, keyring: Keyring, keyId: string, draft: GelDraft): GELRecord {
  const sequence = store.gelLength();
  const previous_gel_hash = store.gelHeadHash();
  const base = { ...draft, sequence, previous_gel_hash } as Record<string, unknown>;
  const gel_record_hash = computeGelRecordHash(base);
  const record = { ...base, gel_record_hash, signatures: [] } as unknown as GELRecord;
  record.signatures = [signGelRecord(keyring, keyId, record as unknown as Record<string, unknown>)];
  store.appendGelRecord(record);
  return record;
}

/**
 * Walk a GEL chain and verify it is intact: contiguous sequence, correct
 * back-links, recomputed content hashes, and (if a keyring is given) valid
 * signatures. Returns the first break as a violation.
 */
export function verifyGelChain(records: GELRecord[], keyring?: Keyring): ValidationResult {
  const results: ValidationResult[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.sequence !== i) {
      results.push(fromViolations([violation("gel-sequence-contiguous", `record ${i} has sequence ${r.sequence}`)]));
    }
    const expectedPrev = i === 0 ? GENESIS_HASH : records[i - 1].gel_record_hash;
    if (r.previous_gel_hash !== expectedPrev) {
      results.push(fromViolations([violation("gel-back-link", `record ${i} previous_gel_hash does not match predecessor`)]));
    }
    const recomputed = computeGelRecordHash(r as unknown as Record<string, unknown>);
    if (recomputed !== r.gel_record_hash) {
      results.push(fromViolations([violation("gel-tamper-evident", `record ${i} content hash mismatch (tampered?)`)]));
    }
    if (keyring && !verifyGelRecordSignatures(keyring, r as unknown as Record<string, unknown> & { signatures: GELRecord["signatures"] })) {
      results.push(fromViolations([violation("gel-signature", `record ${i} signature invalid`)]));
    }
  }
  return results.length === 0 ? valid() : combine(...results);
}

/**
 * Verify each record's own content hash (and signature, if a keyring is given)
 * WITHOUT back-link continuity — for a filtered/scoped subset that is not a
 * contiguous chain (e.g. a per-tenant evidence export).
 */
export function verifyGelRecords(records: GELRecord[], keyring?: Keyring): ValidationResult {
  const results: ValidationResult[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (computeGelRecordHash(r as unknown as Record<string, unknown>) !== r.gel_record_hash) {
      results.push(fromViolations([violation("gel-tamper-evident", `record ${i} content hash mismatch (tampered?)`)]));
    }
    if (keyring && !verifyGelRecordSignatures(keyring, r as unknown as Record<string, unknown> & { signatures: GELRecord["signatures"] })) {
      results.push(fromViolations([violation("gel-signature", `record ${i} signature invalid`)]));
    }
  }
  return results.length === 0 ? valid() : combine(...results);
}

/**
 * A GEL Record must prove the authority chain, not just that an event occurred.
 * For an allowed admissibility record that means every chain reference is present
 * and a warrant consumption proof exists (authority precedes attribution).
 */
export function assertAuthorityChainComplete(record: GELRecord): ValidationResult {
  const v = [] as ReturnType<typeof violation>[];
  const need: Array<[keyof GELRecord, string]> = [
    ["mae_id", "gel-chain-mae"],
    ["ward_id", "gel-chain-ward"],
    ["authority_envelope_id", "gel-chain-envelope"],
    ["warrant_id", "gel-chain-warrant"],
    ["commit_gate_id", "gel-chain-commit-gate"],
  ];
  for (const [field, inv] of need) {
    if (!record[field]) v.push(violation(inv, `allowed GEL record missing ${String(field)}`));
  }
  if (record.decision === "Allow" && record.record_kind === "admissibility" && !record.warrant_consumption_proof) {
    v.push(violation("gel-authority-before-attribution", "allowed record lacks warrant consumption proof"));
  }
  return fromViolations(v);
}
