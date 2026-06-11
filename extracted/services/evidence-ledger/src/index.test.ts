import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Evidence-ledger replay-event + counterfactual-branch lifecycle tests.
 *
 * The evidence-ledger has two surfaces:
 *
 *   (A) The legacy replay-event store: /events/commit, /replay,
 *       /branches, /branches/:id/events, /timeline. These are
 *       in-memory + JSON-persisted, with simple shapes — testable
 *       without external fixtures.
 *
 *   (B) The GEL chain: /gel/append, /gel/chain, /gel/verify, etc.
 *       Requires a WardManifest + CommitGateDecision + Warrant
 *       fixture from execution-control-runtime — deferred to a
 *       later stage where those fixtures can be constructed
 *       properly.
 *
 * Stage 2 covers (A). Each test spawns a fresh evidence-ledger with
 * a temp file for EVIDENCE_LEDGER_GEL_PATH so on-disk persistence
 * doesn't bleed between tests or pollute the dev workspace.
 *
 * No production code is modified.
 */

async function tempLedger() {
  const dir = await mkdtemp(join(tmpdir(), "aristotle-ledger-test-"));
  return {
    gelPath: join(dir, "ledger.gel.jsonl"),
    statePath: join(dir, "evidence-ledger.json")
  };
}

async function startLedger() {
  const paths = await tempLedger();
  // EVIDENCE_LEDGER_STATE_PATH isolates the JSON-persisted replay store;
  // EVIDENCE_LEDGER_GEL_PATH isolates the append-only GEL chain. Both
  // are env-var-controlled by the service.
  return await startService("evidence-ledger", {
    env: {
      EVIDENCE_LEDGER_STATE_PATH: paths.statePath,
      EVIDENCE_LEDGER_GEL_PATH: paths.gelPath
    }
  });
}

test("/health reports the persisted-state path and committed-event count", async () => {
  const svc = await startLedger();
  try {
    const { status, body } = await svc.get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "evidence-ledger");
    assert.equal(typeof body.persistedStatePath, "string");
    assert.equal(body.committedEvents, 0, "fresh ledger must report zero committed events");
  } finally { await svc.stop(); }
});

test("POST /events/commit appends a replay event and assigns a monotonic index", async () => {
  const svc = await startLedger();
  try {
    const a = await svc.post("/events/commit", {
      actor: "test-actor",
      eventKind: "test.commit",
      traceId: "trace-1",
      payload: { hello: "world" }
    });
    assert.equal(a.status, 201);
    assert.equal(a.body.index, 0, "first commit must land at index 0");
    assert.ok(a.body.event.id, "committed event must have an id");
    assert.equal(a.body.event.committed, true);
    assert.equal(a.body.event.artifactType, "replay-event");

    const b = await svc.post("/events/commit", {
      actor: "test-actor",
      eventKind: "test.commit",
      traceId: "trace-1"
    });
    assert.equal(b.status, 201);
    assert.equal(b.body.index, 1, "second commit must land at index 1 — monotonic");
  } finally { await svc.stop(); }
});

test("GET /replay filters committed events by traceId", async () => {
  const svc = await startLedger();
  try {
    await svc.post("/events/commit", { actor: "a", eventKind: "k", traceId: "trace-A", payload: {} });
    await svc.post("/events/commit", { actor: "a", eventKind: "k", traceId: "trace-B", payload: {} });
    await svc.post("/events/commit", { actor: "a", eventKind: "k", traceId: "trace-A", payload: {} });

    const all = await svc.get("/replay");
    assert.equal(all.status, 200);
    assert.equal(all.body.committed, true);
    assert.equal(all.body.items.length, 3, "GET /replay with no filter returns all committed events");

    const filtered = await svc.get("/replay?traceId=trace-A");
    assert.equal(filtered.body.items.length, 2, "traceId filter must restrict to matching events");
    for (const ev of filtered.body.items) {
      assert.equal(ev.traceId, "trace-A");
    }
  } finally { await svc.stop(); }
});

test("POST /branches creates a counterfactual branch; /branches/:id/events appends hypothetical events", async () => {
  const svc = await startLedger();
  try {
    const branch = await svc.post("/branches", {
      actor: "test-sim",
      parentTraceId: "trace-parent",
      label: "what-if-A"
    });
    assert.equal(branch.status, 201);
    assert.equal(branch.body.artifactType, "counterfactual-branch");
    assert.equal(branch.body.status, "open");
    assert.equal(branch.body.hypothetical, true);
    assert.equal(branch.body.parentTraceId, "trace-parent");
    assert.equal(branch.body.label, "what-if-A");
    const branchId = branch.body.id;

    // Hypothetical events go onto the branch, NOT into the committed stream.
    const hyp = await svc.post(`/branches/${branchId}/events`, {
      actor: "test-sim",
      eventKind: "what-if.step",
      payload: { step: 1 }
    });
    assert.equal(hyp.status, 201);
    assert.equal(hyp.body.committed, false, "branch events must be marked uncommitted");
    assert.equal(hyp.body.branchId, branchId);

    // Confirmed: not in the committed /replay stream
    const committed = await svc.get("/replay");
    assert.equal(committed.body.items.length, 0, "branch event must not appear in committed /replay");

    // But visible when /replay is queried by branchId
    const branchReplay = await svc.get(`/replay?branchId=${branchId}`);
    assert.equal(branchReplay.body.committed, false);
    assert.equal(branchReplay.body.items.length, 1);
  } finally { await svc.stop(); }
});

test("POST /branches/:id/events returns 404 for an unknown branch", async () => {
  const svc = await startLedger();
  try {
    const r = await svc.post("/branches/does-not-exist/events", {
      actor: "x", eventKind: "y", payload: {}
    });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "branch_not_found");
  } finally { await svc.stop(); }
});
