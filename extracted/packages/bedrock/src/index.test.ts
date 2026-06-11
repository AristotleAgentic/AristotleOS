import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import { AristotleGateError, makeBedrockToolDispatcher, type BedrockToolUse } from "./index.js";

interface Rec { url: string; method?: string; body?: string }

function mockFetch(h: (r: Rec) => { status: number; body: unknown }) {
  const calls: Rec[] = [];
  const fn = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const r: Rec = { url, method: init.method, body: init.body };
    calls.push(r);
    const { status, body } = h(r);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function makeClient(h: (r: Rec) => { status: number; body: unknown }) {
  const { fn, calls } = mockFetch(h);
  return { client: new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn }), calls };
}

const TOOL_USE: BedrockToolUse = { toolUseId: "tu-1", name: "send_email", input: { to: "alice", body: "hi" } };
const ALLOW = { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr-1" }, gel_record: { record_id: "rec-1", record_hash: "rh" } };
const REFUSE = { decision: "REFUSE", reason_codes: ["ACTION_DENIED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } };
const ESCALATE = { decision: "ESCALATE", reason_codes: ["DUAL_CONTROL_REQUIRED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } };

test("ALLOW dispatches to the tool implementation and returns success", async () => {
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  const innerCalls: Record<string, unknown>[] = [];
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s",
    tools: { send_email: async (input) => { innerCalls.push(input); return { ok: true }; } }
  });
  const result = await dispatch(TOOL_USE);
  assert.equal(result.status, "success");
  assert.deepEqual(innerCalls, [{ to: "alice", body: "hi" }]);
});

test("REFUSE returns tool-result with status:error + outcome JSON; inner never runs", async () => {
  const { client } = makeClient(() => ({ status: 200, body: REFUSE }));
  const innerCalls: unknown[] = [];
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s",
    tools: { send_email: async () => { innerCalls.push(true); return "x"; } }
  });
  const result = await dispatch(TOOL_USE);
  assert.equal(result.status, "error");
  assert.equal(result.toolUseId, "tu-1");
  const outcome = (result.content[0] as { json: Record<string, unknown> }).json;
  assert.equal(outcome.__aristotle, "REFUSE");
  assert.deepEqual(outcome.reasonCodes, ["ACTION_DENIED"]);
  assert.equal(innerCalls.length, 0);
});

test("REFUSE throws AristotleGateError when onRefuse:'throw'", async () => {
  const { client } = makeClient(() => ({ status: 200, body: REFUSE }));
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s", onRefuse: "throw",
    tools: { send_email: async () => "x" }
  });
  await assert.rejects(dispatch(TOOL_USE), (e: unknown) => e instanceof AristotleGateError && (e as AristotleGateError).kind === "REFUSE");
});

test("ESCALATE returns tool-result with __aristotle:'ESCALATE' by default", async () => {
  const { client } = makeClient(() => ({ status: 200, body: ESCALATE }));
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s",
    tools: { send_email: async () => "x" }
  });
  const result = await dispatch(TOOL_USE);
  const outcome = (result.content[0] as { json: Record<string, unknown> }).json;
  assert.equal(outcome.__aristotle, "ESCALATE");
});

test("Gate unreachable throws AristotleGateError by default (fail-closed)", async () => {
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: (async () => { throw new Error("network down"); }) as unknown as typeof fetch });
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s",
    tools: { send_email: async () => "x" }
  });
  await assert.rejects(dispatch(TOOL_USE), (e: unknown) => e instanceof AristotleGateError && (e as AristotleGateError).kind === "GATE_UNREACHABLE");
});

test("Gate unreachable returns tool-result when onError:'tool-result'", async () => {
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: (async () => { throw new Error("network down"); }) as unknown as typeof fetch });
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s", onError: "tool-result",
    tools: { send_email: async () => "x" }
  });
  const result = await dispatch(TOOL_USE);
  const outcome = (result.content[0] as { json: Record<string, unknown> }).json;
  assert.equal(outcome.__aristotle, "GATE_UNREACHABLE");
});

test("passthroughTools dispatches without calling the gate", async () => {
  const handlerCalls: boolean[] = [];
  const { client } = makeClient(() => { handlerCalls.push(true); return { status: 500, body: {} }; });
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s",
    tools: { search_db: async (i) => `r:${(i as { query: string }).query}` },
    passthroughTools: ["search_db"]
  });
  const r = await dispatch({ toolUseId: "x", name: "search_db", input: { query: "alice" } });
  assert.equal(r.status, "success");
  assert.equal((r.content[0] as { text: string }).text, "r:alice");
  assert.equal(handlerCalls.length, 0);
});

test("actionTypeFor routes specific tools into vertical namespace", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: ALLOW }));
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s",
    tools: { transfer_title: async () => "ok" },
    actionTypeFor: (n) => n === "transfer_title" ? "title.transfer" : `tool.${n}`
  });
  await dispatch({ toolUseId: "tu", name: "transfer_title", input: { vin: "V" } });
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string } };
  assert.equal(body.action.action_type, "title.transfer");
});

test("onDecision telemetry fires with verdict + elapsedMs", async () => {
  type Info = Parameters<NonNullable<Parameters<typeof makeBedrockToolDispatcher>[0]["onDecision"]>>[0];
  const seen: Info[] = [];
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s",
    tools: { send_email: async () => "x" },
    onDecision: (i) => { seen.push(i); }
  });
  await dispatch(TOOL_USE);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].toolName, "send_email");
  assert.ok(typeof seen[0].elapsedMs === "number");
});

test("Unknown tool returns an error result without contacting the gate", async () => {
  const handlerCalls: boolean[] = [];
  const { client } = makeClient(() => { handlerCalls.push(true); return { status: 200, body: ALLOW }; });
  const dispatch = makeBedrockToolDispatcher({
    client, wardId: "w", subject: "s",
    tools: { send_email: async () => "x" }
  });
  const result = await dispatch({ toolUseId: "tu", name: "unknown_tool", input: {} });
  assert.equal(result.status, "error");
  assert.equal(handlerCalls.length, 0);
});

test("Constructor refuses missing required options", () => {
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  assert.throws(() => makeBedrockToolDispatcher({ client: undefined as unknown as AristotleClient, wardId: "w", subject: "s", tools: {} }), /client/);
  assert.throws(() => makeBedrockToolDispatcher({ client, wardId: "", subject: "s", tools: {} }), /wardId/);
  assert.throws(() => makeBedrockToolDispatcher({ client, wardId: "w", subject: "", tools: {} }), /subject/);
});
