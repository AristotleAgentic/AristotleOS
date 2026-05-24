# Security model — AristotleOS execution-control boundary

This document describes the trust model, the controls the boundary enforces, and
the known limitations of the Ward/Warrant execution-control path
(`shared/execution-control-runtime` + `@aristotle/os-cli`).

> AristotleOS is independently developed. This document does not reference any
> other vendor's implementation; it describes AristotleOS-native mechanisms only.

## Doctrine

> Governance must bind at the execution boundary before irreversible state
> mutation or external action occurs.

An agent must obtain a decision from the Commit Gate **before** performing a
consequential action. Only an `ALLOW` yields a single-use, signed Warrant.

## Trust roots

- **Ed25519 signing keys.** Warrants, Governance Evidence Ledger (GEL) records,
  and Evidence Bundles are signed with Ed25519 (PKCS8/SPKI PEM). The private key
  is the root of trust; protect it accordingly.
- **Key pinning.** Verifiers can pin an allowlist of `key_id`s (`trustedKeyIds`)
  so only Warrants from approved keys are accepted.
- **Revocation.** Compromised keys, withdrawn Authority Envelopes, or individual
  Warrants can be revoked; the gate refuses to issue against them and verifiers
  reject anything bound to them.

In development, an **ephemeral** in-process key signs Warrants (genuinely
Ed25519, but discarded on exit). Under `NODE_ENV=production` the boundary
**refuses** to issue with an ephemeral key — a durable key must be configured via
`ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH`.

## Operator access control (RBAC) and attribution

The boundary authenticates and authorizes the operators behind `/v1` requests,
and attributes every decision and operator action to an identity.

- **Credential models.** Configure any combination of:
  - `--api-key` — a single full-access (admin) key (legacy / simplest).
  - `--operator role:token[:subject]` (repeatable) — role-scoped static bearer
    tokens. Tokens are compared in constant time.
  - `--oidc-config <file>` — OIDC bearer tokens (compact JWS) verified against the
    issuer's public keys. The token `sub` becomes the operator identity; a roles
    claim (optionally re-mapped) becomes the role.
- **Roles.** `viewer` (read context/audit/metrics) < `operator` (request
  decisions: evaluate, proxy) < `admin` (operator actions: kill switch,
  revocation). Each route enforces a minimum role; insufficient role → `403`.
- **Attribution.** The authenticated principal (`subject`, `role`, `auth` method,
  OIDC `issuer`/`kid`) is written into the **signed, hash-chained** GEL record for
  the decision, so who-authorized-what is tamper-evident and non-repudiable. It is
  also emitted in structured logs and forwarded to the audit sink.
- **Operator actions are access-controlled.** `POST /v1/execution-control/admin/kill`
  and `.../admin/revoke` require the `admin` role and are disabled entirely unless
  authentication is configured (an open/dev boundary never exposes a network kill
  switch). Engaging the kill switch fails closed; both actions are audit-logged
  with the operator identity.
- **OIDC hardening.** Only asymmetric algorithms (RS256/384/512, ES256/384/512,
  EdDSA) are accepted; `alg:none` and HMAC algorithms are rejected, so there is no
  unsigned-token or alg-confusion path. `iss`, `aud` (when configured), `exp`/`nbf`
  (with clock-skew tolerance), and `kid` selection are all validated.

See [docs/ACCESS_CONTROL.md](docs/ACCESS_CONTROL.md) for configuration and examples.

## Controls enforced at the boundary

