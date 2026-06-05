# Diligence Memo

This memo answers the questions a technical due-diligence reviewer would ask in the first hour. It is intentionally direct. It does not pad. Every claim traces to a row in `PROOF_STATUS.md`.

---

## 1. What is AristotleOS?

AristotleOS is an experimental proprietary TypeScript runtime substrate that interposes a signed, replayable authority chain between an autonomous agent and any consequential action the agent might take. The chain is `Meta Authority Envelope → Ward → Authority Envelope → Warrant → Commit Gate → Execution → GEL Record`. The substrate refuses unauthorized actions before they reach the wire and produces hash-chained, signed evidence of every decision.

The repository implements the substrate end-to-end, ships seven protocol-level governance adapters (MAVLink, ROS2, OPC-UA, DNP3, Modbus, BACnet, Kubernetes admission), demonstrates partition-tolerant operation across 40 simulated assets, and produces a content-addressed replay artifact that a third party can verify by re-running the scenario locally.

License: proprietary for AristotleOS-original material; third-party dependencies remain governed by their own licenses. Repository organization: pnpm monorepo, ~47 packages, ~820 test cases.

## 2. What is the core technical claim?

That the runtime, given a `(Ward, AuthorityEnvelope, action)` triple, produces a deterministic decision under known-correct evaluation rules; that the decision is bound to a single-use, content-addressed, Ed25519-signed Warrant; that the entire decision lineage is recorded in a hash-chained ledger; that the ledger can be exported as an offline-verifiable evidence bundle; and that this substrate continues to operate, in a bounded way, under network partition.

In one sentence: **warrant before consequence, hash-chained evidence after, partition-tolerant in between**.

## 3. What can a reviewer verify in 20 minutes?

```sh
git clone https://github.com/AristotleAgentic/AristotleOS
cd AristotleOS/extracted
corepack pnpm@10.32.1 install
pnpm reviewer:verify
```

In ~800 ms of compute, the reviewer flow runs four stages (18 individual checks) against the actual published source and produces a structured JSON report.

- Stage 1: Commit Gate — ALLOW path, two REFUSE paths, Warrant binds to canonical action hash.
- Stage 2: Public Warrant Verifier — happy path + signature tamper + untrusted key + action-hash mismatch + HTTP handler.
- Stage 3: 40-asset partition scenario — deterministic phase counters + stable SHA-256.
- Stage 4: Replay artifact — locally-re-run report hash matches the published artifact's hash byte-for-byte.

If exit code is 0 and `totals.failed: 0`, the core substrate claim is reviewable-verified.

## 4. What does the reviewer flow actually prove?

It proves the **core authority chain is real, signed, partition-tolerant, and reproducibly auditable**:

- The Commit Gate's decision is deterministic given the same inputs.
- A Warrant binds to a specific canonical action hash; tampering breaks the signature.
- An untrusted signing key fails verification.
- An expired warrant fails verification.
- A 40-asset disconnected swarm scenario produces stable deterministic counters that match a content-addressed published artifact.

That's the substrate. The reviewer flow runs the exact same code paths that any production deployment would run for these properties.

## 5. What does it NOT prove?

See `LIMITATIONS.md`. In brief:

- It does not prove anything about real hardware. No autopilot, no PLC, no GPS, no flight controller is in the loop.
- It does not test KMS-backed signing; the reviewer flow uses an ephemeral Ed25519 keypair.
- It does not test cross-process federation (the mesh runs in-process via the bindRegistry fast-path; cross-host mTLS is left to the operator).
- It does not validate APL policy completeness; APL is intentionally small.
- It does not stress-test the runtime under load (~800ms reviewer flow is correctness, not performance).
- It does not substitute for an external security audit.

## 6. What are the strongest technical primitives?

Ordered by maturity:

