/**
 * Aggregate metrics over a governance store — the operational/observability view
 * a commercial deployment needs (dashboards, alerts, capacity, spend). Computed
 * from a store snapshot so it works against any GovernanceStore implementation.
 */
import { verifyGelChain } from "./gel.js";
import { nowIso } from "./ids.js";
export function chainMetrics(store, keyring) {
    const s = store.toSnapshot();
    const warrantsInState = (state) => s.warrants.filter((w) => w.consumption_state === state).length;
    const gelInDecision = (decision) => s.gel.filter((r) => r.decision === decision).length;
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
