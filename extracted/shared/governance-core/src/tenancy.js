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
/** The set of MAE ids in scope, or `null` meaning "everything" (no filter). */
export function maeIdsInScope(snapshot, filter) {
    if (!filter || (!filter.maeId && !filter.tenantId))
        return null;
    const ids = new Set();
    for (const mae of snapshot.maes) {
        if (filter.maeId && mae.mae_id === filter.maeId)
            ids.add(mae.mae_id);
        if (filter.tenantId && mae.tenant_id === filter.tenantId)
            ids.add(mae.mae_id);
    }
    return ids;
}
/** Return a snapshot containing only the primitives within scope. Shared infra
 *  (commit gates, consumed-nonce set) is left intact. */
export function scopeSnapshot(snapshot, filter) {
    const ids = maeIdsInScope(snapshot, filter);
    if (!ids)
        return snapshot;
    const maes = snapshot.maes.filter((m) => ids.has(m.mae_id));
    const wards = snapshot.wards.filter((w) => ids.has(w.mae_id));
    const wardIds = new Set(wards.map((w) => w.ward_id));
    const envelopes = snapshot.envelopes.filter((e) => ids.has(e.mae_id));
    const envelopeIds = new Set(envelopes.map((e) => e.authority_envelope_id));
    const warrants = snapshot.warrants.filter((w) => ids.has(w.mae_id));
    const governors = snapshot.governors.filter((g) => wardIds.has(g.ward_id));
    const gel = snapshot.gel.filter((r) => !!r.mae_id && ids.has(r.mae_id));
    const agreements = snapshot.agreements.filter((a) => ids.has(a.local_mae_id) || ids.has(a.foreign_mae_id));
    const spend = snapshot.spend.filter((s) => envelopeIds.has(s.envelopeId));
    return {
        maes,
        wards,
        governors,
        envelopes,
        warrants,
        gates: snapshot.gates,
        agreements,
        gel,
        consumedNonces: snapshot.consumedNonces,
        spend,
    };
}
/** Per-tenant rollup for an operator overview of a shared deployment. */
export function tenantSummaries(snapshot) {
    const byTenant = new Map();
    const tenantOfMae = new Map();
    for (const mae of snapshot.maes) {
        const tenant = mae.tenant_id ?? "(untenanted)";
        tenantOfMae.set(mae.mae_id, tenant);
        const s = byTenant.get(tenant) ?? { tenant_id: tenant, maes: 0, wards: 0, authority_envelopes: 0, warrants: 0, gel_records: 0 };
        s.maes += 1;
        byTenant.set(tenant, s);
    }
    const bump = (maeId, key) => {
        if (!maeId)
            return;
        const tenant = tenantOfMae.get(maeId);
        if (!tenant)
            return;
        const s = byTenant.get(tenant);
        if (s)
            s[key] += 1;
    };
    for (const w of snapshot.wards)
        bump(w.mae_id, "wards");
    for (const e of snapshot.envelopes)
        bump(e.mae_id, "authority_envelopes");
    for (const w of snapshot.warrants)
        bump(w.mae_id, "warrants");
    for (const r of snapshot.gel)
        bump(r.mae_id, "gel_records");
    return [...byTenant.values()];
}
