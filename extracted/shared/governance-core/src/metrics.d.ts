/**
 * Aggregate metrics over a governance store — the operational/observability view
 * a commercial deployment needs (dashboards, alerts, capacity, spend). Computed
 * from a store snapshot so it works against any GovernanceStore implementation.
 */
import { type ScopeFilter } from "./tenancy.js";
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
        by_kind: {
            admissibility: number;
            execution: number;
        };
    };
    spend: Array<{
        envelope_id: string;
        currency: string;
        amount: number;
    }>;
}
export declare function chainMetrics(store: GovernanceStore, keyring?: Keyring, filter?: ScopeFilter): ChainMetrics;
