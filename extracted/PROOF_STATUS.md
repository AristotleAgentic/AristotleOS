# PROOF_STATUS

This document is the single source of truth for what AristotleOS proves and what it does not. Every claim made elsewhere in the repository (README, CHANGELOG, REVIEWER.md, package descriptions) must trace back to a row here. If a claim doesn't appear in this table or contradicts it, the claim is wrong, not this table.

Statuses
- **PROVEN_BY_TEST** — A passing automated test in this repo demonstrates the claim. Evidence path identifies file + test name.
- **DEMONSTRATED_BY_EXAMPLE** — A runnable example in this repo demonstrates the claim end-to-end. The example may include automated checks but the proof relies on the example's observable behavior.
- **IMPLEMENTED_NOT_FULLY_TESTED** — Code exists but the test surface is shallow or partial. Listed risks describe what's missing.
- **PLAUSIBLE_NOT_PROVEN** — A claim that follows from the design but is not directly tested. Reviewer should not treat as established.
- **NOT_YET_IMPLEMENTED** — Documented as future work. No code, no tests.

---

## Core authority chain

| Claim | Evidence path | Status | Risk / hardening required |
|---|---|---|---|
| Commit Gate is deterministic given the same inputs | `shared/execution-control-runtime/src/index.ts::evaluateCommitGate` + `gate.property.test.ts` (2 property tests) + `index.test.ts` (75 tests) | PROVEN_BY_TEST | Property test coverage is narrow; broader fuzzing/property-based-testing planned (see ROADMAP_TO_100.md §1). |
| Commit Gate emits ALLOW / REFUSE / ESCALATE / EXPIRE with stable reason codes | `shared/execution-control-runtime/src/index.ts` lines 123-150 + `index.test.ts` | PROVEN_BY_TEST | Reason code taxonomy is internal; not published as a versioned spec. |
| Canonical action hash is stable across re-runs of the same action | `shared/execution-control-runtime/src/index.ts::canonicalizeAction` + `index.test.ts` | PROVEN_BY_TEST | Stable serialization handles `undefined` correctly after the v0.1.63 fix; documented in `docs/CANONICALIZATION.md` once written. |
| Warrant is Ed25519-signed and binds to canonical action hash + nonce | `shared/execution-control-runtime/src/index.ts::issueWarrant` + `warrant-time.test.ts` (5 tests) + `warrant-verifier/src/index.test.ts` (11 tests) | PROVEN_BY_TEST | Default dev signer is process-stable but not KMS-backed (LIMITATIONS.md §1). |
| Warrant is single-use; replay of consumed warrant refuses | `shared/execution-control-runtime/src/index.ts::consumeWarrant` + `index.test.ts` "server enforces replay protection" | PROVEN_BY_TEST | Replay protection requires a durable `NonceSeenSet`; only in-memory implementation ships (see warrants-durable-nonce-store TODO below). |
| Tampering a warrant's nonce breaks the signature | `warrant-time.test.ts` "issued warrants carry a signed nonce; tampering ..." | PROVEN_BY_TEST | — |
| Action-hash mismatch refuses verification | `warrant-verifier/src/index.test.ts` "REFUSEs when canonical_action_hash doesn't match" | PROVEN_BY_TEST | — |
| Untrusted signing key refuses verification | `warrant-verifier/src/index.test.ts` "REFUSEs when the warrant's signing key is not in trustedKeyIds" | PROVEN_BY_TEST | — |
| Expired warrant refuses verification | `warrant-verifier/src/index.test.ts` "REFUSEs an expired warrant" | PROVEN_BY_TEST | — |
| Wrong subject refuses at gate | `examples/reviewer/verify.ts` Stage 1c + `index.test.ts` | PROVEN_BY_TEST | — |
| Action not in envelope's allowed_actions refuses at gate | `examples/reviewer/verify.ts` Stage 1b + `index.test.ts` | PROVEN_BY_TEST | — |
| Envelope expiry refuses with `ENVELOPE_EXPIRED` | `index.test.ts` + `mesh-runtime/src/index.test.ts` "envelope EXPIRED returns the distinct EXPIRE decision" | PROVEN_BY_TEST | — |
| Wrong Ward refuses (envelope.ward_id ≠ ward.ward_id) | `index.test.ts` | PROVEN_BY_TEST | — |
| Denied action in envelope's denied_actions refuses | `index.test.ts` | PROVEN_BY_TEST | — |
| Degraded-mode signals trigger fail-closed for safety_critical Wards | `fail-mode.test.ts` (9 tests) + `degradation.test.ts` (8 tests) | PROVEN_BY_TEST | — |
| Multi-tenant key binding prevents cross-tenant forgery | `governance-core/src/validators.security.test.ts` (6 tests) + `tenant-onboarding/src/index.test.ts` (29 tests) | PROVEN_BY_TEST | — |

