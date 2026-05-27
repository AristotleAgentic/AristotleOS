# ARCHITECTURE

AristotleOS is a governance execution substrate for autonomous systems. Its job is to interpose a signed, replayable authority chain between an agent's intent and the consequence that intent would produce.

This document explains how the pieces fit together. For evidence that each piece works as described, see `PROOF_STATUS.md`. For what's missing, see `LIMITATIONS.md`.

---

## The chain

```
MetaAuthorityEnvelope            constitutional layer
  ↓ constitutes
Ward                             sovereign protected domain + accountability root
  ↓ delegates
AuthorityEnvelope                scoped operating authority for a subject/agent
  ↓ issues
Warrant                          single-use, content-bound, signed conveyance for ONE action
  ↓ presented to
CommitGate                       deterministic admissibility evaluator (ALLOW / REFUSE / ESCALATE / EXPIRE)
  ↓ if ALLOW
Execution                        the actual wire-level operation (MAVLink frame, Modbus write, K8s admission, ...)
  ↓ records
GELRecord                        hash-chained, signed evidence of the entire lineage
```

Each primitive is a distinct, signed artifact with stable serialization. Each transition is testable in isolation.

### MetaAuthorityEnvelope (MAE) — the constitutional layer

- Tenant-scoped. Carries `tenant_id`, `constitutional_scope`, `ward_creation_rules`, `authority_envelope_rules`, `federation_rules`, `signing_keys`.
- Signed by a key in its own `signing_keys` allowlist. The allowlist is the cross-tenant forge gap closure: no key trusted by tenant B can mint artifacts under tenant A's MAE.
- Source: `shared/governance-core/src/types.ts::MetaAuthorityEnvelope` + `shared/governance-core/src/factory.ts::createMae`.

### Ward — the sovereign protected domain

- One Ward = one consequence boundary (e.g., "the airspace over this ranch", "this company's treasury", "this substation").
- Required field: `human_origin_act` — an attested, signed act by a named human or institution. A Ward without a human origin is structurally invalid.
- Declares `permitted_subjects`, `physical_bounds`, `criticality`, `evidence_requirements`, `revocation_rules`.
- Source: `shared/governance-core/src/types.ts::Ward`.

### AuthorityEnvelope — the scoped delegation

- Names a `subject` (the agent/actor), declares `allowed_actions`, `denied_actions`, optional `constraints` (`max_validity_seconds`, telemetry requirements, escalation thresholds).
- An envelope's allowed authority must be a subset of the Ward's `authority_envelope_constraints`.
- Source: `shared/governance-core/src/types.ts::AuthorityEnvelope`.

### Warrant — single-use, content-bound

- Ed25519-signed. Binds to: `ward_id`, `authority_envelope_id`, `canonical_action_hash`, `subject`, `action_type`, `nonce`, `issued_at`, `expires_at`, `single_use: true`.
- Cannot be replayed (nonce + `NonceSeenSet`).
- Cannot be reused for a different action (content-hash binding).
- Issued by the gate; consumed at execution.
- Source: `shared/execution-control-runtime/src/index.ts::issueWarrant` / `verifyWarrant` / `consumeWarrant`.

### CommitGate — the deterministic evaluator

- Pure function: `(ward, authorityEnvelope, action, runtimeRegister, now, degradedConditions) → CommitGateDecision`.
- Decisions: `ALLOW`, `REFUSE`, `ESCALATE`, `EXPIRE`. Reason codes drawn from a stable taxonomy.
- No side effects in the evaluator itself. Side effects happen at four distinct seams: `issueWarrant`, `consumeWarrant`, `appendGelRecord`, transport.emit.
- Degraded-mode fail policy: when infrastructure-degradation signals are present, the Ward's criticality decides the fail action (safety-critical fails closed; lower criticalities may escalate).
- Source: `shared/execution-control-runtime/src/index.ts::evaluateCommitGate`.

### GELRecord — hash-chained evidence

- Each record carries: `record_id`, `previous_hash`, `record_hash`, `timestamp`, `ward_id`, `subject`, `canonical_action_hash`, `decision`, `reason_codes`, `runtime_register_snapshot`, `physical_invariant_result`, optional `model_lineage`, optional `hardware_attestation`, signature material.
- Signature covers `record_hash`. `record_hash` covers everything except the signature fields themselves (canonical fields list at `GEL_NON_MATERIAL_FIELDS`).
- Chain verification (`verifyGelChain`) walks the chain and confirms every `previous_hash` matches the prior record's `record_hash` and every signature verifies.

---

## The runtime layout

