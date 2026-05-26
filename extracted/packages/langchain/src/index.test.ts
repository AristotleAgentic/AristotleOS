import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import { ToolEscalationError, ToolGovernanceError, governTool, governTools, type LangChainToolLike } from "./index.js";

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

function fakeTool(name: string, fn: (input: unknown, config?: unknown) => Promise<unknown>): LangChainToolLike {
  return {
    name,
    description: `${name} tool`,
    schema: { type: "object" },
    invoke: fn
  };
}

const allowBody = {
  decision: "ALLOW",
  reason_codes: [],
  canonical_action_hash: "h",
  warrant: { warrant_id: "wr-1" },
  gel_record: { record_id: "rec-1", record_hash: "rh" }
};

test("ALLOW runs the underlying tool's invoke with the original input + config", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: allowBody }));
  let captured: { input: unknown; config: unknown } | null = null;
  const tool = fakeTool("search_database", async (input, config) => {
    captured = { input, config };
    return "ran with input";
  });
  const guarded = governTool(tool, { client, wardId: "ward-agents", subject: "agent:1" });
  const result = await guarded.invoke({ query: "alice" }, { runId: "r-1" });
  assert.equal(result, "ran with input");
  assert.deepEqual(captured?.input, { query: "alice" });
  assert.deepEqual(captured?.config, { runId: "r-1" });
  assert.equal(calls.length, 1, "exactly one gate call");
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string; subject: string; ward_id: string; params: Record<string, unknown> } };
  assert.equal(body.action.action_type, "tool.search_database");
  assert.equal(body.action.ward_id, "ward-agents");
  assert.equal(body.action.subject, "agent:1");
  assert.deepEqual(body.action.params, { query: "alice" });
});

test("REFUSE throws ToolGovernanceError with the gate's reason codes and the underlying tool never runs", async () => {
  const { client } = makeClient(() => ({
    status: 200,
    body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } }
  }));
  let toolRan = false;
  const tool = fakeTool("delete_user", async () => { toolRan = true; return "deleted"; });
  const guarded = governTool(tool, { client, wardId: "w", subject: "s" });
  await assert.rejects(
    () => guarded.invoke({ userId: 42 }),
    (err: unknown) => {
      assert.ok(err instanceof ToolGovernanceError);
      assert.equal((err as ToolGovernanceError).toolName, "delete_user");
      assert.deepEqual((err as ToolGovernanceError).reasonCodes, ["ACTION_DENIED", "PHYSICAL_INVARIANT_FAILED"]);
      assert.equal((err as ToolGovernanceError).gelRecordId, "rec-1");
      return true;
    }
  );
  assert.equal(toolRan, false, "underlying tool must not run on REFUSE");
});

test("ESCALATE throws ToolEscalationError by default; underlying tool never runs", async () => {
  const { client } = makeClient(() => ({
    status: 200,
    body: { decision: "ESCALATE", reason_codes: ["DUAL_CONTROL_REQUIRED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } }
  }));
  let toolRan = false;
  const tool = fakeTool("send_email", async () => { toolRan = true; return "sent"; });
  const guarded = governTool(tool, { client, wardId: "w", subject: "s" });
  await assert.rejects(
    () => guarded.invoke({ to: "alice@example.com" }),
    (err: unknown) => {
      assert.ok(err instanceof ToolEscalationError);
      assert.equal((err as ToolEscalationError).toolName, "send_email");
      assert.deepEqual((err as ToolEscalationError).reasonCodes, ["DUAL_CONTROL_REQUIRED"]);
      return true;
    }
  );
  assert.equal(toolRan, false);
});

test("onEscalate:'return' returns a marker string instead of throwing on ESCALATE", async () => {
  const { client } = makeClient(() => ({
    status: 200,
    body: { decision: "ESCALATE", reason_codes: ["DUAL_CONTROL_REQUIRED"], canonical_action_hash: "h", gel_record: { record_id: "rec-1", record_hash: "rh" } }
  }));
  const tool = fakeTool("send_email", async () => { throw new Error("should not run"); });
  const guarded = governTool(tool, { client, wardId: "w", subject: "s", onEscalate: "return" });
  const result = await guarded.invoke({ to: "alice@example.com" });
  assert.match(String(result), /ESCALATE/);
  assert.match(String(result), /DUAL_CONTROL_REQUIRED/);
});

test("default action_type is tool.<lowercased>; custom actionTypeFor routes into a vertical", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: allowBody }));
  const tool = fakeTool("transfer_title", async () => "ok");
  const guarded = governTool(tool, {
    client, wardId: "ward-title", subject: "agent:title",
    actionTypeFor: (n) => n === "transfer_title" ? "title.transfer" : `tool.${n.toLowerCase()}`
  });
  await guarded.invoke({ vin: "V", to: "Alice" });
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string; params: Record<string, unknown> } };
  assert.equal(body.action.action_type, "title.transfer");
  assert.deepEqual(body.action.params, { vin: "V", to: "Alice" });
});

