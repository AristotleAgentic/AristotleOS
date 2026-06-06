import test from "node:test";
import assert from "node:assert/strict";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Agent-OS task-lifecycle early-return guard tests.
 *
 * Stage 1 deferred the task-lifecycle routes (/tasks/:taskId/claim,
 * /actions, /heartbeat, /complete) because the happy paths call out
 * to governance-kernel + execution-gate + evidence-ledger and need
 * downstream stubs. THIS file pins the EARLY-RETURN guards instead
 * — the 404 / 409 envelopes the handlers emit BEFORE any downstream
 * call. They're load-bearing because:
 *
 *   - they're what API clients see when a task is misrouted or a
 *     stale id is replayed
 *   - they're the only path a future refactor that moves these
 *     handlers (e.g. into src/routes/tasks.ts) can break without
 *     also touching the downstream stubs we don't yet have
 *
 * Coverage:
 *   (1) GET /tasks/next on a fresh service (no missions, no
 *       queued tasks) → 404 task_not_found
 *   (2) POST /tasks/<unknown>/claim → 404 task_not_found
 *   (3) POST /tasks/<unknown>/heartbeat → 404 task_not_found
 *   (4) POST /tasks/<unknown>/complete → 404 task_not_found
 *   (5) GET /tasks/<unknown>/actions → 404 task_not_found
 *
 * Happy paths, the 409 task_claim_owned_by_another_agent guard,
 * AND the gate-ordering test ("agent_not_found returns before
 * governance is called") all require either a queued execution
 * task to exist (which is created by /autonomy/tick — itself a
 * downstream-calling route) OR a downstream mock-server harness.
 * Deferred to a future stage where the harness gains
 * startMockService.
 *
 * No production code is modified.
 */

test("GET /tasks/next returns 404 task_not_found on a fresh service with no missions", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const r = await svc.get("/tasks/next");
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "task_not_found");
  } finally { await svc.stop(); }
});

test("POST /tasks/<unknown>/claim returns 404 task_not_found before any downstream call", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const r = await svc.post("/tasks/task-does-not-exist/claim", { agentId: "agent-planner" });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "task_not_found");
  } finally { await svc.stop(); }
});

test("POST /tasks/<unknown>/heartbeat returns 404 task_not_found", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const r = await svc.post("/tasks/task-does-not-exist/heartbeat", { agentId: "agent-planner" });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "task_not_found");
  } finally { await svc.stop(); }
});

test("POST /tasks/<unknown>/complete returns 404 task_not_found", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const r = await svc.post("/tasks/task-does-not-exist/complete", { agentId: "agent-planner" });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "task_not_found");
  } finally { await svc.stop(); }
});

test("GET /tasks/<unknown>/actions returns 404 task_not_found", async () => {
  const svc = await startService("agent-os", { readyTimeoutMs: 15_000 });
  try {
    const r = await svc.get("/tasks/task-does-not-exist/actions");
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "task_not_found");
  } finally { await svc.stop(); }
});
