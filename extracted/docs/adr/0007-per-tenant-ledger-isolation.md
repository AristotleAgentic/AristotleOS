# ADR-0007 — Per-tenant ledger isolation

**Status:** Accepted

## Context

Multi-tenant deployments must not let one tenant's evidence chain
leak into another's. A shared ledger with a `tenant_id` column makes
chain hash linkage meaningless across tenants (the order of records
depends on cross-tenant arrival timing); a per-tenant ledger keeps
the hash chain coherent per tenant but requires an explicit tenancy
model.

The substrate's `governance-core` ships
`@aristotle/tenant-onboarding` which mints a fresh Ward + Authority
Envelope + bootstrap subject per tenant. The question this ADR
records: where does the EVIDENCE go.

## Decision

Each tenant gets its **own** GEL ledger file path. The substrate's
`ledgerPath` is a per-call parameter, NOT a global; the orchestrator
(service / SDK consumer) is responsible for routing per-tenant calls
to per-tenant paths.

`@aristotle/governance-core::tenancy` records the tenant→ledger-path
binding as part of tenant onboarding; downstream services look up
the binding when serving a tenant request.

## Alternatives considered

- **Shared ledger with tenant_id column.** Rejected. Cross-tenant
  hash linkage is incoherent (the previous_hash field of tenant A's
  record references whichever record happened to land before it,
  including tenant B's). Audit of tenant A's chain requires
  filtering tenant B out, which means standard `verifyGelRecords`
  doesn't apply without modification.
- **Per-tenant DB schema.** Considered. Works for SQL-backed
  ledgers but doesn't generalize to the file-backed default. Add
  via a `LedgerBackend` implementation if operators want it (the
  interface exists).
- **Single ledger with cryptographic isolation (sub-chains).**
  Considered. Possible but doesn't compose with the existing
  archive/restore + reviewer flow — every tool would need to
  understand sub-chain extraction. Per-file isolation is the
  simplest shape that preserves every existing primitive.

## Consequences

- Operators MUST configure per-tenant `ledgerPath`. The substrate
  doesn't infer it from request headers.
- Per-tenant retention policies are independent — one tenant can
  retain forever, another can archive aggressively, without
  affecting the other's chain (`@aristotle/gel-archive` works per
  ledger).
- Per-tenant TSA anchors are independent — one tenant can anchor to
  a public Sigstore Rekor, another to an internal RFC 3161 TSA,
  per their own compliance posture.
- Cross-tenant queries ("show me every revocation across all
  tenants") require a separate aggregation layer the substrate
  doesn't ship. That's intentional — collapsing the per-tenant
  isolation for query convenience is the failure mode this ADR
  prevents.
- Onboarding a new tenant is a substrate primitive
  (`@aristotle/tenant-onboarding`); offboarding is operator-side
  (delete the ledger file + archive on retention).

## See also

- `@aristotle/tenant-onboarding` — bootstrap a tenant's Ward + Envelope + bootstrap agent
- `@aristotle/governance-core::tenancy` — tenant→ledger binding
- `@aristotle/gel-archive` — per-tenant retention
- ADR-0003 (GEL hash chain) — chain semantics that depend on per-tenant isolation
- [docs/TENANCY_AND_FEDERATION.md](../TENANCY_AND_FEDERATION.md) — operator guide
