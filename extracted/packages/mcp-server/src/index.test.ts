import test from "node:test";
import assert from "node:assert/strict";
import type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
import { AristotleApiError } from "@aristotle/os-sdk";
import {
  type GovernanceContext,
  type McpCallResult,
  type UnwrappedMcpTool,
  createGovernedMcpServer
} from "./index.js";

// ---------------------------------------------------------------------------
// Stub AristotleClient factories
// ---------------------------------------------------------------------------

function allowingClient(warrantId = "warrant:mcp-001"): AristotleClient {
  const stub = {
    evaluate: async (_a: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "ALLOW",
      reason_codes: [],
      canonical_action_hash: "sha256:mcp-test",
      warrant: { warrant_id: warrantId, signature: "ed25519:opaque" },
      gel_record: { record_id: "rec-mcp", record_hash: "rh-mcp" }
    })
  };
  return stub as unknown as AristotleClient;
}

function refusingClient(reasonCodes = ["FORBIDDEN"]): AristotleClient {
  const stub = {
    evaluate: async (_a: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "REFUSE",
      reason_codes: reasonCodes,
      canonical_action_hash: "sha256:mcp-refused",
      gel_record: { record_id: "rec-refuse", record_hash: "rh" }
    })
  };
  return stub as unknown as AristotleClient;
}

function unreachableClient(): AristotleClient {
  const stub = {
    evaluate: async (_a: CanonicalAction): Promise<EvaluateResponse> => {
      throw new Error("ECONNREFUSED");
    }
  };
  return stub as unknown as AristotleClient;
}

function httpErrorClient(status: number): AristotleClient {
  const stub = {
    evaluate: async (_a: CanonicalAction): Promise<EvaluateResponse> => {
      throw new AristotleApiError(status, "gate said no", { status });
    }
  };
  return stub as unknown as AristotleClient;
}

// ---------------------------------------------------------------------------
// A simple echo tool the server can wrap
// ---------------------------------------------------------------------------

const echoTool: UnwrappedMcpTool<{ message: string }, string> = {
  name: "echo",
  description: "Returns the message back.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"]
  },
  handler: async (args, _ctx) => `echo: ${args.message}`
};

const recordsCtxTool: UnwrappedMcpTool<{ x: number }, GovernanceContext> = {
  name: "ctx",
  description: "Echoes the governance context.",
  inputSchema: { type: "object" },
  handler: async (_args, ctx) => ctx
};

// ---------------------------------------------------------------------------
// listTools
// ---------------------------------------------------------------------------

test("listTools: returns name + description + inputSchema for every wrapped tool", () => {
  const server = createGovernedMcpServer({
    client: allowingClient(),
    wardId: "w", subject: "agent:s",
    tools: [echoTool, recordsCtxTool]
  });
  const list = server.listTools();
  assert.equal(list.tools.length, 2);
  assert.equal(list.tools[0].name, "echo");
  assert.equal(list.tools[1].name, "ctx");
  assert.equal(list.tools[0].inputSchema.type, "object");
});

// ---------------------------------------------------------------------------
// callTool — ALLOW path
// ---------------------------------------------------------------------------

test("callTool: ALLOW invokes handler and returns content + _aristotle ALLOW metadata", async () => {
  const server = createGovernedMcpServer({
    client: allowingClient("warrant:test-001"),
    wardId: "w", subject: "agent:s",
    tools: [echoTool]
  });
  const result = await server.callTool("echo", { message: "hello" });
  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.equal((result.content[0] as { text: string }).text, "echo: hello");
  assert.equal(result._aristotle?.decision, "ALLOW");
  assert.equal(result._aristotle?.warrant_id, "warrant:test-001");
});

test("callTool: governance context is passed to the handler", async () => {
  const server = createGovernedMcpServer({
    client: allowingClient("warrant:ctx-test"),
    wardId: "w-test", subject: "agent:s-test",
    tools: [recordsCtxTool]
  });
  const result = await server.callTool("ctx", { x: 1 });
  assert.equal(result.isError, undefined);
  const ctxJson = (result.content[0] as { text: string }).text;
  const ctx = JSON.parse(ctxJson) as GovernanceContext;
  assert.equal(ctx.warrant_id, "warrant:ctx-test");
  assert.equal(ctx.ward_id, "w-test");
  assert.equal(ctx.subject, "agent:s-test");
});

