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
| Transport auth | optional API key on `/v1` routes | `401` |
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

- **No built-in high availability.** The boundary is a single process with a
  file-backed JSONL ledger and an in-memory index. There is no clustering,
  replication, or distributed consensus. For HA, front it with your own
  replication/storage strategy.
- **No third-party security audit yet.** The cryptography uses Node's standard
  `node:crypto` Ed25519 primitives, but the system has not undergone an external
  penetration test or formal review.
- **Broker secrets** are read from environment/configuration; their security is
  only as strong as the host's secret management.
- **Replay protection** is per-ledger; it is not shared across independent
  boundary instances that write to separate ledgers.
- **Transport security (TLS)** is expected to be terminated by an upstream
  proxy/ingress; the boundary speaks plain HTTP on localhost by default.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via a GitHub security advisory
on the repository rather than opening a public issue.