## GEL (Governance Evidence Ledger)

| Claim | Evidence path | Status | Risk / hardening required |
|---|---|---|---|
| GEL records are hash-chained | `shared/execution-control-runtime/src/index.ts::appendGelRecord` + `governance-core/src/gel.ts` + `chain.test.ts` (root script `test:chain`) | PROVEN_BY_TEST | — |
| Tampering a record breaks chain verification | `chain.test.ts` + `governance-core/src/test/run.test.ts` | PROVEN_BY_TEST | — |
| Records are signed (Ed25519 or HMAC keyring-backed) | `governance-core` validators + `index.test.ts` "operator identity is attributed in the GEL and is tamper-evident" | PROVEN_BY_TEST | External timestamp authority / Sigstore integration not present (see LIMITATIONS.md §3). |
| Evidence bundle exports + verifies offline | `governance-core/src/test/run.test.ts` "an evidence bundle exports and verifies offline; tampering is detected" | PROVEN_BY_TEST | — |
| Model lineage + hardware attestation fields are hashed into the chain | `shared/execution-control-runtime/src/index.ts` GelRecord interface + `index.test.ts` | PROVEN_BY_TEST | Hardware attestation field accepts caller-supplied content; no built-in TPM/SGX/TrustZone bridge ships. |

## Partition tolerance and the 40-asset scenario

| Claim | Evidence path | Status | Risk / hardening required |
|---|---|---|---|
| Multi-process mesh with ROOT, WITNESS, EDGE roles | `shared/mesh-runtime/src/index.ts` + `index.test.ts` (11 tests) + `quorum-routing.test.ts` (11 tests) | PROVEN_BY_TEST | — |
| Live HTTP transport over real TCP sockets | `mesh-runtime/src/index.test.ts` "live HTTP transport: root and edge can talk over real TCP sockets" | PROVEN_BY_TEST | Pre-existing intermittent timing-related flake on contended hosts; passes on retry. |
| Edge issues Warrants under Fluidity Token when disconnected from root | `mesh-runtime/src/index.test.ts` "partition: edge keeps issuing under Fluidity Token TTL" | PROVEN_BY_TEST | — |
| Edge fails closed when Fluidity Token expires | same file, "then EXPIRES on TTL expiry" | PROVEN_BY_TEST | — |
| Edge fails closed after exceeding maxWarrantsWhileDisconnected | same file, "disconnected-quota cap" | PROVEN_BY_TEST | — |
| Revocation gossiped through witness reaches partitioned edge | `mesh-runtime/src/index.test.ts` "revocation issued during split is detected via surviving witness" | PROVEN_BY_TEST | Witness gossip is at-most-once at gossip time; post-recovery replay requires operator re-gossip (modeled in `chaos-harness::witness_flap`). |
| 40-asset scenario produces deterministic counters | `examples/mesh/swarm-partition-40-asset.test.ts` (7 tests) + `examples/mesh/published.replay.test.ts` (3 tests) + `examples/reviewer/verify.ts` Stage 3 | PROVEN_BY_TEST | "Deterministic" means integer counters are stable; wall-clock timestamps in non-hash fields naturally differ. |
| The published replay artifact's `report_hash` matches a fresh local re-run | `examples/mesh/published.replay.test.ts` + `examples/reviewer/verify.ts` Stage 4 | PROVEN_BY_TEST | Reproducibility holds within the same `pipeline_version`; cross-version drift is a documented future concern. |
| `verifyReplayArtifact()` passes four gates: artifact_hash, report_hash, scenario_reproducible, version_ok | `examples/mesh/published.replay.test.ts` + `shared/replay-artifact/src/index.test.ts` (10 tests) | PROVEN_BY_TEST | — |