1. **Commit Gate** (`shared/execution-control-runtime`) — 75+ tests, deterministic, separates evaluation from issuance from verification from consumption from GEL append.
2. **GEL** (governance-core + execution-control-runtime) — hash-chained, signed, exportable evidence bundle, offline-verifiable.
3. **Warrant lifecycle** — Ed25519-signed, nonce-bound, canonical-action-hash-bound, single-use, replay-protected, expiration-bound.
4. **40-asset disconnected swarm scenario** — content-addressed, deterministic, third-party-verifiable, published as a signed artifact.
5. **Public Warrant verifier** (`@aristotle/warrant-verifier`) — standalone HTTP handler; no gate access required.
6. **Policy pipeline** (`@aristotle/policy-pipeline`) — APL → signed, content-addressed bundle with provenance and OCI-style distribution.
7. **Counterfactual replay** (`@aristotle/time-machine`) — re-evaluate historical GEL records against alternate policy worlds; supports CI-integrated policy tightening.
8. **Multi-tenant control plane** (`@aristotle/tenant-onboarding`) — bootstrap, rotate, suspend, revoke, export, import, audit, federate.
9. **Mesh runtime** (`@aristotle/mesh-runtime`) — ROOT/WITNESS/EDGE roles + Fluidity Tokens; real HTTP transport tested, TLS hooks present.
10. **Chaos harness** (`@aristotle/chaos-harness`) — 10 deterministic failure-mode scenarios with stable scorecard.

## 7. What are the biggest risks?

Ordered by severity:

1. **No external security audit** (`LIMITATIONS.md` §2). Without a third-party pen test, the substrate's defenses are self-asserted.
2. **No production hardware validation** (`LIMITATIONS.md` §8, `docs/ADAPTER_VALIDATION.md`). Of the seven hardware adapters, only MAVLink/PX4 has a wire-level test, and even that's against a `node:dgram` test listener — not a real autopilot.
3. **No KMS/HSM as default** (`LIMITATIONS.md` §1). HMAC + Ed25519 with caller-supplied keyring; KMS integration is operator's responsibility.
4. **No external timestamp authority on GEL records** (`LIMITATIONS.md` §3). A key-compromised adversary could rewrite history within the signing-key's scope. Pair with Sigstore / RFC 3161 TSA for non-repudiation across long time gaps.
5. **No customer deployments or external integrations** (`LIMITATIONS.md` §6). The substrate behaves correctly in tests; field operation hasn't been demonstrated.
6. **The CLI's typecheck is broken** — pre-existing dep declaration issue in `apps/aristotle-cli`. The reviewer flow doesn't depend on it.
7. **The shared-HMAC mesh trust model is for clarity, not production** (`THREAT_MODEL.md` B2). Replace with per-node Ed25519 before relying on the mesh in production.
8. **Edge has no auto-pull of missed revocations post-partition** (`LIMITATIONS.md` §5). Operator must trigger re-gossip from root.
9. **APL is intentionally minimal** (`LIMITATIONS.md` §9). Non-trivial production policies will hit the language's expression limits.
10. **The substrate cannot prevent prompt-injected agents from requesting *legitimate* actions for wrong reasons** (`THREAT_MODEL.md` G1). The gate evaluates capability, not intent.

## 8. What comparable systems exist?

| Category | Examples | What they do | Where AristotleOS overlaps | Where AristotleOS differs |
|---|---|---|---|---|
| Cloud IAM / policy engines | AWS IAM, Cedar, Open Policy Agent (OPA), Casbin, Oso | API-level access control with policy-as-code | Same evaluation model: subject + action + resource → decision | Extends to wire-level actuation across multiple OT/robotics/aviation protocols; produces signed Warrants and hash-chained evidence; partition-tolerant disconnected operation |
| Agent guardrails | LangChain Guardrails, NeMo Guardrails, AWS Bedrock Guardrails, Azure AI Content Safety | Filter / classify model output | Same intent: prevent agents from doing bad things | AristotleOS governs the *action* the agent attempts (post-output), not the output itself. Adapter layer covers actuation protocols, not model gateways |
| OT cybersecurity | Claroty, Dragos, Nozomi | Detect and monitor OT network anomalies | Same operational domain (industrial control) | AristotleOS structurally *prevents* unauthorized writes at the adapter layer rather than detecting after the fact |
| Supply-chain attestation | Sigstore, in-toto, SLSA, OPA Gatekeeper | Attest provenance of software artifacts | Same signing + hash-chain primitives | AristotleOS attests the lineage of *agent decisions*, not software builds. Sigstore-style anchoring is a natural complement |
| Distributed authority | Macaroons, biscuit-auth, JWT, OAuth2 | Convey delegated authority for digital APIs | Same role: bearer-of-authority pattern | Warrants are single-use + content-bound + nonce-bound + partition-tolerant. JWTs are bearer tokens, replayable until expiry |
| Safety-critical software | DO-178C tooling, IEC 61508 | Certify safety-critical avionics / industrial software | Adjacent | AristotleOS holds no certification; it provides governance primitives that a certified safety case might build on |

