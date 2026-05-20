/**
 * Aggregate metrics over a governance store — the operational/observability view
 * a commercial deployment needs (dashboards, alerts, capacity, spend). Computed
 * from a store snapshot so it works against any GovernanceStore implementation.
 */

import { verifyGelChain } from "./gel.js";
import { nowIso } from "./ids.js";
import type { Keyring } from "./hash.js";
import type { GovernanceStore } from "./store.js";
import type { ConsumptionState, GelDecision } from "./types.js";

export interface ChainMetrics {
  generated_at: string;
  maes: number;
  wards: number;
  governors: number;
  authority_envelopes: number;
  commit_gates: number;
  federation_agreements: number;
  warrants: Record<"total" | Lowercase<ConsumptionState>, number>;
  gel: {
    records: number;
    integrity_ok: boolean;
    by_decision: Record<GelDecision, number>;
    by_kind: { admissibility: number; execution: number };
  };
  spend: Array<{ envelope_id: string; currency: string; amount: number }>;
}

export function chainMetrics(store: GovernanceStore, keyring?: Keyring): ChainMetrics {
  const s = store.toSnapshot();
  const warrantsInState = (state: ConsumptionState) => s.warrants.filter((w) => w.consumption_state === state).length;
  const gelInDecision = (decision: GelDecision) => s.gel.filter((r) => r.decision === decision).length;

  return {
    generated_at: nowIso(),
    maes: s.maes.length,
    wards: s.wards.length,
    governors: s.governors.length,
    authority_envelopes: s.envelopes.length,
    commit_gates: s.gates.length,
    federation_agreements: s.agreements.length,
    warrants: {
      total: s.warrants.length,
      unused: warrantsInState("Unused"),
      consumed: warrantsInState("Consumed"),
      expired: warrantsInState("Expired"),
      revoked: warrantsInState("Revoked"),
      rejected: warrantsInState("Rejected"),
    },
    gel: {
      records: s.gel.length,
      integrity_ok: verifyGelChain(s.gel, keyring).ok,
      by_decision: {
        Allow: gelInDecision("Allow"),
        Deny: gelInDecision("Deny"),
        Escalate: gelInDecision("Escalate"),
        FailClosed: gelInDecision("FailClosed"),
      },
      by_kind: {
        admissibility: s.gel.filter((r) => r.record_kind === "admissibility").length,
        execution: s.gel.filter((r) => r.record_kind === "execution").length,
      },
    },
    spend: s.spend.map((e) => ({ envelope_id: e.envelopeId, currency: e.currency, amount: e.amount })),
  };
}
