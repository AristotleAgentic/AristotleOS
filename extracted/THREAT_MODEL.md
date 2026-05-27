# THREAT_MODEL

This is the threat model an external security reviewer should use when evaluating AristotleOS. It is not a substitute for a real third-party audit (see `LIMITATIONS.md` §2). It enumerates the threats the substrate is meant to address, what evidence supports the mitigation, and what residual risk remains.

Conventions
- **Mitigation**: what the substrate does today.
- **Evidence**: pointer to test or example that demonstrates the mitigation.
- **Residual risk**: what could still go wrong, even with the mitigation in place.
- **Production hardening required**: what an operator must do beyond the substrate.

---

## Category A — Authority bypass

| # | Threat | Mitigation | Evidence | Residual risk | Production hardening required |
|---|---|---|---|---|---|
| A1 | Agent bypasses the gate (calls a tool directly) | Adapters (`packages/claude-agents`, `langchain`, `openai-agents`, etc.) wrap the framework's tool-dispatch surface; only governed calls reach the action sink. | Per-framework `src/index.test.ts`. | If the agent's runtime offers an unwrapped tool surface (raw HTTP fetch, raw subprocess), AristotleOS cannot see it. | Configure the agent's runtime to expose only wrapped tools. Enforce egress controls at the network layer. |
| A2 | Agent hallucinates an `action_type` outside its envelope | Gate refuses with `ACTION_NOT_ALLOWED`. | `chaos-harness::hallucinated_command` (50 consecutive refusals); `execution-control-runtime/src/index.test.ts`. | None at the gate. | — |
| A3 | Action drift after Warrant issuance (Warrant minted for action X, adapter emits action Y) | Warrant binds to `canonical_action_hash`; adapter computes the hash again and refuses if mismatched. Each adapter's allowlist (`permitted_register_addresses`, `permitted_object_ids`, etc.) enforces drift detection at the transport seam. | Each adapter's `*_OUTSIDE_AUTHZ` test. | Drift-detection scope depends on what the adapter checks. The MAVLink adapter scopes to `permitted_commands`; Modbus to `permitted_register_addresses`. An adapter that doesn't check a relevant field is blind to drift on that field. | Operator must audit the adapter's authz checks against their action class. |

## Category B — Cryptographic / key compromise

| # | Threat | Mitigation | Evidence | Residual risk | Production hardening required |
|---|---|---|---|---|---|
| B1 | Stolen signing key forges Warrants | MAE `signing_keys` is an explicit allowlist; verifier rejects warrants signed by keys not in the allowlist. Tenant-onboarding ships `rotateTenantKey` + `pruneRetiredTenantKey`. | `tenant-onboarding/src/index.test.ts` rotate/prune tests; `warrant-verifier/src/index.test.ts` "UNTRUSTED_SIGNING_KEY". | A stolen key can mint warrants until detected and pruned. There is no automatic compromise detection. | KMS/HSM-backed key storage; key-rotation runbook; monitoring on `event-stream` decision events. |
| B2 | Malicious envelope injection (rogue node signs with wrong secret) | Edge's `PROPAGATE_ENVELOPE` handler verifies the envelope's signature against its own configured secret. Forged envelopes are silently rejected. | `chaos-harness::malicious_envelope`. | Same-secret-domain compromise (a node that legitimately holds the cluster secret can mint envelopes). The mesh's current shared-secret HMAC model is for clarity; production should use per-node Ed25519 keypairs gated by the MAE's signing key allowlist. | Move from shared HMAC to per-node Ed25519. |
| B3 | Cross-tenant forgery (tenant A's key used to mint tenant B's artifacts) | Each MAE's `signing_keys` allowlist is checked at validation time; a key trusted under tenant B's MAE is not in tenant A's allowlist. | `governance-core/src/validators.security.test.ts` (6 tests). | Operator misconfiguration (e.g., reusing the same key id across tenants) defeats this. | Use distinct key ids per tenant; tenant-onboarding shows the pattern. |
| B4 | Altered action after Warrant issuance | Action canonicalization is deterministic; the canonical_action_hash is signed into the Warrant material; verifier recomputes the hash from the action and refuses on mismatch. | `warrant-verifier/src/index.test.ts` "ACTION_HASH_MISMATCH". | The canonical serializer must agree between issuer and verifier; the stable-stringify implementation is centralized in `execution-control-runtime`. | If forking the gate, preserve the canonicalizer or version-tag the serialization. |

