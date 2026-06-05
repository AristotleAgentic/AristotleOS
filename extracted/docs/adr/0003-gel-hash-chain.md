# ADR-0003 — Hash-chained Governance Evidence Ledger

**Status:** Accepted

## Context

Every Commit Gate decision produces an evidence record. The substrate
must store these durably and detectably-tamperproof — operators,
auditors, regulators, and (in the future) external reviewers must be
able to assert "this decision happened, with these inputs, at this
time" with no plausible deniability.

Three storage models were on the table:

1. **Append-only log with periodic signed roots.** A flat file; sign
   the root hash every N records. Cheap. Tampering inside a window
   isn't detected until the next root.
2. **Hash-chained ledger.** Every record carries the previous
   record's hash; tampering with any record breaks every subsequent
   record's link.
3. **Public blockchain.** Every record committed to a public chain.
   Strongest, most expensive, most operationally invasive.

## Decision

The substrate uses **option 2**: a per-tenant hash-chained ledger
where each `GelRecord` carries `previous_hash` and `record_hash`,
each record is optionally Ed25519-signed by an operator-controlled
signer, and verification walks from `GENESIS_HASH` through every
record asserting `record.previous_hash === previousRecord.record_hash`
and `record.record_hash === sha256(materialFields)`.

External time anchoring (`@aristotle/gel-timestamp`) layers on top
for non-repudiation across long time gaps; that's an operator choice,
not a chain requirement.

## Alternatives considered

- **Append-only with periodic roots.** Rejected. The window between
  signed roots is a tampering opportunity. We didn't want to commit
  to a root-publication cadence in the substrate.
- **Public blockchain (Bitcoin OP_RETURN, Ethereum, etc.).**
  Rejected as the substrate default. The cost per record, the
  operational dependency on a public chain, the privacy implications
  of publishing decision metadata, and the tooling complexity all
  argued against. Operators who want this can layer it via the TSA
  interface; it doesn't belong in the substrate's hot path.
- **Database with row-level signatures only.** Rejected. A row-level
  signature catches per-row tampering but not row reorder, row
  deletion, or row insertion. The hash chain catches all three.
- **Merkle tree without chain.** Considered. A Merkle tree gives
  efficient proof-of-inclusion but doesn't constrain ordering. The
  chain *does*. For a decision ledger where ordering matters (a
  Warrant issued after a revocation is a conflict), the chain is
  the right shape.

## Consequences

- Single-byte tampering anywhere in the chain is detected by
  `verifyGelRecords`. The substrate's `gel.mutation.test.ts`
  exhaustively asserts this across mutation categories M1–M6.
- Concurrent appends to the same chain are serialized through
  whichever backend (`FileLedgerBackend`, `SqliteLedger`,
  `PostgresLedger`) the operator wires. There's no lock-free path;
  the chain enforces ordering by construction.
- Long-running deployments need an archive strategy because the file
  grows forever. The substrate ships `@aristotle/gel-archive` for
  this: oldest records move to a separate file; both files
  independently verify (one rooted at GENESIS, one at the rollover
  hash).
- Restoring a chain after operator-induced corruption is a recovery
  story (see `docs/INCIDENT_RESPONSE.md` § S4.A), not a graceful
  failure mode. We accept this — the alternative is the chain
  silently accepting corruption, which is the failure we built the
  chain to prevent.
- Operators who care about non-repudiation across a multi-month gap
  must additionally anchor with an external TSA (the operator's GEL
  signer can backdate or forward-date records otherwise).
  `@aristotle/gel-timestamp` ships the interface.

## See also

- `shared/execution-control-runtime/src/gel.mutation.test.ts` — chain integrity invariants
- `@aristotle/gel-archive` — retention policy + archive/restore
- `@aristotle/gel-timestamp` — external timestamp anchor
- [docs/GEL.md](../GEL.md) — concept doc
- [LIMITATIONS.md § 3](../../LIMITATIONS.md#3-external-timestamp-authority--interface-ships-real-tsa-wiring-is-operator-supplied) — TSA caveat
- ADR-0002 (deterministic gate) — hash chain meaning depends on decisions being reproducible
