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
