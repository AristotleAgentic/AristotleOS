# AristotleOS

A governance execution substrate for autonomous systems. Apache-2.0. Pre-1.0.

AristotleOS interposes a signed, replayable authority chain between an autonomous agent and the consequence its actions would produce. Every action passes through a Commit Gate that decides ALLOW / REFUSE / ESCALATE / EXPIRE. ALLOWed actions are conveyed by a single-use, content-bound, Ed25519-signed Warrant. Every decision is recorded in a hash-chained Governance Evidence Ledger that a third party can verify offline.

This repository implements the substrate end-to-end, demonstrates partition-tolerant operation across 40 simulated assets, and ships a 20-minute reviewer flow that lets anyone verify the core claim from a clean clone.

---

## 1. What AristotleOS is

A TypeScript runtime substrate, organized as a pnpm monorepo with ~47 packages and ~820 test cases. The chain is:

```
MetaAuthorityEnvelope → Ward → AuthorityEnvelope → Warrant → CommitGate → Execution → GELRecord
```

Each primitive is a distinct signed artifact. Each transition is testable in isolation. See `ARCHITECTURE.md`.

## 2. The problem it addresses

**"Who authorized this action, under what authority, can we prove it, and would the new policy have refused it?"**

This question is unanswered by existing infrastructure:
- IAM and policy engines (AWS IAM, OPA, Cedar) authorize API calls; they don't extend governance through to wire-level actuation.
- Agent guardrails (NeMo, Bedrock Guardrails) filter model output; they don't govern the action that follows.
- OT cybersecurity products detect anomalies; they don't refuse unauthorized writes before bytes hit the wire.
- Supply-chain attestation (Sigstore, SLSA) attests software artifacts; it doesn't attest agent decisions.
- JWTs are reusable bearer tokens; they don't bind to a specific action or detect drift.

AristotleOS provides a per-action, signed, single-use, content-bound conveyance, refused at the wire when drift is detected, recorded in a hash-chained ledger, verifiable by a third party with only the artifact. See `docs/MARKET_POSITIONING.md`.

## 3. What makes it different

| Property | OPA / Cedar | JWT / OAuth | Guardrails | OT Monitoring | Sigstore | AristotleOS |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Governs API access | ✓ | ✓ |   |   |   | ✓ |
| Governs physical actuation |   |   |   | (monitors) |   | **✓** (seven protocols) |
| Single-use conveyance |   |   |   |   |   | **✓** |
| Content-bound to one action |   |   |   |   | (for artifacts) | **✓** |
| Partition-tolerant disconnected authority |   |   |   |   |   | **✓** (Fluidity Tokens) |
| Hash-chained evidence ledger |   |   |   |   | (for builds) | **✓** |
| Counterfactual replay |   |   |   |   |   | **✓** |
| Reproducible evidence artifact |   |   |   |   | ✓ | **✓** |

## 4. Architecture

```
                                  Constitutional layer
       MetaAuthorityEnvelope ──────────────────────────────  signed by issuer key in own allowlist
                  │
                  │ constitutes
                  ▼                Sovereign protected domain
                 Ward ────────────────────────────────────  signed; carries human_origin_act
                  │
                  │ delegates
                  ▼                Scoped operating authority for a subject
          AuthorityEnvelope ──────────────────────────────  signed; lists allowed/denied actions
                  │
                  │ admits via
                  ▼                Pure deterministic evaluator
              CommitGate ─────────  ALLOW | REFUSE | ESCALATE | EXPIRE  +  reason codes
                  │
                  │ ALLOW issues
                  ▼                Single-use, content-bound, Ed25519-signed
                 Warrant ─────────  warrant_id, canonical_action_hash, nonce, expires_at
                  │
                  │ consumed at
                  ▼                Atomic single-shot mark-as-consumed
              Execution ─────────  adapter.emit() refuses if action drifts from warrant
                  │
                  │ records
                  ▼                Hash-chained, signed evidence
              GELRecord ─────────  previous_hash, record_hash, signature; exportable as
                                   offline-verifiable evidence bundle
```

See `ARCHITECTURE.md` for the runtime layout, four-seam separation of concerns, and the three lifecycle paths (direct gate, mesh-disconnected operation, counterfactual replay).

## 5. The 20-minute reviewer flow

```sh
git clone https://github.com/AristotleAgentic/AristotleOS
cd AristotleOS/extracted
corepack enable
corepack pnpm@10.32.1 install
pnpm reviewer:verify
```

In ~800 ms of compute, four stages run 18 individual checks against the actual source:

