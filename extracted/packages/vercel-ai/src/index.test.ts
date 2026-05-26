import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import {
  AristotleGateError,
  governTool,
  governTools,
  type AristotleToolOutcome,
  type VercelTool,
  type VercelToolExecutionOptions
} from "./index.js";

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
  return {
    client: new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn }),
    calls
  };
}

const ALLOW = {
  decision: "ALLOW",
  reason_codes: [],
  canonical_action_hash: "h",
  warrant: { warrant_id: "wr-1" },
  gel_record: { record_id: "rec-1", record_hash: "rh" }
};
const REFUSE = {
  decision: "REFUSE",
  reason_codes: ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"],
  canonical_action_hash: "h",
  gel_record: { record_id: "rec-1", record_hash: "rh" }
};
const ESCALATE = {
  decision: "ESCALATE",
  reason_codes: ["DUAL_CONTROL_REQUIRED"],
  canonical_action_hash: "h",
  gel_record: { record_id: "rec-1", record_hash: "rh" }
};

const EXEC_OPTS: VercelToolExecutionOptions = { toolCallId: "call-1", messages: [] };

function makeTool(impl: (input: unknown, opts: VercelToolExecutionOptions) => unknown | Promise<unknown>): VercelTool {
  return {
    description: "test tool",
    inputSchema: {},
    execute: impl
  };
}

test("ALLOW invokes inner execute and returns its output unchanged", async () => {
  const innerCalls: Array<{ input: unknown }> = [];
  const inner = makeTool(async (input) => {
    innerCalls.push({ input });
    return { ok: true, echo: input };
  });
  const { client, calls } = makeClient(() => ({ status: 200, body: ALLOW }));
  const governed = governTool("send_email", inner, { client, wardId: "ward-ops", subject: "agent:1" });

  const result = await governed.execute!({ to: "alice@example.com", body: "hi" }, EXEC_OPTS);
  assert.deepEqual(result, { ok: true, echo: { to: "alice@example.com", body: "hi" } });
  assert.equal(innerCalls.length, 1);
  assert.equal(calls.length, 1);

  const body = JSON.parse(calls[0].body!) as { action: { action_type: string; ward_id: string; subject: string; params: Record<string, unknown>; action_id: string } };
  assert.equal(body.action.action_type, "tool.send_email");
  assert.equal(body.action.ward_id, "ward-ops");
  assert.equal(body.action.subject, "agent:1");
  assert.deepEqual(body.action.params, { to: "alice@example.com", body: "hi" });
  assert.equal(body.action.action_id, "call-1");
});

