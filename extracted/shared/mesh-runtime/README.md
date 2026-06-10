# @aristotle/mesh-runtime

A multi-process governance mesh implementing ROOT / WITNESS / EDGE roles. The mesh exists so that AristotleOS can operate when an edge node is partitioned from its root authority — under bounded disconnected operation via Fluidity Tokens.

## What this package does

```
RootNode      issues envelopes + revocations, signs Fluidity Tokens, reconciles edge decisions
WitnessNode   mirrors envelope state, gossips revocations to edges, serves as redundant trust path
EdgeNode      runs a Disconnected Commit Gate; issues Warrants locally under a Fluidity Token until
              its TTL expires, the disconnected quota is exhausted, or a revocation arrives
```

Public surface:

- **Node classes**: `MeshNode` (abstract), `RootNode`, `WitnessNode`, `EdgeNode`.
- **Configuration**: `MeshNodeOptions`, `EdgeOptions`. Pluggable `httpClient` and `urlFor` hooks for TLS-enabled production deployments.
- **Types**: `NodeRole`, `NodeId`, `AuthorityEnvelope`, `Revocation`, `FluidityToken`, `Warrant`, `CommitRequest`, `CommitDecision`, `MeshMessage`, `SubmittedEdgeDecision`.
- **Quorum signing**: `QuorumSignature`, `QuorumCollector`, `witnessCoSign`, `verifyQuorumSignature`.
- **Persistence interface**: `MeshPersistence`, `InMemoryMeshPersistence`.
- **Sovereign routing**: `TrustAnchor`, `SovereignRouter`, `StaticSovereignRouter`.
- **Testing utilities**: `bindRegistry` for in-process deterministic tests.

## Mesh protocol

Six message kinds flow across the mesh:

| Message | Origin | Target | Purpose |
|---|---|---|---|
| `PROPAGATE_ENVELOPE` | Root | Witness, Edge | Distribute an authority envelope; receiver verifies signature; monotonic version enforced |
| `GOSSIP_REVOCATION` | Root | Witness, Edge; Witness re-forwards to Edge | Distribute a revocation; receiver caches; Map-deduplicated by `revocation_id` |
| `ISSUE_FLUIDITY_TOKEN` | Root | Edge | Issue a TTL-bound disconnected-operation token |
| `QUERY_LATEST_ENVELOPE` | any | Root, Witness | Look up the current envelope for a given id |
| `QUERY_REVOCATIONS` | any | Root, Witness | Pull revocations since a timestamp |
| `RECONCILE_DECISION` | Edge | Root | Submit locally-issued decisions after partition heal; root flags conflicts |
| `PING` | any | any | Liveness probe |

All messages are JSON over HTTP (or in-process via `bindRegistry` for tests). The wire transport is pluggable via `MeshNodeOptions.httpClient` (e.g., for mTLS) and `MeshNodeOptions.urlFor` (e.g., for service-mesh paths).

## Disconnected operation (Fluidity Tokens)

The core innovation: an edge holds a signed token that authorizes it to mint Warrants locally for a bounded period. While the token is valid AND the disconnected-warrant quota is not exhausted, the edge gate decides ALLOW / REFUSE on its own. When:

- **Token TTL expires** → `EvaluateCommitGate` returns `EXPIRE` with `FLUIDITY_TOKEN_EXPIRED`.
- **Disconnected quota exhausted** → `REFUSE` with `DISCONNECTED_QUOTA_EXCEEDED`.
- **Revocation gossiped via witness** → `REFUSE` with `ENVELOPE_REVOKED`.
- **Subject not in ward** → `REFUSE` with `SUBJECT_MISMATCH`.
- **Action not in envelope's allowed_action_types** → `REFUSE` with `ACTION_OUTSIDE_ENVELOPE`.

When root reachability is restored, `EdgeNode.reconcile()` submits the edge's local decisions to root for conflict detection. Root flags any warrant whose issuance timestamp came after a revocation it had already issued.

## Roles and trust

