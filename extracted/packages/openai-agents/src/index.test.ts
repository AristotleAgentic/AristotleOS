import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import { aristotleToolInputGuardrail, type SdkFunctionCall, type ToolInputGuardrailData } from "./index.js";

interface Recorded { url: string; method?: string; body?: string }

function mockFetch(handler: (rec: Recorded) => { status: number; body: unknown }) {
  const calls: Recorded[] = [];
  const fn = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const rec: Recorded = { url, method: init.method, body: init.body };
    calls.push(rec);
    const { status, body } = handler(rec);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function makeClient(handler: (rec: Recorded) => { status: number; body: unknown }) {
  const { fn, calls } = mockFetch(handler);
  return { client: new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn }), calls };
}

function callData(name: string, args: Record<string, unknown> | string, agentName = "test-agent"): ToolInputGuardrailData {
  const toolCall: SdkFunctionCall = {
    callId: `call-${name}-1`,
    name,
    type: "function_call",
    arguments: typeof args === "string" ? args : JSON.stringify(args)
  };
  return { toolCall, agent: { name: agentName } };
}

const allowBody = {
  decision: "ALLOW",
  reason_codes: [],
  canonical_action_hash: "h",
  warrant: { warrant_id: "wr-1" },
  gel_record: { record_id: "rec-1", record_hash: "rh" }
};

test("ALLOW returns behavior:'allow' with warrant + GEL record id in outputInfo", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: allowBody }));
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "ward-agents", subject: "agent:1" });
  assert.equal(guardrail.type, "tool_input");
  assert.equal(guardrail.name, "aristotle-commit-gate");

  const result = await guardrail.run(callData("search_database", { query: "alice" }));
  assert.equal(result.behavior.type, "allow");
  const info = result.outputInfo as Record<string, unknown>;
  assert.equal(info.warrantId, "wr-1");
  assert.equal(info.gelRecordId, "rec-1");

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string; ward_id: string; subject: string; params: Record<string, unknown>; action_id: string } };
  assert.equal(body.action.action_type, "tool.search_database");
  assert.equal(body.action.ward_id, "ward-agents");
  assert.equal(body.action.subject, "agent:1");
  assert.deepEqual(body.action.params, { query: "alice" });
  assert.equal(body.action.action_id, "call-search_database-1");
});

test("REFUSE returns behavior:'rejectContent' with reason codes; outputInfo carries gelRecordId", async () => {
  const { client } = makeClient(() => ({
    status: 200,
    body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED", "WARRANT_NOT_ISSUED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } }
  }));
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "w", subject: "s" });
  const result = await guardrail.run(callData("delete_user", { id: 42 }));
  assert.equal(result.behavior.type, "rejectContent");
  if (result.behavior.type === "rejectContent") {
    assert.match(result.behavior.message, /REFUSE/);
    assert.match(result.behavior.message, /ACTION_DENIED/);
    assert.match(result.behavior.message, /WARRANT_NOT_ISSUED/);
  }
  const info = result.outputInfo as Record<string, unknown>;
  assert.equal(info.aristotle, "refuse");
  assert.equal(info.gelRecordId, "rec-1");
});

test("ESCALATE returns behavior:'rejectContent' by default carrying reason codes", async () => {
  const { client } = makeClient(() => ({
    status: 200,
    body: { decision: "ESCALATE", reason_codes: ["DUAL_CONTROL_REQUIRED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } }
  }));
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "w", subject: "s" });
  const result = await guardrail.run(callData("send_email", { to: "alice" }));
  assert.equal(result.behavior.type, "rejectContent");
  if (result.behavior.type === "rejectContent") {
    assert.match(result.behavior.message, /ESCALATE/);
    assert.match(result.behavior.message, /DUAL_CONTROL_REQUIRED/);
  }
  const info = result.outputInfo as Record<string, unknown>;
  assert.equal(info.aristotle, "escalate");
});

test("onEscalate:'throwException' raises the runner instead of letting the agent see the rejection", async () => {
  const { client } = makeClient(() => ({
    status: 200,
    body: { decision: "ESCALATE", reason_codes: ["DUAL_CONTROL_REQUIRED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } }
  }));
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "w", subject: "s", onEscalate: "throwException" });
  const result = await guardrail.run(callData("send_email", { to: "alice" }));
  assert.equal(result.behavior.type, "throwException");
});

