/* AristotleOS execution-control throughput benchmark.
 * Exercises the real code paths. Run: npx tsx shared/execution-control-runtime/benchmark.mts
 */
import { performance } from "node:perf_hooks";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  InMemoryLedgerBackend,
  LedgerStore,
  SqliteLedgerBackend,
  canonicalizeAction,
  createEd25519Signer,
  createExecutionControlRuntimeServer,
  evaluateCommitGate,
  evaluateExecutionControl,
  issueWarrant,
  verifyWarrant,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest
} from "./src/index.js";

const ward: WardManifest = {
  ward_id: "bench-ward",
  name: "Benchmark Ward",
  sovereignty_context: "bench",
  authority_domain: "drone-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:bench"],
  physical_bounds: { max_altitude_m: 120, permitted_boundary_id: "bench-zone", battery_minimum_pct: 20 }
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-bench",
  ward_id: "bench-ward",
  subject: "agent:bench",
  allowed_actions: ["drone.takeoff"],
  denied_actions: ["drone.disable_geofence"],
  constraints: { required_runtime_registers: ["telemetry.gps_lock"] },
  expires_at: "2099-12-31T23:59:59Z",
  issuer: "bench-root"
};
const action = (i: number): CanonicalActionInput => ({
  action_id: `act-${i}`,
  ward_id: "bench-ward",
  subject: "agent:bench",
  action_type: "drone.takeoff",
  target: "drone/unit-1",
  params: { altitude_m: 60, boundary_id: "bench-zone", battery_pct: 90 },
  requested_at: "2026-05-24T00:00:00.000Z",
  request_id: `req-${i}`,
  telemetry: { gps_lock: true }
});

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = createEd25519Signer({
  privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
});

interface Row { name: string; n: number; ops: number; p50: number; p95: number; p99: number; }
const rows: Row[] = [];

function bench(name: string, n: number, fn: (i: number) => void): void {
  for (let i = 0; i < Math.min(2000, n); i++) fn(i); // warmup
  const lat = new Float64Array(n);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    fn(i);
    lat[i] = performance.now() - s;
  }
  const totalMs = performance.now() - t0;
  lat.sort();
  const pct = (p: number) => lat[Math.min(n - 1, Math.floor(n * p))];
  rows.push({ name, n, ops: n / (totalMs / 1000), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) });
}

async function httpBench(url: string, total: number, concurrency: number): Promise<Row> {
  const lat: number[] = [];
  let i = 0;
  const t0 = performance.now();
  async function worker() {
    while (i < total) {
      const idx = i++;
      const s = performance.now();
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: action(idx) }) });
      await res.text();
      lat.push(performance.now() - s);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const totalMs = performance.now() - t0;
  lat.sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))];
  return { name: `HTTP boundary (c=${concurrency})`, n: total, ops: total / (totalMs / 1000), p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) };
}

async function main() {
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action: action(0) });
  const warrant = issueWarrant(decision, action(0), envelope, undefined, signer)!;
  const hash = canonicalizeAction(action(0)).canonical_action_hash;

  bench("canonicalizeAction (hash)", 200_000, (i) => void canonicalizeAction(action(i % 1000)));
  bench("evaluateCommitGate (pure decision)", 200_000, (i) => void evaluateCommitGate({ ward, authorityEnvelope: envelope, action: action(i % 1000) }));
  bench("issueWarrant (Ed25519 sign)", 20_000, (i) => void issueWarrant(decision, action(i), envelope, undefined, signer));
  bench("verifyWarrant (Ed25519 verify)", 20_000, () => void verifyWarrant(warrant, hash));

  const memLedger = new LedgerStore(new InMemoryLedgerBackend());
  bench("evaluateExecutionControl + in-memory ledger", 20_000, (i) =>
    void evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: action(i), ledgerPath: "unused", signer, ledger: memLedger }));

  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "aos-bench-")), "gel.db");
  const sqliteLedger = new LedgerStore(new SqliteLedgerBackend(dbPath));
  bench("evaluateExecutionControl + SQLite ledger (durable)", 10_000, (i) =>
    void evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: action(i), ledgerPath: "unused", signer, ledger: sqliteLedger }));

  // HTTP boundary
  const { server } = createExecutionControlRuntimeServer({ ward, authorityEnvelope: envelope, ledgerPath: "unused", signer, ledger: LedgerStore.memory() });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const url = `http://127.0.0.1:${addr && typeof addr === "object" ? addr.port : 0}/v1/execution-control/evaluate`;
  rows.push(await httpBench(url, 3000, 1));
  rows.push(await httpBench(url, 8000, 32));
  await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

  // report
  const pad = (s: string, n: number) => s.padEnd(n);
  const padR = (s: string, n: number) => s.padStart(n);
  console.log("\nAristotleOS execution-control throughput  ·  Node " + process.version + "\n");
  console.log(pad("path", 46) + padR("ops/sec", 12) + padR("p50 ms", 10) + padR("p95 ms", 10) + padR("p99 ms", 10));
  console.log("-".repeat(88));
  for (const r of rows) {
    console.log(
      pad(r.name, 46) +
      padR(Math.round(r.ops).toLocaleString(), 12) +
      padR(r.p50.toFixed(3), 10) +
      padR(r.p95.toFixed(3), 10) +
      padR(r.p99.toFixed(3), 10)
    );
  }
  console.log("");
}

void main();
