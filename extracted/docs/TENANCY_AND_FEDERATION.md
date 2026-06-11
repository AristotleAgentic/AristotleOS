# Tenancy and Federation

## Vocabulary

| Term | What it is | What it is NOT |
|---|---|---|
| **Tenant** | An owning organization; one or more MAEs may share a `tenant_id` | Not a Ward; not an RBAC role; not a namespace |
| **MetaAuthorityEnvelope (MAE)** | Constitutional root for a tenant — declares which Wards may exist, which signing keys are authorized, federation rules | Not a Ward; not configuration |
| **Ward** | Sovereign protected domain (airspace, treasury, substation, building) | Not a tenant; not a project; not an RBAC role |
| **AuthorityEnvelope** | Scoped delegation: a subject is allowed to perform a set of actions under a Ward | Not a permission; not a policy bundle |
| **Subject** | The agent / actor whose actions are governed | Not a Ward; not a session |
| **Governor** | A delegated authority issuer within a Ward (typically `accountable_party`) | Not a Ward; never absorbs consequence — delegation extends reach, consequence stays with `accountable_party` |
| **Federation Agreement** | Signed cross-MAE trust relationship | Not a shared key; not blanket trust |

## MAE as constitutional root

A `MetaAuthorityEnvelope` declares:
- `tenant_id` — owning organization.
- `signing_keys` — the **allowlist** of key ids authorized to mint artifacts under this MAE.
- `ward_creation_rules` — who may constitute Wards, what types of Wards (`Institutional`, `ProtectedSpace`, etc.), what origin methods (`institutional-charter`, `regulatory-designation`, ...).
- `authority_envelope_rules` — max delegation depth, permitted action classes, prohibited action classes.
- `federation_rules` — federation_allowed, trusted_mae_ids, exportable_evidence.

A MAE without `signing_keys` is structurally vulnerable to cross-tenant forgery. **Every MAE shipped by `bootstrapTenant` has a non-empty `signing_keys` allowlist by default.**

## Issuer / key binding

Every artifact beneath a MAE (the MAE itself, Wards under it, Envelopes under Wards, Warrants issued by Envelopes) must be signed by a key whose `key_id` is in `mae.signing_keys`. Validators enforce this:

| Validator | Check |
|---|---|
| `validateMae` | Self-signature uses a key in own `signing_keys` |
| `validateWard` | Signature uses a key in parent MAE's `signing_keys` |
| `validateAuthorityEnvelope` | Signature uses a key in parent MAE's `signing_keys` |
| `validateWarrant` | Signature uses a key in parent MAE's `signing_keys` |

This **closes the cross-tenant forge gap**: a key trusted under tenant B's MAE cannot mint artifacts under tenant A's MAE, even if both keys are present in a shared keyring. Tested in `governance-core/src/validators.security.test.ts`.

## Key rotation

```ts
import { rotateTenantKey, pruneRetiredTenantKey } from "@aristotle/tenant-onboarding";

// Add the new key to the keyring beforehand (this is operator-side):
keyring.addKey("key-acme-v2", kmsBackedSecret);

// Rotate
rotateTenantKey({
  tenant_id, store, keyring,
  oldKeyId: "key-acme-v1",
  newKeyId: "key-acme-v2"
});
// → mae.signing_keys now contains both v1 and v2; mae is re-sealed under v2

// Later, after in-flight artifacts expire under v1:
pruneRetiredTenantKey({
  tenant_id, store, keyring,
  activeKeyId: "key-acme-v2",
  retiredKeyId: "key-acme-v1"
});
// → mae.signing_keys now contains only v2; mae re-sealed under v2
```

