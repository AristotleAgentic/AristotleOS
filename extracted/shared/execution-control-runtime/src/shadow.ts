import {
  type AristotleSigner,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ExecutionControlDecision,
  type ExecutionControlReasonCode,
  type GelRecord,
  type RuntimeRegister,
  type WardManifest,
  LedgerStore,
  evaluateExecutionControl,
  getDefaultDevSigner,
  missingRuntimeRegisters,
  verifyGelRecords
} from "./index.js";

/**
 * Shadow Mode profiling — an adoption / rollout tool.
 *
 * Runs proposed actions through the *real* Commit Gate to observe what AristotleOS
 * WOULD allow, refuse, or escalate, WITHOUT touching the live system: each action
 * is evaluated against an ephemeral in-memory ledger, so the live Governance
 * Evidence Ledger is never written and replay state is never consumed.
 *
 * Doctrine guarantee: shadow mode NEVER modifies the Ward or Authority Envelope.
 * It only observes and reports. Any policy change an operator makes in response is
 * a separate, explicit, reviewed action — this engine emits findings, not edits.
 */

export interface ShadowAction {
  action: CanonicalActionInput;
  runtimeRegister?: RuntimeRegister;
}

export interface ShadowDecisionRecord {
  action_id: string;
  request_id?: string;
  subject: string;
  action_type: string;
  target: string;
  would_decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  /** A would-ALLOW yields a single-use Warrant in enforcement. */
  warrant_eligible: boolean;
  missing_runtime_registers: string[];
  physical_invariant_ok: boolean;
  /** Passed, but within the near-miss margin of a physical bound. */
  physical_near_miss?: string;
  canonical_action_hash: string;
  gel_record_id: string;
}

export interface ShadowReport {
  ward_id: string;
  authority_envelope_id: string;
  evaluated_at: string;
  count: number;
  decisions: Record<ExecutionControlDecision, number>;
  reason_codes: Record<string, number>;
  would_block: ShadowDecisionRecord[];
  would_escalate: ShadowDecisionRecord[];
  findings: {
    missing_runtime_registers: Array<{ action_id: string; registers: string[] }>;
    revoked_authority: Array<{ action_id: string; reason: ExecutionControlReasonCode }>;
    physical_near_misses: Array<{ action_id: string; detail: string }>;
  };
  rollout: {
    /** Heuristic: ready when nothing would escalate (no unresolved ambiguity/missing state). */
    ready: boolean;
    allow_rate: number;
    blockers: Array<{ reason_code: string; count: number }>;
  };
  /** Replayable, GEL-compatible evidence chain (ephemeral; verifies with verifyGelRecords). */
  evidence: GelRecord[];
  traces: ShadowDecisionRecord[];
}

const NEAR_MISS_ALTITUDE_FRACTION = 0.9; // within 10% below the ceiling
const NEAR_MISS_BATTERY_MARGIN = 5; // within 5 points above the floor

function nearMiss(action: CanonicalActionInput, ward: WardManifest): string | undefined {
  const bounds = ward.physical_bounds;
  if (!bounds) return undefined;
  const altitude = typeof action.params.altitude_m === "number" ? action.params.altitude_m : undefined;
  if (bounds.max_altitude_m !== undefined && altitude !== undefined && altitude <= bounds.max_altitude_m && altitude >= bounds.max_altitude_m * NEAR_MISS_ALTITUDE_FRACTION) {
    return `altitude_m ${altitude} within 10% of ceiling ${bounds.max_altitude_m}`;
  }
  const battery = typeof action.params.battery_pct === "number" ? action.params.battery_pct : undefined;
  if (bounds.battery_minimum_pct !== undefined && battery !== undefined && battery >= bounds.battery_minimum_pct && battery <= bounds.battery_minimum_pct + NEAR_MISS_BATTERY_MARGIN) {
    return `battery_pct ${battery} within ${NEAR_MISS_BATTERY_MARGIN} of minimum ${bounds.battery_minimum_pct}`;
  }
  return undefined;
}

