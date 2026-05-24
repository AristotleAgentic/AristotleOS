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

## 5. Areas to probe (priorities for the auditor)
1. **Cryptography**: canonical-action determinism, signature material binding (could a different action reuse a signature?), key-id pinning, GEL chain + bundle verification edge cases.
2. **Authorization bypass**: envelope/scope matching, target vs `params.url`, constraint evaluation, escalate/fail-closed paths.
2b. **Operator RBAC / OIDC** (`auth.ts`): role gating per route, constant-time token compare, JWS verification edge cases (alg confusion, `none`, key/alg mismatch, kid selection, `iss`/`aud`/`exp`/`nbf`), role-claim mapping, and the admin-only kill/revoke endpoints.
3. **Replay & idempotency**: across restarts and across nodes (shared Postgres).
4. **Credential broker**: any path where a secret reaches the caller, logs, or the ledger.
5. **Concurrency**: serialized append correctness; race between revocation and in-flight decisions.
6. **Supply chain**: dependencies (`sbom.json`), bundle integrity, Docker/k8s config.

## 6. Known limitations / residual risk
- **Operator RBAC is in place** at the boundary (viewer/operator/admin, OIDC-capable, with identity attribution in the signed GEL). Residual: role *mapping* is only as trustworthy as the configured IdP/token issuance, and there is no built-in token-rotation scheduler — rotate static tokens and OIDC keys via your own process.
- **OIDC keys are configured statically** (PEM/JWKS materialized in config); the boundary does not fetch a remote JWKS endpoint, so key rollover requires a config update/reload.
- **No third-party security audit yet** (this document exists to commission one).
- **TLS** is expected to be terminated by an upstream proxy/ingress; the boundary speaks plain HTTP by default.
- **Throughput** is bounded per node by signing cost (see `npm run bench:execution-control`); scale horizontally via the shared Postgres backend.
