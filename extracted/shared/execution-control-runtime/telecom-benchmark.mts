/* AristotleOS telecom carrier-scale benchmark.
 * Runs the real Ward/Warrant execution-control boundary against a telecom Ward.
 *
 * Usage:
 *   npx tsx shared/execution-control-runtime/telecom-benchmark.mts
 *   AOS_TELECOM_BENCH_COUNT=10000 npx tsx shared/execution-control-runtime/telecom-benchmark.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  loadAuthorityEnvelope,
  loadWardManifest,
  runCarrierScaleBenchmark
} from "./src/index.js";

const count = Number(process.env.AOS_TELECOM_BENCH_COUNT ?? "5000");
const ward = loadWardManifest("examples/telecom/ward.ran_region_west.yaml");
const authorityEnvelope = loadAuthorityEnvelope("examples/telecom/authority_envelope.noc_change_orchestrator.yaml");
const report = runCarrierScaleBenchmark({
  ward,
  authorityEnvelope,
  actionCount: count,
  now: new Date().toISOString()
});

mkdirSync("reports", { recursive: true });
writeFileSync(path.join("reports", "telecom-carrier-benchmark.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(path.join("reports", "telecom-carrier-benchmark.md"), [
  "# AristotleOS Telecom Carrier Benchmark",
  "",
  `Generated: ${report.generated_at}`,
  `Actions: ${report.action_count}`,
  `Throughput: ${report.decisions_per_second} decisions/sec`,
  `Latency p50/p95/p99: ${report.latency.p50_ms}/${report.latency.p95_ms}/${report.latency.p99_ms} ms`,
  `Ledger verification: ${report.ledger_verification.ok ? "ok" : `failed (${report.ledger_verification.failure})`}`,
  "",
  "This benchmark exercises the actual Commit Gate, Warrant issuance, and GEL append path using telecom Ward/Authority artifacts."
].join("\n"), "utf8");

console.log(`telecom benchmark complete: ${report.decisions_per_second} decisions/sec, p95=${report.latency.p95_ms}ms`);
console.log("reports written -> reports/telecom-carrier-benchmark.{json,md}");