The rotation preserves verifiability of in-flight artifacts signed under v1 (they still verify against v1 while it's in the allowlist). After pruning, v1-signed artifacts fail validation.

## Tenant lifecycle

| Operation | Effect | Code |
|---|---|---|
| `bootstrapTenant` | Mints MAE + initial Ward + initial Envelope + optional Governor | `tenant-onboarding/src/index.ts::bootstrapTenant` |
| `rotateTenantKey` | Adds new signing key; re-seals MAE | `rotateTenantKey` |
| `pruneRetiredTenantKey` | Removes retired key; re-seals under active | `pruneRetiredTenantKey` |
| `suspendTenant` | Latches `suspended_at` on Wards + `revocation_state: suspended` on Envelopes | `suspendTenant` |
| `revokeTenant` | Terminal: `revoked_at` on Wards + `revocation_state: revoked` on Envelopes | `revokeTenant` |
| `exportTenantSnapshot` | Portable JSON bundle of MAE + Wards + Envelopes | `exportTenantSnapshot` |
| `importTenantSnapshot` | Round-trip: import into a fresh store; refuses collisions by default | `importTenantSnapshot` |
| `tenantAuditReport` | Posture findings (critical / warn / info) + overall posture | `tenantAuditReport` |
| `federateTenants` | Cross-MAE FederationAgreement | `federateTenants` |

29 tests cover the full surface. See `tenant-onboarding/src/index.test.ts`.

## Federation handshake — the four invariants

`federateTenants(input)` mints a signed `FederationAgreement` only if all four invariants hold:

1. **Local MAE has `federation_rules.federation_allowed: true`.**
2. **Foreign MAE has `federation_rules.federation_allowed: true`.**
3. **Local MAE lists the foreign MAE's `mae_id` in `trusted_mae_ids`** (and vice versa for #4).
4. **Foreign MAE lists the local MAE's `mae_id` in `trusted_mae_ids`.**

Additionally, the Ward ids must exist under their declared tenants. The signed `FederationAgreement` carries `trust_anchors` merged from both MAEs' `signing_keys` — so a Warrant signed under either side's anchor is verifiable on the other side under the agreement.

A federation failure produces a specific error naming the missing invariant. See `tenant-onboarding/src/index.test.ts` for the four refusal paths.

## Cross-tenant risk model

| Scenario | Substrate behavior |
|---|---|
| Same store, two tenants, ordinary operation | `scopeSnapshot(snapshot, { tenantId })` filters each tenant's view; tested in `tenant-onboarding/src/index.test.ts` |
| Tenant A's operator-side keyring contains tenant B's key by mistake | A cannot mint B's artifacts — B's MAE allowlist refuses A's key |
| Tenant A is compromised (key stolen) | Only A's artifacts are forgeable; B is unaffected |
| Tenant A is revoked (`revokeTenant`) | A's Wards / Envelopes are latched; no new Warrants under A; existing GEL records under A remain valid evidence |
| Tenant A and B federate via signed `FederationAgreement` | Cross-MAE Warrants verify under the union of both signing-key allowlists, scoped to the agreement's `shared_action_classes` |
| Tenant A unilaterally claims trust of tenant B without B's opt-in | `federateTenants` refuses with the specific invariant failure |

## Production hardening for tenancy

| Requirement | Status | Production guidance |
|---|---|---|
| KMS-backed signing keyring | Caller-supplied today (HmacKeyring is demo-only) | Inject a `Keyring` implementation that delegates `sign` and `verify` to AWS KMS, GCP KMS, Vault, etc. |
| Key rotation runbook | Primitives ship (`rotateTenantKey` / `pruneRetiredTenantKey`); operational runbook does not | Document: when to rotate, grace period for old keys, prune trigger |
| Per-tenant signing key id discipline | Operator's responsibility | Never reuse a `key_id` across tenants; the substrate doesn't enforce this beyond the allowlist check |
| Cross-host federation transport | Mesh runtime ships TLS hook; federation handshake assumes single-store today | Production federation across hosts requires the operator to wire mTLS + cross-host MeshPersistence |
| Posture monitoring | `tenantAuditReport` returns a snapshot; not on a schedule | Cron `tenantAuditReport` → emit to monitoring stack via `@aristotle/event-stream` webhooks |

## What this primitive set does NOT do

- It does not provide a UI for tenant management (that's operator tooling).
- It does not provide an admin API for cross-organizational provisioning workflows.
- It does not validate KMS health (operator must signal that via degraded-mode conditions on the gate).
- It does not perform legal / contractual federation work (the `FederationAgreement` is the technical primitive that records what the operator's lawyers separately negotiated).

## Tests

29 tests in `tenant-onboarding/src/index.test.ts` plus security tests in `governance-core/src/validators.security.test.ts`. Run:

```sh
pnpm --filter @aristotle/tenant-onboarding test
pnpm --filter @aristotle/governance-core test
pnpm test:tenancy
```