| Stage | What it proves |
|---|---|
| 1. Commit Gate | ALLOW path + two REFUSE paths + Warrant binds to canonical action hash |
| 2. Public Warrant Verifier | Happy path + signature tamper + untrusted key + action-hash mismatch + HTTP handler |
| 3. 40-asset disconnected swarm scenario | Deterministic phase counters + stable SHA-256 report hash |
| 4. Published replay artifact | Local re-run reproduces the published `report_hash` byte-for-byte |

Exit `0` and `totals.failed: 0` means the core substrate claim is reviewer-verified. See `examples/reviewer/REVIEWER.md`.

## 6. Quickstart for integrators

### Use the gate as a service

```ts
import { AristotleClient } from "@aristotle/os-sdk";

const aos = new AristotleClient({ baseUrl: "http://127.0.0.1:8181" });
const decision = await aos.evaluate({
  action_id: "act-1",
  ward_id: "ward-x",
  subject: "agent:demo",
  action_type: "demo.run"
});
// decision.decision: "ALLOW" | "REFUSE" | "ESCALATE" | "EXPIRE"
// decision.warrant: present on ALLOW
```

### Govern a hardware-actuation call (Modbus example)

```ts
import { DemonstrationModbusTransport, governModbusOperation } from "@aristotle/modbus-adapter";

const transport = new DemonstrationModbusTransport();   // production_validated: false
const result = await governModbusOperation(
  { kind: "write_single_register", unit_id: 1, start_address: 40001, values: [42],
    label: "Tank-1 setpoint", requested_at: new Date().toISOString() },
  transport,
  { client: aos, wardId: "ward-plant", subject: "agent:scada-controller",
    deviceId: "plc:plant-1", allowDemonstrationTransport: true }
);
// result.ok / result.refusal / result.outcome.receipt (with content-addressed hash)
```

The same shape applies to MAVLink/PX4, ROS2, OPC-UA, DNP3, BACnet, and Kubernetes admission. See `docs/ADAPTER_VALIDATION.md`.

### Govern a Claude agent's tool calls

```ts
import { wrapClaudeAgent } from "@aristotle/claude-agents";
import { AristotleClient } from "@aristotle/os-sdk";

const aos = new AristotleClient({ baseUrl: "http://127.0.0.1:8181" });
const governedAgent = wrapClaudeAgent(yourAgent, { client: aos, wardId, subject });
// Every tool call now flows through the gate before reaching its sink
```

Adapters exist for Claude Agents, LangChain, OpenAI Agents, Vercel AI, Bedrock, Mastra, CrewAI, LangGraph, Pydantic AI, AutoGen, Semantic Kernel, LlamaIndex, AG2, and MCP.

## 7. Core primitives

| Primitive | Package | What it does |
|---|---|---|
| Constitutional layer | `@aristotle/governance-core` | MAE / Ward / Envelope / signing / validators / federation |
| Commit Gate + GEL | `@aristotle/execution-control-runtime` | deterministic evaluator, warrant lifecycle, hash-chained ledger, APL compiler |
| Multi-process mesh | `@aristotle/mesh-runtime` | ROOT/WITNESS/EDGE roles, Fluidity Tokens, quorum signing, sovereign routing |
| Policy build pipeline | `@aristotle/policy-pipeline` | APL → signed, content-addressed bundle with OCI distribution |
| Counterfactual replay | `@aristotle/time-machine` | re-evaluate history against alternate policies; CLI for CI gates |
| Reproducibility | `@aristotle/replay-artifact` | content-addressed scenario reproducibility; four-gate verifier |
| Public verifier | `@aristotle/warrant-verifier` | standalone offline warrant verification (no gate access required) |
| Multi-tenant | `@aristotle/tenant-onboarding` | bootstrap, rotate, suspend, revoke, export, import, audit, federate |
| Chaos primitives | `@aristotle/chaos-harness` | 10 deterministic failure-mode scenarios |
| Scenario engine | `@aristotle/scenario-engine` | declarative scenario DSL with packet loss, partition, assertions |
| Event delivery | `@aristotle/event-stream` | HMAC-signed webhook + Server-Sent Events |
| Client SDK | `@aristotle/os-sdk` (TS) / `aristotle-os-sdk` (Py) | typed clients for the gate API |

## 8. Example: governed action lifecycle

