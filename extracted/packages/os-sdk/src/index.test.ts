import test from "node:test";
import assert from "node:assert/strict";
import { AristotleApiError, AristotleClient, type CanonicalAction } from "./index.js";

interface Recorded { url: string; method?: string; headers?: Record<string, string>; body?: string }

/** A fetch double: records calls, returns a canned status/body per request. */
function mockFetch(handler: (rec: Recorded) => { status: number; body: unknown }) {
  const calls: Recorded[] = [];
  const fn = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const rec: Recorded = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(rec);
    const { status, body } = handler(rec);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const action: CanonicalAction = {
  action_id: "act-1",
  ward_id: "w1",
  subject: "agent:demo",
  action_type: "drone.takeoff",
  params: { altitude_m: 60 }
};

test("evaluate posts the action to the gate, sends the bearer token, and parses the decision", async () => {
  const { fn, calls } = mockFetch(() => ({ status: 200, body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", gel_record: { record_id: "r1", record_hash: "rh" }, warrant: { warrant_id: "wr1" } } }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal/", token: "tok-operator", fetch: fn });

  const result = await aos.evaluate(action, { now: "2026-05-24T00:00:00.000Z" });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.warrant?.warrant_id, "wr1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gate.internal/v1/execution-control/evaluate"); // trailing slash trimmed
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers?.["authorization"], "Bearer tok-operator");
  assert.equal(calls[0].headers?.["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].body!), { action, now: "2026-05-24T00:00:00.000Z" });
});

test("apiKey is sent as X-API-Key and GET requests carry no content-type/body", async () => {
  const { fn, calls } = mockFetch(() => ({ status: 200, body: { ward_id: "w1" } }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", apiKey: "k-123", fetch: fn });
  await aos.context();
  assert.equal(calls[0].url, "https://gate.internal/v1/execution-control/context");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers?.["x-api-key"], "k-123");
  assert.equal(calls[0].headers?.["content-type"], undefined);
  assert.equal(calls[0].body, undefined);
});

test("governance compile/diff/explain hit the right routes", async () => {
  const seen: string[] = [];
  const { fn } = mockFetch((rec) => {
    seen.push(rec.url);
    return { status: 200, body: { manifest_version: "v1", hashes: { ward_hash: "", authority_envelope_hash: "", manifest_hash: "m" }, validation: { ok: true, errors: [] }, entries: [], summary: { total: 0, weakening: 0, requires_review: false }, ward_id: "w1", authority_envelope_id: "ae", allowed_actions: [], denied_actions: [], samples: [] } };
  });
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  await aos.compileGovernance({ ward: {}, authority_envelope: {} });
  await aos.diffGovernance({ before: {}, after: {} });
  await aos.explainGovernance({ sample_actions: [] });
  assert.deepEqual(seen, [
    "https://gate.internal/v1/execution-control/governance/compile",
    "https://gate.internal/v1/execution-control/governance/diff",
    "https://gate.internal/v1/execution-control/governance/explain"
  ]);
});

test("auditTail builds the limit query; auditVerify parses the result", async () => {
  const { fn, calls } = mockFetch((rec) => rec.url.includes("verify") ? { status: 200, body: { ok: true, count: 7 } } : { status: 200, body: { items: [] } });
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  await aos.auditTail(5);
  const verify = await aos.auditVerify();
  assert.equal(calls[0].url, "https://gate.internal/v1/execution-control/audit/tail?limit=5");
  assert.equal(verify.ok, true);
  assert.equal(verify.count, 7);
});

test("a non-2xx response throws AristotleApiError carrying status + body", async () => {
  const { fn } = mockFetch(() => ({ status: 403, body: { error: "forbidden", required: "operator" } }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "tok-viewer", fetch: fn });
  await assert.rejects(
    () => aos.evaluate(action),
    (err: unknown) => {
      assert.ok(err instanceof AristotleApiError);
      assert.equal((err as AristotleApiError).status, 403);
      assert.deepEqual((err as AristotleApiError).body, { error: "forbidden", required: "operator" });
      return true;
    }
  );
});

test("operator engines hit the right routes with the right methods", async () => {
  const seen: Array<{ url: string; method?: string }> = [];
  const { fn } = mockFetch((rec) => {
    seen.push({ url: rec.url, method: rec.method });
    return { status: 200, body: { ok: true, count: 0, agreements: 0, conflicts: 0, items: [], decisions: {}, rollout: { ready: true, allow_rate: 1 }, summary: { total: 0, open: 0, conflicts: 0, by_status: {} } } };
  });
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  await aos.shadow({ actions: [] });
  await aos.reconcile({ records: [] });
  await aos.ingestConflicts({ records: [] });
  await aos.conflicts();
  await aos.resolveConflict({ action_id: "c1", action: "reject" });
  await aos.marshalCensus({ observations: [] });
  await aos.marshalBehavior({ events: [] });
  await aos.degradation();
  assert.deepEqual(seen, [
    { url: "https://gate.internal/v1/execution-control/shadow", method: "POST" },
    { url: "https://gate.internal/v1/execution-control/reconcile", method: "POST" },
    { url: "https://gate.internal/v1/execution-control/conflicts/ingest", method: "POST" },
    { url: "https://gate.internal/v1/execution-control/conflicts", method: "GET" },
    { url: "https://gate.internal/v1/execution-control/conflicts/resolve", method: "POST" },
    { url: "https://gate.internal/v1/execution-control/marshal/census", method: "POST" },
    { url: "https://gate.internal/v1/execution-control/marshal/behavior", method: "POST" },
    { url: "https://gate.internal/v1/execution-control/degradation", method: "GET" }
  ]);
});

test("degradation() parses the live status", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: { ward_id: "w1", criticality: "safety_critical", healthy: false, conditions: ["ledger_unavailable"], fail_action: "refuse", binding_condition: "ledger_unavailable", probes: 1 } }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const status = await aos.degradation();
  assert.equal(status.healthy, false);
  assert.equal(status.fail_action, "refuse");
  assert.deepEqual(status.conditions, ["ledger_unavailable"]);
});

test("constructor rejects a missing baseUrl", () => {
  assert.throws(() => new AristotleClient({ baseUrl: "" } as unknown as { baseUrl: string }), /requires a baseUrl/);
});
