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
import { violation } from "./errors.js";
// Path segments that would reach into the prototype chain. The fact record fed to
// the gate is built from attacker-controlled telemetry/context/action parameters, so
// resolving these would let a request satisfy/evade an authority-defined predicate by
// reading inherited properties (e.g. "constructor"/"toString" always "exist").
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
function getPath(record, path) {
    let cur = record;
    for (const part of path.split(".")) {
        if (FORBIDDEN_PATH_SEGMENTS.has(part))
            return undefined;
        // Own-property only: never traverse the prototype chain.
        if (cur && typeof cur === "object" && Object.prototype.hasOwnProperty.call(cur, part)) {
            cur = cur[part];
        }
        else {
            return undefined;
        }
    }
    return cur;
}
function asNumber(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
/** Evaluate a single constraint. Returns true when satisfied. */
export function satisfies(constraint, record) {
    const actual = getPath(record, constraint.key);
    const expected = constraint.value;
    switch (constraint.op) {
        case "exists":
            return actual !== undefined && actual !== null;
        case "absent":
            return actual === undefined || actual === null;
        case "eq":
            return actual === expected;
        case "neq":
            return actual !== expected;
        case "in":
            return Array.isArray(expected) && expected.includes(actual);
        case "nin":
            return Array.isArray(expected) && !expected.includes(actual);
        case "lt":
        case "lte":
        case "gt":
        case "gte": {
            const a = asNumber(actual);
            const e = asNumber(expected);
            if (a === undefined || e === undefined)
                return false;
            if (constraint.op === "lt")
                return a < e;
            if (constraint.op === "lte")
                return a <= e;
            if (constraint.op === "gt")
                return a > e;
            return a >= e;
        }
        default:
            return false;
    }
}
/**
 * Evaluate every constraint against a record, returning a Violation for each
 * unsatisfied one. `invariantName` lets the caller attribute the failures to the
 * primitive that imposed them (e.g. "ward-boundary", "envelope-telemetry").
 */
export function evaluateConstraints(constraints, record, invariantName) {
    if (!constraints || constraints.length === 0)
        return [];
    const out = [];
    for (const c of constraints) {
        if (!satisfies(c, record)) {
            out.push(violation(invariantName, c.message ?? `constraint failed: ${c.key} ${c.op}${c.value !== undefined ? ` ${JSON.stringify(c.value)}` : ""}`));
        }
    }
    return out;
}
/** True iff `subset` is contained in `superset`, treating "*" in superset as wildcard. */
export function isSubsetOf(subset, superset) {
    if (superset.includes("*"))
        return true;
    const allowed = new Set(superset);
    return subset.every((s) => allowed.has(s));
}
/** Items in `candidates` that are also present in `prohibited`. */
export function intersect(candidates, prohibited) {
    const set = new Set(prohibited);
    return candidates.filter((c) => set.has(c));
}