```
Agent proposes action
  ↓ (AristotleClient.evaluate)
Commit Gate evaluates against (Ward, Envelope, runtime registers, degraded conditions)
  ↓ ALLOW + reason_codes=["ALLOWED"]
Warrant minted: { warrant_id, canonical_action_hash, nonce, expires_at, signature }
  ↓ (carried to execution boundary)
Adapter receives (operation, authz); preflight checks operation against authz allowlists
  ↓ (drift detection: refuses with *_OUTSIDE_AUTHZ if mismatch)
Transport emits the wire-level operation (MAVLink frame, Modbus write, K8s admission response, ...)
  ↓
Warrant consumed atomically (single-shot)
  ↓
GEL record appended: previous_hash → record_hash → signed
  ↓
event-stream webhook fires for downstream observability
```

## 9. Example: refused unauthorized protocol write

```
Agent attempts:  Modbus write to register 49999 with value 200
Authz allowlist: permitted_register_addresses=[40001, 40002, 40003], max_register_value={40001: 100}

Adapter preflight:
  - register 49999 ∉ allowlist → REFUSE: ADDRESS_OUTSIDE_AUTHZ
  - transport.emit() is NEVER called
  - no wire-level bytes are sent
```

The refusal-before-emission invariant is tested for every adapter. See `docs/ADAPTER_VALIDATION.md`.

## 10. Example: 40-asset partition replay

`examples/mesh/published.replay.json` is a content-addressed proof artifact:

```
scenario_id: swarm-partition-40-asset
scenario_version: 1.0.0
inputs: { assetCount: 40, fluidityTtlMs: 1500 }
report: { phase1_allow: 40, phase2_allow: 40, phase3_isolated_half_allowed: 10,
          phase4_reconciled_conflicts: 10, total_warrants_issued: 90, ... }
report_hash:   sha256:8b379ea543a8b72aad81b8c4be37bc3c054209dfd8bd04e15e03c51a9d952ce2
artifact_hash: sha256:5e1adb1b303f66f300a43d24d4e2cdd1601c68cc3b4e823227100e1b1d2620c1
```

A reviewer's local re-run must produce the same `report_hash`. The scenario runs in ~500 ms. See `examples/mesh/published.replay.report.md` for the readable walkthrough.

## 11. Package map

```
shared/governance-core              constitutional primitives
shared/execution-control-runtime    Commit Gate + APL + ledger backends
shared/mesh-runtime                 multi-process mesh + Fluidity Tokens
shared/policy-pipeline              signed policy bundles + OCI distribution
shared/time-machine                 counterfactual replay + CLI
shared/replay-artifact              content-addressed reproducibility
shared/warrant-verifier             standalone public verifier
shared/tenant-onboarding            bootstrap + lifecycle + federation
shared/chaos-harness                deterministic failure scenarios
shared/scenario-engine              declarative scenario DSL
shared/event-stream                 webhook + SSE delivery

packages/os-sdk                     TS client
packages/os-sdk-python              Python client
packages/{mavlink-px4, ros2-bridge, opcua-adapter, dnp3-adapter,
          modbus-adapter, bacnet-adapter, k8s-admission}
                                    seven protocol-level governance adapters
packages/{claude-agents, openai-agents, langchain, vercel-ai, bedrock, mastra,
          ag2, autogen, crewai, langgraph, llamaindex, pydantic-ai, semantic-kernel}
                                    thirteen agent-framework adapters

examples/reviewer/                  the 20-minute reviewer flow
examples/mesh/                      40-asset disconnected swarm + published.replay.json
examples/framework-adapters/        worked examples per framework

services/                           service skeletons (most early; see PROOF_STATUS.md)
apps/                               aristotle-cli, console-ui
```

## 12. What is proven (and where)

See `PROOF_STATUS.md` for the per-claim evidence table. Every PROVEN_BY_TEST row points to a specific test file. Summary:

- Commit Gate determinism, decision taxonomy, canonical action hash, reason codes — `shared/execution-control-runtime/src/index.test.ts` (75 tests).
- Warrant single-use + signature + content-binding + replay protection — `warrant-time.test.ts`, `warrant-verifier/src/index.test.ts`.
- GEL hash-chained, signed, evidence-bundle-exportable, tamper-detected — `governance-core/src/test/run.test.ts` (41 tests).
- 40-asset disconnected swarm reproducibility — `examples/mesh/published.replay.test.ts`.
- Partition tolerance + Fluidity Tokens — `mesh-runtime/src/index.test.ts` (22 tests).
- 10 chaos scenarios — `chaos-harness/src/index.test.ts`.
- Counterfactual replay + CLI — `time-machine/src/index.test.ts` + `cli.test.ts`.
- Multi-tenant lifecycle + federation handshake — `tenant-onboarding/src/index.test.ts` (29 tests).
- Per-adapter refusal-before-emission — each `packages/*-adapter/src/index.test.ts`.