## Category C — Replay / freshness

| # | Threat | Mitigation | Evidence | Residual risk | Production hardening required |
|---|---|---|---|---|---|
| C1 | Replayed Warrant (same warrant used twice) | Warrant carries a per-issuance nonce; `consumeWarrant` is atomic and single-shot through the `LedgerStore` backend (in-memory, SQLite, or Postgres). Verifier additionally accepts a caller-supplied `NonceSeenSet` for distributed replay-detection. | `execution-control-runtime/src/index.test.ts` "server enforces replay protection"; `warrant-verifier/src/index.test.ts` "WARRANT_REPLAYED"; `chaos-harness::replay_attempt`. | The bundled in-memory `NonceSeenSet` (`SimpleNonceSeenSet`) is not durable across restarts. Persistent replay protection requires the operator to wire a durable nonce store. | Inject a durable `NonceSeenSet` (Redis / Postgres / SQLite) at the verifier deployment. |
| C2 | Expired warrant used post-expiry | `verifyWarrant` returns `WARRANT_EXPIRED` when `now > expires_at` (with `maxClockSkewMs` tolerance, default 60s). | `warrant-time.test.ts`; `warrant-verifier/src/index.test.ts` "WARRANT_EXPIRED". | Clock skew larger than `maxClockSkewMs` either allows a too-early warrant or rejects a still-valid one. | Operate with NTP-synchronized clocks; configure `maxClockSkewMs` deliberately. |
| C3 | Clock-skewed issuer (warrant issued in the future) | `verifyWarrant` returns `WARRANT_NOT_YET_VALID` when `issued_at > now + maxClockSkewMs`. | `warrant-time.test.ts`. | Same as C2. | — |
| C4 | Stale policy bundle (gate runs on a superseded policy version) | `evaluateCommitGate` returns `ESCALATE` with `POLICY_VERSION_MISMATCH` when `runtime_register.policy_version ≠ ward.policy_version`. | `execution-control-runtime/src/index.test.ts`. | Operator must update the gate's policy version when rolling out new policies. | Policy-pipeline OCI bundle distribution + gate restart hook. |

## Category D — Mesh / distributed-system threats