## Chaos / failure modes

| Claim | Evidence path | Status | Risk / hardening required |
|---|---|---|---|
| Revocation lag — witness-reachable refuses, isolated allows under FT | `chaos-harness/src/index.test.ts` "revocation_lag" | PROVEN_BY_TEST | — |
| Malicious envelope (wrong-secret signature) is rejected | `chaos-harness/src/index.test.ts` "malicious_envelope" | PROVEN_BY_TEST | Test exercises HMAC-secret forgery; Ed25519-keypair forgery is structurally similar but not separately tested. |
| Hallucinated commands (out-of-envelope action_type) refused 50× consecutively | `chaos-harness/src/index.test.ts` "hallucinated_command" | PROVEN_BY_TEST | — |
| Fluidity Token TTL expiry returns EXPIRE | `chaos-harness/src/index.test.ts` "fluidity_ttl_expiry" | PROVEN_BY_TEST | — |
| Disconnected quota exhaustion → REFUSE / DISCONNECTED_QUOTA_EXCEEDED | `chaos-harness/src/index.test.ts` "quota_exhaustion" | PROVEN_BY_TEST | — |
| Replay-attempt: every replay yields distinct warrant_id | `chaos-harness/src/index.test.ts` "replay_attempt" | PROVEN_BY_TEST | — |
| Clock skew past local TTL → EXPIRE | `chaos-harness/src/index.test.ts` "clock_skew" | PROVEN_BY_TEST | Edge clock semantics are local-clock-driven by design; real wall-clock-skew between nodes requires NTP synchrony assumptions (LIMITATIONS.md §4). |
| Witness flap + operator re-gossip restores edge view | `chaos-harness/src/index.test.ts` "witness_flap" | PROVEN_BY_TEST | Recovery requires explicit operator re-gossip; edge has no auto-pull of missed revocations (LIMITATIONS.md §5). |
| Gossip storm idempotency (Map dedup by revocation_id) | `chaos-harness/src/index.test.ts` "gossip_storm" | PROVEN_BY_TEST | — |
| Envelope version downgrade rejected | `chaos-harness/src/index.test.ts` "envelope_version_downgrade" | PROVEN_BY_TEST | — |

## Protocol adapters