test("REFUSE returns a structured AristotleToolOutcome by default; inner execute never runs", async () => {
  const innerCalls: unknown[] = [];
  const inner = makeTool(async () => { innerCalls.push("ran"); return "ok"; });
  const { client } = makeClient(() => ({ status: 200, body: REFUSE }));
  const governed = governTool("delete_user", inner, { client, wardId: "w", subject: "s" });

  const result = (await governed.execute!({ id: 42 }, EXEC_OPTS)) as AristotleToolOutcome;
  assert.equal(result.__aristotle, "REFUSE");
  assert.equal(result.toolName, "delete_user");
  assert.deepEqual(result.reasonCodes, ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"]);
  assert.equal(result.gelRecordId, "rec-1");
  assert.match(result.message, /REFUSE/);
  assert.match(result.message, /ACTION_DENIED/);
  assert.equal(innerCalls.length, 0);
});

test("REFUSE throws AristotleGateError when onRefuse:'throw'", async () => {
  const inner = makeTool(async () => "ok");
  const { client } = makeClient(() => ({ status: 200, body: REFUSE }));
  const governed = governTool("t", inner, { client, wardId: "w", subject: "s", onRefuse: "throw" });

  await assert.rejects(
    () => governed.execute!({}, EXEC_OPTS) as Promise<unknown>,
    (err: unknown) => {
      assert.ok(err instanceof AristotleGateError);
      assert.equal((err as AristotleGateError).kind, "REFUSE");
      assert.equal((err as AristotleGateError).toolName, "t");
      assert.deepEqual([...(err as AristotleGateError).reasonCodes], ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"]);
      return true;
    }
  );
});

test("ESCALATE returns AristotleToolOutcome by default; can throw when onEscalate:'throw'", async () => {
  const inner = makeTool(async () => "ok");
  const { client } = makeClient(() => ({ status: 200, body: ESCALATE }));

  const governedDefault = governTool("send_payment", inner, { client, wardId: "w", subject: "s" });
  const result = (await governedDefault.execute!({}, EXEC_OPTS)) as AristotleToolOutcome;
  assert.equal(result.__aristotle, "ESCALATE");
  assert.deepEqual(result.reasonCodes, ["DUAL_CONTROL_REQUIRED"]);

  const governedThrow = governTool("send_payment", inner, { client, wardId: "w", subject: "s", onEscalate: "throw" });
  await assert.rejects(
    () => governedThrow.execute!({}, EXEC_OPTS) as Promise<unknown>,
    (err: unknown) => err instanceof AristotleGateError && (err as AristotleGateError).kind === "ESCALATE"
  );
});

test("gate-unreachable throws by default; returns outcome with onError:'return-error'", async () => {
  const inner = makeTool(async () => "ok");
  const { fn } = mockFetch(() => ({ status: 0, body: "" }));
  // Real "unreachable" simulation: throw from fetch.
  const failingFetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;

  const clientDefault = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: failingFetch });
  const governedDefault = governTool("t", inner, { client: clientDefault, wardId: "w", subject: "s" });
  await assert.rejects(
    () => governedDefault.execute!({}, EXEC_OPTS) as Promise<unknown>,
    (err: unknown) => err instanceof AristotleGateError && (err as AristotleGateError).kind === "GATE_UNREACHABLE"
  );

  const clientReturn = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: failingFetch });
  const governedReturn = governTool("t", inner, { client: clientReturn, wardId: "w", subject: "s", onError: "return-error" });
  const result = (await governedReturn.execute!({}, EXEC_OPTS)) as AristotleToolOutcome;
  assert.equal(result.__aristotle, "GATE_UNREACHABLE");
  assert.match(result.message, /network down|unreachable/);

  // Silence unused warning.
  void fn;
});

test("passthroughTools returns the original tool unchanged (gate not called)", async () => {
  const innerCalls: unknown[] = [];
  const inner = makeTool(async (input) => { innerCalls.push(input); return "ran"; });
  const { client, calls } = makeClient(() => ({ status: 500, body: { error: "should not be reached" } }));
  const governed = governTool("read_kb", inner, {
    client,
    wardId: "w",
    subject: "s",
    passthroughTools: ["read_kb", "search_docs"]
  });
  assert.equal(governed, inner, "passthrough must return the original tool object");

  const result = await governed.execute!({ q: "x" }, EXEC_OPTS);
  assert.equal(result, "ran");
  assert.equal(calls.length, 0, "gate must not be called for a passthrough tool");
  assert.deepEqual(innerCalls, [{ q: "x" }]);
});

test("actionTypeFor routes specific tools into a vertical namespace", async () => {
  const inner = makeTool(async () => "ok");
  const { client, calls } = makeClient(() => ({ status: 200, body: ALLOW }));
  const governed = governTool("transfer_title", inner, {
    client,
    wardId: "ward-title",
    subject: "agent:title",
    actionTypeFor: (n) => (n === "transfer_title" ? "title.transfer" : `tool.${n.toLowerCase()}`)
  });

  await governed.execute!({ vin: "V", to: "Alice" }, EXEC_OPTS);
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string } };
  assert.equal(body.action.action_type, "title.transfer");
});

test("buildAction takes full control over the canonical action shape", async () => {
  const inner = makeTool(async () => "ok");
  const { client, calls } = makeClient(() => ({ status: 200, body: ALLOW }));
  const governed = governTool("audit_log", inner, {
    client,
    wardId: "w",
    subject: "s",
    buildAction: ({ toolName, toolInput, toolCallId }) => ({
      action_id: toolCallId,
      ward_id: "ward-custom",
      subject: "agent:custom",
      action_type: `custom.${toolName}`,
      params: { wrapped: toolInput },
      target: "custom-target"
    })
  });

  await governed.execute!({ event: "login" }, EXEC_OPTS);
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string; ward_id: string; params: Record<string, unknown>; target: string } };
  assert.equal(body.action.action_type, "custom.audit_log");
  assert.equal(body.action.ward_id, "ward-custom");
  assert.deepEqual(body.action.params, { wrapped: { event: "login" } });
  assert.equal(body.action.target, "custom-target");
});