// ---------------------------------------------------------------------------
// callTool — refusal paths
// ---------------------------------------------------------------------------

test("callTool: REFUSE returns isError + content describing the refusal + _aristotle REFUSE metadata", async () => {
  const server = createGovernedMcpServer({
    client: refusingClient(["MCP_FORBIDDEN_BY_POLICY"]),
    wardId: "w", subject: "agent:s",
    tools: [echoTool]
  });
  const result = await server.callTool("echo", { message: "should refuse" });
  assert.equal(result.isError, true);
  assert.ok((result.content[0] as { text: string }).text.includes("REFUSE"));
  assert.ok((result.content[0] as { text: string }).text.includes("MCP_FORBIDDEN_BY_POLICY"));
  assert.equal(result._aristotle?.decision, "REFUSE");
  assert.deepEqual(result._aristotle?.reason_codes, ["MCP_FORBIDDEN_BY_POLICY"]);
});

test("callTool: gate unreachable -> isError + GATE_UNREACHABLE reason", async () => {
  const server = createGovernedMcpServer({
    client: unreachableClient(),
    wardId: "w", subject: "agent:s",
    tools: [echoTool]
  });
  const result = await server.callTool("echo", { message: "x" });
  assert.equal(result.isError, true);
  assert.ok((result.content[0] as { text: string }).text.includes("gate unreachable"));
  assert.equal(result._aristotle?.decision, "REFUSE");
  assert.deepEqual(result._aristotle?.reason_codes, ["GATE_UNREACHABLE"]);
});

test("callTool: gate HTTP error surfaces as fail-closed", async () => {
  const server = createGovernedMcpServer({
    client: httpErrorClient(503),
    wardId: "w", subject: "agent:s",
    tools: [echoTool]
  });
  const result = await server.callTool("echo", { message: "x" });
  assert.equal(result.isError, true);
  assert.ok((result.content[0] as { text: string }).text.includes("HTTP 503"));
});

test("callTool: ALLOW without Warrant surfaces as MISSING_WARRANT (defensive)", async () => {
  const noWarrantClient = {
    evaluate: async (_a: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "ALLOW",
      reason_codes: [],
      canonical_action_hash: "sha256:no-warrant",
      gel_record: { record_id: "rec", record_hash: "rh" }
    } as EvaluateResponse)
  } as unknown as AristotleClient;
  const server = createGovernedMcpServer({
    client: noWarrantClient,
    wardId: "w", subject: "agent:s",
    tools: [echoTool]
  });
  const result = await server.callTool("echo", { message: "x" });
  assert.equal(result.isError, true);
  assert.deepEqual(result._aristotle?.reason_codes, ["MISSING_WARRANT"]);
});

test("callTool: handler exception after ALLOW surfaces as isError + HANDLER_THREW", async () => {
  const throwingTool: UnwrappedMcpTool = {
    name: "thrower", description: "", inputSchema: { type: "object" },
    handler: async () => { throw new Error("disk full"); }
  };
  const server = createGovernedMcpServer({
    client: allowingClient(),
    wardId: "w", subject: "agent:s",
    tools: [throwingTool]
  });
  const result = await server.callTool("thrower", {});
  assert.equal(result.isError, true);
  assert.ok((result.content[0] as { text: string }).text.includes("disk full"));
  assert.equal(result._aristotle?.decision, "ALLOW");
  assert.deepEqual(result._aristotle?.reason_codes, ["HANDLER_THREW"]);
});

test("callTool: unknown tool name returns isError", async () => {
  const server = createGovernedMcpServer({
    client: allowingClient(),
    wardId: "w", subject: "agent:s",
    tools: [echoTool]
  });
  const result = await server.callTool("nonexistent", {});
  assert.equal(result.isError, true);
  assert.ok((result.content[0] as { text: string }).text.includes("Unknown tool"));
});

