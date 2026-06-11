/**
 * @aristotle/time-machine — counterfactual replay primitive.
 *
 * Substrate audit #9 "Time Machine" was 35%: we had GEL replay
 * verification (does the chain still hash? would the recorded decision
 * still verify?) but not counterfactual replay (what if the WARD had a
 * different policy_version, or the envelope had different
 * allowed_actions, at the time the decision was made?).
 *
 * This package wraps `evaluateCommitGate` and produces a side-by-side
 * {@link CounterfactualDiff} between:
 *
 *   - the ORIGINAL decision (rebuilt by re-running the historical
 *     ward/envelope/runtimeRegister/action through the gate; assert
 *     determinism by checking decision + canonical_action_hash match
 *     the GEL record)
 *   - one or more COUNTERFACTUAL decisions (same action, different
 *     ward/envelope/runtimeRegister inputs)
 *
 * The output is a stable JSON shape (`CounterfactualDiff`) that policy
 * designers / auditors can read without needing access to the gate's
 * source. Use cases:
 *
 *   - "Would this week's tightened policy have refused last quarter's
 *     incident?"
 *   - "If we lower max_altitude_m by 50 m, how many historical ALLOWs
 *     flip to REFUSE?"
 *   - Insurance carrier wants a what-if on a denied claim's evidence
 *     bundle.
 *
 * The primitive is deterministic: same inputs in, same diff out.
 */

import {
  evaluateCommitGate,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type CommitGateDecision,
  type ExecutionControlReasonCode,
  type ExecutionControlDecision,
  type GelRecord,
  type RuntimeRegister,
  type WardManifest
} from "@aristotle/execution-control-runtime";

export interface CounterfactualInput {
  /** The action whose decision we're replaying. Should canonicalize to
   *  the same canonical_action_hash as the GEL record below; the
   *  primitive verifies this and reports a mismatch if not. */
  action: CanonicalActionInput;
  /** Original Ward / Envelope / Registers in effect when the GEL
   *  record was issued. */
  originalWard?: WardManifest | null;
  originalEnvelope?: AuthorityEnvelope | null;
  originalRuntimeRegister?: RuntimeRegister;
  /** The historical GEL record we want to counterfactual against. */
  historicalRecord: GelRecord;
  /** One or more counterfactual policy worlds. Each gets its own
   *  side-by-side diff entry in the result. */
  counterfactuals: Array<{
    name: string;
    ward?: WardManifest | null;
    authorityEnvelope?: AuthorityEnvelope | null;
    runtimeRegister?: RuntimeRegister;
    now?: string;
  }>;
  /** Evaluation clock for the ORIGINAL replay. Defaults to the GEL
   *  record's timestamp so envelope-expiry math is honest. */
  originalNow?: string;
}

export interface CounterfactualReplay {
  name: string;
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  /** Differences from the original decision. Empty when the
   *  counterfactual would have decided the same. */
  changed_from_original: {
    decision_changed: boolean;
    added_reason_codes: ExecutionControlReasonCode[];
    removed_reason_codes: ExecutionControlReasonCode[];
  };
  /** The full counterfactual decision (for callers that want detail). */
  raw: CommitGateDecision;
}

export interface CounterfactualDiff {
  /** True when the original replay reproduces the historical record's
   *  decision exactly. False indicates determinism drift (e.g. the
   *  original ward/envelope inputs supplied here don't match the ones
   *  in effect at record time). */
  original_reproduces_historical: boolean;
  /** What the gate returns when fed the ORIGINAL inputs today. */
  original: {
    decision: ExecutionControlDecision;
    reason_codes: ExecutionControlReasonCode[];
    canonical_action_hash: string;
  };
  /** What the GEL recorded historically. */
  historical: {
    decision: ExecutionControlDecision;
    reason_codes: ExecutionControlReasonCode[];
    canonical_action_hash: string;
    record_id: string;
    timestamp: string;
  };
  /** Per-counterfactual replay results. */
  counterfactuals: CounterfactualReplay[];
  /** Number of counterfactuals whose decision differs from the
   *  original (handy for "how many flips" summaries). */
  decisions_flipped: number;
}

/**
 * Run the counterfactual primitive and return a structured diff.
 */
