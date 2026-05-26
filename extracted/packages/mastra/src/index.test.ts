import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import { AristotleGateError, governMastraTool, governMastraTools, type MastraToolLike } from "./index.js";

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

function makeTool(execute: (ctx: { context: Record<string, unknown> }) => Promise<unknown> | unknown): MastraToolLike {
  return { id: "send_email", description: "Send", inputSchema: {}, execute };
}

const ALLOW = { decision: "ALLOW", reason_codes: [], canonical_action_hash: "h", warrant: { warrant_id: "wr-1" }, gel_record: { record_id: "rec-1", record_hash: "rh" } };
const REFUSE = { decision: "REFUSE", reason_codes: ["ACTION_DENIED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } };
const ESCALATE = { decision: "ESCALATE", reason_codes: ["DUAL_CONTROL_REQUIRED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } };

test("ALLOW invokes wrapped execute and returns its output", async () => {
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  const calls: unknown[] = [];
  const tool = makeTool(async ({ context }) => { calls.push(context); return "sent"; });
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s" });
  const result = await governed.execute!({ context: { to: "alice", body: "hi" } });
  assert.equal(result, "sent");
  assert.deepEqual(calls, [{ to: "alice", body: "hi" }]);
});

test("REFUSE returns AristotleToolOutcome by default, execute never runs", async () => {
  const { client } = makeClient(() => ({ status: 200, body: REFUSE }));
  const innerCalls: unknown[] = [];
  const tool = makeTool(async () => { innerCalls.push(true); return "x"; });
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s" });
  const out = await governed.execute!({ context: { to: "alice", body: "hi" } });
  assert.equal((out as { __aristotle: string }).__aristotle, "REFUSE");
  assert.deepEqual((out as { reasonCodes: string[] }).reasonCodes, ["ACTION_DENIED"]);
  assert.equal(innerCalls.length, 0);
});

test("REFUSE throws AristotleGateError when onRefuse:'throw'", async () => {
  const { client } = makeClient(() => ({ status: 200, body: REFUSE }));
  const tool = makeTool(async () => "x");
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s", onRefuse: "throw" });
  await assert.rejects(governed.execute!({ context: {} }), (e: unknown) => e instanceof AristotleGateError && (e as AristotleGateError).kind === "REFUSE");
});

test("ESCALATE returns AristotleToolOutcome by default", async () => {
  const { client } = makeClient(() => ({ status: 200, body: ESCALATE }));
  const tool = makeTool(async () => "x");
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s" });
  const out = await governed.execute!({ context: {} });
  assert.equal((out as { __aristotle: string }).__aristotle, "ESCALATE");
});

test("Gate unreachable throws by default", async () => {
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: (async () => { throw new Error("network down"); }) as unknown as typeof fetch });
  const tool = makeTool(async () => "x");
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s" });
  await assert.rejects(governed.execute!({ context: {} }), (e: unknown) => e instanceof AristotleGateError && (e as AristotleGateError).kind === "GATE_UNREACHABLE");
});

test("Gate unreachable returns outcome when onError:'return-outcome'", async () => {
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: (async () => { throw new Error("network down"); }) as unknown as typeof fetch });
  const tool = makeTool(async () => "x");
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s", onError: "return-outcome" });
  const out = await governed.execute!({ context: {} });
  assert.equal((out as { __aristotle: string }).__aristotle, "GATE_UNREACHABLE");
});

test("passthroughTools returns the original tool unchanged (identity)", async () => {
  const { client } = makeClient(() => ({ status: 200, body: REFUSE }));
  const tool = makeTool(async ({ context }) => `r:${(context as { q: string }).q}`);
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s", passthroughTools: ["send_email"] });
  assert.equal(governed, tool, "must return the same object so SDK identity checks keep working");
});

test("actionTypeFor routes specific tools into a vertical namespace", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: ALLOW }));
  const tool = makeTool(async () => "ok");
  tool.id = "transfer_title";
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s", actionTypeFor: (n) => n === "transfer_title" ? "title.transfer" : `tool.${n}` });
  await governed.execute!({ context: { vin: "V" } });
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string } };
  assert.equal(body.action.action_type, "title.transfer");
});

test("onDecision telemetry fires with verdict + elapsedMs", async () => {
  type Info = Parameters<NonNullable<Parameters<typeof governMastraTool>[1]["onDecision"]>>[0];
  const seen: Info[] = [];
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  const tool = makeTool(async () => "x");
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s", onDecision: (i) => { seen.push(i); } });
  await governed.execute!({ context: {} });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].toolName, "send_email");
  assert.ok(typeof seen[0].elapsedMs === "number");
});

test("governMastraTools wraps every tool in the record", async () => {
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  const innerCalls: string[] = [];
  const tools = {
    send: { id: "send", description: "", execute: async () => { innerCalls.push("send"); return "ok"; } } as MastraToolLike,
    search: { id: "search", description: "", execute: async () => { innerCalls.push("search"); return "ok"; } } as MastraToolLike,
  };
  const governed = governMastraTools(tools, { client, wardId: "w", subject: "s" });
  await governed.send.execute!({ context: {} });
  await governed.search.execute!({ context: {} });
  assert.deepEqual(innerCalls, ["send", "search"]);
});

test("Tool without execute is returned unchanged", () => {
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  const tool: MastraToolLike = { id: "external", description: "external tool" };
  const governed = governMastraTool(tool, { client, wardId: "w", subject: "s" });
  assert.equal(governed, tool);
});

test("Constructor refuses missing required options", () => {
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  const tool = makeTool(async () => "x");
  assert.throws(() => governMastraTool(tool, { client: undefined as unknown as AristotleClient, wardId: "w", subject: "s" }), /client/);
  assert.throws(() => governMastraTool(tool, { client, wardId: "", subject: "s" }), /wardId/);
  assert.throws(() => governMastraTool(tool, { client, wardId: "w", subject: "" }), /subject/);
});
