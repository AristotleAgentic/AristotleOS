import test from "node:test";
import assert from "node:assert/strict";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Agent-OS task lifecycle smoke tests.
 *
 * Agent-OS depends on governance-kernel + evidence-ledger +
 * execution-gate for live cross-service flows (kill-switch checks,
 * GEL appends, etc.). For stage 1 we exercise only routes that
 * write local state without requiring those downstreams:
 *
 *   (1) /missions POST creates a mission + workspace + tool leases
 *       and auto-generates mission steps from the requiredTools.
 *       State persists in the running service. Handler returns 201
 *       with shape { mission, workspace, leases }.
 *   (2) /missions GET lists the created missions back as
 *       { items: [...] }.
 *
 * Routes that DO call downstreams (claim/dispatch/execute/conclude)
 * are deferred to stage 2 where the harness will stub the
 * downstream HTTP endpoints with a tiny mock server.
 *
 * Companion to governance-chain-client.test.ts, which exercises the
 * /v2 chain client against a stubbed kernel. This file covers the
 * legacy mission-creation surface end-to-end.
 *
 * No production code is modified by this suite.
 */

test("POST /missions creates a mission and persists in /missions list", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const create = await svc.post("/missions", {
      title: "Test mission",
      objective: "Smoke-test the mission creation path",
      priority: "medium",
      assignedAgents: ["agent-planner", "agent-executor"],
      requiredTools: ["editor", "ledger"]
    });
    assert.equal(create.status, 201);
    assert.ok(create.body.mission, "response must include the created mission");
    assert.ok(create.body.mission.id, "mission.id must be present");
    assert.equal(create.body.mission.title, "Test mission");
    assert.equal(create.body.mission.objective, "Smoke-test the mission creation path");
    assert.equal(create.body.mission.priority, "medium");
    assert.deepEqual(create.body.mission.assignedAgents, ["agent-planner", "agent-executor"]);
    assert.ok(Array.isArray(create.body.mission.steps) && create.body.mission.steps.length > 0,
      "POST /missions must auto-generate mission steps");
    // Side-effects: a workspace + tool leases are also created.
    assert.ok(create.body.workspace?.id, "workspace must be created alongside the mission");
    assert.equal(create.body.workspace.missionId, create.body.mission.id);
    assert.ok(Array.isArray(create.body.leases) && create.body.leases.length > 0,
      "tool leases must be issued for the required tools");
  } finally { await svc.stop(); }
});

test("GET /missions lists missions created via POST", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const a = await svc.post("/missions", { title: "Mission Alpha", objective: "first" });
    const b = await svc.post("/missions", { title: "Mission Beta",  objective: "second" });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const list = await svc.get("/missions");
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.items));
    const ids = list.body.items.map((m) => m.id);
    assert.ok(ids.includes(a.body.mission.id), "list must include first mission");
    assert.ok(ids.includes(b.body.mission.id), "list must include second mission");
  } finally { await svc.stop(); }
});