test("onDecision telemetry fires with the gate verdict and elapsedMs", async () => {
  type DecisionInfo = Parameters<NonNullable<Parameters<typeof governTool>[2]["onDecision"]>>[0];
  const seen: DecisionInfo[] = [];
  const inner = makeTool(async () => "ok");
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  const governed = governTool("search", inner, {
    client,
    wardId: "w",
    subject: "s",
    onDecision: (info) => { seen.push(info); }
  });

  await governed.execute!({ q: "x" }, EXEC_OPTS);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].toolName, "search");
  assert.equal(seen[0].action.action_type, "tool.search");
  if ("warrant" in seen[0].decision) {
    assert.equal(seen[0].decision.warrant?.warrant_id, "wr-1");
  }
  assert.ok(typeof seen[0].elapsedMs === "number");
});

test("non-object input (string, number) normalizes into params:{input: value}", async () => {
  const inner = makeTool(async () => "ok");
  const { client, calls } = makeClient(() => ({ status: 200, body: ALLOW }));
  const governed = governTool("legacy_tool", inner, { client, wardId: "w", subject: "s" });

  await governed.execute!("the literal string", EXEC_OPTS);
  const body = JSON.parse(calls[0].body!) as { action: { params: Record<string, unknown> } };
  assert.deepEqual(body.action.params, { input: "the literal string" });
});

test("governTools wraps every tool in the record using the same options", async () => {
  const aCalls: unknown[] = [];
  const bCalls: unknown[] = [];
  const tools = {
    send_email: makeTool(async (i) => { aCalls.push(i); return "sent"; }),
    search_db: makeTool(async (i) => { bCalls.push(i); return "result"; })
  };
  const { client, calls } = makeClient(() => ({ status: 200, body: ALLOW }));
  const governed = governTools(tools, { client, wardId: "w", subject: "s" });

  assert.deepEqual(Object.keys(governed), ["send_email", "search_db"]);
  await governed.send_email.execute!({ to: "alice" }, { toolCallId: "c1", messages: [] });
  await governed.search_db.execute!({ q: "alice" }, { toolCallId: "c2", messages: [] });

  assert.equal(calls.length, 2);
  const b1 = JSON.parse(calls[0].body!) as { action: { action_type: string; action_id: string } };
  const b2 = JSON.parse(calls[1].body!) as { action: { action_type: string; action_id: string } };
  assert.equal(b1.action.action_type, "tool.send_email");
  assert.equal(b1.action.action_id, "c1");
  assert.equal(b2.action.action_type, "tool.search_db");
  assert.equal(b2.action.action_id, "c2");
  assert.deepEqual(aCalls, [{ to: "alice" }]);
  assert.deepEqual(bCalls, [{ q: "alice" }]);
});

test("a tool with no execute (e.g. provider-defined) is returned unchanged", async () => {
  const providerTool: VercelTool = { description: "provider-side", type: "provider" };
  const { client } = makeClient(() => ({ status: 200, body: REFUSE }));
  const governed = governTool("provider_tool", providerTool, { client, wardId: "w", subject: "s" });
  assert.equal(governed, providerTool);
});

test("constructor refuses missing required options", async () => {
  const inner = makeTool(async () => "ok");
  const { client } = makeClient(() => ({ status: 200, body: ALLOW }));
  assert.throws(() => governTool("", inner, { client, wardId: "w", subject: "s" }), /name/);
  assert.throws(() => governTool("t", inner, { client: undefined as unknown as AristotleClient, wardId: "w", subject: "s" }), /client/);
  assert.throws(() => governTool("t", inner, { client, wardId: "", subject: "s" }), /wardId/);
  assert.throws(() => governTool("t", inner, { client, wardId: "w", subject: "" }), /subject/);
});
