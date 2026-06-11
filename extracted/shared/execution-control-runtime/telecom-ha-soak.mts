/* AristotleOS telecom HA/reconnect soak simulation.
 * Exercises multi-region ledger append and disconnected edge reconnect replay.
 *
 * Usage:
 *   npx tsx shared/execution-control-runtime/telecom-ha-soak.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  loadAuthorityEnvelope,
  loadWardManifest,
  runReconnectStormSimulation,
  simulateMultiRegionLedgerSoak
} from "./src/index.js";

const ward = loadWardManifest("examples/telecom/ward.ran_region_west.yaml");
const authorityEnvelope = loadAuthorityEnvelope("examples/telecom/authority_envelope.noc_change_orchestrator.yaml");
const generatedAt = new Date().toISOString();

const reconnect = runReconnectStormSimulation({
  ward,
  authorityEnvelope,
  edgeNodes: Number(process.env.AOS_TELECOM_EDGE_NODES ?? "100"),
  recordsPerNode: Number(process.env.AOS_TELECOM_RECORDS_PER_NODE ?? "100"),
  now: generatedAt
});

const ledger = simulateMultiRegionLedgerSoak({
  ward,
  authorityEnvelope,
  regions: (process.env.AOS_TELECOM_REGIONS ?? "east,central,west").split(",").map((s) => s.trim()).filter(Boolean),
  decisionsPerRegion: Number(process.env.AOS_TELECOM_DECISIONS_PER_REGION ?? "500"),
  now: generatedAt
});

const report = {
  report: "aristotle.telecom.ha-soak.v1",
  generated_at: generatedAt,
  reconnect,
  ledger,
  pass: reconnect.total_records > 0 && ledger.ledger_verification.ok
};

mkdirSync("reports", { recursive: true });
writeFileSync(path.join("reports", "telecom-ha-soak.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`reconnect storm: ${reconnect.total_records} records, ${reconnect.conflicts} conflict(s), ${reconnect.records_per_second} records/sec`);
console.log(`multi-region ledger: ${ledger.total_decisions} decisions, verification=${ledger.ledger_verification.ok ? "ok" : "failed"}`);
console.log("report written -> reports/telecom-ha-soak.json");
process.exit(report.pass ? 0 : 1);
