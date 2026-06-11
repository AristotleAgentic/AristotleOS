import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ExecutionControlDecision,
  type ExecutionControlReasonCode,
  type RuntimeRegister,
  type WardManifest,
  evaluateCommitGate
} from "./index.js";

/**
 * Edge Conflict Inbox — reconciliation backend.
 *
 * When an edge node reconnects after operating under cached or degraded authority,
 * its decisions must be reconciled against central governance. This engine takes
 * the edge's actual decisions and re-evaluates each action through the real Commit
 * Gate under (a) the *current* policy and, when supplied, (b) the policy that was
 * active *at execution time* — then classifies conflicts and tracks an
 * operator-resolution state machine. It decides nothing on the operator's behalf.
 */

export interface EdgeRecord {
  action: CanonicalActionInput;
  /** The decision the edge actually made (often under cached/historical authority). */
  edge_decision: ExecutionControlDecision;
  edge_policy_version?: string;
  occurred_at?: string;
  runtimeRegister?: RuntimeRegister;
  /** Optional snapshot of the policy in force at execution time, for historical replay. */
  executionTimeWard?: WardManifest;
  executionTimeEnvelope?: AuthorityEnvelope;
  gel_record_id?: string;
}

export type ConflictStatus = "open" | "accepted" | "rejected" | "escalated" | "reconciled";
export type ConflictKind = "edge_more_permissive" | "edge_more_restrictive" | "reason_divergence";
export type ResolutionAction = "accept" | "reject" | "escalate" | "reconcile";

export interface ReplayResult {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
}

export interface ReconciliationItem {
  action_id: string;
  action_type: string;
  subject: string;
  ward_id: string;
  edge_decision: ExecutionControlDecision;
  current_decision: ExecutionControlDecision;
  current_reason_codes: ExecutionControlReasonCode[];
  agrees: boolean;
  conflict_kind?: ConflictKind;
  status: ConflictStatus;
  edge_policy_version?: string;
  occurred_at?: string;
  gel_record_id?: string;
  /** Replay against current policy, and (when provided) the execution-time policy. */
  replay: { against_current: ReplayResult; against_execution_time?: ReplayResult };
}

export interface ReconciliationReport {
  ward_id: string;
  authority_envelope_id: string;
  reconciled_at: string;
  count: number;
  agreements: number;
  conflicts: number;
  by_kind: Record<ConflictKind, number>;
  by_status: Record<ConflictStatus, number>;
  items: ReconciliationItem[];
}

function classify(edge: ExecutionControlDecision, current: ExecutionControlDecision): { agrees: boolean; kind?: ConflictKind } {
  if (edge === current) return { agrees: true };
  if (edge === "ALLOW" && current !== "ALLOW") return { agrees: false, kind: "edge_more_permissive" };
  if (edge !== "ALLOW" && current === "ALLOW") return { agrees: false, kind: "edge_more_restrictive" };
  return { agrees: false, kind: "reason_divergence" };
}

export interface ReconcileInput {
  records: EdgeRecord[];
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  now?: string;
}

/** Reconcile a batch of edge records against current (and execution-time) policy. */
export function reconcileEdgeRecords(input: ReconcileInput): ReconciliationReport {
  const items: ReconciliationItem[] = input.records.map((record) => {
    const current = evaluateCommitGate({ ward: input.ward, authorityEnvelope: input.authorityEnvelope, action: record.action, runtimeRegister: record.runtimeRegister, now: input.now });
    const { agrees, kind } = classify(record.edge_decision, current.decision);

    let against_execution_time: ReplayResult | undefined;
    if (record.executionTimeWard && record.executionTimeEnvelope) {
      const historical = evaluateCommitGate({ ward: record.executionTimeWard, authorityEnvelope: record.executionTimeEnvelope, action: record.action, runtimeRegister: record.runtimeRegister, now: record.occurred_at });
      against_execution_time = { decision: historical.decision, reason_codes: historical.reason_codes };
    }

    return {
      action_id: record.action.action_id,
      action_type: record.action.action_type,
      subject: record.action.subject,
      ward_id: record.action.ward_id,
      edge_decision: record.edge_decision,
      current_decision: current.decision,
      current_reason_codes: current.reason_codes,
      agrees,
      conflict_kind: kind,
      // Agreements need no operator action; conflicts start open.
      status: agrees ? "reconciled" : "open",
      edge_policy_version: record.edge_policy_version,
      occurred_at: record.occurred_at,
      gel_record_id: record.gel_record_id,
      replay: { against_current: { decision: current.decision, reason_codes: current.reason_codes }, against_execution_time }
    };
  });

  const by_kind: Record<ConflictKind, number> = { edge_more_permissive: 0, edge_more_restrictive: 0, reason_divergence: 0 };
  const by_status: Record<ConflictStatus, number> = { open: 0, accepted: 0, rejected: 0, escalated: 0, reconciled: 0 };
  for (const item of items) {
    if (item.conflict_kind) by_kind[item.conflict_kind] += 1;
    by_status[item.status] += 1;
  }

  return {
    ward_id: input.ward.ward_id,
    authority_envelope_id: input.authorityEnvelope.envelope_id,
    reconciled_at: input.now ?? new Date().toISOString(),
    count: items.length,
    agreements: items.filter((i) => i.agrees).length,
    conflicts: items.filter((i) => !i.agrees).length,
    by_kind,
    by_status,
    items
  };
}

const NEXT_STATUS: Record<ResolutionAction, ConflictStatus> = {
  accept: "accepted",
  reject: "rejected",
  escalate: "escalated",
  reconcile: "reconciled"
};

/**
 * Apply an operator resolution to a conflict item (pure). Valid only from `open` or
 * `escalated`; resolving an already-resolved item throws. Returns a new item.
 */
export function applyResolution(item: ReconciliationItem, action: ResolutionAction): ReconciliationItem {
  if (item.status !== "open" && item.status !== "escalated") {
    throw new Error(`cannot ${action} a conflict already in status "${item.status}"`);
  }
  if (!(action in NEXT_STATUS)) {
    throw new Error(`unknown resolution action: ${action}`);
  }
  return { ...item, status: NEXT_STATUS[action] };
}