| # | Threat | Mitigation | Evidence | Residual risk | Production hardening required |
|---|---|---|---|---|---|
| D1 | Compromised edge node (mints unauthorized warrants while disconnected) | Edge is bounded by Fluidity Token TTL + `maxWarrantsWhileDisconnected` quota. Local decisions are reconciled against root at heal time; warrants issued after the envelope's revocation are flagged as `warrant_issued_after_revocation` conflicts. | `mesh-runtime/src/index.test.ts` (multiple tests); `chaos-harness::quota_exhaustion`. | A compromised edge can still issue up to `maxWarrantsWhileDisconnected` warrants during the disconnect window, all of which are valid until reconciled. | Set `maxWarrantsWhileDisconnected` per criticality; monitor conflict counts on reconciliation. |
| D2 | Malicious witness (drops revocation gossip) | Edges have multiple witness paths; redundancy is configured at peer setup. | `mesh-runtime/src/index.test.ts` "revocation issued during split is detected via surviving witness". | A network topology with only one witness path is brittle. The substrate doesn't enforce witness redundancy. | Operator must configure ≥ 2 independent witnesses per edge. |
| D3 | Witness flap (witness goes down at the moment a revocation is gossiped, then recovers) | Modeled in `chaos-harness::witness_flap`. Recovery requires explicit operator re-gossip via `RootNode.gossipRevocation(rev)`. | `chaos-harness/src/index.test.ts` "witness_flap". | Without operator action or an auto-pull mechanism (see LIMITATIONS.md §5), a flapped revocation can take time to reach the edge. | Implement scheduled re-gossip OR add an edge pull API. Tracked in `ROADMAP_TO_100.md`. |
| D4 | Gossip storm (same revocation re-emitted thousands of times) | Edge's `cachedRevocations` is a `Map` keyed by `revocation_id`; duplicates are silently deduplicated. | `chaos-harness::gossip_storm` (50 storms; cache size stays 1). | Denial-of-service from storm volume is not modeled. | Operator should rate-limit the witness's outbound gossip. |
| D5 | Replayed edge decision (compromised edge submits the same decision twice on reconciliation) | Root's `RECONCILE_DECISION` handler appends each submitted decision to its log; the log is consulted on conflict checks. | `mesh-runtime/src/index.test.ts` reconciliation tests. | Duplicate-submission detection at the root is by warrant_id + nonce, which is already covered by C1. | — |
| D6 | Envelope version downgrade (attacker replays an older, looser envelope) | Edge's `PROPAGATE_ENVELOPE` handler accepts only `env.version >= existing.version`. | `chaos-harness::envelope_version_downgrade`. | — | — |

## Category E — GEL / evidence integrity

| # | Threat | Mitigation | Evidence | Residual risk | Production hardening required |
|---|---|---|---|---|---|
| E1 | GEL tampering (record content modified post-write) | Records are hash-chained (each record's `previous_hash` references the prior record's `record_hash`) and signed. `verifyGelChain` walks the chain. | `chain.test.ts` (root `test:chain`); `governance-core/src/test/run.test.ts` "an evidence bundle exports and verifies offline; tampering is detected". | An adversary with the signing key can rewrite history. Mitigated only by external timestamp anchoring (LIMITATIONS.md §3). | RFC 3161 TSA integration; periodic publication of GEL roots to a public log. |
| E2 | Missing GEL record (decision recorded but record never written) | Gate calls `appendGelRecord` synchronously before returning a decision; failure to append is surfaced as a runtime error. | `execution-control-runtime/src/index.test.ts` ledger tests. | An operator who removes records from a non-append-only backend defeats the chain. SQLite and Postgres backends are append-only by design. | Use the SQLite or Postgres ledger backend; avoid file-based JSON ledger in production. |
| E3 | Reordered records | `previous_hash` references break under reorder; `verifyGelChain` returns `ok: false`. | `chain.test.ts`. | — | — |

## Category F — Operator / infrastructure threats

