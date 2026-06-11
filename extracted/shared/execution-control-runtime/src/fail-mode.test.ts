import test from "node:test";
import assert from "node:assert/strict";
import { type DegradationCondition, DEFAULT_CRITICALITY, failModeBlocks, resolveFailMode } from "./fail-mode.js";

test("no degradation conditions resolve to allow", () => {
  assert.equal(resolveFailMode("safety_critical", []).action, "allow");
  assert.equal(resolveFailMode("best_effort", undefined).action, "allow");
});

test("safety-critical fails closed on every condition", () => {
  for (const c of ["ledger_unavailable", "control_plane_stale", "quorum_lost", "dependency_timeout"] as DegradationCondition[]) {
    const r = resolveFailMode("safety_critical", [c]);
    assert.equal(r.action, "refuse", `safety_critical + ${c}`);
    assert.equal(failModeBlocks(r), true);
  }
});

test("mission-critical refuses on infra loss but escalates a soft timeout", () => {
  assert.equal(resolveFailMode("mission_critical", ["ledger_unavailable"]).action, "refuse");
  assert.equal(resolveFailMode("mission_critical", ["quorum_lost"]).action, "refuse");
  assert.equal(resolveFailMode("mission_critical", ["dependency_timeout"]).action, "escalate");
});

test("routine escalates infra loss, allows a degraded soft timeout", () => {
  assert.equal(resolveFailMode("routine", ["ledger_unavailable"]).action, "escalate");
  assert.equal(resolveFailMode("routine", ["dependency_timeout"]).action, "allow_degraded");
});

test("best-effort proceeds degraded but still escalates split-brain (quorum_lost)", () => {
  assert.equal(resolveFailMode("best_effort", ["ledger_unavailable"]).action, "allow_degraded");
  assert.equal(resolveFailMode("best_effort", ["quorum_lost"]).action, "escalate");
});

test("the most-restrictive active condition wins", () => {
  const r = resolveFailMode("routine", ["dependency_timeout", "ledger_unavailable"]);
  assert.equal(r.action, "escalate"); // escalate (ledger) beats allow_degraded (timeout)
  assert.equal(r.condition, "ledger_unavailable");
});

test("an unlabeled Ward defaults to mission-critical (fails closed on infra loss)", () => {
  assert.equal(DEFAULT_CRITICALITY, "mission_critical");
  assert.equal(resolveFailMode(undefined, ["ledger_unavailable"]).action, "refuse");
});

test("an unknown degradation condition fails closed", () => {
  const r = resolveFailMode("best_effort", ["meteor_strike" as DegradationCondition]);
  assert.equal(r.action, "refuse");
});

test("failModeBlocks is true only for refuse/escalate", () => {
  assert.equal(failModeBlocks({ action: "allow", criticality: "routine" }), false);
  assert.equal(failModeBlocks({ action: "allow_degraded", criticality: "routine" }), false);
  assert.equal(failModeBlocks({ action: "escalate", criticality: "routine" }), true);
  assert.equal(failModeBlocks({ action: "refuse", criticality: "routine" }), true);
});
