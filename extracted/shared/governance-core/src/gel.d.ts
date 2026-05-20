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
import { type Keyring } from "./hash.js";
import { type ValidationResult } from "./errors.js";
import type { GELRecord } from "./types.js";
import type { GovernanceStore } from "./store.js";
/** The hash that precedes the first record in any chain. */
export declare const GENESIS_HASH: string;
/** A GEL record before the store assigns its position, hash and signature. */
export type GelDraft = Omit<GELRecord, "sequence" | "previous_gel_hash" | "gel_record_hash" | "signatures">;
/**
 * Finalize a draft into the chain: assign sequence + previous hash, compute the
 * record hash, sign it, and append. This is the only sanctioned way to extend
 * the ledger so the chain invariant cannot be violated by construction.
 */
export declare function finalizeAndAppend(store: GovernanceStore, keyring: Keyring, keyId: string, draft: GelDraft): GELRecord;
/**
 * Walk a GEL chain and verify it is intact: contiguous sequence, correct
 * back-links, recomputed content hashes, and (if a keyring is given) valid
 * signatures. Returns the first break as a violation.
 */
export declare function verifyGelChain(records: GELRecord[], keyring?: Keyring): ValidationResult;
/**
 * A GEL Record must prove the authority chain, not just that an event occurred.
 * For an allowed admissibility record that means every chain reference is present
 * and a warrant consumption proof exists (authority precedes attribution).
 */
export declare function assertAuthorityChainComplete(record: GELRecord): ValidationResult;