## 9. How is AristotleOS different from OPA, Cedar, JWT, OAuth, guardrails, OT monitoring, and supply-chain attestation?

| Question | OPA / Cedar | JWT / OAuth | Guardrails | OT Monitoring | Sigstore | AristotleOS |
|---|---|---|---|---|---|---|
| Governs API access? | Yes | Yes | Indirect | No | No | Yes |
| Governs physical actuation? | No | No | No | No (monitors) | No | **Yes** (seven protocols) |
| Single-use tokens? | N/A | No (bearer) | N/A | N/A | N/A | **Yes** |
| Content-bound to action? | N/A | No | N/A | N/A | Yes (for artifacts) | **Yes** (canonical action hash) |
| Partition-tolerant disconnected authority? | No | No | No | No | No | **Yes** (Fluidity Tokens) |
| Hash-chained evidence ledger? | No | No | No | No | Yes (for build provenance) | **Yes** (per decision) |
| Counterfactual replay? | No | No | No | No | No | **Yes** (time-machine) |
| Reproducible evidence artifact? | No | No | No | No | Yes | **Yes** (replay-artifact) |

The closest single comparable is **OPA + Sigstore combined and applied to actuation**: OPA's policy-as-code model + Sigstore's signed provenance, but operating on agent decisions and physical-actuation protocols rather than software artifacts.

## 10. What would need to be true for this to become valuable infrastructure?

Not financial assumptions — operational ones:

1. At least one named, public pilot deployment running for a non-trivial period (90+ days) producing real GEL records.
2. An external security audit completed and remediated.
3. KMS / HSM integration shipped as a first-party package.
4. The Warrant + GEL wire formats published as an open spec independent of this codebase, with at least three independent third-party integrations.
5. A protocol adapter (MAVLink / Modbus / OPC-UA) reaching `productionValidated: true` status through an end-to-end integration test against the real protocol implementation (PX4 SITL, opendnp3, node-opcua), with operator/range sign-off.
6. A regulatory or insurance use case where AristotleOS's evidence bundle (GEL + replay artifact) is accepted as audit substrate.

Each of these is a discrete, achievable milestone. None requires a fundamentally new invention. They require pilot relationships, time, and the discipline to keep the substrate's claims aligned with what's tested.

---

## Recommendation for diligence

| Question the reviewer might ask | Answer |
|---|---|
| Does the substrate work as claimed? | Yes, within the scope `PROOF_STATUS.md` enumerates. Run `pnpm reviewer:verify` to confirm. |
| Is it ready for production? | No, and the repo says so. See `LIMITATIONS.md`. |
| Is it differentiated? | Yes, on three axes: wire-level actuation governance, partition-tolerant disconnected authority, content-addressed replay-verifiable evidence. |
| Is the team honest? | Read `LIMITATIONS.md` and `THREAT_MODEL.md`. They list, by row, exactly what's not proven and what could go wrong. |
| Is the codebase serious? | 820+ tests, hash-chained reproducibility, structured threat model, dedicated reviewer flow with 18 independent checks. Judge from the source. |

The 20-minute reviewer flow exists to make this decision auditable rather than rhetorical.