test("buildAction takes full control over the canonical action shape", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: allowBody }));
  const tool = fakeTool("audit_log", async () => "ok");
  const guarded = governTool(tool, {
    client, wardId: "w", subject: "s",
    buildAction: ({ toolName, toolInput, invocationId }) => ({
      action_id: invocationId,
      ward_id: "ward-override",
      subject: "agent:override",
      action_type: `audit.${toolName}`,
      params: { wrapped: toolInput },
      target: "audit-store"
    })
  });
  await guarded.invoke({ event: "login" });
  const body = JSON.parse(calls[0].body!) as { action: { action_type: string; ward_id: string; params: Record<string, unknown>; target: string } };
  assert.equal(body.action.action_type, "audit.audit_log");
  assert.equal(body.action.ward_id, "ward-override");
  assert.deepEqual(body.action.params, { wrapped: { event: "login" } });
  assert.equal(body.action.target, "audit-store");
});

test("passthroughTools skips the gate call entirely and runs the original tool", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: { decision: "REFUSE", reason_codes: [], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } } }));
  const tool = fakeTool("read_only_query", async () => "read result");
  const guarded = governTool(tool, { client, wardId: "w", subject: "s", passthroughTools: ["read_only_query"] });
  const result = await guarded.invoke({ q: "select 1" });
  assert.equal(result, "read result");
  assert.equal(calls.length, 0, "gate must not be called for a passthrough tool");
});

test("onDecision telemetry fires with the verdict + elapsed time", async () => {
  type DecisionInfo = Parameters<NonNullable<Parameters<typeof governTool>[1]["onDecision"]>>[0];
  const seen: DecisionInfo[] = [];
  const { client } = makeClient(() => ({ status: 200, body: allowBody }));
  const tool = fakeTool("search", async () => "result");
  const guarded = governTool(tool, { client, wardId: "w", subject: "s", onDecision: (info) => { seen.push(info); } });
  await guarded.invoke({ q: "x" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].toolName, "search");
  assert.equal(seen[0].action.action_type, "tool.search");
  assert.ok(typeof seen[0].elapsedMs === "number");
});

test("gate-unreachable defaults to fail-closed deny (ToolGovernanceError)", async () => {
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: (async () => { throw new Error("network down"); }) as unknown as typeof fetch });
  const tool = fakeTool("send_payment", async () => "sent");
  const guarded = governTool(tool, { client, wardId: "w", subject: "s" });
  await assert.rejects(
    () => guarded.invoke({ to: "alice", amount: 100 }),
    (err: unknown) => {
      assert.ok(err instanceof ToolGovernanceError);
      assert.match(String(err), /network down|unreachable/i);
      return true;
    }
  );
});

test("onError:'escalate' raises ToolEscalationError when the gate is unreachable", async () => {
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: (async () => { throw new Error("timeout"); }) as unknown as typeof fetch });
  const tool = fakeTool("send_email", async () => "sent");
  const guarded = governTool(tool, { client, wardId: "w", subject: "s", onError: "escalate" });
  await assert.rejects(
    () => guarded.invoke({ to: "x" }),
    (err: unknown) => err instanceof ToolEscalationError
  );
});

test("governTools maps over an array preserving every tool's shape", async () => {
  const { client } = makeClient(() => ({ status: 200, body: allowBody }));
  const tools = [
    fakeTool("a", async () => "a-result"),
    fakeTool("b", async () => "b-result")
  ];
  const guarded = governTools(tools, { client, wardId: "w", subject: "s" });
  assert.equal(guarded.length, 2);
  assert.equal(guarded[0].name, "a");
  assert.equal(guarded[1].name, "b");
  assert.equal(guarded[0].description, "a tool");
  assert.equal(await guarded[0].invoke({}), "a-result");
  assert.equal(await guarded[1].invoke({}), "b-result");
});

test("the original tool is not mutated; governTool returns a new object", () => {
  const { client } = makeClient(() => ({ status: 200, body: allowBody }));
  const tool = fakeTool("x", async () => "ok");
  const originalInvoke = tool.invoke;
  const guarded = governTool(tool, { client, wardId: "w", subject: "s" });
  assert.notEqual(guarded, tool);
  assert.notEqual(guarded.invoke, tool.invoke);
  assert.equal(tool.invoke, originalInvoke, "original tool's invoke must be unchanged");
});

test("string input is normalized into params:{input: '...'}", async () => {
  const { client, calls } = makeClient(() => ({ status: 200, body: allowBody }));
  const tool = fakeTool("legacy_string_tool", async () => "ok");
  const guarded = governTool(tool, { client, wardId: "w", subject: "s" });
  await guarded.invoke("the literal string");
  const body = JSON.parse(calls[0].body!) as { action: { params: Record<string, unknown> } };
  assert.deepEqual(body.action.params, { input: "the literal string" });
});

test("constructor refuses missing required options", () => {
  const { client } = makeClient(() => ({ status: 200, body: allowBody }));
  const tool = fakeTool("x", async () => "ok");
  assert.throws(() => governTool(tool, { client: undefined as unknown as AristotleClient, wardId: "w", subject: "s" }), /client/);
  assert.throws(() => governTool(tool, { client, wardId: "", subject: "s" }), /wardId/);
  assert.throws(() => governTool(tool, { client, wardId: "w", subject: "" }), /subject/);
});
