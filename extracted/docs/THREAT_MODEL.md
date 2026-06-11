# AristotleOS — Threat Model

Scope: the Ward/Warrant **execution-control boundary** (`shared/execution-control-runtime`),
the CLI (`@aristotle/os-cli`), and the operator console. This document is written
to drive a third-party security review; see [AUDIT_SCOPE.md](AUDIT_SCOPE.md) for
onboarding and [../SECURITY.md](../SECURITY.md) for the control summary.

> AristotleOS is independently developed. This document describes AristotleOS-native
> mechanisms only and references no third party.

## 1. Assets to protect

| Asset | Why it matters |
|-------|----------------|
| Warrant signing private key | Forging it forges authority. Root of the trust model. |
| Governance Evidence Ledger (GEL) | The system of record. Tampering destroys auditability. |
| Authority Envelopes | Define who may do what. Forgery/escalation = unauthorized action. |
| Brokered downstream credentials | Held by the boundary; leakage = downstream compromise. |
| Commit Gate decision integrity | A wrong ALLOW is an unauthorized consequential action. |
| Kill switch / revocation state | Must reliably force fail-closed. |

## 2. Trust boundaries

```
[ agent / caller ] --HTTP/MCP/stdio--> [ Commit Gate boundary ] --signed--> [ GEL store ]
                                            |  injects creds (broker)
                                            v
                                     [ downstream service ]
```

- The **agent is untrusted**: it proposes actions; it must never hold authority or secrets directly.
- The **boundary is the trusted decision point**; its signing key and config are the trust anchor.
- The **downstream service** is reached only after ALLOW + verified warrant.
- The **ledger store** (file/SQLite/Postgres) is trusted for durability; integrity is independently verifiable via hashes/signatures.

## 3. Attacker model

- **A1 Malicious/compromised agent** — tries to act without authority, replay approvals, exfiltrate credentials, or hit internal targets (SSRF).
- **A2 Network attacker** — intercepts/replays HTTP, forges requests, induces partition.
- **A3 Insider/operator misuse** — issues dangerous operator actions; mitigated by role-based access control (viewer/operator/admin), authenticated identity attribution in the signed ledger, and fail-closed operator actions.
- **A4 Supply-chain attacker** — malicious dependency or build tampering.
- **A5 Storage attacker** — tampers with the ledger at rest.

## 4. Threats → mitigations (built)