## 13. What is NOT proven

See `LIMITATIONS.md` for the full list. Short version:

- No production hardware validation. The seven protocol adapters ship with `production_validated: false` by default.
- No external security audit.
- No KMS / HSM integration as a default (caller-supplied today).
- No external timestamp authority anchoring of GEL records.
- No customer deployments or pilots.
- No certifications (SOC 2, ISO 27001, IEC 62443, DO-178C, etc.).
- APL is intentionally small; non-trivial policies require in-code construction.
- Edge auto-pull of missed revocations after partition is a documented gap.

## 14. Security model

See `SECURITY.md` for disclosure path and `THREAT_MODEL.md` for the structured threat table. Highlights:

- Cross-tenant forgery is structurally prevented by the `mae.signing_keys` allowlist (tested).
- Warrant replay is prevented by atomic single-shot `consumeWarrant` + per-issuance nonce (tested).
- Action drift between warrant issuance and execution is detected by canonical action hash binding (tested).
- GEL tampering breaks the hash chain (tested).
- Mesh partition is handled by Fluidity Tokens with bounded TTL and disconnected quota (tested).

What this model does NOT defend against (in scope for an external audit):
- Key compromise (mitigated by rotation primitives + KMS integration the operator wires).
- Backdating by a key-compromised adversary (mitigated by external timestamp authority the operator wires).
- Clock manipulation on a compromised edge host (mitigated by hardware-attested clocks).

## 15. Limitations

See `LIMITATIONS.md`. Read this before deciding whether the substrate meets your bar.

## 16. Roadmap

See `ROADMAP_TO_100.md`. Organized in five categories: technical seriousness, commercial readiness, strategic novelty, diligence readiness, high-upside potential. Each lists current gaps, concrete actions, and the highest-leverage next step.

## 17. License

Apache-2.0. See `LICENSE` and `NOTICE`. Every workspace `package.json` declares `"license": "Apache-2.0"`.

Demonstration material — including jurisdiction-rule presets, sample APL policies under `examples/`, and demonstration transports across the protocol adapters — is explicitly labeled. Real deployments require counsel review and per-jurisdiction validation before promotion past `production_validated: false`.

---

## Diligence documents

| Document | Purpose |
|---|---|
| `examples/reviewer/REVIEWER.md` | The 20-minute reviewer flow walkthrough |
| `PROOF_STATUS.md` | Every claim → evidence path → status → risk |
| `VALIDATION_MATRIX.md` | Capability-by-capability evidence + confidence |
| `THREAT_MODEL.md` | Threats, mitigations, residual risk, production hardening |
| `LIMITATIONS.md` | What AristotleOS does NOT prove |
| `ARCHITECTURE.md` | The chain, the runtime, the four seams |
| `VERSIONING.md` | Pre-1.0 posture and stable format tags |
| `ROADMAP_TO_100.md` | Concrete path to closure in each category |
| `RELEASE_CHECKLIST.md` | Pre-release discipline |
| `CONTRIBUTING.md` | How to contribute |
| `docs/ADAPTER_VALIDATION.md` | Per-adapter validation status |
| `docs/WARRANTS.md` | Why a Warrant is not a JWT |
| `docs/GEL.md` | The evidence ledger |
| `docs/MESH.md` | Partition-tolerant authority |
| `docs/APL.md` | The policy language |
| `docs/TIME_MACHINE.md` | Counterfactual replay |
| `docs/TENANCY_AND_FEDERATION.md` | Multi-tenant control plane |
| `docs/DILIGENCE_MEMO.md` | Diligence answers, in one document |
| `docs/MARKET_POSITIONING.md` | Sober positioning, no projections |

Run `pnpm proof:status` for an at-a-glance orientation.

## Run the full suite

```sh
pnpm reviewer:verify           # 18 checks, ~800 ms — the headline integration
pnpm test:core                 # governance-core + execution-control + mesh + verifier + replay-artifact
pnpm test:protocol-adapters    # the seven hardware-governance adapters
pnpm test:framework-adapters   # agent-framework worked examples
pnpm test:mesh                 # mesh-runtime + chaos + scenarios
pnpm test:tenancy              # tenant-onboarding + policy-pipeline + time-machine + event-stream
pnpm test:all                  # every workspace package (sequential)
```
