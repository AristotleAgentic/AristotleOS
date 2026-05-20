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

import { Violation, violation } from "./errors.js";

export type ConstraintOp =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "nin"
  | "exists"
  | "absent";

export interface Constraint {
  /** Dotted path into the record being evaluated, e.g. "altitude_ft" or "geo.cell". */
  key: string;
  op: ConstraintOp;
  value?: unknown;
  /** Optional override for the violation detail. */
  message?: string;
}

function getPath(record: Record<string, unknown>, path: string): unknown {
  let cur: unknown = record;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Evaluate a single constraint. Returns true when satisfied. */
export function satisfies(constraint: Constraint, record: Record<string, unknown>): boolean {
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
      return Array.isArray(expected) && expected.includes(actual as never);
    case "nin":
      return Array.isArray(expected) && !expected.includes(actual as never);
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const a = asNumber(actual);
      const e = asNumber(expected);
      if (a === undefined || e === undefined) return false;
      if (constraint.op === "lt") return a < e;
      if (constraint.op === "lte") return a <= e;
      if (constraint.op === "gt") return a > e;
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
export function evaluateConstraints(
  constraints: Constraint[] | undefined,
  record: Record<string, unknown>,
  invariantName: string,
): Violation[] {
  if (!constraints || constraints.length === 0) return [];
  const out: Violation[] = [];
  for (const c of constraints) {
    if (!satisfies(c, record)) {
      out.push(
        violation(
          invariantName,
          c.message ?? `constraint failed: ${c.key} ${c.op}${c.value !== undefined ? ` ${JSON.stringify(c.value)}` : ""}`,
        ),
      );
    }
  }
  return out;
}

/** True iff `subset` is contained in `superset`, treating "*" in superset as wildcard. */
export function isSubsetOf(subset: string[], superset: string[]): boolean {
  if (superset.includes("*")) return true;
  const allowed = new Set(superset);
  return subset.every((s) => allowed.has(s));
}

/** Items in `candidates` that are also present in `prohibited`. */
export function intersect(candidates: string[], prohibited: string[]): string[] {
  const set = new Set(prohibited);
  return candidates.filter((c) => set.has(c));
}