| # | Threat | Mitigation | Code |
|---|--------|-----------|------|
| T1 | Act without authority | Commit Gate: ward/envelope/scope/expiry/invariant checks before any action | `evaluateCommitGate` |
| T2 | Forge a warrant | Ed25519 signature over canonical material; key pinning | `signing.ts`, `verifyWarrant` |
| T3 | Replay an approved action | DB/index-backed replay check (`REPLAY_DETECTED`); single-use warrants | `hasPriorAdmission`, `LedgerStore` |
| T4 | Tamper with evidence | Hash-chained + signed GEL; offline-verifiable bundles | `verifyGelRecords`, `verifyEvidenceBundle` |
| T5 | Use revoked authority | Revocation list enforced at gate + verify (`AUTHORITY_REVOKED`/`REVOKED`) | `revocation.ts` |
| T6 | SSRF via proxy | Proxy contacts only the gate-authorized `target`; divergent `params.url` rejected | `proxy.ts` |
| T7 | Credential leakage | Broker injects at forward time; secret never returned or logged | `proxy.ts`, audit logging |
| T8 | Unauthenticated control | Optional API key on `/v1`, constant-time compare | `index.ts` server |
| T9 | DoS via large/expensive requests | 1 MB body cap; per-subject rate limiting | `readJsonBody`, `SubjectRateLimiter` |
| T10 | Operate under partition | Fail-closed; cached-authority only; kill switch | gate + `killSwitchPath` |
| T11 | Multi-writer chain fork | Serialized append (advisory-locked transaction) | `postgres-ledger.ts` |
| T12 | Weak production posture | `aristotle preflight`; refuses ephemeral keys under `NODE_ENV=production` | CLI + `requireProductionSigner` |
| T13 | Operator over-reach / unattributed admin action | RBAC (viewer/operator/admin) per route; admin-only, fail-closed kill/revoke; authenticated identity written to the signed GEL | `auth.ts`, server route gate, `GelActor` |
| T14 | Forged/abused OIDC token (alg:none, alg-confusion, expiry, audience) | Asymmetric-only JWS verification; `none`/HMAC rejected; `iss`/`aud`/`exp`/`nbf`/`kid` validated | `auth.ts` → `verifyJwt` |
| T14b | Stale/rotated IdP signing key (DoS via key rollover, or accepting a retired key) | Live JWKS cache: TTL + on-unknown-`kid` background refresh picks up rotations; fail-static keeps last-good keys; only `use:"sig"` keys imported | `auth.ts` → `createJwksKeyStore`/`importJwks` |
| T15 | Spoofed physical telemetry (agent lies about altitude/battery/boundary to pass a hard interlock) | Attested-telemetry binding: device-signed (Ed25519) readings verified against **pinned device keys** + freshness bound; safety params overwritten with attested values before the gate; unattested/stale/tampered ⇒ `TELEMETRY_UNATTESTED`. The invariant is then enforced over device-signed ground truth, not agent claims. **Residual:** device identity must be hardware-rooted (TPM) — that provisioning is the operator's integration. | `attestation.ts` → `attestActionTelemetry` |
| T16 | Clock-trust abuse on Warrant validity (rolled-back verifier accepts expired Warrants; forward-skewed issuer mints "future" Warrants; over-long TTL honored) | `issued_at`/`expires_at` are signed (untamperable without the key). Verifier-side trusted-time hardening: future-issuance guard (`WARRANT_NOT_YET_VALID`, default 60s skew), verifier-policy lifetime ceiling (`WARRANT_LIFETIME_EXCEEDED`), per-issuance signed nonce + optional seen-nonce set for artifact replay (`WARRANT_REPLAYED`). `now` is injectable for an attested time source. **Residual:** a monotonic/attested clock is still the operator's to supply; replay-of-warrant detection requires a shared seen-nonce store. | `index.ts` → `issueWarrant`/`verifyWarrant` |
| T17 | Captured / long-partitioned edge node mints unlimited authority while dark (can't hear "you're revoked") | DDIL containment: **default-deny on staleness** (no control-plane sync within `maxRevocationStalenessMs` ⇒ fail closed; a never-synced node is stale by default) + **offline Warrant quota** (at most N issuances between syncs), persisted to disk so a process bounce can't reset the count. Composable precondition checked before issuance. **Residual:** the edge signing key should be hardware-rooted (TPM) so the key itself can't be exfiltrated (Tier C). | `edge-containment.ts` → `EdgeContainmentTracker` |
| T18 | Cross-level data leakage (an under-cleared subject acts on classified data; silent downgrade across domains) | MLS labels (`level` + caveats) on Ward/Envelope/Action; the gate refuses an action whose data label is not **dominated** by the Ward *and* Envelope clearance (no read up) ⇒ `CLASSIFICATION_VIOLATION`. `crossDomainTransferAllowed` refuses downgrades / compartment loss (no write down). Unlabeled artifacts default to unclassified (backward compatible). **Residual:** an **accredited cross-domain solution (CDS)** + label provenance are the operator's integration (Tier C); this is the typed boundary it enforces against, not the accreditation. | `classification.ts` → `enforceClassification`/`crossDomainTransferAllowed` |
| T19 | Supply-chain compromise (a vulnerable transitive dependency ships; a tampered or non-pipeline-built release artifact is distributed) | **Blocking** dependency-audit gate: prod advisories at/above `high` fail CI unless triaged in `.audit-allowlist.json` with a reason and a hard **expiry** (expired waivers fail too). Release artifacts carry **SLSA build provenance** + an **SBOM attestation**, OIDC-signed via the release workflow and verifiable with `gh attestation verify` — a tampered or off-pipeline tarball fails. **Residual:** the OIDC-signed attestations are produced on GitHub Actions (not on a dev laptop); transitive-CVE coverage is only as fresh as the advisory DB. | `audit-deps.mjs`, `.github/workflows/release.yml` (see `docs/supply-chain.md`) |
| T20 | Boundary dependency degradation (the evidence ledger blips, the control plane goes stale, HA write-quorum is lost, an attested dependency times out — and the boundary acts anyway, or hard-blocks a low-stakes fleet) | Per-Ward **criticality** drives a declarative fail-mode matrix: `resolveFailMode(criticality, conditions)` returns the most-restrictive action. Safety-critical fails closed on every condition; `quorum_lost` never resolves softer than escalate at any tier; lower tiers may `allow_degraded` (admit + mark for Conflict-Inbox reconciliation). Unlabeled Wards default to `mission_critical` (fail closed on infra loss); unknown conditions fail closed ⇒ `DEGRADED_MODE`. Real detectors ship (`degradation.ts`): a ledger-writability canary (on by default; the server short-circuits an unavailable ledger to a *governed* degraded decision rather than a 500) and a control-plane staleness probe (shared with B2/T17); `predicateProbe`/`runWithTimeout` adapt deployment heartbeats. HA: stateless replicas over a serialized durable ledger keep single-use/replay consistent across instances. **Residual:** quorum/dependency-liveness probes are deployment-specific (adapters provided), and multi-node soak/chaos on target hardware (Tier C / C6) is the operator's. | `fail-mode.ts` → `resolveFailMode`; `degradation.ts`; gate precondition + probe wiring in `index.ts` (see `docs/fail-modes.md`) |

## 5. Areas to probe (priorities for the auditor)
1. **Cryptography**: canonical-action determinism, signature material binding (could a different action reuse a signature?), key-id pinning, GEL chain + bundle verification edge cases.
2. **Authorization bypass**: envelope/scope matching, target vs `params.url`, constraint evaluation, escalate/fail-closed paths.
2b. **Operator RBAC / OIDC** (`auth.ts`): role gating per route, constant-time token compare, JWS verification edge cases (alg confusion, `none`, key/alg mismatch, kid selection, `iss`/`aud`/`exp`/`nbf`), role-claim mapping, and the admin-only kill/revoke endpoints.
3. **Replay & idempotency**: across restarts and across nodes (shared Postgres).
4. **Credential broker**: any path where a secret reaches the caller, logs, or the ledger.
5. **Concurrency**: serialized append correctness; race between revocation and in-flight decisions.
6. **Supply chain**: dependencies (`sbom.json`), bundle integrity, Docker/k8s config.

## 6. Known limitations / residual risk
- **Operator RBAC is in place** at the boundary (viewer/operator/admin, OIDC-capable, with identity attribution in the signed GEL). Residual: role *mapping* is only as trustworthy as the configured IdP/token issuance, and there is no built-in static-token-rotation scheduler — rotate static tokens via your own process.
- **OIDC signing keys can be live or static.** With `jwksUri` the boundary fetches the issuer's JWKS, caches it with a TTL, refreshes in the background, and picks up rotated `kid`s automatically; refresh is fail-static (a fetch failure keeps the last-good keys). Static PEM/JWK config is still supported for air-gapped deployments, where rollover is a config update/reload. (`auth.ts` → `createJwksKeyStore`/`importJwks`.)
- **Sandbox isolation is real but layered, not absolute.** AristotleOS governs *whether* execution may occur (Commit Gate → Warrant) and isolates *where*: the built-in `container` provider uses real namespaces + cgroups (`--network=none`, read-only rootfs, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, mem/CPU/PID limits, non-root), and the `wasm` provider uses capability-based WASI (deny fs/net/env by default). Residual: containers **share the host kernel**, so a kernel-level escape is out of scope for the container provider — layer gVisor/Kata, a seccomp/LSM profile, or a remote micro-VM for multi-tenant untrusted code. The `local-process` provider is explicitly a dev wrapper, **not** an isolation boundary. **Roadmap (not implemented, not faked):** gVisor/Kata runtimes, shipped seccomp/LSM profiles, and eBPF syscall attestation into the GEL. (`sandbox.ts` → `ContainerSandboxProvider`/`WasmSandboxProvider`; see `docs/sandboxes.md`.)
- **Warrant/evidence signing key custody is configurable; HSM-resident signing is roadmap.** Keys can be ephemeral-dev (refused in production), file-based, or loaded from a **managed secret store / KMS** at startup (`createSignerFromKeyProvider`, `examples/signers/`) — encrypted at rest, IAM-gated, audited. Rotation is a documented dual-key overlap with no break in the hash-chained ledger (`docs/key-management.md`). Residual: in all tiers the private key is in process memory during signing; **HSM-resident signing (key never in memory)** needs an async signing path and is **not implemented** (explicit roadmap, not faked). (`signing.ts`.)
- **No third-party security audit yet** (this document exists to commission one).
- **TLS** is expected to be terminated by an upstream proxy/ingress; the boundary speaks plain HTTP by default.
- **Throughput** is bounded per node by signing cost (see `npm run bench:execution-control`); scale horizontally via the shared Postgres backend.
