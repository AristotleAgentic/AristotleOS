import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReplayArtifact, verifyReplayArtifact } from "../../shared/replay-artifact/src/index.js";
import { runSwarmPartitionScenario, type ScenarioReport } from "./swarm-partition-40-asset.js";
import { SCENARIO_VERSION, type SwarmScenarioInputs } from "./publish-replay-artifact.js";

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = join(here, "published.replay.json");

test("published.replay.json: file exists and parses", () => {
  const raw = readFileSync(ARTIFACT_PATH, "utf8");
  const artifact = loadReplayArtifact<SwarmScenarioInputs, ScenarioReport>(raw);
  assert.equal(artifact.scenario_id, "swarm-partition-40-asset");
  assert.equal(artifact.scenario_version, SCENARIO_VERSION);
  assert.equal(artifact.inputs.assetCount, 40);
  assert.equal(artifact.inputs.fluidityTtlMs, 1500);
  assert.match(artifact.report_hash, /^sha256:[0-9a-f]{64}$/);
  assert.match(artifact.artifact_hash, /^sha256:[0-9a-f]{64}$/);
});

test("published.replay.json: verifies under local re-run (artifact_hash + report_hash + reproducibility + version all green)", async () => {
  const raw = readFileSync(ARTIFACT_PATH, "utf8");
  const artifact = loadReplayArtifact<SwarmScenarioInputs, ScenarioReport>(raw);
  const v = await verifyReplayArtifact(artifact, {
    rerun: runSwarmPartitionScenario,
    localScenarioVersion: SCENARIO_VERSION
  });
  assert.equal(v.ok, true, `failures: ${v.failures.join("; ")}`);
  assert.equal(v.artifact_hash_ok, true);
  assert.equal(v.report_hash_ok, true);
  assert.equal(v.scenario_reproducible, true);
  assert.equal(v.version_ok, true);
});

test("published.replay.json: report meets the substrate audit's #12 claims", () => {
  const raw = readFileSync(ARTIFACT_PATH, "utf8");
  const artifact = loadReplayArtifact<SwarmScenarioInputs, ScenarioReport>(raw);
  const r = artifact.report;
  // All 40 assets receive a warrant in nominal flight.
  assert.equal(r.phase1_allow, 40);
  assert.equal(r.phase1_other, 0);
  // Every asset's phase-2 evaluation under partition lands in
  // exactly one of ALLOW / REFUSE / EXPIRE (no losses).
  assert.equal(r.phase2_allow + r.phase2_refuse + r.phase2_expire, 40);
  // 10 envelopes get revoked in phase 3; their phase-3 evaluations
  // resolve cleanly into the isolated/witness-reachable split.
  assert.equal(r.phase3_isolated_half_allowed + r.phase3_witness_half_refused, 10);
  // Reconciliation accounts for every asset that issued at least one
  // local decision (clean + conflicting).
  assert.ok(r.phase4_reconciled_clean + r.phase4_reconciled_conflicts >= 10);
  // total_warrants_issued is the sum of ALLOWs across phases 1-3.
  assert.equal(r.total_warrants_issued, r.phase1_allow + r.phase2_allow + r.phase3_isolated_half_allowed);
});
