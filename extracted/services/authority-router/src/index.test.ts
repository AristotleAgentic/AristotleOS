import test from "node:test";
import assert from "node:assert/strict";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Authority-router /route + /v1/mesh/route behavioral tests.
 *
 * /route is a pure-function decision tree over (domain, phase,
 * riskLevel, degradedNodes, requiredAuthorities). It returns the
 * selected relay path, the rejected alternate, and a continuity
 * mode (nominal | degraded | disconnected). These tests pin the
 * core decision branches that operators rely on:
 *
 *   - safety domain  → mesh.delta
 *   - high risk      → mesh.delta (same escalation lane as safety)
 *   - completion     → mesh.gamma
 *   - tool-action    → mesh.beta
 *   - mission/dispatch/medium → mesh.alpha (the default lane)
 *   - primary relay degraded → continuity=degraded, alternate selected
 *   - primary + alternate both degraded → continuity=disconnected,
 *     selectedPath is empty, mode="disconnected"
 *
 * /v1/mesh/route uses the real StaticSovereignRouter (mesh-runtime).
 * Tests cover: is_local for the configured local MAE, 400 on a
 * missing mae_id.
 *
 * No production code is modified.
 */

test("/health surfaces readiness with trust anchor count", async () => {
  const svc = await startService("authority-router");
  try {
    const { status, body } = await svc.get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "authority-router");
  } finally { await svc.stop(); }
});

test("/route picks mesh.alpha for the default mission/dispatch/medium lane", async () => {
  const svc = await startService("authority-router");
  try {
    const { status, body } = await svc.post("/route", {
      source: "node-source",
      target: "node-target"
      // domain=mission, phase=dispatch, riskLevel=medium — all defaults
    });
    assert.equal(status, 200);
    assert.deepEqual(body.selectedPath, ["node-source", "mesh.alpha", "node-target"]);
    assert.equal(body.continuity, "stable");
    assert.equal(body.mode, "nominal");
    assert.equal(body.recoverable, false);
  } finally { await svc.stop(); }
});

test("/route escalates safety domain to mesh.delta", async () => {
  const svc = await startService("authority-router");
  try {
    const { body } = await svc.post("/route", {
      source: "node-source",
      target: "node-target",
      domain: "safety"
    });
    assert.equal(body.selectedPath[1], "mesh.delta", "safety domain must route via mesh.delta");
    assert.equal(body.continuity, "stable");
  } finally { await svc.stop(); }
});

test("/route escalates riskLevel=high to mesh.delta even when domain is mission", async () => {
  const svc = await startService("authority-router");
  try {
    const { body } = await svc.post("/route", {
      source: "node-source",
      target: "node-target",
      domain: "mission",
      riskLevel: "high"
    });
    assert.equal(body.selectedPath[1], "mesh.delta", "high risk must escalate to mesh.delta");
  } finally { await svc.stop(); }
});

test("/route routes completion phase via mesh.gamma and tool-action via mesh.beta", async () => {
  const svc = await startService("authority-router");
  try {
    const completion = await svc.post("/route", { source: "s", target: "t", phase: "completion" });
    assert.equal(completion.body.selectedPath[1], "mesh.gamma");
    const tool = await svc.post("/route", { source: "s", target: "t", phase: "tool-action" });
    assert.equal(tool.body.selectedPath[1], "mesh.beta");
  } finally { await svc.stop(); }
});

test("/route reports degraded continuity when the primary relay is in degradedNodes", async () => {
  const svc = await startService("authority-router");
  try {
    // mesh.alpha is the primary for mission/dispatch/medium; mesh.delta is the
    // configured failover for non-safety lanes.
    const { body } = await svc.post("/route", {
      source: "node-source",
      target: "node-target",
      degradedNodes: ["mesh.alpha"]
    });
    assert.equal(body.continuity, "degraded");
    assert.equal(body.mode, "degraded");
    assert.equal(body.recoverable, true);
    assert.equal(body.selectedPath[1], "mesh.delta", "must reroute via failover relay");
  } finally { await svc.stop(); }
});

test("/route reports disconnected when both primary and failover relays are degraded", async () => {
  const svc = await startService("authority-router");
  try {
    const { body } = await svc.post("/route", {
      source: "node-source",
      target: "node-target",
      degradedNodes: ["mesh.alpha", "mesh.delta"]
    });
    assert.equal(body.continuity, "disconnected");
    assert.equal(body.mode, "disconnected");
    assert.deepEqual(body.selectedPath, [], "no admissible path must yield an empty selectedPath");
  } finally { await svc.stop(); }
});

test("/v1/mesh/route returns is_local=true for the configured local MAE", async () => {
  const svc = await startService("authority-router", {
    env: { MESH_LOCAL_MAE_ID: "mae.test.local" }
  });
  try {
    const { status, body } = await svc.post("/v1/mesh/route", { mae_id: "mae.test.local" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.is_local, true);
    assert.equal(body.mae_id, "mae.test.local");
  } finally { await svc.stop(); }
});

test("/v1/mesh/route returns 400 on missing mae_id", async () => {
  const svc = await startService("authority-router");
  try {
    const { status, body } = await svc.post("/v1/mesh/route", {});
    assert.equal(status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error, "missing_mae_id");
  } finally { await svc.stop(); }
});