| # | Threat | Mitigation | Evidence | Residual risk | Production hardening required |
|---|---|---|---|---|---|
| F1 | KMS unavailable (signing key cannot be reached) | `evaluateCommitGate` enters degraded-mode when `degradedConditions` include the KMS-unavailable signal; the Ward's criticality determines the fail action. | `execution-control-runtime/src/index.test.ts` "evaluate self-detects an unavailable ledger and returns a governed degraded decision (no 500)"; `fail-mode.test.ts`. | Operator must wire the `degradedConditions` signal from their KMS health-check. | KMS health endpoint + circuit breaker on the gate. |
| F2 | Telemetry spoofing (agent reports false sensor data) | Envelope's `telemetry_requirements` declare expected telemetry. The gate evaluates against what the agent reports; the substrate does not verify the telemetry source. | `execution-control-runtime/src/index.test.ts` runtime register tests. | Telemetry verification is the operator's responsibility (TPM-quoted sensor reads, attested controllers). | Bridge to hardware attestation through `gel_record.hardware_attestation`. |
| F3 | Physical-invariant spoofing (agent reports coords that pass geofence but vehicle is elsewhere) | Same as F2 — the gate evaluates declared coords. | `geofence.test.ts`. | Same as F2. | Pair AristotleOS with a trusted positioning source. |
| F4 | Operator misuse (correct system, wrong configuration) | Validators reject obviously broken artifacts (missing fields, expired-at-creation, etc.). `tenantAuditReport` reports posture findings (severity: critical / warn / info). | `validators.security.test.ts`; `tenant-onboarding/src/index.test.ts` audit tests. | The substrate cannot prevent an operator from issuing an Envelope that legitimately permits dangerous actions — that's the operator's policy choice. | Independent policy review; counterfactual replay (`time-machine`) to test policy changes. |
| F5 | Network partition | Mesh is partition-tolerant by design (Fluidity Tokens + reconciliation). | `examples/mesh/swarm-partition-40-asset.ts`; `mesh-runtime/src/index.test.ts`. | Partition tolerance is bounded — see LIMITATIONS.md §5. | Configure Fluidity Token TTL and disconnected quota per criticality. |
| F6 | Malicious package dependency (supply-chain attack) | Repository uses `corepack` pinning of pnpm@10.32.1, Apache-2.0 license check is feasible. SBOM generation is documented in `RELEASE_CHECKLIST.md`. | None directly testable. | A compromised dependency could subvert any layer. | SBOM publication; signed releases; npm provenance (`npm publish --provenance`). |

## Category G — Application-layer threats

| # | Threat | Mitigation | Evidence | Residual risk | Production hardening required |
|---|---|---|---|---|---|
| G1 | Prompt-injected agent tool call | The agent's tool dispatch flows through the framework adapter, which calls the gate. The gate evaluates the action on its own terms (canonical action hash + envelope rules); the prompt content is not consulted. | All framework adapter tests. | If the agent is prompt-injected into requesting a *legitimate* action (one the envelope allows) for a wrong reason, the gate has no way to detect intent vs. capability. | Tighten envelopes to least privilege; require human-in-the-loop ESCALATE for high-consequence actions. |
| G2 | Unauthorized transport emission (action attempted bypassing the gate) | Adapters refuse to emit unless the Warrant's binding matches the action. Every adapter's `*_OUTSIDE_AUTHZ` test verifies this. | Each adapter's `src/index.test.ts`. | Bypass requires the operator to misconfigure the adapter (e.g., set `productionValidated: true` on a demo transport without integration testing). | Adapter README mandates explicit opt-in to production; production-validated transports must come with operator/range sign-off. |

---

## What this threat model is NOT

- It is not a comprehensive enterprise threat model (DREAD / STRIDE / PASTA pass). An external audit should perform that pass.
- It does not enumerate denial-of-service threats in detail; that depends on deployment topology.
- It does not address regulatory threats (e.g., GDPR, HIPAA) that depend on what data the operator processes.
- It does not address insider threats with full key access — that requires defenses outside the substrate (HSM access control, dual-control administration, audit).

---

## Required next steps for production deployment

A reviewer evaluating AristotleOS for production should at minimum require:

1. External security audit (penetration test + code audit).
2. KMS/HSM integration in the deployed gate.
3. Durable nonce store wired into the verifier and consumeWarrant path.
4. External timestamp authority anchoring for GEL records.
5. Per-node Ed25519 keypairs for mesh nodes (replace shared-HMAC default).
6. NTP-synchronized clocks across all nodes; `maxClockSkewMs` tuned to deployment.
7. SBOM + signed release artifacts.
8. Runbook for key compromise, GEL chain repair, partition recovery.
9. Edge auto-pull of missed revocations (or scheduled re-gossip from root).
10. Continuous monitoring on `event-stream` decision events with alerts on conflict counts.

This list is the threat-mitigation overlay on the existing test suite. Each item maps to one or more rows above.
