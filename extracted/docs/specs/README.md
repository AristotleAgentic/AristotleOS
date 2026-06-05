# Formal specifications

This directory holds formal specifications of substrate invariants. They are
documentation-grade: they explain what the implementation is supposed to do in
a notation that a reviewer can check independently of the source.

These specs are **not** in the project's CI gate. Running them is a
manual reviewer step. Wiring `tlc` into CI is a future-work item — see
[ROADMAP_TO_100.md](../../ROADMAP_TO_100.md) Category 1.

## Files

### `mesh-reconciliation.tla`

Models the partition → heal → reconcile → auto-pull → conflict-detection
state machine implemented in `shared/mesh-runtime/src/index.ts`. Covers:

- Root issuing envelopes and revocations.
- Witness + Edge caches.
- Edge issuing Warrants while disconnected, subject to the Fluidity Token
  TTL and the disconnected-warrant quota.
- `pingRoot` reconnect transition that auto-pulls missed revocations.
- `reconcile` that surfaces a Warrant-after-revocation as a conflict.

Asserts the safety invariants:
- `Inv_NoWarrantAfterKnownRevocation` — no Warrant after the edge has cached the matching revocation
- `Inv_QuotaCap` — disconnected-warrant counter is bounded
- `Inv_ReconcileDetectsConflict` — every missed revocation either pre-dates the Warrant or is auto-pulled on heal

And the liveness property:
- `Live_EventualConsistencyOnHeal` — a permanently-healed edge eventually catches up to Root's full revocation set

### Companion property tests

The same invariants are exercised at the implementation level by:

- `shared/mesh-runtime/src/index.test.ts` — `auto-pull: *` tests, `partition: *` tests, `reconciliation: *` tests
- `shared/execution-control-runtime/src/gate.replay-property.test.ts` — Warrant replay invariants
- `shared/execution-control-runtime/src/gel.mutation.test.ts` — GEL chain mutation invariants

The TLA+ spec is a higher-level statement of the same invariants the test
files assert at the code level. If they ever disagree, both should be
reviewed before deciding which one is wrong.

## Running TLC

[TLA+ Toolbox](https://lamport.azurewebsites.net/tla/toolbox.html) or the
command-line `tlc`:

```sh
# From this directory:
tlc MeshReconciliation.tla -config <(cat <<EOF
SPECIFICATION Spec
INVARIANTS
  Inv_NoWarrantAfterKnownRevocation
  Inv_QuotaCap
  Inv_ReconcileDetectsConflict
PROPERTY
  Live_EventualConsistencyOnHeal
CONSTANTS
  Edges = {"e1", "e2"}
  MaxRevocations = 3
  MaxDisconnectedWarrants = 2
  MaxTime = 6
EOF
)
```

At those bounds the state space is roughly 10⁴ states; TLC completes in
seconds.

## Limitations

- The spec deliberately abstracts the envelope. Real envelopes have
  versioning, expiry, and per-subject scoping — none of which is modeled
  here. A future iteration could lift those into the state space.
- The spec models **one** witness implicitly (the witness's behavior is
  folded into Root's gossip-on-issue). A multi-witness model with byzantine
  quorum would be a separate spec.
- The clock is logical (`rootClock`). Real deployments have clock skew,
  which the substrate handles via `maxClockSkewMs` in
  `verifyWarrant`. That's out of scope for this spec.
- This is a model, not a proof. Refinement to executable code (Apalache or
  TLAPS) is future work.
