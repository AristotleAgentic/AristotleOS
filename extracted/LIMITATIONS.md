# LIMITATIONS

A list of the things AristotleOS does NOT currently do or prove. Read this before deciding whether the system meets your bar.

## 1. Production-grade key management

The repository ships an HMAC keyring (`HmacKeyring`) for tests and an Ed25519 signer factory (`createEd25519Signer`) that consumes caller-supplied PEM material. **It does NOT ship a KMS / HSM / cloud-managed-key integration as a default.**

What's tested today:
- Ed25519 signing and verification of Warrants.
- HMAC signing for MAE/Ward/Envelope artifacts under demo keyrings.
- Cross-tenant forgery is prevented by `mae.signing_keys` allowlist (`governance-core/src/validators.security.test.ts`).

What's missing:
- A first-party adapter for AWS KMS / GCP KMS / Azure Key Vault / HashiCorp Vault.
- A reference integration with a cloud HSM.
- Documented key-rotation procedures wired into the runtime (the primitives exist via `tenant-onboarding::rotateTenantKey`; production runbook does not).

Production deployments **must** inject their own `Keyring` implementation backed by a KMS/HSM. The `HmacKeyring` constructor logs a demo warning in tenant-onboarding (`summary.warning` field).

## 2. No external security audit

The system has not been reviewed by an external security firm. The code is in good test posture (820+ tests, see `PROOF_STATUS.md`) but **no third-party penetration test, code audit, threat-model review, or certification has been performed**.

Before relying on AristotleOS for safety-critical or high-consequence deployments, the operator must commission an external review. See `THREAT_MODEL.md` for the threat surface a reviewer should examine.

## 3. No external timestamp authority

GEL records are hash-chained and signed with the operator's keyring, but there is **no integration with an external timestamp authority** (RFC 3161 TSA, Sigstore, OpenTimestamps). A determined adversary with access to the signing key can backdate or forward-date records.

What's tested today:
- Hash chain continuity (tampering one record breaks the chain).
- Signature verification on each record.
- Offline evidence-bundle export / import.

What's missing:
- Per-record external timestamp anchoring.
- Block-anchored / Merkle-mountain-range publication of GEL roots to a public source of truth.

If your use case requires non-repudiation across a time gap (insurance claims, regulatory replay), pair the GEL with an external TSA at write time.

## 4. Clock-skew assumptions

The mesh runtime assumes nodes have loosely synchronized clocks (NTP-class drift, ≤ a few hundred milliseconds). Fluidity Token TTL is local-clock-driven on each edge.

What's tested today:
- Edge clock advancing past TTL → EXPIRE (`chaos-harness::clock_skew`).
- Warrant verification rejects warrants issued in the future beyond `maxClockSkewMs` (default 60s).

What's missing:
- Defense against malicious clock manipulation on an edge node (compromised host).
- TPM-backed monotonic clock attestation.

Operators running edge nodes on hosts they don't control should treat edge-clock manipulation as in-scope. Hardware attestation fields in `GelRecord` are present but the bridge to real TPM/SGX quotes is caller-supplied.

## 5. Edge auto-pulls missed revocations — closed

**Status:** closed. Earlier revisions of this document flagged this as an open gap; the fix shipped in `shared/mesh-runtime/src/index.ts`.

When an edge node is partitioned at the moment a revocation is gossiped, the edge now auto-recovers via two paths:

1. **Automatic post-heal pull.** `EdgeNode.pingRoot()` tracks the last reachable state. When it transitions from unreachable → reachable, it fires `pullRevocations(prevContact - 1s)` as a side effect. `QUERY_REVOCATIONS` returns every revocation Root issued during the gap; the edge verifies each signature and caches the survivors.
2. **Operator-driven pull.** `EdgeNode.pullRevocations(sinceMs?)` is a public method an operator can invoke at any time — useful for cold-boot bootstrap or manual reconciliation drills.

What's tested today (`shared/mesh-runtime/src/index.test.ts`):
- `auto-pull: pullRevocations() backfills the edge from root after a missed gossip window` — direct API test under full partition.
- `auto-pull: pingRoot reconnect transition fires pullRevocations automatically` — asserts the disconnected → reconnected transition triggers the pull and that `getAutoPullCount()` advances.
- `chaos-harness::witness_flap` continues to model the original scenario; the operator-driven recovery path is still supported for cases where Root is unreachable but Witness is.

What's still not in scope:
- Periodic background polling for revocations independent of any state change. The current design is event-driven (reconnect or explicit call); a future implementation could add a configurable poll interval if operators want belt-and-suspenders coverage. Not required for correctness — Fluidity Token TTL plus disconnected-warrant quota bound the staleness window today.

