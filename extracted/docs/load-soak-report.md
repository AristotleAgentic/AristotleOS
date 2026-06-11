# Load & soak evidence — execution-control boundary

Peak throughput is measured by `npm run bench:execution-control`. This report
captures a **soak** run (`npm run soak:execution-control`) that answers the
operational questions a pilot asks: *does latency drift, does memory leak, does the
hash-chained ledger stay intact under sustained append?*

## Methodology

`shared/execution-control-runtime/soak.mts` drives `evaluateExecutionControl`
(canonicalize → Commit Gate → Ed25519 Warrant → signed, hash-chained GEL append)
in a tight loop for a fixed wall-clock duration against a **durable SQLite ledger**
(the realistic production path; records persist to disk rather than the JS heap, so
heap growth is a clean leak signal). It samples `heapUsed`/`rss` every second,
compares the p99 latency of the first 10% of operations to the last 10% (drift),
and at the end re-reads **every** appended record and runs `verifyGelRecords` to
prove chain integrity held throughout.

Reproduce (durations and GC sampling are configurable):

```bash
AOS_SOAK_MS=45000 npm run soak:execution-control   # node --expose-gc ... soak.mts
```

## Result (representative run)

- Host: Node v24.15.0, win32/x64, single node, SQLite (durable) ledger
- Duration: **45.0 s**

| Metric | Value | Reading |
|--------|-------|---------|
| Throughput | **1,662 ops/sec** over 74,795 ops | sustained, single node, per-op Ed25519 sign + durable append |
| Latency p50 / p99 | **0.275 ms / 4.899 ms** | full evaluate→sign→append path |
| Latency drift (last-decile p99 ÷ first-decile p99) | **0.359×** | **no degradation** over the run (improves post-warmup; ratio ≤ ~1.0 is the pass) |
| Memory | start 9.4 MB → peak 25.3 MB → **end 10.1 MB** | end ≈ start after GC |
| Heap growth | **+0.0095 MB / 1,000 ops** | effectively flat — **no leak** |
| Ledger integrity | **OK — 76,795 records verified** | every record (warmup + soak) verifies as one unbroken hash chain |

## Reading the numbers honestly

- **Single-node throughput is bound by Ed25519 signing**, not I/O or the gate logic.
  ~1.6k governed decisions/sec/node with full durable, signed, hash-chained evidence
  is comfortably above typical agent-action rates; scale **horizontally** via the
  shared Postgres ledger backend (serialized append + leader election) when one node
  is not enough.
- **Numbers are machine-specific** — treat ratios (drift ≈ 0.36×, heap ≈ flat) and
  integrity (100% verified) as the durable signals, not the absolute ops/sec as an
  SLA. Re-run on target hardware to set real SLOs.
- This is an in-process soak. It is **not** a substitute for a multi-node, multi-hour
  production soak with chaos/failure injection on the target cluster — that remains a
  pre-GA step (see `docs/release-checklist.md`).
- The full per-second sample series is written to `reports/execution-control-soak.json`
  (gitignored; machine-specific).
