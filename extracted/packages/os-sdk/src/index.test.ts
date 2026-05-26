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

test("metrics() reads the aggregate metrics endpoint", async () => {
  const { fn, calls } = mockFetch(() => ({ status: 200, body: { warrants_today: 42, refusals_today: 3, gate_latency_ms: 7.1 } }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const m = await aos.metrics();
  assert.equal(calls[0].url, "https://gate.internal/v1/execution-control/metrics");
  assert.equal(calls[0].method, "GET");
  assert.equal(m.warrants_today, 42);
  assert.equal(m.gate_latency_ms, 7.1);
});

test("approvals() lists the queue; decideApproval votes on a request", async () => {
  const { fn, calls } = mockFetch((rec) => rec.url.endsWith("/approvals")
    ? { status: 200, body: { items: [{ request_id: "ap-1", action_id: "act-1", action_type: "title.transfer", ward_id: "ward-title", required: 2, votes: [], status: "pending", created_at: "t" }] } }
    : { status: 200, body: { ok: true, status: "approved", votes: [{ operator_id: "op-1", decision: "approve", voted_at: "t" }, { operator_id: "op-2", decision: "approve", voted_at: "t" }] } });
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const list = await aos.approvals();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].status, "pending");
  const result = await aos.decideApproval({ request_id: "ap-1", decision: "approve", reason: "verified" });
  assert.equal(result.ok, true);
  assert.equal(result.status, "approved");
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(JSON.parse(calls[1].body!), { request_id: "ap-1", decision: "approve", reason: "verified" });
});

test("killSwitch() and revokeEnvelope() POST to the admin routes with the right body", async () => {
  const { fn, calls } = mockFetch((rec) => rec.url.endsWith("/kill")
    ? { status: 200, body: { ok: true, scope: "global", action: "arm", applied_at: "t" } }
    : { status: 200, body: { ok: true, envelope_id: "env-1", revoked_at: "t" } });
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const ks = await aos.killSwitch({ scope: "global", action: "arm", reason: "incident" });
  assert.equal(ks.action, "arm");
  assert.equal(calls[0].url, "https://gate.internal/v1/execution-control/admin/kill");
  const rv = await aos.revokeEnvelope({ envelope_id: "env-1", reason: "issuer compromise" });
  assert.equal(rv.envelope_id, "env-1");
  assert.equal(calls[1].url, "https://gate.internal/v1/execution-control/admin/revoke");
});

test("governAndExecute: ALLOW runs the executor and returns its result with the warrant", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr1" }, gel_record: { record_id: "r1", record_hash: "rh" } } }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  let captured: string | undefined;
  const out = await aos.governAndExecute(action, async (dec) => { captured = dec.warrant?.warrant_id as string | undefined; return { ok: true }; });
  assert.equal(out.decision, "ALLOW");
  if (out.decision !== "ALLOW") return;
  assert.deepEqual(out.result, { ok: true });
  assert.equal(out.warrant?.warrant_id, "wr1");
  assert.equal(captured, "wr1");
});

test("governAndExecute: REFUSE throws AristotleApiError with the reason codes; executor never runs", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED", "WARRANT_NOT_ISSUED"], canonical_action_hash: "h", gel_record: { record_id: "r1", record_hash: "rh" } } }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  let executorRan = false;
  await assert.rejects(
    () => aos.governAndExecute(action, async () => { executorRan = true; return { ok: true }; }),
    (err: unknown) => {
      assert.ok(err instanceof AristotleApiError);
      assert.equal((err as AristotleApiError).status, 403);
      assert.match((err as Error).message, /ACTION_DENIED.*WARRANT_NOT_ISSUED/);
      return true;
    }
  );
  assert.equal(executorRan, false, "executor must not run on REFUSE");
});

test("governAndExecute: ESCALATE returns an escalation handle and never calls the executor", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: { decision: "ESCALATE", reason_codes: ["DUAL_CONTROL_REQUIRED"], canonical_action_hash: "h", gel_record: { record_id: "r1", record_hash: "rh" } } }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  let executorRan = false;
  const out = await aos.governAndExecute(action, async () => { executorRan = true; return { ok: true }; });
  assert.equal(out.decision, "ESCALATE");
  if (out.decision !== "ESCALATE") return;
  assert.deepEqual(out.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  assert.equal(out.record.record_id, "r1");
  assert.equal(executorRan, false, "executor must not run on ESCALATE");
});

