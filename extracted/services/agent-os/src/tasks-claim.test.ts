import test from "node:test";
import assert from "node:assert/strict";
import { freePort, startService, startMockService } from "../../../tests/_harness.mjs";

/**
 * Agent-OS happy-path tests for the FULL governance dispatch chain.
 *
 * Stage 9 mocked the downstream services with permissive defaults
 * (so /missions/:id/advance seeded tasks but the actual dispatch
 * call always fell through to a 'blocked' governance status). THIS
 * file fills in the rest of the chain — policy-compiler /compile,
 * governance-kernel /validate-envelope + /evaluate-admissibility +
 * /issue-warrant, authority-router /route, execution-gate /commit-point
 * — with shapes the agent-os call sites actually parse correctly.
 *
 * What's pinned:
 *
 *   (1) End-to-end happy chain: with every downstream returning a
 *       documented success shape, /missions/:id/advance with
 *       action='execute' seeds 3 tasks AND successfully dispatches
 *       the context task. The dispatched task lands in 'running'
 *       state with execution.claimedBy set to the agent the
 *       handler chose. Ledger receives queue.created + at least
 *       one task-dispatched/claimed event.
 *
 *   (2) /tasks/:id/claim refuses an already-running task with
 *       409 task_not_eligible — proves the eligibility-gate
 *       envelope shape that any future refactor of the claim
 *       handler (e.g. extraction to src/routes/tasks.ts) MUST
 *       preserve.
 *
 *   (3) Downstream-call attribution: the gate's mock records the
 *       /commit-point call, and we assert the agent-os payload
 *       (phase, targetType, missionId, agentId) — proving the
 *       call-construction code in assessTaskGovernance hasn't
 *       silently drifted.
 *
 * What's NOT pinned (and why):
 *   The literal POST /tasks/<queued-id>/claim happy path requires
 *   a queued task whose dependencies are met AND whose governance
 *   is NOT already cached on the task (the cache is set by the
 *   dispatch path). Constructing that state from the public API
 *   surface alone is awkward; for the value it adds over (1) +
 *   (2), it can wait for a stage that needs it.
 *
 * No production code is modified.
 */

const FAR_FUTURE_MS = "600000";

/**
 * Spin up the full kernel-aware downstream stack for happy-path tests.
 * Returns each mock so the test can inspect calls[] and the agent-os
 * service handle. stopAll() must be awaited in finally.
 */
