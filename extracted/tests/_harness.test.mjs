import test from "node:test";
import assert from "node:assert/strict";
import { startMockService, freePort } from "./_harness.mjs";

/**
 * Self-tests for the test harness itself.
 *
 * startMockService is the foundation that future stage tests will
 * use to drive happy-path agent-os routes (claim/dispatch/execute)
 * without standing up the full control plane. Before any consumer
 * builds on it, these tests pin the contract:
 *
 *   (1) canned-response routes
 *   (2) function handlers receive the parsed body + query string +
 *       headers and can return dynamic shapes
 *   (3) unmatched routes get a deterministic 404
 *       mock_route_not_configured (NOT a hang)
 *   (4) calls[] records arrivals in order
 *   (5) the listener actually binds to a free port
 *   (6) stop() releases the socket so the test process can exit
 *
 * Pure node:test + the harness itself; nothing else required.
 */

test("startMockService returns a canned JSON response for a configured route", async () => {
  const mock = await startMockService({
    "GET /ping": { status: 200, body: { ok: true, source: "mock" } }
  });
  try {
    const r = await fetch(`${mock.base}/ping`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/json");
    assert.deepEqual(await r.json(), { ok: true, source: "mock" });
  } finally { await mock.stop(); }
});

test("function handlers receive parsed body + query + method + path and may be async", async () => {
  const mock = await startMockService({
    "POST /echo": async ({ method, path, body, query, headers }) => ({
      status: 200,
      body: { method, path, body, query, gotKey: headers["x-test-key"] }
    })
  });
  try {
    const r = await fetch(`${mock.base}/echo?missionId=mission-1&priority=high`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-key": "abc123" },
      body: JSON.stringify({ hello: "world", n: 42 })
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.method, "POST");
    assert.equal(j.path, "/echo");
    assert.deepEqual(j.body, { hello: "world", n: 42 });
    assert.deepEqual(j.query, { missionId: "mission-1", priority: "high" });
    assert.equal(j.gotKey, "abc123");
  } finally { await mock.stop(); }
});

test("unmatched routes get 404 mock_route_not_configured — deterministic, not a hang", async () => {
  const mock = await startMockService({
    "GET /known": { status: 200, body: { ok: true } }
  });
  try {
    const r = await fetch(`${mock.base}/this-route-not-configured`, { method: "POST" });
    assert.equal(r.status, 404);
    const j = await r.json();
    assert.equal(j.error, "mock_route_not_configured");
    assert.equal(j.method, "POST");
    assert.equal(j.path, "/this-route-not-configured");
  } finally { await mock.stop(); }
});

test("calls[] records every arrival in order with method, path, query, body, headers", async () => {
  const mock = await startMockService({
    "POST /events/commit": { status: 201, body: { index: 0 } },
    "GET /health":         { status: 200, body: { ok: true } }
  });
  try {
    await fetch(`${mock.base}/health`);
    await fetch(`${mock.base}/events/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventKind: "test.event", actor: "harness" })
    });
    await fetch(`${mock.base}/missing-route?x=1`);

    assert.equal(mock.calls.length, 3, "must record one entry per arrived request");
    assert.equal(mock.calls[0].method, "GET");
    assert.equal(mock.calls[0].path, "/health");

    assert.equal(mock.calls[1].method, "POST");
    assert.equal(mock.calls[1].path, "/events/commit");
    assert.deepEqual(mock.calls[1].body, { eventKind: "test.event", actor: "harness" });

    assert.equal(mock.calls[2].method, "GET");
    assert.equal(mock.calls[2].path, "/missing-route");
    assert.deepEqual(mock.calls[2].query, { x: "1" },
      "unmatched routes must also be recorded — they're often the bug indicator");
  } finally { await mock.stop(); }
});

test("a caller-supplied port is honored (no auto-allocation)", async () => {
  const port = await freePort();
  const mock = await startMockService(
    { "GET /": { status: 200, body: { port } } },
    { port }
  );
  try {
    assert.equal(mock.port, port);
    assert.equal(mock.base, `http://127.0.0.1:${port}`);
    const r = await fetch(`${mock.base}/`);
    assert.equal((await r.json()).port, port);
  } finally { await mock.stop(); }
});

test("stop() releases the port so a follow-up listener can bind to it", async () => {
  const port = await freePort();
  const first = await startMockService(
    { "GET /": { status: 200, body: { stage: "first" } } },
    { port }
  );
  await first.stop();
  // If close() didn't actually release the socket, this would EADDRINUSE.
  const second = await startMockService(
    { "GET /": { status: 200, body: { stage: "second" } } },
    { port }
  );
  try {
    const r = await fetch(`${second.base}/`);
    assert.equal((await r.json()).stage, "second");
  } finally { await second.stop(); }
});

test("handler-thrown errors surface as 500 mock_handler_threw — not a hang", async () => {
  const mock = await startMockService({
    "GET /boom": () => { throw new Error("intentional handler failure"); }
  });
  try {
    const r = await fetch(`${mock.base}/boom`);
    assert.equal(r.status, 500);
    const j = await r.json();
    assert.equal(j.error, "mock_handler_threw");
    assert.match(j.message, /intentional handler failure/);
  } finally { await mock.stop(); }
});
