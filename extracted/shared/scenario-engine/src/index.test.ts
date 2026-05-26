import test from "node:test";
import assert from "node:assert/strict";
import {
  runScenario,
  GPS_SPOOF_MID_MISSION,
  FLASH_REVOCATION,
  PARTITION_RECONCILE,
  type ScenarioStepResult
} from "./index.js";

function payload(step: ScenarioStepResult): Record<string, unknown> { return step.payload; }

test("GPS_SPOOF_MID_MISSION: spoof step refused with SUBJECT_MISMATCH; subsequent legit eval allowed", async () => {
  const trace = await runScenario(
    { scenarioId: "gps-spoof", edgeIds: ["uav-01"] },
    GPS_SPOOF_MID_MISSION.steps
  );
  // 6 steps emitted
  assert.equal(trace.steps.length, 6);
  // The two early evaluates are ALLOW
  assert.equal(payload(trace.steps[2]).decision, "ALLOW");
  assert.equal(payload(trace.steps[3]).decision, "ALLOW");
  // The spoof step is REFUSE with SUBJECT_MISMATCH
  const spoof = payload(trace.steps[4]);
  assert.equal(spoof.decision, "REFUSE");
  assert.ok((spoof.reason_codes as string[]).includes("SUBJECT_MISMATCH"));
  // Legit eval after spoof is ALLOW again
  assert.equal(payload(trace.steps[5]).decision, "ALLOW");
});

test("FLASH_REVOCATION: evaluate after revoke is ENVELOPE_REVOKED", async () => {
  const trace = await runScenario(
    { scenarioId: "flash-revoke", edgeIds: ["agent-01"] },
    FLASH_REVOCATION.steps
  );
  assert.equal(trace.steps.length, 5);
  // pre-revoke evaluate is ALLOW
  assert.equal(payload(trace.steps[2]).decision, "ALLOW");
  // revoke step succeeds
  assert.ok(payload(trace.steps[3]).revocation_id);
  // post-revoke evaluate is REFUSE / ENVELOPE_REVOKED
  const post = payload(trace.steps[4]);
  assert.equal(post.decision, "REFUSE");
  assert.ok((post.reason_codes as string[]).includes("ENVELOPE_REVOKED"));
});

test("PARTITION_RECONCILE: partitioned ALLOWs reconcile cleanly with no conflicts", async () => {
  const trace = await runScenario(
    { scenarioId: "partition-reconcile", edgeIds: ["edge-01"] },
    PARTITION_RECONCILE.steps
  );
  // 9 steps emitted
  assert.equal(trace.steps.length, 9);
  // Steps 4 and 5 are ALLOWs under Fluidity Token
  assert.equal(payload(trace.steps[4]).decision, "ALLOW");
  assert.equal(payload(trace.steps[5]).decision, "ALLOW");
  // Reconcile step (index 8) reports zero conflicts (no revocations
  // happened in this scenario).
  const recon = payload(trace.steps[8]);
  assert.equal(recon.conflicts, 0);
});

test("trace metadata: scenario_id, started_at, finished_at all populated", async () => {
  const trace = await runScenario(
    { scenarioId: "meta-test", edgeIds: ["e"] },
    [{ kind: "wait", ms: 10 }]
  );
  assert.equal(trace.scenario_id, "meta-test");
  assert.ok(trace.started_at);
  assert.ok(trace.finished_at);
  assert.ok(Date.parse(trace.finished_at) >= Date.parse(trace.started_at));
});

test("evaluate against missing envelope returns UNKNOWN_ENVELOPE", async () => {
  const trace = await runScenario(
    { scenarioId: "no-env", edgeIds: ["e1"] },
    [{ kind: "evaluate", edgeId: "e1", actionType: "x.do" }]
  );
  const d = payload(trace.steps[0]);
  assert.equal(d.decision, "REFUSE");
  assert.ok((d.reason_codes as string[]).includes("UNKNOWN_ENVELOPE"));
});

test("unknown edge in evaluate marks step !ok with error", async () => {
  const trace = await runScenario(
    { scenarioId: "no-edge", edgeIds: ["other"] },
    [{ kind: "evaluate", edgeId: "missing", actionType: "x.do" }]
  );
  assert.equal(trace.steps[0].ok, false);
  assert.equal(payload(trace.steps[0]).error, "unknown-edge");
});
