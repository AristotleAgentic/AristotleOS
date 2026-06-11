# ADR-0004 — Fluidity Tokens for disconnected operation

**Status:** Accepted

## Context

The substrate gates execution. The "obvious" implementation is: every
action contacts the root authority synchronously to get a fresh
Warrant. That works in a datacenter; it fails on a UAV with
intermittent comms, an OT site with hours-long uplink outages, a
ship's bridge crossing an ocean, or an autonomous vehicle in a
tunnel.

The substrate can't choose between "always-connected" and "always-
disconnected"; real deployments are both, at different times, in
different parts. We needed a primitive that lets an edge keep
operating safely during a disconnection window — without giving up
the ability to revoke its authority retroactively.

## Decision

The substrate ships **Fluidity Tokens**: time-boxed delegations
issued by the root, presented by the edge during disconnected
operation.

Properties:

1. **Issued in advance.** Root proactively issues Fluidity Tokens
   bound to an envelope + edge id with a TTL (typical: minutes to
   hours, operator-chosen).
2. **Used at the edge.** Edge holds the token; on each disconnected
   action, edge checks the token is unexpired and uses it to issue a
   local Warrant.
3. **Bounded by TTL.** Token expires → edge fails closed
   (`FLUIDITY_TOKEN_EXPIRED`). The TTL is the operator's stated
   risk tolerance for partition.
4. **Bounded by disconnected-warrant quota.** Edge tracks how many
   warrants it has issued since last root contact
   (`warrantsSinceContact`); past `maxWarrantsWhileDisconnected`,
   the edge fails closed (`DISCONNECTED_QUOTA_EXCEEDED`) regardless
   of TTL.
5. **Reconciled on heal.** When the partition heals, the edge's
   auto-pull (ADR-implicit: ROADMAP closure) catches up missed
   revocations from root, and `reconcile()` surfaces conflicts
   (warrants issued after a revocation root had already gossiped).

## Alternatives considered

- **Always-connected gates (no disconnect support).** Rejected.
  Foundational use cases (UAV, OT, maritime) wouldn't ship.
- **Pre-issued Warrants the edge presents directly.** Rejected.
  Warrants are single-use and action-bound (ADR-0001); pre-issuing
  one per anticipated action is a combinatorial problem.
- **Long-lived bearer tokens.** Rejected. Same reasoning as
  ADR-0001's JWT rejection: bearer + long-lived = replay easy.
- **"Trust the edge" — no governance during disconnection.**
  Rejected outright. The substrate's value is that governance applies
  even during disconnection.
- **CRDT-like eventually-consistent authority.** Considered.
  Interesting but the substrate needed a primitive operators could
  reason about ("we trust this edge for 5 minutes after losing
  contact"), and CRDT consensus semantics are hard to reduce to that
  operator-facing statement. The TTL + quota model is concrete.

## Consequences

- Edges operate during partition, bounded by the operator's chosen
  TTL + quota. The gate is fail-closed at the boundary: past either
  cap, no more warrants issue. This is the operationally legible
  knob: if you trust the edge less, lower the TTL or the quota.
- Reconciliation can surface conflicts: an edge that issued a
  Warrant under a Fluidity Token AFTER root revoked the underlying
  envelope is a conflict. The substrate detects this on `reconcile()`;
  operators decide how to respond.
- Fluidity Tokens are themselves signed by root and verified by the
  edge against root's public key. A compromised root could issue
  arbitrary tokens, but the same compromise breaks every other
  substrate property — this isn't a new attack surface.
- Operators must choose TTL + quota deliberately. The substrate's
  default (`maxWarrantsWhileDisconnected: 100`) is too loose for
  safety-critical deployments; see `docs/PRODUCTION_DEPLOYMENT.md`
  for sizing guidance.
- The auto-pull on heal (ROADMAP closure: edge calls
  `pullRevocations()` when `pingRoot()` flips to reachable) means
  the edge catches up missed revocations without operator action.
  This was a known gap in the original Fluidity Token design and
  shipped as a follow-up hardening.

## See also

- `shared/mesh-runtime/src/index.ts` — `EdgeNode.evaluate`, `FluidityToken`, `pullRevocations`
- `docs/PRODUCTION_DEPLOYMENT.md` — sizing the TTL + quota
- `docs/INCIDENT_RESPONSE.md` § S3.A — partition exceeding TTL recovery
- `docs/specs/mesh-reconciliation.tla` — formal model of the partition → heal → reconcile flow
- ADR-0001 (single-use Warrants) — Fluidity Tokens are the mechanism that lets a single-use Warrant model work under disconnection