// ---------------------------------------------------------------------------
// Customization options
// ---------------------------------------------------------------------------

test("actionTypeFor: override is used to build the CanonicalAction action_type", async () => {
  let observedActionType = "";
  const observingClient = {
    evaluate: async (a: CanonicalAction): Promise<EvaluateResponse> => {
      observedActionType = a.action_type;
      return {
        decision: "ALLOW", reason_codes: [], canonical_action_hash: "h",
        warrant: { warrant_id: "w", signature: "s" },
        gel_record: { record_id: "r", record_hash: "rh" }
      };
    }
  } as unknown as AristotleClient;
  const server = createGovernedMcpServer({
    client: observingClient,
    wardId: "w", subject: "agent:s",
    tools: [echoTool],
    actionTypeFor: (t) => `custom.namespace.${t.name}.v1`
  });
  await server.callTool("echo", { message: "x" });
  assert.equal(observedActionType, "custom.namespace.echo.v1");
});

test("default action_type is mcp.<toolName>", async () => {
  let observedActionType = "";
  const observingClient = {
    evaluate: async (a: CanonicalAction): Promise<EvaluateResponse> => {
      observedActionType = a.action_type;
      return {
        decision: "ALLOW", reason_codes: [], canonical_action_hash: "h",
        warrant: { warrant_id: "w", signature: "s" },
        gel_record: { record_id: "r", record_hash: "rh" }
      };
    }
  } as unknown as AristotleClient;
  const server = createGovernedMcpServer({
    client: observingClient,
    wardId: "w", subject: "agent:s",
    tools: [echoTool]
  });
  await server.callTool("echo", { message: "x" });
  assert.equal(observedActionType, "mcp.echo");
});

test("buildParams: override transforms args before they reach the gate", async () => {
  let observedParams: Record<string, unknown> | undefined;
  const observingClient = {
    evaluate: async (a: CanonicalAction): Promise<EvaluateResponse> => {
      observedParams = a.params as Record<string, unknown>;
      return {
        decision: "ALLOW", reason_codes: [], canonical_action_hash: "h",
        warrant: { warrant_id: "w", signature: "s" },
        gel_record: { record_id: "r", record_hash: "rh" }
      };
    }
  } as unknown as AristotleClient;
  const server = createGovernedMcpServer({
    client: observingClient,
    wardId: "w", subject: "agent:s",
    tools: [echoTool],
    buildParams: (_t, args) => ({ ...args, normalized: true })
  });
  await server.callTool("echo", { message: "x" });
  assert.deepEqual(observedParams, { message: "x", normalized: true });
});

// ---------------------------------------------------------------------------
// Custom formatResult
// ---------------------------------------------------------------------------

test("formatResult: tool override controls how the handler result becomes content", async () => {
  const customTool: UnwrappedMcpTool<{ x: number }, { value: number }> = {
    name: "custom",
    description: "", inputSchema: { type: "object" },
    handler: async (args) => ({ value: args.x * 2 }),
    formatResult: (r) => [{ type: "text", text: `Doubled to ${r.value}` }]
  };
  const server = createGovernedMcpServer({
    client: allowingClient(),
    wardId: "w", subject: "agent:s",
    tools: [customTool]
  });
  const result = await server.callTool("custom", { x: 21 });
  assert.equal((result.content[0] as { text: string }).text, "Doubled to 42");
});

// ---------------------------------------------------------------------------
// Cross-cutting: no handler invocation on REFUSE
// ---------------------------------------------------------------------------

test("REFUSE: handler is NEVER invoked", async () => {
  let handlerCalled = false;
  const spyTool: UnwrappedMcpTool = {
    name: "spy", description: "", inputSchema: { type: "object" },
    handler: async () => { handlerCalled = true; return "should never happen"; }
  };
  const server = createGovernedMcpServer({
    client: refusingClient(),
    wardId: "w", subject: "agent:s",
    tools: [spyTool]
  });
  await server.callTool("spy", {});
  assert.equal(handlerCalled, false,
    "REFUSE must not invoke the underlying handler — same fail-closed invariant as the other adapters");
});
