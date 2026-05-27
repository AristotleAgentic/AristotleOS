# VALIDATION_MATRIX

Capability-by-capability evidence summary. Each row is a single capability, with the test path, current status, confidence level, and what would still be required before production.

Statuses
- **Implemented and tested** — code exists, passing tests directly assert the capability.
- **Demonstrated by deterministic scenario** — runnable scenario in this repo demonstrates the capability end-to-end.
- **Implemented but needs deeper tests** — code exists, test coverage is shallow.
- **Documented but not implemented** — described as future work in this repo.
- **Not currently claimed** — explicitly out of scope.

Confidence
- **High** — multiple independent tests; cross-checked by the reviewer flow.
- **Medium** — directly tested but with narrow coverage.
- **Low** — covered by integration-level testing only.
- **Demo-grade** — runnable example, no production-equivalent validation.

---

| # | Capability | Evidence today | Test path | Status | Confidence | Missing before production |
|---|---|---|---|---|---|---|
| 1 | Commit Gate determinism (same inputs → same decision) | `evaluateCommitGate` is a pure function; `gate.property.test.ts` + 75 tests in `index.test.ts` | `shared/execution-control-runtime/src/index.test.ts`, `gate.property.test.ts` | Implemented and tested | High | Broader property-based testing (`fast-check`) and fuzzing. |
| 2 | Stable canonical action hash | `canonicalizeAction` deterministic across re-runs | `index.test.ts` action hash tests; reviewer Stage 1d | Implemented and tested | High | — |
| 3 | Single-use Warrant — replay refused | `consumeWarrant` atomic; `NonceSeenSet` interface | `warrant-time.test.ts`; `chaos-harness::replay_attempt`; `warrant-verifier::WARRANT_REPLAYED` | Implemented and tested | High | Durable `NonceSeenSet` for cross-process / cross-restart replay protection. |
| 4 | Canonical action hash binding (Warrant for action X cannot authorize action Y) | Warrant signature material includes `canonical_action_hash`; verifier recomputes | `warrant-verifier/src/index.test.ts` "ACTION_HASH_MISMATCH" | Implemented and tested | High | — |
| 5 | Subject binding (Warrant for agent A cannot authorize agent B) | Gate checks `envelope.subject == action.subject`; reviewer Stage 1c | `index.test.ts`; reviewer `1c.refuse-subject-not-in-ward` | Implemented and tested | High | — |
| 6 | Ed25519 signature verification | `verifyWarrant` Ed25519 path | `warrant-time.test.ts`; `warrant-verifier/src/index.test.ts` | Implemented and tested | High | KMS-backed signing path (currently caller-supplied keyring). |
| 7 | Clock-skew tolerance (configurable) | `maxClockSkewMs` honored in `verifyWarrant` | `warrant-time.test.ts` "warrant issued in the future" | Implemented and tested | High | — |
| 8 | Multi-tenant key binding (cross-tenant forgery prevented) | `mae.signing_keys` allowlist enforced | `validators.security.test.ts` (6 tests); `tenant-onboarding` (29 tests) | Implemented and tested | High | — |
| 9 | GEL hash-chain continuity | `verifyGelChain` walks every record; reorder/missing breaks chain | `chain.test.ts`; `governance-core/src/test/run.test.ts` | Implemented and tested | High | — |
| 10 | GEL evidence bundle export/import (offline verifiable) | `exportEvidenceBundle` + `verifyEvidenceBundle` | `governance-core/src/test/run.test.ts` "evidence bundle exports and verifies offline" | Implemented and tested | High | External timestamp authority for non-repudiation across time. |
| 11 | Degraded-mode fail-closed for safety-critical Wards | `resolveFailMode` consults Ward criticality | `fail-mode.test.ts`; `degradation.test.ts` | Implemented and tested | High | — |
| 12 | Counterfactual replay against alternate policy world | `runCounterfactual` + `runCounterfactualSweep` + CLI | `time-machine/src/index.test.ts`; `cli.test.ts` | Implemented and tested | High | Integration with a GEL action archive (callers wire it). |
| 13 | 40-asset partition scenario reproducibility | Deterministic counters + published replay artifact | `examples/mesh/published.replay.test.ts`; reviewer Stage 3 + 4 | Demonstrated by deterministic scenario | High | This is the scenario itself — not a production deployment proof. |
| 14 | Partition tolerance — bounded disconnected operation under Fluidity Token | Edge issues warrants under FT until TTL or quota | `mesh-runtime/src/index.test.ts` (4 partition tests); `chaos-harness::fluidity_ttl_expiry`, `quota_exhaustion` | Demonstrated by deterministic scenario | High | Real-network partition testing (not just `partitions: Set` mutation). |
| 15 | Revocation during partition propagates via surviving witness | Witness gossip + edge `cachedRevocations` map | `mesh-runtime/src/index.test.ts` "revocation issued during split"; `chaos-harness::revocation_lag` | Demonstrated by deterministic scenario | High | Operator-driven re-gossip after witness flap (LIMITATIONS.md §5). |
| 16 | Reconciliation flags warrant-after-revocation as conflict | Root's `RECONCILE_DECISION` handler | `mesh-runtime/src/index.test.ts` "submitted-after-revocation decisions surface as conflicts" | Implemented and tested | High | — |
| 17 | Envelope version monotonicity (downgrade rejected) | Edge `PROPAGATE_ENVELOPE` rejects `env.version < existing.version` | `chaos-harness::envelope_version_downgrade`; `mesh-runtime/src/index.test.ts` "envelope versioning" | Implemented and tested | High | — |
| 18 | Adapter refusal before transport emission (action drift) | Each adapter's preflight checks `*_OUTSIDE_AUTHZ`, `*_OVER_LIMIT`, `MALFORMED_OPERATION` | Each adapter's `src/index.test.ts` | Implemented and tested | High (per-adapter) | A single cross-adapter test that asserts the invariant simultaneously across all 7 adapters (planned, see ROADMAP_TO_100.md). |
| 19 | Policy bundle source reproducibility | `verifyPolicyBundle::manifests_reproducible` re-compiles source and checks every manifest_hash | `policy-pipeline/src/index.test.ts` (multiple); `oci.test.ts` | Implemented and tested | High | — |
| 20 | OCI-style policy bundle distribution | `toOciBundle` / `fromOciBundle` with media-typed layers | `policy-pipeline/src/oci.test.ts` (5 tests) | Implemented and tested | High | Real OCI registry push + cosign sign-and-verify roundtrip. |
| 21 | Standalone public Warrant verifier (no gate access) | `verifyWarrantPublic` + HTTP handler | `warrant-verifier/src/index.test.ts` (11 tests) | Implemented and tested | High | — |
| 22 | Webhook event delivery (HMAC-signed, retried, dead-letter) | `WebhookDispatcher` with bounded retry | `event-stream/src/index.test.ts` (11 tests) | Implemented and tested | High | — |
| 23 | SSE event streaming with per-connection filter | `attachSseHandler` | `event-stream/src/index.test.ts` | Implemented and tested | High | — |
| 24 | Tenant lifecycle: bootstrap → rotate → suspend → revoke → export → import → audit → federate | All primitives in `@aristotle/tenant-onboarding` | `tenant-onboarding/src/index.test.ts` (29 tests) | Implemented and tested | High | KMS-backed signing for the keyring used during onboarding. |
| 25 | Federation handshake enforces four invariants | `federateTenants` rejects unless both opt in, mutual trust, ward ownership, anchor merge | `tenant-onboarding/src/index.test.ts` federate tests | Implemented and tested | High | Cross-host (not just cross-tenant-in-same-store) federation. |
| 26 | Mesh inter-node transport (TLS-pluggable) | `MeshNodeOptions.httpClient` + `urlFor` overrides; `live HTTP transport` test | `mesh-runtime/src/index.test.ts`; `quorum-routing.test.ts` | Implemented and tested | Medium | A reference deployment that actually injects mTLS-capable fetch. |
| 27 | Mesh persistence durability roundtrip | `InMemoryMeshPersistence` round-trip via JSON | `mesh-runtime/src/quorum-routing.test.ts` | Implemented and tested | High | A real durable backend (SQLite / Postgres) for `MeshPersistence`. |
| 28 | APL compiles `ward { ... }` blocks deterministically | `compilePolicy` + `compileGovernanceManifest` | `policy-dsl.test.ts` (11 tests); `policy-pipeline/src/index.test.ts` | Implemented and tested | Medium | Richer APL grammar (LIMITATIONS.md §9). |
| 29 | Counterfactual sweep CLI exits non-zero on flips | `aristotle-counterfactual` binary | `time-machine/src/cli.test.ts` (9 tests) | Implemented and tested | High | — |
| 30 | Replay artifact verification — four-gate model | `verifyReplayArtifact` checks signature/hash/reproducibility/version | `replay-artifact/src/index.test.ts` (10 tests); `published.replay.test.ts` | Implemented and tested | High | — |
| 31 | Reviewer end-to-end verification | 18 individual checks, <1s compute | `examples/reviewer/verify.ts`, `verify.test.ts` (8 tests) | Implemented and tested | High | — |