test("custom actionTypeFor routes specific tools into a vertical namespace", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: allowBody }));
  const guardrail = aristotleToolInputGuardrail({
    client, wardId: "ward-title", subject: "agent:title",
    actionTypeFor: (n) => n === "transfer_title" ? "title.transfer" : `tool.${n.toLowerCase()}`
  });
  await guardrail.run(callData("transfer_title", { vin: "V", to: "Alice" }));
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string } };
  assert.equal(body.action.action_type, "title.transfer");
});

test("custom buildAction takes full control over the canonical action shape", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: allowBody }));
  const guardrail = aristotleToolInputGuardrail({
    client, wardId: "w", subject: "s",
    buildAction: ({ toolName, toolInput, callId, agentName }) => ({
      action_id: callId,
      ward_id: "ward-custom",
      subject: "agent:custom",
      action_type: `custom.${toolName}`,
      params: { wrapped: toolInput, by: agentName },
      target: "custom-target"
    })
  });
  await guardrail.run(callData("audit_log", { event: "login" }));
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string; ward_id: string; params: Record<string, unknown>; target: string } };
  assert.equal(body.action.action_type, "custom.audit_log");
  assert.equal(body.action.ward_id, "ward-custom");
  assert.deepEqual(body.action.params, { wrapped: { event: "login" }, by: "test-agent" });
  assert.equal(body.action.target, "custom-target");
});

test("passthroughTools allows specified tools without calling the gate", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: { decision: "REFUSE", reason_codes: ["should-not-reach"], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } } }));
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "w", subject: "s", passthroughTools: ["read_db", "search_docs"] });
  const result = await guardrail.run(callData("read_db", { q: "select 1" }));
  assert.equal(result.behavior.type, "allow");
  assert.equal(calls.length, 0, "gate must not be called for a passthrough tool");
});

test("onDecision telemetry fires with the gate verdict + elapsed time", async () => {
  type DecisionInfo = Parameters<NonNullable<Parameters<typeof aristotleToolInputGuardrail>[0]["onDecision"]>>[0];
  const seen: DecisionInfo[] = [];
  const { client } = makeClient(() => ({ status: 200, body: allowBody }));
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "w", subject: "s", onDecision: (info) => { seen.push(info); } });
  await guardrail.run(callData("search", { q: "x" }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].toolName, "search");
  assert.equal(seen[0].action.action_type, "tool.search");
  if ("warrant" in seen[0].decision) {
    assert.equal(seen[0].decision.warrant?.warrant_id, "wr-1");
  }
  assert.ok(typeof seen[0].elapsedMs === "number");
});

test("gate-unreachable defaults to rejectContent (fail-closed message the agent can incorporate)", async () => {
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: (async () => { throw new Error("network down"); }) as unknown as typeof fetch });
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "w", subject: "s" });
  const result = await guardrail.run(callData("send_payment", { to: "alice" }));
  assert.equal(result.behavior.type, "rejectContent");
  if (result.behavior.type === "rejectContent") {
    assert.match(result.behavior.message, /network down|unreachable/i);
  }
});

test("onError:'throwException' raises the runner on gate failure", async () => {
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: (async () => { throw new Error("timeout"); }) as unknown as typeof fetch });
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "w", subject: "s", onError: "throwException" });
  const result = await guardrail.run(callData("send_email", { to: "x" }));
  assert.equal(result.behavior.type, "throwException");
});

test("non-JSON tool arguments are normalized into params:{input: '...'}", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: allowBody }));
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "w", subject: "s" });
  await guardrail.run(callData("legacy_tool", "the literal string"));
  const body = JSON.parse(calls[0].body!) as { action: { params: Record<string, unknown> } };
  assert.deepEqual(body.action.params, { input: "the literal string" });
});

test("the resulting guardrail has the right name, type, and run-function shape", async () => {
  const { client } = makeClient(() => ({ status: 200, body: allowBody }));
  const guardrail = aristotleToolInputGuardrail({ client, wardId: "w", subject: "s", guardrailName: "title-vertical-gate" });
  assert.equal(guardrail.name, "title-vertical-gate");
  assert.equal(guardrail.type, "tool_input");
  assert.equal(typeof guardrail.run, "function");
});

test("constructor refuses missing required options", () => {
  const { client } = makeClient(() => ({ status: 200, body: allowBody }));
  assert.throws(() => aristotleToolInputGuardrail({ client: undefined as unknown as AristotleClient, wardId: "w", subject: "s" }), /client/);
  assert.throws(() => aristotleToolInputGuardrail({ client, wardId: "", subject: "s" }), /wardId/);
  assert.throws(() => aristotleToolInputGuardrail({ client, wardId: "w", subject: "" }), /subject/);
});