| Claim | Evidence path | Status | Risk / hardening required |
|---|---|---|---|
| MAVLink v2 wire frame is bit-correct for COMMAND_LONG (msg id 76) | `packages/mavlink-px4/src/index.test.ts` "encodeCommandLong produces a MAVLink v2 frame" | PROVEN_BY_TEST | Framing layer minimal; full MAVLink ecosystem (heartbeats, parameter ops, ferry/SITL integration) out of scope. |
| MAVLink UDP transport sends a real datagram to a local listener | `packages/mavlink-px4/src/index.test.ts` "MavlinkUdpTransport sends a real UDP datagram to a listener" | DEMONSTRATED_BY_EXAMPLE | "Real listener" = a `node:dgram` socket in the test process, NOT a PX4 SITL / autopilot. **Not production validated.** |
| ROS2 rosbridge websocket transport sends JSON op via injected socket | `packages/ros2-bridge/src/index.test.ts` "RosbridgeWebsocketTransport sends a JSON op via the injected socket" | DEMONSTRATED_BY_EXAMPLE | Real ROS2 daemon integration not tested. |
| OPC-UA write delegates to provided writer; NodeId allowlist enforced | `packages/opcua-adapter/src/index.test.ts` "REFUSES nodes outside authz.permitted_node_ids" | PROVEN_BY_TEST | No `node-opcua` integration test; demonstrates the governance pattern, not the OPC-UA stack. |
| DNP3 CROB write — point_index allowlist enforced | `packages/dnp3-adapter/src/index.test.ts` "REFUSES point indexes outside authz" | PROVEN_BY_TEST | No real DNP3 RTU test; transport is a shim or demo. |
| Modbus TCP write — address allowlist + value cap enforced | `packages/modbus-adapter/src/index.test.ts` (14 tests) | PROVEN_BY_TEST | No real PLC test. |
| BACnet WriteProperty — object allowlist + priority cap | `packages/bacnet-adapter/src/index.test.ts` (13 tests) | PROVEN_BY_TEST | No real BAS test. |
| K8s admission webhook — ALLOW → 200, REFUSE → 403, ESCALATE → 409 or 202, gate-unreachable → 503 | `packages/k8s-admission/src/index.test.ts` (10 tests) | PROVEN_BY_TEST | Not deployed against a real cluster's API server in tests. |
| EVERY adapter refuses before transport emission when authz mismatch | `examples/reviewer/verify.ts` Stage 1d cross-checks Warrant binding; each adapter's own test for `*_OUTSIDE_AUTHZ` covers this | PROVEN_BY_TEST | The cross-cutting invariant ("transport.emit() is never called when authz is wrong") is provable per-adapter; no single test asserts it across all 7 simultaneously. See `tests/refusal-before-emission.test.ts` (planned, ROADMAP_TO_100.md). |

## Policy pipeline

| Claim | Evidence path | Status | Risk / hardening required |
|---|---|---|---|
| APL source → signed PolicyBundle with provenance | `shared/policy-pipeline/src/index.test.ts` "buildPolicyBundle: emits a PolicyBundle with bundle_hash + provenance + manifests" | PROVEN_BY_TEST | APL is small (one `ward { ... }` block per source file); not a complete policy DSL — see docs/APL.md. |
| Same source + same built_at → byte-identical bundle_hash | same file, "reproducibility" test | PROVEN_BY_TEST | — |
| Tampered source breaks reproducibility check | same file, "tampered source breaks reproducibility" | PROVEN_BY_TEST | — |
| Tampered manifest breaks bundle_hash check | same file, "tampered manifest breaks bundle_hash" | PROVEN_BY_TEST | — |
| OCI-style bundling round-trips through signature verify | `shared/policy-pipeline/src/oci.test.ts` (5 tests) | PROVEN_BY_TEST | OCI distribution-spec filesystem layout / tarball emission is left to the caller. |

## Time Machine / counterfactual replay

| Claim | Evidence path | Status | Risk / hardening required |
|---|---|---|---|
| Counterfactual diff against alternate policy world | `shared/time-machine/src/index.test.ts` (11 tests) + `cli.test.ts` (9 tests) | PROVEN_BY_TEST | — |
| Old-policy ALLOW + new-policy REFUSE flips reported with reason-code delta | same file, "counterfactual that removes action from envelope flips ALLOW to REFUSE" | PROVEN_BY_TEST | — |
| Policy_version mismatch → ESCALATE in counterfactual | `time-machine/src/index.test.ts` "counterfactual reports policy_version mismatch as ESCALATE" | PROVEN_BY_TEST | — |
| Sweep batch reports ALLOW_to_REFUSE counters | `time-machine/src/index.test.ts` "runCounterfactualSweep" | PROVEN_BY_TEST | — |
| `aristotle-counterfactual` CLI exits non-zero when flipped > max | `time-machine/src/cli.test.ts` | PROVEN_BY_TEST | — |

## Multi-tenant control plane