| Role | Holds | Trusts | Trusted by |
|---|---|---|---|
| Root | Signing key, envelopes, revocations, Fluidity Token issuance | Itself + witnesses (replicate state) + edges (issue warrants) | Witnesses, Edges |
| Witness | Cached envelopes + revocations | Root (verify signature) + own secret (for verification) | Edges (alternate trust path) |
| Edge | Cached envelopes, revocations, Fluidity Tokens, locally-issued warrants | Root + at least one witness | None other than itself |

The current shared-HMAC trust model is for clarity. Production should use per-node Ed25519 keypairs gated by the MAE's signing-key allowlist (see `THREAT_MODEL.md` row B2).

## Quorum signing

`QuorumCollector(required, witnessIds)` requires `m of n` witnesses to co-sign a Warrant before it's admitted at the consumer. Use cases: high-consequence actions where one witness signature is insufficient.

`witnessCoSign(secret, witness_id, warrant)` produces a `QuorumSignature` by HMAC-signing the warrant material with the witness's secret. `verifyQuorumSignature(secret, warrant, sig)` checks it.

## Persistence

`MeshPersistence` is a small interface (`loadEnvelopes`, `loadRevocations`, `saveEnvelope`, `saveRevocation`). `InMemoryMeshPersistence` is the reference implementation; production deployments inject SQLite, Postgres, or any durable store implementing the interface.

`InMemoryMeshPersistence` has a tested durability roundtrip: save state, serialize to JSON, restart, restore — content matches byte-for-byte.

## Sovereign routing

`StaticSovereignRouter(localMaeId, trustAnchors[])` lets a node decide whether an incoming request references a local MAE (handle locally) or a foreign MAE (route to the configured trust anchor). Tested for local / foreign / unknown cases.

## Threat model (mesh-specific)

See `THREAT_MODEL.md` Category D for the full enumeration. Highlights:

| Threat | Mitigation | Residual |
|---|---|---|
| Compromised edge mints unauthorized warrants while disconnected | Fluidity Token TTL + quota cap + reconciliation conflict flag | Compromised edge can issue up to `maxWarrantsWhileDisconnected` warrants in the disconnect window |
| Malicious witness drops revocations | Multi-witness redundancy expected; substrate doesn't enforce it | Operator must configure ≥ 2 witnesses |
| Witness flaps at the moment a revocation is gossiped | `chaos-harness::witness_flap` models this; recovery is via operator re-gossip | No auto-pull on edge side yet — see `LIMITATIONS.md` §5 |
| Gossip storm (same revocation re-emitted thousands of times) | Map deduplication by `revocation_id` | No outbound rate-limit; operator should configure at witness |
| Envelope version downgrade | Edge rejects `env.version < existing.version` | — |

## Test scenarios

22 tests across `src/index.test.ts` (11) and `src/quorum-routing.test.ts` (11). See `PROOF_STATUS.md` for the per-claim mapping. The headline scenario is the **40-asset disconnected swarm partition** at `examples/mesh/swarm-partition-40-asset.ts` — that scenario depends on this package.

```sh
pnpm --filter @aristotle/mesh-runtime test
```

The live HTTP transport test occasionally has port-timing flakes on contended hosts; passes on retry. Marked in `LIMITATIONS.md`.

## Production hardening requirements

| Requirement | Status |
|---|---|
| mTLS or service-mesh authenticated transport | Hooks present (`httpClient`, `urlFor`); operator wires |
| Per-node Ed25519 keypairs (replace shared HMAC) | Not yet — see `ROADMAP_TO_100.md` |
| Persistent `MeshPersistence` backend (SQLite/Postgres) | Interface present; only in-memory ships |
| Edge auto-pull of missed revocations post-heal | Not yet — see `LIMITATIONS.md` §5 |
| Real partition testing (not just `partitions: Set` mutation) | Not yet — operator should validate with their network |

## License

MPL-2.0. See `LICENSE`, `NOTICE`, and the repository root `LICENSING.md`.
