/* AristotleOS execution-control SOAK test.
 *
 * Distinct from benchmark.mts (peak throughput): this drives sustained load for a
 * duration against a *durable* SQLite ledger and answers the operational questions
 * an enterprise asks before a pilot:
 *   - Does latency drift (degrade) over time? (last-decile p99 vs first-decile p99)
 *   - Does memory grow without bound? (heapUsed/RSS sampled in windows)
 *   - Does the hash-chained ledger stay intact under sustained append? (verify all)
 *
 * Run:        npx tsx shared/execution-control-runtime/soak.mts
 * Duration:   AOS_SOAK_MS=60000 npx tsx shared/execution-control-runtime/soak.mts
 * GC samples: node --expose-gc --import tsx shared/execution-control-runtime/soak.mts
 */
import { performance } from "node:perf_hooks";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LedgerStore,
  SqliteLedgerBackend,
  createEd25519Signer,
  evaluateExecutionControl,
  verifyGelRecords,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest
} from "./src/index.js";

const ward: WardManifest = {
  ward_id: "soak-ward",
  name: "Soak Ward",
  sovereignty_context: "soak",
  authority_domain: "drone-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:soak"],
  physical_bounds: { max_altitude_m: 120, permitted_boundary_id: "soak-zone", battery_minimum_pct: 20 }
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-soak",
  ward_id: "soak-ward",
  subject: "agent:soak",
  allowed_actions: ["drone.takeoff"],
  denied_actions: ["drone.disable_geofence"],
  constraints: { required_runtime_registers: ["telemetry.gps_lock"] },
  expires_at: "2099-12-31T23:59:59Z",
  issuer: "soak-root"
};
const action = (i: number): CanonicalActionInput => ({
  action_id: `act-${i}`,
  ward_id: "soak-ward",
  subject: "agent:soak",
  action_type: "drone.takeoff",
  target: "drone/unit-1",
  params: { altitude_m: 60, boundary_id: "soak-zone", battery_pct: 90 },
  requested_at: "2026-05-24T00:00:00.000Z",
  request_id: `req-${i}`,
  telemetry: { gps_lock: true }
});

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = createEd25519Signer({
  privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
});

const DURATION_MS = Number(process.env.AOS_SOAK_MS ?? "20000");
const SAMPLE_MS = 1000;
const MB = 1024 * 1024;

interface Sample { t: number; ops: number; heapMb: number; rssMb: number; }

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "aos-soak-"));
  const dbPath = path.join(dir, "gel.db");
  const ledger = new LedgerStore(new SqliteLedgerBackend(dbPath));
  const gc = (globalThis as { gc?: () => void }).gc;

  // warmup
  for (let i = 0; i < 2000; i++) evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: action(i), ledgerPath: "unused", signer, ledger });
  if (gc) gc();

  const latencies: number[] = [];
  const samples: Sample[] = [];
  const startHeap = process.memoryUsage().heapUsed;
  let ops = 0;
  let nextSample = SAMPLE_MS;

  const t0 = performance.now();
  const baseMem = process.memoryUsage();
  samples.push({ t: 0, ops: 0, heapMb: baseMem.heapUsed / MB, rssMb: baseMem.rss / MB });

  for (;;) {
    const s = performance.now();
    evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: action(2000 + ops), ledgerPath: "unused", signer, ledger });
    latencies.push(performance.now() - s);
    ops++;
    const elapsed = performance.now() - t0;
    if (elapsed >= nextSample) {
      const mem = process.memoryUsage();
      samples.push({ t: Math.round(elapsed), ops, heapMb: mem.heapUsed / MB, rssMb: mem.rss / MB });
      nextSample += SAMPLE_MS;
    }
    if (elapsed >= DURATION_MS) break;
  }
  const totalMs = performance.now() - t0;

  // latency drift: compare the first 10% of ops to the last 10%
  const decile = Math.max(1, Math.floor(latencies.length * 0.1));
  const p99 = (arr: number[]) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * 0.99))]; };
  const p50 = (arr: number[]) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length * 0.5)]; };
  const firstP99 = p99(latencies.slice(0, decile));
  const lastP99 = p99(latencies.slice(-decile));
  const driftRatio = lastP99 / firstP99;

  if (gc) gc();
  const endHeap = process.memoryUsage().heapUsed;
  const peakHeapMb = Math.max(...samples.map((s) => s.heapMb));

  // integrity: every appended record verifies as one hash-chain
  const records = ledger.records();
  const integrity = verifyGelRecords(records);

  const result = {
    soak: "execution-control",
    generated_at: new Date().toISOString(),
    node_version: process.version,
    platform: `${process.platform}/${process.arch}`,
    duration_ms: Math.round(totalMs),
    ledger: "sqlite (durable)",
    total_ops: ops,
    ops_per_sec: Math.round(ops / (totalMs / 1000)),
    latency_ms: { p50: p50(latencies), p99: p99(latencies) },
    latency_drift: { first_decile_p99_ms: firstP99, last_decile_p99_ms: lastP99, ratio: Number(driftRatio.toFixed(3)) },
    memory: {
      start_heap_mb: Number((startHeap / MB).toFixed(1)),
      peak_heap_mb: Number(peakHeapMb.toFixed(1)),
      end_heap_mb: Number((endHeap / MB).toFixed(1)),
      heap_growth_per_1k_ops_mb: Number((((endHeap - startHeap) / MB) / (ops / 1000)).toFixed(4)),
      gc_available: Boolean(gc)
    },
    ledger_integrity: { ok: integrity.ok, records_verified: integrity.count, failure: integrity.failure ?? null }
  };

  console.log("\nAristotleOS execution-control SOAK  ·  Node " + process.version + "\n");
  console.log(`duration:        ${(totalMs / 1000).toFixed(1)}s   ledger: SQLite (durable)`);
  console.log(`throughput:      ${result.ops_per_sec.toLocaleString()} ops/sec over ${ops.toLocaleString()} ops`);
  console.log(`latency:         p50 ${result.latency_ms.p50.toFixed(3)}ms   p99 ${result.latency_ms.p99.toFixed(3)}ms`);
  console.log(`latency drift:   first-decile p99 ${firstP99.toFixed(3)}ms -> last-decile p99 ${lastP99.toFixed(3)}ms  (ratio ${result.latency_drift.ratio}x)`);
  console.log(`memory:          start ${result.memory.start_heap_mb}MB  peak ${result.memory.peak_heap_mb}MB  end ${result.memory.end_heap_mb}MB  (+${result.memory.heap_growth_per_1k_ops_mb}MB/1k ops${gc ? "" : ", no --expose-gc"})`);
  console.log(`ledger integrity: ${integrity.ok ? "OK" : "FAILED"}  (${integrity.count.toLocaleString()} records verified${integrity.failure ? ", " + integrity.failure : ""})`);
  console.log("");

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const reportsDir = path.join(root, "reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(path.join(reportsDir, "execution-control-soak.json"), `${JSON.stringify({ ...result, samples }, null, 2)}\n`, "utf8");
  console.log("report written → reports/execution-control-soak.json\n");

  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }

  if (!integrity.ok) process.exit(1);
}

void main();
