# @aristotle/governance-core

The runtime governance chain for AristotleOS. This package makes **Ward** a
first-class governance primitive and turns the authority chain from an implicit
sequence of service calls into an explicit, enforced, hash-chained pipeline.

> AristotleOS does not ask whether an agent is *authenticated*. It asks whether a
> *consequential act* is *admissible* under a *complete authority chain* at the
> *moment of execution*.

That chain, top to bottom:

```
Meta Authority Envelope   constitutional layer — who may constitute Wards at all
   └─ Ward                sovereign protected domain + accountability root
       └─ Authority Envelope   delegated operating scope inside the Ward
           └─ Warrant          single-use conveyance for ONE proposed act
               └─ Commit Gate  the Warden: admissibility at the execution boundary
                   └─ Execution    consequence — only after the gate permits
                       └─ GEL Record   the receipt: proof of the whole lineage
```

No consequential action reaches execution unless that chain is **complete and
valid at commit time**. Every act must answer six questions, and the GEL Record
records all six:

| Question | Primitive |
|---|---|
| Under which **MAE**? | `MetaAuthorityEnvelope` |
| Inside which **Ward**? | `Ward` |
| Through which **Authority Envelope**? | `AuthorityEnvelope` |
| By what **Warrant**? | `Warrant` (single-use) |
| At which **Commit Gate**? | `CommitGate` / `evaluateCommit` |
| Producing what **GEL Record**? | `GELRecord` (hash-chained) |

## What a Ward is — and is not

A **Ward** is a *bounded sovereignty domain constituted by a human or
institutional governance act*. It is the boundary within which governance
applies, the protected interest on whose behalf authority is exercised, and the
accountability root to which consequence ultimately returns.

A Ward is **not** identity, **not** RBAC, **not** a tenant, **not** a namespace,
**not** a session, and **not** merely a policy bundle. A Ward with no human /
institutional origin act is invalid — machines cannot constitute Wards.

Four configurations are supported (`ward_type`):

- `IndividualDirect` — a living human directly constitutes the Ward and bears consequence.
- `IndividualDelegated` — a human Ward delegates authorship to Governors but retains consequence.
- `Institutional` — an institution is the Ward, traceable through charter/board/officer.
- `ProtectedSpace` — a facility, cockpit, network segment, drone operating area,
  clinical unit, or regulated zone where entry triggers governance conditions.

## The governance ontology (do not collapse these)

`ontology.ts` names seven concepts that must stay distinct. Collapsing any two is
the "governance fiction" failure mode — looking governed without bounded authority.

- **Identity** — who/what the actor is. Necessary, never sufficient.
- **Presence** — whether the actor is currently participating/reachable.
- **Authority** — what the actor may do (Envelopes + Warrants).
- **Sovereignty** — on whose behalf / within which domain (the Ward).
- **Admissibility** — whether *this* act is allowed *now* (the Commit Gate).
- **Execution** — the production of consequence, only after the gate.
- **Attribution** — who answers afterward, *derived from* the GEL Record.

The cardinal ordering is **authority precedes attribution**: the Warrant is
consumed before the receipt is written, and attribution is derived from the
receipt — never asserted ahead of it. Identity-based access control reverses this
order; that reversal is the architectural failure this package corrects.

## The Commit Gate (the Warden)

`evaluateCommit(store, request, opts)` does not author policy. It guards the
execution boundary and evaluates, **in order**:

1. MAE validity
2. Ward validity (under the MAE)
3. Authority Envelope validity (under the Ward)
4. Warrant validity (binding, temporal, non-replay)
5. action classification
6. context admissibility (Ward boundary, geo, operational limits)
7. telemetry requirements
8. revocation state
9. temporal scope
10. nonce / replay protection
11. GEL record creation

It returns `Allow | Deny | Escalate | FailClosed`, and it **never allows
execution on an incomplete chain**. On `Allow` it consumes the Warrant *before*
writing the receipt. Any missing primitive or non-consumable warrant fails
**closed**, with evidence.

## Single-use Warrants

A `Warrant` is exhaustible, action-specific, and non-replayable. It carries a
`nonce` and a `consumption_state` (`Unused → Consumed | Expired | Revoked |
Rejected`), and it is pinned to one act by `parameters_hash`, `context_hash`, and
`telemetry_snapshot_hash`. A consumed Warrant can never authorize another act;
the store enforces consumption atomically and rejects nonce replay.

## GEL Records (the receipt)

A `GELRecord` proves *authority lineage*, not just event occurrence. Records are
hash-chained (`previous_gel_hash` → `gel_record_hash`), signed, and
tamper-evident; `verifyGelChain` walks and revalidates the whole ledger.
Admissibility and execution are kept as **separate** records so authority,
execution, and attribution are never conflated.

## Revocation & federation

Revocation propagates strictly downward (`revocation.ts`): MAE → Wards →
Envelopes → Warrants. Federation (`federation.ts`) requires authority-chain
compatibility across a `FederationAgreement` trust bridge — never federation by
identity alone.

## Usage

```ts
import {
  buildPayments,          // a worked scenario fixture
} from "@aristotle/governance-core/fixtures"; // or: import { fixtures } from "@aristotle/governance-core"
import { evaluateCommit } from "@aristotle/governance-core";

const w = buildPayments();                       // constitute MAE → Ward → Envelope → Gate
const { request } = w.propose();                 // issue a single-use Warrant for "refund $412"
const decision = evaluateCommit(w.store, request, { keyring: w.keyring, signKeyId: w.keyId });

decision.decision;        // "Allow"
decision.warrant_consumed // true  (authority spent before the receipt)
decision.gel_record_id    // the receipt proving the full chain
```

Scenario fixtures (`fixtures.ts`) cover **payments**, **drone swarm**,
**healthcare**, and **cross-domain federation**.

## Commands

```bash
corepack pnpm --filter @aristotle/governance-core check   # tsc --noEmit (incl. tests)
corepack pnpm --filter @aristotle/governance-core build   # emit dist/
corepack pnpm --filter @aristotle/governance-core test    # node:test via tsx
```

The suite uses Node's built-in test runner, so the package has **no runtime or
test dependencies** beyond `node:crypto` / `node:test`.

## File map

| File | Responsibility |
|---|---|
| `ontology.ts` | the seven non-collapsible concepts + ordering |
| `types.ts` | all primitive interfaces (MAE, Ward, Envelope, Warrant, Governor, GEL, Federation) |
| `hash.ts` | canonical hashing, policy hashes, HMAC/Ed25519 signing |
| `constraints.ts` | declarative predicate language for boundaries/telemetry/jurisdiction |
| `errors.ts` | `Violation`/`ValidationResult` (soft) + `GovernanceError` (fail-closed) |
| `store.ts` | `GovernanceStore` — atomic warrant consumption + hash-chained ledger |
| `validators.ts` | per-primitive invariant validation |
| `commit-gate.ts` | the Warden: `evaluateCommit` + `recordExecutionOutcome` |
| `gel.ts` | GEL record finalization, chain verification, completeness assertion |
| `revocation.ts` | downward revocation propagation |
| `federation.ts` | cross-Ward trust-bridge evaluation |
| `factory.ts` | sanctioned authoring helpers (seal = hash + sign + register) |
| `fixtures.ts` | the four worked scenarios |

See [MIGRATION.md](./MIGRATION.md) for grafting this onto the existing service mesh.
