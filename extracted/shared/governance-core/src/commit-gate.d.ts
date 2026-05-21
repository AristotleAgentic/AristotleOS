/**
 * The Commit Gate — the Warden at the execution boundary.
 *
 * The gate does not author policy. It evaluates whether a *proposed* act is
 * admissible under a *complete* authority chain, and it does so BEFORE the act
 * produces consequence. It implements the spec evaluator in fixed order:
 *
 *   MAE validity -> Ward validity -> Authority Envelope validity -> Warrant
 *   validity -> action classification -> context admissibility -> telemetry ->
 *   revocation state -> temporal -> replay protection -> GEL precommit record.
 *
 * It returns Allow | Deny | Escalate | FailClosed and NEVER allows execution if
 * the chain is incomplete. The two terminal guarantees:
 *   - On Allow the Warrant is consumed (single-use) BEFORE the receipt is written
 *     — authority precedes attribution.
 *   - Any missing primitive or non-consumable warrant fails CLOSED, with evidence.
 */
import { type Keyring } from "./hash.js";
import type { GovernanceStore } from "./store.js";
import type { CommitDecision, CommitRequest, ExecutionResult, GELRecord } from "./types.js";
export interface CommitOptions {
    now?: Date;
    /** Maximum accepted age/future skew for CommitRequest.presented_at. */
    presentationSkewMs?: number;
    keyring: Keyring;
    /** Key the gate signs GEL records with. */
    signKeyId: string;
}
export declare function evaluateCommit(store: GovernanceStore, request: CommitRequest, opts: CommitOptions): CommitDecision;
/**
 * Record the outcome of a permitted execution as a SEPARATE GEL record. Keeping
 * admissibility and execution as distinct records is the ledger expression of
 * the ontology: authority, execution and attribution are not the same event.
 */
export declare function recordExecutionOutcome(store: GovernanceStore, opts: CommitOptions, allowDecision: CommitDecision, result: ExecutionResult): GELRecord;