```
shared/governance-core              types, validators, signing primitives, factories
shared/execution-control-runtime    the Commit Gate, APL compiler, ledger backends, OpenAPI server
shared/mesh-runtime                 ROOT/WITNESS/EDGE multi-process mesh + Fluidity Tokens
shared/scenario-engine              declarative scenario DSL for scripting fault patterns
shared/chaos-harness                10 deterministic failure-mode scenarios
shared/time-machine                 counterfactual replay + CLI
shared/replay-artifact              content-addressed scenario reproducibility format
shared/warrant-verifier             standalone public verifier (no gate access required)
shared/tenant-onboarding            bootstrap, lifecycle, audit, federation primitives
shared/policy-pipeline              APL compiler wrapped with provenance + signing + OCI bundling
shared/event-stream                 webhook + SSE delivery

packages/os-sdk                     typed TypeScript client for the gate API
packages/os-sdk-python              typed Python client
packages/{mavlink-px4, ros2-bridge, opcua-adapter, dnp3-adapter, modbus-adapter, bacnet-adapter, k8s-admission}
                                    seven protocol-level governance adapters
packages/{claude-agents, openai-agents, langchain, vercel-ai, bedrock, mastra,
          pydantic-ai-python, autogen-python, semantic-kernel-python, llamaindex-python,
          ag2-python, crewai-python, langgraph-python}
                                    thirteen agent-framework adapters

services/                           service skeletons (most are early; only governance-kernel
                                    and agent-os have tests today — see PROOF_STATUS.md)

apps/                               aristotle-cli, console-ui

examples/mesh/                      40-asset disconnected swarm scenario + published.replay.json
examples/reviewer/                  the 20-minute reviewer flow
examples/framework-adapters/        worked examples for each agent framework
```

---

## Three lifecycle paths

### 1. Direct gate evaluation (in-process or via HTTP)

```
agent → AristotleClient.evaluate(action) → CommitGate → Decision (with Warrant if ALLOW) → GEL record appended
```

If the caller wants to actually execute the action, they consume the Warrant at the boundary (e.g., adapter.emit) and the adapter's transport refuses if the operation drifted from what the Warrant authorized.

### 2. Disconnected operation via the mesh

```
root issues envelope + fluidity token → witness mirrors → edge accepts → edge.evaluate() issues warrants
locally until either: (a) root link recovers and reconciliation runs, or
(b) fluidity TTL expires → edge returns EXPIRE, or
(c) revocation gossiped via witness → edge refuses ENVELOPE_REVOKED, or
(d) disconnected quota exhausted → edge refuses DISCONNECTED_QUOTA_EXCEEDED
```

The 40-asset scenario walks all four paths concretely.

### 3. Counterfactual replay

```
historical GEL records + alternate Ward/Envelope/runtimeRegister → time-machine.runCounterfactual()
                                                              → CounterfactualDiff (flips + reason-code deltas)
```

Used for: policy-tightening CI gates, insurance/audit replay, regulatory what-if review, incident root-cause.

---

## The four seams (separation of concerns)

The runtime deliberately separates four operations that are easy to conflate:

| Seam | Function | Side effects |
|---|---|---|
| **Evaluation** | `evaluateCommitGate` | None. Pure function. |
| **Warrant issuance** | `issueWarrant` | Generates nonce, signs material. Does not store. |
| **Warrant verification** | `verifyWarrant` | None. Pure function. |
| **Warrant consumption** | `consumeWarrant` (via `LedgerStore.consumeWarrant`) | Atomic single-shot mark-as-consumed. Throws on replay. |
| **GEL append** | `appendGelRecord` | Hash-chained append to the durable store. |
| **Transport emission** | adapter.emit | The wire-level operation. Refuses if Warrant scope doesn't cover. |

A reviewer can audit each seam independently. Their composition produces the end-to-end behavior.

---

## What's in-process vs cross-process

Most of the runtime is in-process by default. Specifically:
- `evaluateCommitGate` is pure and synchronous.
- `LedgerStore` ships an in-memory backend and a SQLite backend (`SqliteLedgerBackend`); Postgres backend (`PostgresLedgerBackend` via `@electric-sql/pglite`) is integration-tested.
- Mesh nodes (`RootNode`, `WitnessNode`, `EdgeNode`) ship a real `node:http` server + `fetch` client and are tested both in-process (via `bindRegistry` fast-path) and over real TCP sockets (`live HTTP transport` test).
- Pluggable `httpClient` and `urlFor` hooks on `MeshNodeOptions` allow callers to inject mTLS / service-mesh URLs without modifying protocol.

---

## What's NOT in the architecture

This is important to be explicit about:

- No execution dispatcher: AristotleOS does not run agents or perform IO on behalf of agents. It governs the calls the agent makes.
- No prompt-time intervention: AristotleOS does not modify, sanitize, or rewrite LLM outputs. It receives an action proposal and decides.
- No model gateway / orchestration: AristotleOS does not host or proxy model inference.
- No telemetry stack: AristotleOS records what was decided. Operational telemetry (metrics, traces, logs) is the host's responsibility, though `event-stream` ships webhook + SSE for decision events.
- No safety subsystem (collision avoidance, hazard detection): AristotleOS evaluates declared physical bounds; it does not derive bounds from live sensor fusion. That belongs in the controller / certified safety layer the operator already has.

---

## Threat surface (link)

See `THREAT_MODEL.md` for the structured table of threats, mitigations, evidence paths, and residual risks. This document focuses on shape; that one focuses on what could go wrong.