async function startAgentOsHappyStack(opts = {}) {
  // policy-compiler: /compile always returns a valid compile
  const compiler = await startMockService({
    "POST /compile": ({ body }) => ({
      status: 200,
      body: { valid: true, compileId: `compile-${(body?.policyName ?? "x").slice(0, 12)}`, errors: [] }
    }),
    ...(opts.compilerRoutes ?? {})
  });
  // governance-kernel: all routes used by assessTaskGovernance + the
  // periodic kill-switch poll. envelope ids embed the issuer so the
  // ledger trail is differentiable across calls.
  const kernel = await startMockService({
    "GET /health": { status: 200, body: { ok: true, killSwitchState: "inactive", activeKillScopes: [] } },
    "POST /validate-envelope": ({ body }) => ({
      status: 200,
      body: { allowed: true, envelope: { id: `env-${(body?.issuer ?? "x").slice(0, 16)}` } }
    }),
    "POST /evaluate-admissibility": { status: 200, body: { admissible: true, reasons: [] } },
    "POST /issue-warrant": ({ body }) => ({
      status: 201,
      body: { id: `war-${(body?.missionId ?? "x").slice(0, 16)}`, artifactType: "execution-warrant" }
    }),
    ...(opts.kernelRoutes ?? {})
  });
  // authority-router: /route returns a stable nominal route (not degraded)
  const router = await startMockService({
    "POST /route": ({ body }) => ({
      status: 200,
      body: {
        source: body?.source ?? "src",
        target: body?.target ?? "tgt",
        selectedPath: [body?.source ?? "src", "mesh.alpha", body?.target ?? "tgt"],
        rejectedPath: [body?.source ?? "src", "mesh.delta", body?.target ?? "tgt"],
        continuity: "stable",
        mode: "nominal",
        authorityAnchor: body?.source ?? "src",
        recoverable: false
      }
    }),
    ...(opts.routerRoutes ?? {})
  });
  // execution-gate: /commit-point ALLOWs everything; /health for the poll.
  const gate = await startMockService({
    "GET /health": { status: 200, body: { ok: true, killSwitchState: "inactive", activeKillScopes: [] } },
    "POST /commit-point": ({ body }) => ({
      status: 200,
      body: {
        id: `dec-${(body?.warrantId ?? "x").slice(0, 16)}`,
        decision: "allow",
        reasons: ["mocked allow"],
        killSwitchState: "inactive"
      }
    }),
    "POST /decide": { status: 200, body: { id: "dec-decide", decision: "allow", reasons: ["mocked allow"] } },
    ...(opts.gateRoutes ?? {})
  });
  // evidence-ledger: /events/commit records every event
  const ledger = await startMockService({
    "POST /events/commit": ({ body }) => ({
      status: 201,
      body: { index: ledger.calls.filter((c) => c.path === "/events/commit").length, event: body }
    }),
    ...(opts.ledgerRoutes ?? {})
  });
  // witness-service: /verify always accepts
  const witness = await startMockService({
    "POST /verify": { status: 200, body: { accepted: true, quorumReached: 2, quorumRequired: 2, verification: { status: "verified" } } },
    ...(opts.witnessRoutes ?? {})
  });
  // simulation-engine: /telemetry returns no degraded nodes
  const sim = await startMockService({
    "GET /telemetry": { status: 200, body: { nodes: [{ id: "mesh.alpha", status: "healthy" }, { id: "mesh.beta", status: "healthy" }] } },
    ...(opts.simRoutes ?? {})
  });

  const port = await freePort();
  const svc = await startService("agent-os", {
    port,
    readyTimeoutMs: 15_000,
    env: {
      AGENT_OS_AUTONOMY_TICK_MS: FAR_FUTURE_MS,
      AGENT_OS_KILL_SWITCH_CACHE_MS: FAR_FUTURE_MS,
      HOST_POLICY_COMPILER:   "127.0.0.1", PORT_POLICY_COMPILER:   String(compiler.port),
      HOST_GOVERNANCE_KERNEL: "127.0.0.1", PORT_GOVERNANCE_KERNEL: String(kernel.port),
      HOST_AUTHORITY_ROUTER:  "127.0.0.1", PORT_AUTHORITY_ROUTER:  String(router.port),
      HOST_EXECUTION_GATE:    "127.0.0.1", PORT_EXECUTION_GATE:    String(gate.port),
      HOST_EVIDENCE_LEDGER:   "127.0.0.1", PORT_EVIDENCE_LEDGER:   String(ledger.port),
      HOST_WITNESS_SERVICE:   "127.0.0.1", PORT_WITNESS_SERVICE:   String(witness.port),
      HOST_SIMULATION_ENGINE: "127.0.0.1", PORT_SIMULATION_ENGINE: String(sim.port)
    }
  });

  return {
    svc, compiler, kernel, router, gate, ledger, witness, sim,
    async stopAll() {
      await svc.stop();
      await Promise.all([compiler, kernel, router, gate, ledger, witness, sim].map((m) => m.stop()));
    }
  };
}