export function runCounterfactual(input: CounterfactualInput): CounterfactualDiff {
  // Original replay — what does the gate say TODAY when fed the
  // original inputs? If this matches the historical record exactly,
  // we have determinism. If not, the caller fed us mismatched inputs
  // or the gate has drifted (e.g. a policy change reached production
  // between record-time and now).
  const originalNow = input.originalNow ?? input.historicalRecord.timestamp;
  const original = evaluateCommitGate({
    ward: input.originalWard,
    authorityEnvelope: input.originalEnvelope,
    action: input.action,
    runtimeRegister: input.originalRuntimeRegister ?? input.historicalRecord.runtime_register_snapshot,
    now: originalNow
  });

  const hist = input.historicalRecord;
  const originalReproduces =
    original.decision === hist.decision &&
    original.canonical_action_hash === hist.canonical_action_hash &&
    sameSet(original.reason_codes, hist.reason_codes);

  // Counterfactual replays — same action, different policy world.
  const counterfactuals: CounterfactualReplay[] = [];
  let flipped = 0;
  for (const cf of input.counterfactuals) {
    const cfDecision = evaluateCommitGate({
      ward: cf.ward ?? input.originalWard,
      authorityEnvelope: cf.authorityEnvelope ?? input.originalEnvelope,
      action: input.action,
      runtimeRegister: cf.runtimeRegister ?? input.originalRuntimeRegister ?? input.historicalRecord.runtime_register_snapshot,
      now: cf.now ?? originalNow
    });
    const decisionChanged = cfDecision.decision !== original.decision;
    if (decisionChanged) flipped++;
    counterfactuals.push({
      name: cf.name,
      decision: cfDecision.decision,
      reason_codes: cfDecision.reason_codes,
      changed_from_original: {
        decision_changed: decisionChanged,
        added_reason_codes: diff(cfDecision.reason_codes, original.reason_codes),
        removed_reason_codes: diff(original.reason_codes, cfDecision.reason_codes)
      },
      raw: cfDecision
    });
  }

  return {
    original_reproduces_historical: originalReproduces,
    original: {
      decision: original.decision,
      reason_codes: original.reason_codes,
      canonical_action_hash: original.canonical_action_hash
    },
    historical: {
      decision: hist.decision,
      reason_codes: hist.reason_codes,
      canonical_action_hash: hist.canonical_action_hash,
      record_id: hist.record_id,
      timestamp: hist.timestamp
    },
    counterfactuals,
    decisions_flipped: flipped
  };
}

/**
 * Sweep helper. Given a list of historical records (e.g. a quarter's
 * worth of decisions) and ONE counterfactual policy world, count how
 * many historical decisions would have changed. The caller supplies an
 * `actionResolver` because the GEL stores `canonical_action_hash`, not
 * the action material itself.
 */
export interface CounterfactualSweepInput {
  records: GelRecord[];
  resolveAction: (record: GelRecord) => CanonicalActionInput | null;
  resolveOriginal: (record: GelRecord) => {
    ward?: WardManifest | null;
    envelope?: AuthorityEnvelope | null;
  };
  counterfactual: {
    name: string;
    ward?: WardManifest | null;
    envelope?: AuthorityEnvelope | null;
    runtimeRegister?: RuntimeRegister;
  };
}

export interface CounterfactualSweepResult {
  name: string;
  total_records: number;
  resolved_records: number;
  unresolved_records: number;
  /** Decisions that flipped to a different value under the
   *  counterfactual policy. */
  flipped: Array<{
    record_id: string;
    historical_decision: ExecutionControlDecision;
    counterfactual_decision: ExecutionControlDecision;
  }>;
  /** Per-transition counters, e.g. ALLOW_to_REFUSE: 5. */
  transitions: Record<string, number>;
}