test("AristotleClient.titleAction builds a typed title action with namespaced params", () => {
  const a = AristotleClient.titleAction({
    action_id: "act-mt-7",
    ward_id: "ward-title",
    subject: "agent:lender-orchestrator",
    action_type: "title.lien_release",
    vin: "1HGCM82633A123456",
    jurisdiction: "MT",
    transaction_type: "lien-release",
    params: { lienholder_id: "lender:demo-bank-mt" }
  });
  assert.equal(a.action_type, "title.lien_release");
  assert.equal(a.params?.vin, "1HGCM82633A123456");
  assert.equal(a.params?.jurisdiction, "MT");
  assert.equal(a.params?.transaction_type, "lien-release");
  assert.equal(a.params?.lienholder_id, "lender:demo-bank-mt");
});

// --- New v0.3 surfaces: requestWarrant, replay, exportEvidence -------------

test("requestWarrant returns the warrant id on ALLOW and carries the canonical_action_hash", async () => {
  const { fn } = mockFetch(() => ({
    status: 200,
    body: {
      decision: "ALLOW",
      reason_codes: [],
      canonical_action_hash: "sha256:bound-by-gate",
      warrant: { warrant_id: "warrant:from-gate" },
      gel_record: { record_id: "rec-7", record_hash: "rh" }
    }
  }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal/", token: "t", fetch: fn });
  const w = await aos.requestWarrant({
    action: "release_funds",
    subject: "agent:payments",
    ward: "ward-finance",
    authority: "treasury_ops",
    params: { amount: 5000, currency: "USD" },
    jurisdiction: "US-MT",
    risk: "medium"
  });
  assert.equal(w.warrant_id, "warrant:from-gate");
  assert.equal(w.canonical_action_hash, "sha256:bound-by-gate");
  assert.equal(w.gel_record_id, "rec-7");
});

test("requestWarrant on REFUSE throws AristotleApiError with status 403", async () => {
  const { fn } = mockFetch(() => ({
    status: 200,
    body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } }
  }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal/", token: "t", fetch: fn });
  let caught: unknown;
  try {
    await aos.requestWarrant({ action: "x", subject: "s", ward: "w" });
  } catch (e) { caught = e; }
  assert.ok(caught instanceof AristotleApiError);
  if (caught instanceof AristotleApiError) {
    assert.equal(caught.status, 403);
    assert.match(caught.message, /ACTION_DENIED/);
  }
});

test("requestWarrant on EXPIRE throws AristotleApiError with status 410", async () => {
  const { fn } = mockFetch(() => ({
    status: 200,
    body: { decision: "EXPIRE", reason_codes: ["warrant-expired"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } }
  }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal/", token: "t", fetch: fn });
  let caught: AristotleApiError | undefined;
  try {
    await aos.requestWarrant({ action: "x", subject: "s", ward: "w" });
  } catch (e) { if (e instanceof AristotleApiError) caught = e; }
  assert.ok(caught);
  assert.equal(caught!.status, 410);
});

test("replay POSTs to /v1/execution-control/replay and parses the result", async () => {
  const { fn, calls } = mockFetch(() => ({
    status: 200,
    body: { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr-replay" }, gel_record: { record_id: "rec-1", record_hash: "rh" }, replay: true }
  }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal/", token: "t", fetch: fn });
  const r = await aos.replay({ record_id: "rec-1" });
  assert.equal(r.decision, "ALLOW");
  assert.equal(r.replay, true);
  assert.equal(calls[0].url, "https://gate.internal/v1/execution-control/replay");
});

test("exportEvidence POSTs to /v1/execution-control/evidence/export and returns the bundle hash", async () => {
  const { fn, calls } = mockFetch(() => ({
    status: 200,
    body: { bundle: { hash_chained: true }, bundle_hash: "0xabc" }
  }));
  const aos = new AristotleClient({ baseUrl: "https://gate.internal/", token: "t", fetch: fn });
  const r = await aos.exportEvidence({ from_seq: 100, to_seq: 200, format: "bundle" });
  assert.equal(r.bundle_hash, "0xabc");
  assert.equal(calls[0].url, "https://gate.internal/v1/execution-control/evidence/export");
});
