# Migrating the service mesh onto `@aristotle/governance-core`

This package was landed as a self-contained, fully-tested core (Phase 1). The
live 9-service mesh is **not yet wired onto it** — by design, so the ontology
refactor could be reviewed in isolation without destabilizing the running system
or its on-disk state. This document is the plan for Phase 2.

## Why the chain already half-existed

The mesh already implements most of the chain under different names. The gaps the
core closes are the load-bearing ones:

| Core primitive | Today in the mesh | Gap the core closes |
|---|---|---|
| `MetaAuthorityEnvelope` | `meta-authority-registry` seed `maa-root-001` (`services/meta-authority-registry/src/index.ts:8`) | Registry artifact, not a constitution. Root actor is `system.bootstrap` — **no human origin act**, no ward-creation/amendment/federation rules. |
| `Ward` | **absent** (closest: `OperatingMission.requestedBy`, a string — `shared/types/src/index.ts:272`) | No first-class protected-sovereignty domain. The string field is exactly the identity/sovereignty collapse the ontology forbids. |
| `AuthorityEnvelope` | `shared/types/src/index.ts:44` | Has `domain/subject/action/permittedEffects`; **no `ward_id`, no `actor_type`, no delegation depth**. Field shapes differ — see "Type collision" below. |
| `Warrant` | `ExecutionWarrant` (`shared/types/src/index.ts:57`); issued in `governance-kernel` (`src/index.ts:99`) | **Not single-use.** No `nonce`, no `consumption_state`; stored in a `Map` and reused across dispatch + completion. This is the biggest correctness gap. |
| `CommitGate` | `execution-gate` (`services/execution-gate/src/index.ts:63`) | Checks kill-switch/identity/authority/telemetry/witness, but **does not validate the MAE→Ward→Envelope→Warrant chain or consume the warrant**. |
| `GELRecord` | `evidence-ledger` `ReplayEvent` (`services/evidence-ledger/src/index.ts:639`) | Append-only + signed, but **not hash-chained** (`previous_gel_hash` absent) and proves event occurrence, not authority lineage. |
| `Governor` / federation / ward-types | absent | — |

## Type collision (handle deliberately)

The new ward-scoped `AuthorityEnvelope` and single-use `Warrant` collide with the
existing `@aristotle/shared-types` shapes. Do **not** edit the shared-types
interfaces in place — services and on-disk JSON (`services/*/data/*.json`) depend
on them. Instead:

1. Keep `@aristotle/shared-types` as the legacy wire/state types.
2. Add the core types as the new source of truth.
3. Write thin adapters at each service boundary (below) that translate legacy ↔
   core, gated behind a feature flag (`GOVERNANCE_CHAIN_V2`).

## Phase 2 wiring, service by service

Order matters: introduce the data model first, then enforce, then deprecate.

### 1. `meta-authority-registry` → seat a real `MetaAuthorityEnvelope`
- Replace the `system.bootstrap` seed with an MAE whose `signing_keys` are real
  and whose first Ward is created by a **`HumanOriginAct`** (WebAuthn assertion or
  key-ceremony log). This is the natural home for audit item **T1.2 (operator
  signing)** / **Fork 5 (BYO trust roots)**.
- Expose ward-creation/amendment/revocation/federation rules instead of a flat
  delegation list.

### 2. `agent-os` → make `Ward` first-class
- Introduce a `Ward` registry. Map each `OperatingMission` to a `ward_id` +
  `accountable_party` + `protected_interest` rather than a bare `requestedBy`
  string (`shared/types/src/index.ts:272`).
- At task dispatch and completion (`completeTaskWithGovernance`,
  `assessTaskGovernance`), build a `CommitRequest` and call the core
  `evaluateCommit` instead of the ad-hoc pipeline.

### 3. `governance-kernel` → issue single-use `Warrant`s
- Replace the warrant `Map` (`services/governance-kernel/src/index.ts:99`) with the
  core `Warrant` (add `nonce`, `consumption_state`, the three binding hashes).
- Stop reusing one warrant across dispatch + completion: issue **one warrant per
  proposed act**. This aligns with audit item **T1.0 (fail-closed audit trail)**.

### 4. `execution-gate` → become the `CommitGate`
- Delegate the decision to core `evaluateCommit`, which validates the **full
  chain** and **consumes the warrant on Allow**. Keep the existing kill-switch /
  witness inputs as additional `context`/`telemetry` constraints.
- Preserve the existing `allow | deny | halt` outputs by mapping
  `Allow→allow`, `Deny→deny`, `FailClosed/Escalate→halt` (or add `escalate`).

### 5. `evidence-ledger` → hash-chain into `GELRecord`s
- Add `previous_gel_hash` / `gel_record_hash` and emit core `GELRecord`s. The
  existing Ed25519/HMAC signing path (`services/evidence-ledger/src/index.ts:174`)
  carries straight over to `signGelRecord`.
- Persisting a durable `GovernanceStore` (replacing `InMemoryGovernanceStore`) is
  the only new infrastructure: it must preserve the two guarantees — atomic
  single-shot `consumeWarrant`, and append-only `appendGelRecord`.

### 6. `witness-service`, `authority-router`, `policy-compiler`
- Feed their outputs into the `CommitRequest` (`context`/`telemetry`) and the
  Authority Envelope's `escalation_requirements`. No structural change to the
  core is required.

## Constitutional execution loop, restated

The loop in `CLAUDE.md` ("read this before touching agent-os or execution-gate")
becomes, per consequential act:

1. Resolve **MAE** and **Ward** for the mission.
2. Resolve/author the **Authority Envelope** for the agent.
3. Issue **one single-use Warrant** bound to the proposed act.
4. **Commit Gate** (`evaluateCommit`): validate the whole chain, consume the
   warrant, write the admissibility **GEL Record** — fail closed on any gap.
5. Execute only on `Allow`.
6. Record the **execution** outcome as a separate GEL Record.
7. Attribution is derived from the GEL chain — never written ahead of it.

## Strategic note

This refactor advances Posture A rather than competing with it: single-use
warrants ≈ **T1.0**, the human origin act ≈ **T1.2 / Fork 5**, and
Ward-as-protected-interest is the multi-stakeholder envelope made first-class.
Consider folding a pointer to this package into the audit's Tier 1 section.
