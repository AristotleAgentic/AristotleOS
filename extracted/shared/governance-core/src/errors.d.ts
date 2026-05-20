/**
 * Failure model for the governance chain.
 *
 * Two layers:
 *  - `Violation` / `ValidationResult` — soft, accumulating results returned by
 *    validators. The Commit Gate collects these and turns them into a Deny.
 *  - `GovernanceError` — hard, throwable faults for conditions that mean the
 *    chain cannot even be evaluated (a referenced primitive is missing, a warrant
 *    cannot be consumed). The Commit Gate catches these and fails *closed*.
 *
 * The distinction matters: a Deny is a governed answer ("the chain is complete
 * and the answer is no"); a FailClosed is the refusal to answer at all because
 * the chain is incomplete. Both are recorded, but they are not the same thing.
 */
/** A single broken invariant, named so tests and the GEL Record can cite it. */
export interface Violation {
    /** Stable invariant identifier, e.g. "warrant-non-replayable". */
    invariant: string;
    /** Human-readable detail. */
    detail: string;
}
export type ValidationResult = {
    ok: true;
    violations: [];
} | {
    ok: false;
    violations: Violation[];
};
export declare function valid(): ValidationResult;
export declare function invalid(violations: Violation[]): ValidationResult;
export declare function violation(invariant: string, detail: string): Violation;
/** Fold a list of violations into a single result. */
export declare function fromViolations(violations: Violation[]): ValidationResult;
/** Combine multiple results, accumulating every violation. */
export declare function combine(...results: ValidationResult[]): ValidationResult;
/** Error codes for hard, fail-closed faults. */
export type GovernanceErrorCode = "mae-not-found" | "ward-not-found" | "authority-envelope-not-found" | "warrant-not-found" | "commit-gate-not-found" | "warrant-already-consumed" | "warrant-not-consumable" | "nonce-replayed" | "federation-agreement-not-found" | "chain-incomplete" | "signing-key-unknown";
export declare class GovernanceError extends Error {
    readonly code: GovernanceErrorCode;
    readonly detail?: string;
    constructor(code: GovernanceErrorCode, detail?: string);
}
