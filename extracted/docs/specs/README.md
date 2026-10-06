# Bounded formal specifications

`MeshReconciliation.tla` models bounded offline issuance, logical token expiry,
quota, revocation propagation, root contact, and explicit reconciliation. It is
not a proof of the TypeScript implementation. The mapping is reviewed manually.

The original documentation-grade model failed its reconciliation invariant under
TLC: an isolated edge was required to know a revocation before reconnecting.
It also allowed connected issuance to violate its unconditional quota invariant,
had unbounded warrant histories, and used a tautological monotonicity predicate.
The counterexample is retained in `docs/assurance/baseline` at repository root.

The corrected model preserves permitted disconnected issuance. Reconciliation
checks the snapshot actually reconciled; future or unseen revocations do not
rewrite that snapshot. Quota counts disconnected issuance. Token renewal is a
connected root action, and expired tokens cannot permit new offline issuance.
Monotonicity is a temporal property, not a predicate comparing a set to itself.

## Running

Use Java 21 and the official TLA+ `v1.7.4` release's `tla2tools.jar`.
Set `TLA_TOOLS_JAR` to the jar's absolute path; optionally set `ARISTOTLE_JAVA`
to a Java executable. From `extracted/`, run:

```sh
node scripts/check-formal-model.mjs
```

The runner verifies the pinned jar SHA-256, applies a three-minute timeout per
configuration, and records exact source/configuration hashes, exit codes and
logs under `reports/formal/`. CI runs the same checks and uploads evidence.
Official tool usage: https://github.com/tlaplus/tlaplus/blob/master/USE.md

| Configuration | Bounds | Purpose |
|---|---|---|
| MeshReconciliation.cfg | 2 edges, time 0..2, 1 warrant/edge, quota 1, token TTL 1 | Partition/heal/reconciliation and per-edge liveness |
| MeshReconciliation.quota.cfg | 1 edge, time 0..2, 3 warrants, quota 1, token TTL 1 | Repeated issuance and quota exhaustion |
| Negative quota control | Quota configuration with issuance quota guard removed | Must produce an invariant counterexample |
| Negative revocation control | Quota configuration with known-revocation guard removed | Must produce an invariant counterexample |

Successful positive runs alone are insufficient: both seeded flaws must fail.
These small configurations are repeatable CI bounds, not a proof for all fleet
sizes or partitions. An earlier larger exploratory configuration was stopped
before completion; it is not reported as passing evidence.

## Implementation correspondence and assumptions

- `Issue` corresponds to the edge gate's known-revocation, token TTL and offline
  quota checks. `MaxWarrants` is an exploration cutoff, not production policy.
- `Pull` abstracts a successful `pullRevocations`/post-heal `pingRoot` refresh;
  the model assumes authenticated delivery and weak fairness separately per edge.
- `Reconcile` abstracts root classification of the submitted historical snapshot.
  Equal logical timestamps are conservatively classified as conflicts.
- Root gossip abstracts witness forwarding. Per-witness faults, Byzantine peers,
  transport authentication and cryptographic implementation are outside this model.
- The liveness claim requires eventual permanent connectivity. It makes no
  convergence promise during an endless partition.
- One implicit authority envelope is modeled. Complete MAE/Ward/delegation scope,
  real clock drift, envelope expiry, physical constraints, effect persistence,
  Warrant consumption, crashes and database transactions remain outside this model.
- `RevocationsMonotone` checks that learned revocations are never forgotten.
  No runtime semantics were changed to make the checker pass.

Runtime property/race tests remain separate evidence. Formal refinement and
unbounded theorem proofs remain future work.
