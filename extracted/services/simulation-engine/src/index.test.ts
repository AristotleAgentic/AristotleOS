import test from "node:test";
import assert from "node:assert/strict";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Simulation-engine telemetry + chaos-harness routes.
 *
 * The simulation-engine exposes the @aristotle/chaos-harness scenario
 * runners over HTTP so operator UIs can stress-test the substrate.
 * The library-level chaos tests already prove each scenario's
 * deterministic behavior; this file proves the SERVICE-level wiring
 * — the right scenarios are exposed, /run/:name maps name → runner,
 * and unknown names fail closed with 404.
 *
 * Coverage:
 *   (1) /health surfaces an integer tick + ok=true
 *   (2) /telemetry lists exactly the 3 mesh nodes (alpha/beta/gamma)
 *       with mesh.gamma defaulting to degraded
 *   (3) /degrade replaces the degraded-nodes list
 *   (4) /v1/chaos/scenarios lists all 10 deterministic scenarios
 *       with the documented names
 *   (5) /v1/chaos/run/<name> on a known scenario returns ok=true +
 *       scorecard + duration_ms (run the smallest scenario to keep
 *       the test fast — replay_attempt)
 *   (6) /v1/chaos/run/unknown returns 404 unknown_scenario
 *   (7) /counterfactual on a degraded primary relay reports
 *       projectedOutcome=reroute + projectedRoute.mode=degraded
 *   (8) /counterfactual with injectKillSwitch=true reports
 *       projectedOutcome=halt + recovery paths include "Clear sovereign halt"
 *
 * No production code is modified.
 */

const EXPECTED_SCENARIOS = [
  "revocation_lag",
  "malicious_envelope",
  "hallucinated_command",
  "fluidity_ttl_expiry",
  "quota_exhaustion",
  "replay_attempt",
  "clock_skew",
  "witness_flap",
  "gossip_storm",
  "envelope_version_downgrade"
];

test("/health returns ok=true and an integer tick counter", async () => {
  const svc = await startService("simulation-engine");
  try {
    const { status, body } = await svc.get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "simulation-engine");
    assert.equal(Number.isInteger(body.tick), true, `tick must be an integer, got ${body.tick}`);
  } finally { await svc.stop(); }
});

test("/telemetry lists exactly the 3 mesh nodes; mesh.gamma defaults to degraded", async () => {
  const svc = await startService("simulation-engine");
  try {
    const { status, body } = await svc.get("/telemetry");
    assert.equal(status, 200);
    assert.equal(body.nodes.length, 3);
    const byId = Object.fromEntries(body.nodes.map((n) => [n.id, n]));
    assert.equal(byId["mesh.alpha"]?.status, "healthy");
    assert.equal(byId["mesh.beta"]?.status, "healthy");
    assert.equal(byId["mesh.gamma"]?.status, "degraded",
      "mesh.gamma is the documented default-degraded node");
  } finally { await svc.stop(); }
});

test("/degrade replaces the degraded-nodes list", async () => {
  const svc = await startService("simulation-engine");
  try {
    const r = await svc.post("/degrade", { nodes: ["mesh.alpha", "mesh.beta"] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.degradedNodes, ["mesh.alpha", "mesh.beta"]);

    // Confirm /telemetry reflects the new state
    const tele = await svc.get("/telemetry");
    const byId = Object.fromEntries(tele.body.nodes.map((n) => [n.id, n]));
    assert.equal(byId["mesh.alpha"]?.status, "degraded");
    assert.equal(byId["mesh.beta"]?.status, "degraded");
    assert.equal(byId["mesh.gamma"]?.status, "healthy",
      "mesh.gamma must be back to healthy because /degrade replaces (not unions)");
  } finally { await svc.stop(); }
});

test("/v1/chaos/scenarios lists all 10 documented chaos-harness scenarios", async () => {
  const svc = await startService("simulation-engine");
  try {
    const { status, body } = await svc.get("/v1/chaos/scenarios");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.count, EXPECTED_SCENARIOS.length);
    const names = body.scenarios.map((s) => s.name);
    for (const expected of EXPECTED_SCENARIOS) {
      assert.ok(names.includes(expected), `missing scenario "${expected}", got ${JSON.stringify(names)}`);
    }
  } finally { await svc.stop(); }
});

test("/v1/chaos/run/replay_attempt returns ok=true + scorecard + duration_ms", async () => {
  // Increased timeout because a chaos scenario does real work.
  const svc = await startService("simulation-engine", { readyTimeoutMs: 15_000 });
  try {
    const r = await svc.post("/v1/chaos/run/replay_attempt", {});
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true, `chaos run failed: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.scenario, "replay_attempt");
    assert.equal(typeof r.body.duration_ms, "number");
    assert.ok(r.body.scorecard, "scorecard must be present");
    assert.equal(r.body.scorecard.scenario, "replay_attempt");
    assert.equal(typeof r.body.scorecard.passed, "boolean");
  } finally { await svc.stop(); }
});

test("/v1/chaos/run/unknown_scenario returns 404 unknown_scenario", async () => {
  const svc = await startService("simulation-engine");
  try {
    const r = await svc.post("/v1/chaos/run/this_scenario_does_not_exist", {});
    assert.equal(r.status, 404);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "unknown_scenario");
  } finally { await svc.stop(); }
});

test("/counterfactual on a degraded primary relay reports projectedOutcome=reroute, mode=degraded", async () => {
  const svc = await startService("simulation-engine");
  try {
    const r = await svc.post("/counterfactual", {
      degradedNodes: ["mesh.alpha"],
      route: {
        source: "node-source",
        target: "node-target",
        selectedPath: ["node-source", "mesh.alpha", "node-target"],
        rejectedPath: ["node-source", "mesh.delta", "node-target"],
        authorityAnchor: "anchor-primary",
        alternateAuthorityAnchor: "anchor-secondary"
      }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.hypothetical, true);
    assert.equal(r.body.projectedOutcome, "reroute");
    assert.equal(r.body.projectedRoute?.mode, "degraded");
    assert.equal(r.body.projectedRoute?.continuity, "degraded");
    assert.equal(r.body.projectedRoute?.recoverable, true);
  } finally { await svc.stop(); }
});

test("/counterfactual with injectKillSwitch=true reports projectedOutcome=halt + sovereign-halt recovery path", async () => {
  const svc = await startService("simulation-engine");
  try {
    const r = await svc.post("/counterfactual", {
      injectKillSwitch: true,
      scope: "mission",
      scopeRef: "mission-x",
      route: {
        source: "node-source",
        target: "node-target",
        selectedPath: ["node-source", "mesh.alpha", "node-target"],
        rejectedPath: ["node-source", "mesh.delta", "node-target"]
      }
    });
    assert.equal(r.body.projectedOutcome, "halt");
    const recoveryLabels = r.body.projectedRecoveryPaths.map((p) => p.label);
    assert.ok(recoveryLabels.includes("Clear sovereign halt"));
    assert.ok(recoveryLabels.includes("Escalate for constitutional review"));
  } finally { await svc.stop(); }
});
