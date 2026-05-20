/**
 * Multi-tenant isolation.
 *
 * In a shared deployment, a tenant must not see or touch another tenant's chain.
 * The constitutional boundary is the Meta Authority Envelope: every Ward,
 * Envelope, Warrant and GEL record traces to exactly one MAE (already enforced by
 * the validators — a warrant cannot bind a Ward under a different MAE). A
 * `tenant_id` groups one or more MAEs under an owning organization.
 *
 * This module provides the read-side isolation: scoping a store snapshot to a
 * single tenant (or MAE) so metrics, ledger views and listings only ever expose
 * that tenant's governance. The commit path's cross-tenant rejection is already
 * guaranteed structurally by the per-primitive `mae_id` bindings.
 */
import type { StoreSnapshot } from "./store.js";
export interface ScopeFilter {
    /** Scope to a single constitution. */
    maeId?: string;
    /** Scope to all constitutions owned by this tenant. */
    tenantId?: string;
}
/** The set of MAE ids in scope, or `null` meaning "everything" (no filter). */
export declare function maeIdsInScope(snapshot: StoreSnapshot, filter?: ScopeFilter): Set<string> | null;
/** Return a snapshot containing only the primitives within scope. Shared infra
 *  (commit gates, consumed-nonce set) is left intact. */
export declare function scopeSnapshot(snapshot: StoreSnapshot, filter?: ScopeFilter): StoreSnapshot;
export interface TenantSummary {
    tenant_id: string;
    maes: number;
    wards: number;
    authority_envelopes: number;
    warrants: number;
    gel_records: number;
}
/** Per-tenant rollup for an operator overview of a shared deployment. */
export declare function tenantSummaries(snapshot: StoreSnapshot): TenantSummary[];
