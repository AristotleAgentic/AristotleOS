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
export function valid() {
    return { ok: true, violations: [] };
}
export function invalid(violations) {
    return { ok: false, violations };
}
export function violation(invariant, detail) {
    return { invariant, detail };
}
/** Fold a list of violations into a single result. */
export function fromViolations(violations) {
    return violations.length === 0 ? valid() : invalid(violations);
}
/** Combine multiple results, accumulating every violation. */
export function combine(...results) {
    const all = results.flatMap((r) => r.violations);
    return fromViolations(all);
}
export class GovernanceError extends Error {
    code;
    detail;
    constructor(code, detail) {
        super(detail ? `${code}: ${detail}` : code);
        this.name = "GovernanceError";
        this.code = code;
        this.detail = detail;
    }
}
