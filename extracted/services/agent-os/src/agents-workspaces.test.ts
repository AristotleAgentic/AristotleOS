import test from "node:test";
import assert from "node:assert/strict";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Agent-OS /agents/register + /workspaces creation tests.
 *
 * Both routes are simple self-contained handlers (no downstream
 * calls, no governance gate, no kill-switch evaluation) — just
 * data-shaping + state-Map insertion + schedulePersist. They had
 * no service-level test coverage before. THIS file pins their
 * response shapes + default values + Map insertion so a future
 * stage can extract them to src/routes/agents.ts and
 * src/routes/workspaces.ts under green tests.
 *
 * Coverage:
 *   (1) POST /agents/register with minimal body → 201 + agent
 *       with documented defaults (status='ready', trustTier=
 *       'sandboxed', maxConcurrency=1, verificationStatus=
 *       'verified', identityFingerprint defaulting to the
 *       fingerprint helper's slug form)
 *   (2) POST /agents/register with explicit fields → 201 + every
 *       field round-trips verbatim; agent appears in /state.agents
 *   (3) POST /workspaces with minimal body → 201 + workspace
 *       with documented defaults (state='prepared',
 *       missionId='unassigned', verificationStatus='verified',
 *       branchName auto-generated)
 *   (4) POST /workspaces with explicit fields → 201 + every
 *       field round-trips; workspace appears in /state.workspaces
 *
 * Auto-isolated state path (stage 11 harness change) means these
 * tests start from a clean slate and don't pollute siblings.
 *
 * No production code is modified.
 */

test("POST /agents/register with minimal body returns 201 with documented defaults", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const r = await svc.post("/agents/register", { id: "agent-test-minimal" });
    assert.equal(r.status, 201);
    assert.equal(r.body.id, "agent-test-minimal");
    assert.equal(r.body.name, "Unnamed Agent");
    assert.equal(r.body.role, "executor");
    assert.equal(r.body.status, "ready");
    assert.equal(r.body.model, "unknown");
    assert.equal(r.body.provider, "unknown");
    assert.equal(r.body.trustTier, "sandboxed");
    assert.equal(r.body.maxConcurrency, 1);
    assert.equal(r.body.verificationStatus, "verified");
    assert.deepEqual(r.body.specializations, []);
    assert.deepEqual(r.body.toolchains, []);
    // identityFingerprint default uses fingerprint('agentfp', body.id)
    assert.equal(r.body.identityFingerprint, "agentfp-agent-test-minimal",
      `identityFingerprint default must match the agentfp- slug of the id`);
    assert.equal(typeof r.body.lastHeartbeat, "string");
  } finally { await svc.stop(); }
});

test("POST /agents/register with explicit fields preserves them and lists agent in /state", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const create = await svc.post("/agents/register", {
      id: "agent-custom",
      name: "Custom Agent",
      role: "planner",
      status: "ready",
      model: "gpt-5.4-mini",
      provider: "anthropic",
      specializations: ["risk discovery"],
      toolchains: ["docs"],
      trustTier: "privileged",
      maxConcurrency: 8,
      workspaceAffinity: "repo",
      deviceId: "device-custom-1",
      identityFingerprint: "agentfp-custom-override",
      verificationStatus: "verified"
    });
    assert.equal(create.status, 201);
    assert.equal(create.body.role, "planner");
    assert.equal(create.body.model, "gpt-5.4-mini");
    assert.equal(create.body.provider, "anthropic");
    assert.deepEqual(create.body.specializations, ["risk discovery"]);
    assert.deepEqual(create.body.toolchains, ["docs"]);
    assert.equal(create.body.trustTier, "privileged");
    assert.equal(create.body.maxConcurrency, 8);
    assert.equal(create.body.workspaceAffinity, "repo");
    assert.equal(create.body.deviceId, "device-custom-1");
    assert.equal(create.body.identityFingerprint, "agentfp-custom-override",
      "explicit identityFingerprint must override the auto-slug default");

    // Round-trip: agent appears in /state.agents
    const state = await svc.get("/state");
    const agentIds = (state.body.agents ?? []).map((a) => a.id);
    assert.ok(agentIds.includes("agent-custom"),
      `expected agent-custom in /state.agents, got ${JSON.stringify(agentIds)}`);
  } finally { await svc.stop(); }
});

test("POST /workspaces with minimal body returns 201 with documented defaults", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const r = await svc.post("/workspaces", { id: "ws-test-minimal" });
    assert.equal(r.status, 201);
    assert.equal(r.body.id, "ws-test-minimal");
    assert.equal(r.body.missionId, "unassigned");
    assert.equal(r.body.state, "prepared");
    assert.equal(r.body.cwd, "/workspace");
    assert.equal(r.body.branchName, "codex/mission",
      `branchName default uses 'codex/<missionId>' with missionId fallback 'mission'`);
    assert.equal(r.body.memoryNamespace, "mission.shared");
    assert.deepEqual(r.body.attachedAgents, []);
    assert.equal(r.body.verificationStatus, "verified");
    // deviceFingerprint default uses fingerprint('devicefp', body.id)
    assert.equal(r.body.deviceFingerprint, "devicefp-ws-test-minimal");
    assert.equal(typeof r.body.createdAt, "string");
    assert.equal(typeof r.body.lastActiveAt, "string");
  } finally { await svc.stop(); }
});

test("POST /workspaces with explicit fields preserves them and lists workspace in /state", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const create = await svc.post("/workspaces", {
      id: "ws-custom",
      missionId: "mission-foo",
      state: "active",
      cwd: "/srv/repo",
      branchName: "feature/explicit",
      memoryNamespace: "team.shared",
      attachedAgents: ["agent-planner", "agent-executor"],
      deviceFingerprint: "devicefp-custom-override",
      verificationStatus: "verified"
    });
    assert.equal(create.status, 201);
    assert.equal(create.body.missionId, "mission-foo");
    assert.equal(create.body.state, "active");
    assert.equal(create.body.cwd, "/srv/repo");
    assert.equal(create.body.branchName, "feature/explicit");
    assert.equal(create.body.memoryNamespace, "team.shared");
    assert.deepEqual(create.body.attachedAgents, ["agent-planner", "agent-executor"]);
    assert.equal(create.body.deviceFingerprint, "devicefp-custom-override",
      "explicit deviceFingerprint must override the auto-slug default");

    // Round-trip: workspace appears in /state.workspaces
    const state = await svc.get("/state");
    const workspaceIds = (state.body.workspaces ?? []).map((w) => w.id);
    assert.ok(workspaceIds.includes("ws-custom"),
      `expected ws-custom in /state.workspaces, got ${JSON.stringify(workspaceIds)}`);
  } finally { await svc.stop(); }
});
