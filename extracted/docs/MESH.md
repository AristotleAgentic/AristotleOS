# Mesh — Partition-Tolerant Governance

The mesh exists so that an edge node can operate under bounded disconnection from its root authority — without compromising the substrate's authority chain. This document describes what's implemented today, what's simulated, and what production transport would require.

## Roles

```
ROOT      issues envelopes, revocations, Fluidity Tokens; reconciles edge decisions on heal
WITNESS   replicates envelopes and revocations; serves as alternate trust path for edges
EDGE      runs a Disconnected Commit Gate; issues Warrants locally under Fluidity Token
```

Each role is a `MeshNode` subclass in `shared/mesh-runtime/src/index.ts`. Each runs a `node:http` server (or in-process registry for tests). Each holds its own secret material.

## What's implemented (real)

| Capability | Implementation | Test |
|---|---|---|
| Real HTTP transport | `node:http` server + `fetch` client; pluggable `httpClient` for mTLS | `mesh-runtime/src/index.test.ts` "live HTTP transport: root and edge can talk over real TCP sockets" |
| Envelope propagation | Root → Witness + Edge; signature verified by recipient | "envelope propagates from root through witnesses to all edges" |
| Revocation gossip | Root → Witness → Edge; Map-deduplicated by `revocation_id` | "edge REFUSES when revocation has propagated"; `chaos-harness::gossip_storm` |
| Fluidity Token issuance | Root signs `(edge_id, envelope_id, expires_at)` with TTL | "edge issues warrant on ALLOW under valid Fluidity Token" |
| Disconnected operation | Edge mints Warrants locally until TTL or quota | "partition: edge keeps issuing under Fluidity Token TTL, then EXPIRES" |
| Disconnected quota | `maxWarrantsWhileDisconnected` cap | "disconnected-quota cap" |
| Reconciliation | Edge submits decisions on heal; root flags conflicts | "reconciliation: edge submits"; "submitted-after-revocation decisions surface as conflicts" |
| Monotonic envelope versioning | `env.version >= existing.version` enforced | "envelope versioning: a higher-version envelope replaces a lower one"; `chaos-harness::envelope_version_downgrade` |
| Quorum signing | `QuorumCollector(required, witnessIds)` requires m-of-n witnesses | `quorum-routing.test.ts` (4 tests) |
| Persistence interface | `MeshPersistence` (in-memory ships; durable is operator's) | `quorum-routing.test.ts` durability roundtrip |
| Sovereign routing | `StaticSovereignRouter` for foreign MAE → trust anchor lookup | `quorum-routing.test.ts` routing tests |
| TLS hook | `MeshNodeOptions.httpClient` + `urlFor` overrides | `quorum-routing.test.ts` "MeshNode.httpClient" |

## What's simulated

| Behavior | Why simulated | Real-world equivalent |
|---|---|---|
| Network partition | `MeshNode.partitions: Set<string>` mutation refuses traffic to/from listed peer ids | Real cable cut, RF loss, gateway failure |
| In-process node communication (when bindRegistry is in scope) | Deterministic fast-path for tests | Inter-host RPC |
| Witness flap recovery via operator re-gossip | No automatic edge pull post-heal (LIMITATIONS.md §5) | Real recovery would either auto-pull or rely on operator action |

The simulation is **deterministic** — the same scenario sequence produces the same outcome. That's why the 40-asset replay artifact is reproducible byte-for-byte.

## Why disconnected bounded authority matters

A field operator running an autonomous swarm in a degraded-RF environment cannot ask root for permission on every action. Equally, granting unbounded local authority is unsafe — a compromised edge with unlimited authority is unbounded liability.

Fluidity Tokens are the middle path:
- Root pre-issues a token to each edge with declared TTL and disconnected quota.
- While the token is valid, the edge can issue Warrants for actions within the envelope's `allowed_action_types`.
- Beyond the TTL or quota, the edge fails closed (returns EXPIRE or REFUSE).
- Every locally-issued Warrant is reconciled with root on heal; warrants issued after a revocation are flagged.

The bound is in the token itself, signed by root. The edge cannot extend its own authority.

## How Fluidity Tokens work

```ts
interface FluidityToken {
  token_id: string;
  edge_id: string;
  envelope_id: string;
  expires_at: ISO8601;
  issued_at: ISO8601;
  issued_by: string;
  max_revocation_age_ms: number;
  signature: string;            // signed by root with secret
}
```

The edge accepts a token only if signature verifies. Then `evaluate()`:
1. Looks up the envelope (cached) and applies normal envelope rules.
2. Checks for valid (unexpired) Fluidity Token for the envelope.
3. If no valid token → returns EXPIRE / FLUIDITY_TOKEN_EXPIRED.
4. Otherwise tracks `warrantsSinceContact`; refuses if > `maxWarrantsWhileDisconnected`.
5. Otherwise issues Warrant locally with `under_fluidity_token: token.token_id`.

When root reachability is restored, `warrantsSinceContact` resets and the edge resumes normal operation.

## Reconciliation

When the edge calls `reconcile()` (typically post-heal), it submits every locally-issued decision to root:

```
edge → RECONCILE_DECISION → root
root walks its own envelope-revocation log; for each submitted decision,
checks whether the envelope was revoked BEFORE the decision's warrant
was issued.
- Yes → conflict: warrant_issued_after_revocation
- No → clean
```

The 40-asset scenario's `phase4_reconciled_conflicts` count is the number of warrants the edge issued after the envelope was revoked at root.

This is auditable: every conflict has a `warrant_id` and a `revocation_id`. Operators can examine each conflict individually and decide whether to roll back the action's consequence (when reversible) or accept the residual risk.

## How this differs from normal distributed logging

| Distributed log (e.g., Kafka, AWS Kinesis) | Aristotle Mesh |
|---|---|
| Stores events for later consumption | Issues per-action signed authorizations |
| Replication for availability | Replication for trust |
| Best-effort partition tolerance | Bounded disconnected authority via Fluidity Tokens |
| Eventual consistency | Strong consistency on revocation gossip; bounded staleness on disconnected edge |
| Reader pulls events | Witness pushes revocations; edge maintains local cache |
| No per-event authorization | Every locally-issued Warrant carries the Fluidity Token id |

## Production transport requirements

The default transport uses plain HTTP for clarity. Production deployments must inject:

1. **mTLS or service-mesh authentication** via `MeshNodeOptions.httpClient`. The hook is present; the operator wires `undici.Agent({ connect: { ca, cert, key, rejectUnauthorized: true } })` or equivalent.
2. **Per-node Ed25519 keypairs** instead of shared HMAC. The current shared-HMAC model is for clarity; production should rotate every node to its own keypair, gated by the MAE's signing-key allowlist. Tracked in `ROADMAP_TO_100.md` Category 1.
3. **Durable `MeshPersistence`** instead of in-memory. The interface is stable; operator implements against SQLite, Postgres, or any durable store.
4. **Redundant witness paths**. The substrate doesn't enforce minimum witness count; operator must configure ≥ 2 independent witnesses per edge.
5. **NTP-synchronized clocks** across all nodes (within `maxClockSkewMs` of each other; default 60s).
6. **Monitoring on reconciliation conflict counts**. A non-zero count after heal is the operator's signal to investigate.

## Edge auto-pull (a known gap)

When an edge is partitioned at the moment a revocation is gossiped, the witness doesn't auto-replay the revocation when the edge link recovers. Current recovery requires either:
- Operator-triggered re-gossip from root (`RootNode.gossipRevocation(rev)`), tested in `chaos-harness::witness_flap`.
- Edge calling `QUERY_REVOCATIONS` to witness post-heal (the protocol supports this; the edge's `pingRoot` doesn't currently chain into it).

This is a documented future fix. Tracked in `LIMITATIONS.md` §5 and `ROADMAP_TO_100.md` Category 1.

## Tests

22 tests across `src/index.test.ts` (11) and `src/quorum-routing.test.ts` (11). The headline scenario — 40-asset disconnected swarm partition — lives at `examples/mesh/swarm-partition-40-asset.ts` and is reviewer-validated end-to-end (see `examples/reviewer/REVIEWER.md` Stage 3 + Stage 4).

```sh
pnpm --filter @aristotle/mesh-runtime test
pnpm test:mesh                       # mesh-runtime + chaos-harness + scenario-engine
```