export function runCounterfactualSweep(input: CounterfactualSweepInput): CounterfactualSweepResult {
  const flipped: CounterfactualSweepResult["flipped"] = [];
  const transitions: Record<string, number> = {};
  let resolved = 0;
  for (const rec of input.records) {
    const action = input.resolveAction(rec);
    if (!action) continue;
    resolved++;
    const orig = input.resolveOriginal(rec);
    const diff = runCounterfactual({
      action,
      originalWard: orig.ward ?? null,
      originalEnvelope: orig.envelope ?? null,
      originalRuntimeRegister: rec.runtime_register_snapshot,
      historicalRecord: rec,
      counterfactuals: [{
        name: input.counterfactual.name,
        ward: input.counterfactual.ward ?? null,
        authorityEnvelope: input.counterfactual.envelope ?? null,
        runtimeRegister: input.counterfactual.runtimeRegister
      }]
    });
    const cf = diff.counterfactuals[0];
    if (cf.changed_from_original.decision_changed) {
      flipped.push({
        record_id: rec.record_id,
        historical_decision: rec.decision,
        counterfactual_decision: cf.decision
      });
      const key = `${rec.decision}_to_${cf.decision}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
    }
  }
  return {
    name: input.counterfactual.name,
    total_records: input.records.length,
    resolved_records: resolved,
    unresolved_records: input.records.length - resolved,
    flipped,
    transitions
  };
}

// ---------------------------------------------------------------------------
// Serialization + summary
// ---------------------------------------------------------------------------

/** Format identifier embedded in serialized sweep artifacts. */
export const SWEEP_ARTIFACT_FORMAT = "aristotle.counterfactual-sweep.v1";

export interface SerializedSweep {
  format: typeof SWEEP_ARTIFACT_FORMAT;
  generated_at: string;
  result: CounterfactualSweepResult;
}

export function serializeSweep(result: CounterfactualSweepResult, now?: string): SerializedSweep {
  return {
    format: SWEEP_ARTIFACT_FORMAT,
    generated_at: now ?? new Date().toISOString(),
    result
  };
}

export function loadSweep(artifact: unknown): SerializedSweep {
  if (!artifact || typeof artifact !== "object") throw new Error("sweep artifact is not an object");
  const o = artifact as Record<string, unknown>;
  if (o.format !== SWEEP_ARTIFACT_FORMAT) {
    throw new Error(`unexpected sweep format: ${String(o.format)} (expected ${SWEEP_ARTIFACT_FORMAT})`);
  }
  if (!o.result || typeof o.result !== "object") throw new Error("sweep artifact missing 'result'");
  // We don't deep-validate the result body — the format tag is the
  // contract; tighter parsing belongs to a caller that has a schema.
  return o as unknown as SerializedSweep;
}

/** Human-readable single-line summary for a sweep result. Suitable
 *  for CI logs, dashboards, slack pings. Pure formatting — no I/O. */
export function summarizeSweep(result: CounterfactualSweepResult): string {
  const transitions = Object.entries(result.transitions).sort(([a], [b]) => a.localeCompare(b));
  const transitionBits = transitions.map(([k, v]) => `${k}: ${v}`);
  const transitionsText = transitionBits.length ? ` [${transitionBits.join(", ")}]` : "";
  return `counterfactual '${result.name}': ${result.flipped.length}/${result.resolved_records} resolved records flipped` +
    (result.unresolved_records > 0 ? ` (${result.unresolved_records} unresolved)` : "") +
    transitionsText;
}

/** Aggregate multiple counterfactual sweeps (e.g., one per candidate
 *  policy world) into a comparison table. */
export interface SweepComparison {
  total_resolved_records: number;
  /** Sorted by flipped count descending. */
  rows: Array<{
    name: string;
    flipped: number;
    resolved_records: number;
    transitions: Record<string, number>;
  }>;
}

export function compareSweeps(sweeps: CounterfactualSweepResult[]): SweepComparison {
  const totalResolved = sweeps.length ? Math.max(...sweeps.map((s) => s.resolved_records)) : 0;
  const rows = sweeps.map((s) => ({
    name: s.name,
    flipped: s.flipped.length,
    resolved_records: s.resolved_records,
    transitions: s.transitions
  })).sort((a, b) => b.flipped - a.flipped);
  return { total_resolved_records: totalResolved, rows };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function diff<T>(a: readonly T[], b: readonly T[]): T[] {
  const bs = new Set(b);
  return a.filter((x) => !bs.has(x));
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  for (const x of a) { if (!bs.has(x)) return false; }
  return true;
}

export type { GelRecord, WardManifest, AuthorityEnvelope, CanonicalActionInput, RuntimeRegister };
