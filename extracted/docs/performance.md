# Performance — measured, and honestly positioned

Reproduce: `corepack pnpm bench:execution-control` (writes
`reports/execution-control-benchmark.{json,md}`). Numbers below are a representative
single-instance run on Node v24, one core. Treat them as orders of magnitude, not
guarantees — re-run on your target hardware.

| Path | ops/sec | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| `canonicalizeAction` (canonical hash) | ~75,000 | 0.010 | 0.017 | 0.040 |
| `evaluateCommitGate` (pure decision) | ~57,000 | 0.013 | 0.023 | 0.070 |
| `issueWarrant` (Ed25519 sign) | ~12,000 | 0.061 | 0.134 | 0.41 |
| `verifyWarrant` (Ed25519 verify) | ~5,900 | 0.140 | 0.357 | 0.81 |
| `evaluateExecutionControl` + in-memory ledger | ~3,900 | 0.179 | 0.61 | 1.47 |
| `evaluateExecutionControl` + SQLite ledger (durable) | ~1,800 | 0.270 | 1.54 | 2.66 |
| HTTP boundary, concurrency 1 | ~410 | 1.8 | 6.7 | 8.5 |
| HTTP boundary, concurrency 32 | ~590 | 51 | 76 | 99 |

## How to read this

- **The decision itself is cheap.** The pure Commit Gate evaluates at ~57k/core and
  canonical hashing at ~75k/core. Policy evaluation is not the bottleneck.
- **The cost is the guarantee, not the language.** The full path is dominated by
  Ed25519 signing (~12k/core) and a durable `fsync` append (SQLite ~1.8k/core).
  Those costs buy the product: a single-use signed Warrant and a tamper-evident,
  offline-verifiable evidence record. They are inherent to "evidence after every
  decision," and they are roughly language-independent (the same OpenSSL primitives
  and the same disk).
- **Throughput scales horizontally, by design.** A single Node instance is
  event-loop bound; the throughput story is **stateless replicas over the serialized
  Postgres ledger** (single-use/replay stay consistent across instances — see
  `docs/fail-modes.md`). Add replicas, not a faster language.

## The optimization in this pass

Ed25519 verification re-parsed the public-key PEM on every call. `verifyEd25519` now
caches the parsed `KeyObject` by PEM (bounded, behaviour-identical). The single-call
win is small — Ed25519's verify *math* dominates one verification — but it removes N
redundant PEM parses from **batch** verification that reuses one key:
`verifyGelChain` over a long ledger and `verifyEvidenceBundle`. Those are exactly the
auditor/replay paths where verification volume is highest.

## Honest position vs a compiled (e.g. Go) gate

A compiled gate will win a single-core microbenchmark of the decision step, and we do
not pretend otherwise. It does not change the two things that actually bound a
governance boundary:

1. **Crypto + durability dominate**, and they cost the same in any language.
2. **Scale is replicas**, and a stateless boundary over a shared serialized ledger
   scales the same regardless of the gate's implementation language.

So we deliberately did **not** rewrite the gate to chase a benchmark we don't need to
win. The engineering effort goes where it changes outcomes — provable determinism
(the differential oracle), cryptographic evidence, and horizontal-scale correctness —
not into shaving microseconds off a step that is already ~17µs.

## If you need more single-instance throughput

- Run multiple replicas behind an L7 load balancer over the Postgres ledger backend.
- Use the async evaluate path with the Postgres backend for I/O-bound concurrency.
- Batch-verify evidence offline (the key cache above makes chain/bundle verification
  cheaper).
- Keep warrant TTLs and replay windows sized to your ledger backend's write latency.