| Claim | Evidence path | Status | Risk / hardening required |
|---|---|---|---|
| Bootstrap tenant in one signed call | `shared/tenant-onboarding/src/index.test.ts` "bootstrapTenant" tests | PROVEN_BY_TEST | — |
| Key rotation + prune preserves verifiability of in-flight artifacts | `tenant-onboarding/src/index.test.ts` rotateTenantKey / pruneRetiredTenantKey tests | PROVEN_BY_TEST | — |
| Suspend / revoke / export / import tenant lifecycle | `tenant-onboarding/src/index.test.ts` 10 lifecycle tests | PROVEN_BY_TEST | — |
| Tenant posture audit report with severity-ordered findings | `tenant-onboarding/src/index.test.ts` tenantAuditReport tests | PROVEN_BY_TEST | — |
| Federation handshake enforces four invariants (both opt-in, mutual trust, ward ownership, anchor merge) | `tenant-onboarding/src/index.test.ts` federateTenants tests | PROVEN_BY_TEST | — |

## Event streaming and external verification

| Claim | Evidence path | Status | Risk / hardening required |
|---|---|---|---|
| Webhook delivery with HMAC signing, bounded retry, dead-letter | `shared/event-stream/src/index.test.ts` (11 tests) | PROVEN_BY_TEST | — |
| SSE stream with per-connection filter | `event-stream/src/index.test.ts` "attachSseHandler" | PROVEN_BY_TEST | — |
| Standalone public Warrant verifier — no gate access | `shared/warrant-verifier/src/index.test.ts` (11 tests) | PROVEN_BY_TEST | — |

---

## Reviewer flow (the headline integration)

| Stage | What it proves | Source |
|---|---|---|
| Stage 1 (Commit Gate) | ALLOW path, two REFUSE paths, Warrant binds to canonical action hash | `examples/reviewer/verify.ts` lines 130-191 |
| Stage 2 (Public Warrant Verifier) | Happy path + signature tamper + untrusted key + action-hash mismatch + HTTP handler 200 | `examples/reviewer/verify.ts` lines 196-260 |
| Stage 3 (40-asset scenario) | Phase counters + sha256 stability | `examples/reviewer/verify.ts` lines 265-308 |
| Stage 4 (Replay artifact) | Local re-run reproduces published `report_hash` byte-for-byte | `examples/reviewer/verify.ts` lines 313-355 |

Total: **18 checks, ~800ms, exit 0/1.** See `examples/reviewer/REVIEWER.md`.

---

## What this table does NOT cover (and where to look)

| Concern | Where to look | Status |
|---|---|---|
| Production hardware integration | LIMITATIONS.md §1, ROADMAP_TO_100.md §1 | NOT_YET_IMPLEMENTED |
| External security audit | LIMITATIONS.md §2 | NOT_YET_DONE |
| Formal verification / TLA+ spec | ROADMAP_TO_100.md §1 | NOT_YET_DONE |
| KMS / HSM integration as default | LIMITATIONS.md §1 | NOT_YET_IMPLEMENTED |
| External timestamp authority (TSA / Sigstore) for GEL records | LIMITATIONS.md §3 | NOT_YET_IMPLEMENTED |
| Real customer deployments | LIMITATIONS.md §6 | NONE |
| Certification (SOC2 / ISO 27001 / regulatory) | LIMITATIONS.md §7 | NONE |
| Standards-body governance of Warrant / GEL format | ROADMAP_TO_100.md §3 | OPEN |

---

## How to dispute a row

Every row above is falsifiable. If a reviewer believes a `PROVEN_BY_TEST` row's test doesn't actually prove the claim:

1. Open the file at the listed path.
2. Find the test by name.
3. Read the assertion. Re-run it locally: `corepack pnpm@10.32.1 --filter @aristotle/<package> test`.
4. Open an issue with the row's claim and the specific reason the test is insufficient.

This document is updated on every release. See `RELEASE_CHECKLIST.md` § "Proof status updated".