## Capabilities NOT validated by this repository

| # | Capability | Status | Why missing | Where it could come from |
|---|---|---|---|---|
| P1 | Production hardware validation (real autopilot / PLC / RTU / BAS) | Documented but not implemented | Requires hardware lab + range/operator sign-off | Pilot integration with a hardware vendor |
| P2 | External security audit | Documented but not implemented | Requires commissioning external firm | Trail of Bits / NCC Group / Doyensec / Cure53 |
| P3 | Formal verification of the gate decision function | Documented but not implemented | TLA+ or Alloy spec not yet authored | ROADMAP_TO_100.md §1 |
| P4 | KMS / HSM integration as default | Documented but not implemented | Caller-supplied today; production adapter would benefit | First-party AWS KMS / GCP KMS / Vault adapter |
| P5 | External timestamp authority anchoring | Documented but not implemented | Sigstore / RFC 3161 TSA not integrated | LIMITATIONS.md §3; ROADMAP_TO_100.md §1 |
| P6 | Certification (SOC 2 / ISO 27001 / IEC 62443 / DO-178C) | Not currently claimed | Each requires substantial process + audit | Operator-side, not substrate-side |
| P7 | Real customer deployments | Not currently claimed | No customers | — |
| P8 | Open Warrant / GEL standards spec | Documented but not implemented | Repo defines formats, no external standards body | IETF / NIST / OCI working group |

---

## How to read this matrix

- A row marked **Implemented and tested** + **High confidence** means: a reviewer can re-run the test path and observe the assertion holding. If the test passes, the capability holds for the conditions the test exercises.
- A row marked **Demonstrated by deterministic scenario** + **High confidence** means: an end-to-end scenario in this repo exercises the capability and produces a stable, reproducible outcome. The strongest example is the 40-asset partition scenario.
- A row marked **Documented but not implemented** means: this repo describes the capability but does not provide it. A reviewer should treat it as a roadmap item, not a fact.

Combining rows: the substrate's authority chain (rows 1–11) plus the partition story (rows 14–17) plus the adapter refusal invariant (row 18) plus the reproducibility proof (row 13, 30, 31) is what the reviewer flow proves end-to-end.