test("end-to-end: /missions/:id/advance with full happy mocks dispatches the context task to running", async () => {
  const stack = await startAgentOsHappyStack();
  try {
    const { svc, ledger, gate, kernel } = stack;

    const mission = await svc.post("/missions", {
      title: "Happy-chain test",
      objective: "Exercise dispatch end-to-end",
      assignedAgents: ["agent-planner", "agent-executor", "agent-auditor"],
      requiredTools: ["editor", "ledger"]
    });
    assert.equal(mission.status, 201);
    const missionId = mission.body.mission.id;

    const advance = await svc.post(`/missions/${missionId}/advance`, { action: "execute" });
    assert.equal(advance.status, 200);

    const state = await svc.get("/state");
    const tasks = (state.body.executionTasks ?? []).filter((t) => t.missionId === missionId);
    assert.equal(tasks.length, 3, `expected 3 seeded tasks, got ${tasks.length}`);

    // With the full happy chain, at least one task must reach 'running'.
    // (The other two are dependent and stay queued until the first completes.)
    const runningTasks = tasks.filter((t) => t.status === "running");
    assert.ok(runningTasks.length >= 1,
      `expected at least one task to be dispatched/running with full happy mocks, got statuses: ${JSON.stringify(tasks.map((t) => ({ id: t.id, status: t.status })))}`);
    const dispatched = runningTasks[0];
    assert.ok(dispatched.execution?.claimedBy,
      `dispatched task must have execution.claimedBy set, got: ${JSON.stringify(dispatched.execution)}`);

    // Kernel was actually called along the dispatch path
    const validateCalls = kernel.calls.filter((c) => c.path === "/validate-envelope");
    assert.ok(validateCalls.length >= 1, "kernel /validate-envelope must be called at least once during dispatch");
    const warrantCalls = kernel.calls.filter((c) => c.path === "/issue-warrant");
    assert.ok(warrantCalls.length >= 1, "kernel /issue-warrant must be called");

    // Gate received the commit-point call with the right attribution
    const commitCalls = gate.calls.filter((c) => c.path === "/commit-point");
    assert.ok(commitCalls.length >= 1, "gate /commit-point must be called");
    const commitBody = commitCalls[0].body;
    assert.equal(commitBody.phase, "dispatch", "commit-point phase must be 'dispatch' on the dispatch path");
    assert.equal(commitBody.targetType, "task");
    assert.equal(commitBody.missionId, missionId);
    assert.ok(typeof commitBody.warrantId === "string" && commitBody.warrantId.startsWith("war-"),
      `commit-point must reference the warrant id issued by the kernel, got ${commitBody.warrantId}`);

    // Ledger has both queue.created and at least one dispatch/claim event
    const ledgerEvents = ledger.calls.filter((c) => c.path === "/events/commit").map((c) => c.body?.eventKind);
    assert.ok(ledgerEvents.includes("agent-os.execution.queue.created"));
    assert.ok(
      ledgerEvents.some((e) => typeof e === "string" && /agent-os\.execution\.task/.test(e)),
      `ledger must receive at least one agent-os.execution.task.* event, got ${JSON.stringify(ledgerEvents)}`
    );
  } finally { await stack.stopAll(); }
});

test("/tasks/<running-id>/claim returns 409 task_not_eligible (already-claimed envelope)", async () => {
  const stack = await startAgentOsHappyStack();
  try {
    const { svc } = stack;
    const mission = await svc.post("/missions", { title: "Re-claim test", objective: "reject claim on running task" });
    const missionId = mission.body.mission.id;

    await svc.post(`/missions/${missionId}/advance`, { action: "execute" });

    const state = await svc.get("/state");
    const tasks = (state.body.executionTasks ?? []).filter((t) => t.missionId === missionId);
    const runningTask = tasks.find((t) => t.status === "running");
    assert.ok(runningTask, `expected a running task; got ${JSON.stringify(tasks.map((t) => t.status))}`);

    // Try to claim the already-running task. eligibility should refuse it
    // with task_not_eligible — the canonical 409 envelope future refactors
    // of the claim handler MUST preserve.
    const reclaim = await svc.post(`/tasks/${runningTask.id}/claim`,
      { agentId: runningTask.assignedAgentId });
    assert.equal(reclaim.status, 409,
      `expected 409 task_not_eligible on already-running task, got ${reclaim.status}: ${JSON.stringify(reclaim.body)}`);
    assert.equal(reclaim.body.error, "task_not_eligible");
    assert.ok(Array.isArray(reclaim.body.reasons) && reclaim.body.reasons.length > 0,
      "task_not_eligible response must carry a non-empty reasons[] array");
    assert.ok(reclaim.body.reasons.some((r) => /not claimable|status running/i.test(r)),
      `eligibility reasons must mention the unclaimable status, got ${JSON.stringify(reclaim.body.reasons)}`);
    assert.ok(reclaim.body.task, "task_not_eligible response must carry the task in body.task");
  } finally { await stack.stopAll(); }
});