## 6. No production deployments

The system has no public, named, production deployments. No customers. No pilots. No field-validated installations.

What this repo demonstrates is a substrate — the primitives and tests that show the substrate behaves correctly. It does not demonstrate field operation.

Before a procurement conversation: this would need at least one named pilot or one named integration partner running it for real traffic.

## 7. No certification

The system holds no certification — not SOC 2, not ISO 27001, not FedRAMP, not IEC 62443 (industrial control safety), not DO-178C (aviation software safety), not FDA software-as-a-medical-device, not anything else.

Demonstration material in this repo that references industry standards (e.g., the pipeline vertical's mention of 49 CFR 192/195, the aviation vertical's mention of 14 CFR Part 107) is **explicitly labeled "DEMONSTRATION ONLY"** in the source. The wording exists to illustrate what a policy in that domain would look like; it is not a certification claim.

## 8. Adapter wire-level validation

Of the seven hardware-governance adapters, **only MAVLink/PX4 has an automated test that emits a real wire-level frame to a real socket listener** (a `node:dgram` UDP socket inside the test process — not a real autopilot).

| Adapter | Wire-level test | Real-system integration |
|---|---|---|
| `@aristotle/mavlink-px4` | ✅ UDP datagram to local listener; frame validates MAVLink v2 with correct CRC and msg id | No PX4 SITL test, no autopilot integration |
| `@aristotle/ros2-bridge` | ✅ JSON op sent via injected mock socket | No real `ros2 daemon` test |
| `@aristotle/opcua-adapter` | Demo / shim transport; preflight + delegation tested | No `node-opcua` integration |
| `@aristotle/dnp3-adapter` | Demo / shim transport | No real RTU test |
| `@aristotle/modbus-adapter` | Demo / shim transport | No real PLC test |
| `@aristotle/bacnet-adapter` | Demo / shim transport | No real BAS test |
| `@aristotle/k8s-admission` | HTTP handler tested with mocked decisions | Not deployed against a real cluster's API server in tests |

Every adapter's `*Transport` ships with `production_validated: false` by default. The `governXxx()` orchestrator refuses to emit unless the caller explicitly opts in via `allowDemonstrationTransport: true` or wires a `productionValidated: true` transport.

**No adapter is currently safe to use unmodified against safety-critical equipment.** Each requires its own integration testing, operator/range sign-off, and the operator's own production transport.

## 9. APL is intentionally small

The Aristotle Policy Language (APL) compiler at `shared/execution-control-runtime/src/policy-dsl.ts` is small by design. It compiles to `GovernanceDraft` and supports:
- `ward "..." { ... }` blocks
- `id`, `domain`, `subject`, `criticality`, `classification`, `version`
- `allow A, B, C when telemetry.X`
- `deny A, B`
- `bound altitude_m <= 120` style numeric constraints
- `within <boundary-id>`

It does not currently support:
- Cross-ward references / inheritance
- Macros / reusable rule fragments
- Custom predicate functions
- Importable type libraries
- Rich rule composition (intersection / union / conditional escalation)

For non-trivial policies, callers can construct `WardManifest` / `AuthorityEnvelope` objects directly in TypeScript and bypass APL. See `docs/APL.md` for what compiles today.

## 10. Reviewer flow does not test production paths

The reviewer flow (`examples/reviewer/verify.ts`) proves the **core authority chain** is real and reproducible. It does not test:
- KMS-backed signing
- Postgres / SQLite ledger persistence under load
- Concurrent request throughput
- Latency under realistic traffic
- Network failures more complex than the scripted mesh-runtime scenarios
- Federation across genuinely separate processes / hosts

For each of these, see the relevant per-package test suite (`execution-control-runtime` has Postgres/SQLite ledger durability tests; `mesh-runtime` has live HTTP transport tests) and `ROADMAP_TO_100.md` for what's missing at scale.

---

## Summary for a skeptical reviewer

**Do trust:** the substrate primitives (Ward / Envelope / Warrant / Commit Gate / GEL), the 40-asset disconnected swarm reproducibility proof, the multi-tenant isolation tests, the policy bundle reproducibility, the public Warrant verifier.

**Do not trust without further validation:**
- That AristotleOS will work unmodified against your specific hardware (it will not — every adapter ships unvalidated for production by default).
- That AristotleOS is safe for safety-critical deployment without an external security review.
- That the cryptographic guarantees hold under key compromise (key-rotation primitives ship; KMS-backed signing does not).
- That GEL records are non-repudiable across long time gaps without an external timestamp authority.

If your bar is "I want to see the substrate's correctness before I evaluate the integration work" — the reviewer flow proves that.
If your bar is "I want to deploy this in production tomorrow" — this is not that.