| Control | Mechanism | Failure mode |
|---------|-----------|--------------|
| Authority scoping | Ward Manifest + Authority Envelope (subject, allowed/denied actions, constraints, expiry) | `REFUSE` with reason code |
| Decision | Commit Gate → `ALLOW` / `REFUSE` / `ESCALATE` | non-ALLOW yields no Warrant |
| Physical invariants | geofence / altitude / battery / boundary checks | `PHYSICAL_INVARIANT_FAILED` |
| Single-use | replay protection (admitted canonical-action hashes) | `REPLAY_DETECTED` |
| Sovereign halt | file-backed kill switch, checked per request | `KILL_SWITCH_ENGAGED` |
| Revocation | key / envelope / warrant revocation list | `AUTHORITY_REVOKED` / `REVOKED` |
| Tamper evidence | hash-chained, Ed25519-signed GEL; offline-verifiable bundles | verification fails |
| Operator authentication | API key, role-scoped static tokens, or OIDC bearer (JWT) on `/v1` | `401` |
| Operator authorization (RBAC) | viewer / operator / admin roles enforced per route | `403` |
| Operator attribution | authenticated identity (incl. OIDC `sub`) written into the signed GEL | non-repudiable record |
| Resource limits | 1 MB request body cap | `413` |
| Credential isolation | broker injects secrets at forward time only | secret never returned/logged |
| Proxy destination | only the gate-authorized `target` is contacted; a divergent `params.url` is rejected | not forwarded (SSRF guard) |

## Operational guidance

- Run `aristotle preflight` before deploying: it checks for a durable signing
  key, operator API key, replay protection, valid Ward/Envelope, and a writable
  ledger path, and exits non-zero on any blocking issue.
- Keep the signing private key off the agent host; mount it read-only into the
  boundary only.
- Pin trusted `key_id`s in verifiers and distribute the public key out-of-band.
- Treat the GEL and Evidence Bundles as the system of record for audit.

## Known limitations

These are deliberately documented; they bound what the current version
guarantees:

- **High availability.** The boundary persists evidence to a durable, ACID ledger:
  single-node SQLite (`--ledger-backend sqlite`) or **Postgres**
  (`--ledger-backend postgres`), which keeps replay state in a shared database so
  multiple boundary instances refuse replays consistently. Multi-writer appends are
  **serialized via an advisory-locked transaction**, so the hash chain stays correct
  under active-active deployment. Front the boundary with your own load balancing.
  (Throughput under heavy multi-writer contention is bounded by the serialized
  append; partition this by ward if needed.)
- **No third-party security audit yet.** The cryptography uses Node's standard
  `node:crypto` Ed25519 primitives, but the system has not undergone an external
  penetration test or formal review.
- **Broker secrets** are read from environment/configuration; their security is
  only as strong as the host's secret management.
- **Replay protection** is per-ledger; it is not shared across independent
  boundary instances that write to separate ledgers.
- **Transport security (TLS)** is expected to be terminated by an upstream
  proxy/ingress; the boundary speaks plain HTTP on localhost by default.

## Responsible disclosure policy

We welcome reports from security researchers and treat them as a priority.

**How to report**

- Preferred: open a private [GitHub Security Advisory](https://github.com/AristotleAgentic/AristotleOS/security/advisories/new).
- Alternative: email `security@aristotleos.dev`.
- Please do **not** open a public issue for a suspected vulnerability.
- A machine-readable contact is published at `/.well-known/security.txt` (RFC 9116).

**What to include**

- Affected component/version (a git commit or the `v0.1.0` tag is ideal).
- Reproduction steps or a proof-of-concept, and the impact you observed.
- Any suggested remediation.

**Our commitments**

| Stage | Target |
|-------|--------|
| Acknowledge receipt | within 3 business days |
| Initial triage & severity | within 7 business days |
| Status updates | at least every 14 days until resolved |
| Fix or mitigation for high/critical | as fast as practicable; coordinated release |

**Coordinated disclosure**

- We ask for up to 90 days to remediate before public disclosure; we will
  coordinate the timeline and a release/advisory with you.
- We will credit reporters in the advisory unless you prefer to remain anonymous.

**Safe harbor**

If you make a good-faith effort to comply with this policy, we will not pursue or
support legal action against you for your research. Good faith means: only
testing systems/accounts you own or are authorized to test, avoiding privacy
violations and service degradation, not exfiltrating more data than necessary to
demonstrate the issue, and giving us reasonable time to respond before disclosure.

**Scope**

In scope: `shared/execution-control-runtime`, `apps/aristotle-cli`,
`adapters/http-gateway`, `services/*`, and `apps/console-ui` in this repository.
See [docs/AUDIT_SCOPE.md](docs/AUDIT_SCOPE.md) and
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for a deeper map. Out of scope:
third-party dependencies' internals (track those via `sbom.json` / `pnpm audit`)
and any infrastructure not part of this repository.
