/**
 * A compact declarative predicate language used wherever a primitive needs to
 * constrain a runtime fact: Ward boundary definitions (geofence, altitude,
 * network segment), Authority Envelope telemetry/operational limits, Governor
 * scope, and federation jurisdiction rules.
 *
 * Keeping the constraint shape uniform across primitives means the Commit Gate
 * evaluates boundary, telemetry, and jurisdiction checks through one evaluator,
 * and every failure is reportable with the same `Violation` vocabulary.
 */
import { Violation } from "./errors.js";
export type ConstraintOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "nin" | "exists" | "absent";
export interface Constraint {
    /** Dotted path into the record being evaluated, e.g. "altitude_ft" or "geo.cell". */
    key: string;
    op: ConstraintOp;
    value?: unknown;
    /** Optional override for the violation detail. */
    message?: string;
}
/** Evaluate a single constraint. Returns true when satisfied. */
export declare function satisfies(constraint: Constraint, record: Record<string, unknown>): boolean;
/**
 * Evaluate every constraint against a record, returning a Violation for each
 * unsatisfied one. `invariantName` lets the caller attribute the failures to the
 * primitive that imposed them (e.g. "ward-boundary", "envelope-telemetry").
 */
export declare function evaluateConstraints(constraints: Constraint[] | undefined, record: Record<string, unknown>, invariantName: string): Violation[];
/** True iff `subset` is contained in `superset`, treating "*" in superset as wildcard. */
export declare function isSubsetOf(subset: string[], superset: string[]): boolean;
/** Items in `candidates` that are also present in `prohibited`. */
export declare function intersect(candidates: string[], prohibited: string[]): string[];