export interface ShadowModeInput {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  actions: ShadowAction[];
  signer?: AristotleSigner;
  now?: string;
  /** Optional revocation list to surface stale/revoked authority during profiling. */
  revocationListPath?: string;
}

/**
 * Profile a batch of proposed actions in observe-only mode. Returns a report; the
 * live system is untouched and the input Ward/Envelope are never mutated.
 */
export function profileShadowMode(input: ShadowModeInput): ShadowReport {
  const signer = input.signer ?? getDefaultDevSigner();
  // Ephemeral ledger: every decision is recorded here and discarded with the call.
  const ledger = LedgerStore.memory();

  const traces: ShadowDecisionRecord[] = [];
  const decisions: Record<ExecutionControlDecision, number> = { ALLOW: 0, REFUSE: 0, ESCALATE: 0 };
  const reasonCodes: Record<string, number> = {};

  for (const { action, runtimeRegister } of input.actions) {
    const result = evaluateExecutionControl({
      ward: input.ward,
      authorityEnvelope: input.authorityEnvelope,
      action,
      runtimeRegister,
      ledger,
      ledgerPath: "shadow", // unused; ledger store is in-memory
      signer,
      now: input.now,
      revocationListPath: input.revocationListPath,
      // Profile each action independently; do not consume single-use replay state.
      replayProtection: false
    });

    decisions[result.decision] += 1;
    for (const code of result.reason_codes) reasonCodes[code] = (reasonCodes[code] ?? 0) + 1;

    const missing = missingRuntimeRegisters(input.authorityEnvelope, action, (runtimeRegister ?? {}) as RuntimeRegister);
    const physicalOk = result.gel_record.physical_invariant_result?.ok ?? true;
    const record: ShadowDecisionRecord = {
      action_id: action.action_id,
      request_id: action.request_id,
      subject: action.subject,
      action_type: action.action_type,
      target: action.target,
      would_decision: result.decision,
      reason_codes: result.reason_codes,
      warrant_eligible: result.decision === "ALLOW" && !!result.warrant,
      missing_runtime_registers: missing,
      physical_invariant_ok: physicalOk,
      physical_near_miss: physicalOk ? nearMiss(action, input.ward) : undefined,
      canonical_action_hash: result.canonical_action_hash,
      gel_record_id: result.gel_record.record_id
    };
    traces.push(record);
  }

  const wouldBlock = traces.filter((t) => t.would_decision === "REFUSE");
  const wouldEscalate = traces.filter((t) => t.would_decision === "ESCALATE");
  const allowRate = traces.length ? decisions.ALLOW / traces.length : 0;

  const blockers = Object.entries(reasonCodes)
    .filter(([code]) => code !== "ALLOWED")
    .map(([reason_code, count]) => ({ reason_code, count }))
    .sort((a, b) => b.count - a.count);

  return {
    ward_id: input.ward.ward_id,
    authority_envelope_id: input.authorityEnvelope.envelope_id,
    evaluated_at: input.now ?? new Date().toISOString(),
    count: traces.length,
    decisions,
    reason_codes: reasonCodes,
    would_block: wouldBlock,
    would_escalate: wouldEscalate,
    findings: {
      missing_runtime_registers: traces.filter((t) => t.missing_runtime_registers.length > 0).map((t) => ({ action_id: t.action_id, registers: t.missing_runtime_registers })),
      revoked_authority: traces.filter((t) => t.reason_codes.includes("AUTHORITY_REVOKED")).map((t) => ({ action_id: t.action_id, reason: "AUTHORITY_REVOKED" as ExecutionControlReasonCode })),
      physical_near_misses: traces.filter((t) => t.physical_near_miss).map((t) => ({ action_id: t.action_id, detail: t.physical_near_miss! }))
    },
    rollout: {
      ready: wouldEscalate.length === 0,
      allow_rate: Math.round(allowRate * 1000) / 1000,
      blockers
    },
    evidence: ledger.records(),
    traces
  };
}

/** Convenience: verify the evidence a shadow run produced (it is real, signed GEL material). */
export function verifyShadowEvidence(report: ShadowReport): { ok: boolean; count: number; failure?: string } {
  return verifyGelRecords(report.evidence);
}
