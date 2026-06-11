import test from "node:test";
import assert from "node:assert/strict";
import type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
import { AristotleApiError } from "@aristotle/os-sdk";
import {
  GovernedAnthropicHandler,
  governAnthropicTool,
  governAnthropicTools,
  type AnthropicTool
} from "./index.js";

// ---------------------------------------------------------------------------
// Stub AristotleClient factories
// ---------------------------------------------------------------------------

function allowingClient(warrantId = "warrant:ant-001"): AristotleClient {
  const stub = {
    evaluate: async (_a: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "ALLOW",
      reason_codes: [],
      canonical_action_hash: "sha256:ant-test",
      warrant: { warrant_id: warrantId, signature: "ed25519:opaque" },
      gel_record: { record_id: "rec-ant", record_hash: "rh-ant" }
    })
  };
  return stub as unknown as AristotleClient;
}

function refusingClient(reasonCodes = ["FORBIDDEN"]): AristotleClient {
  const stub = {
    evaluate: async (_a: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "REFUSE",
      reason_codes: reasonCodes,
      canonical_action_hash: "sha256:ant-refused",
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
// Reference tool definition
// ---------------------------------------------------------------------------

const SEARCH_TOOL: AnthropicTool = {
  name: "search_database",
  description: "Search the customer database.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"]
  }
};

const SEND_EMAIL_TOOL: AnthropicTool = {
  name: "send_email",
  description: "Send an email.",
  input_schema: {
    type: "object",
    properties: { to: { type: "string" }, body: { type: "string" } },
    required: ["to", "body"]
  }
};

// ---------------------------------------------------------------------------
// Tool-definition wrappers preserve shape
// ---------------------------------------------------------------------------

test("governAnthropicTool: preserves name + description + input_schema", () => {
  const wrapped = governAnthropicTool(SEARCH_TOOL, {
    client: allowingClient(),
    wardId: "w", subject: "agent:s"
  });
  assert.equal(wrapped.name, SEARCH_TOOL.name);
  assert.equal(wrapped.description, SEARCH_TOOL.description);
  assert.deepEqual(wrapped.input_schema, SEARCH_TOOL.input_schema);
});

test("governAnthropicTool: preserves pass-through fields (e.g. cache_control)", () => {
  const tool: AnthropicTool = {
    ...SEARCH_TOOL,
    cache_control: { type: "ephemeral" }
  };
  const wrapped = governAnthropicTool(tool, {
    client: allowingClient(),
    wardId: "w", subject: "agent:s"
  });
  assert.deepEqual(wrapped.cache_control, { type: "ephemeral" });
});

test("governAnthropicTool: rejects bad input shape", () => {
  // @ts-expect-error — deliberate misuse
  assert.throws(() => governAnthropicTool(null, { client: allowingClient(), wardId: "w", subject: "agent:s" }), /tool must be an object/);
  // @ts-expect-error — deliberate misuse
  assert.throws(() => governAnthropicTool({ description: "x" }, { client: allowingClient(), wardId: "w", subject: "agent:s" }), /tool\.name is required/);
});

test("governAnthropicTools: wraps every entry of the input map", () => {
  const wrapped = governAnthropicTools(
    { search: SEARCH_TOOL, email: SEND_EMAIL_TOOL },
    { client: allowingClient(), wardId: "w", subject: "agent:s" }
  );
  assert.equal(Object.keys(wrapped).length, 2);
  assert.equal(wrapped.search.name, "search_database");
  assert.equal(wrapped.email.name, "send_email");
  // Each is a fresh object (no aliasing).
  assert.notStrictEqual(wrapped.search, SEARCH_TOOL);
  assert.notStrictEqual(wrapped.email, SEND_EMAIL_TOOL);
});

// ---------------------------------------------------------------------------
// GovernedAnthropicHandler — ALLOW path
// ---------------------------------------------------------------------------

test("executeTool: ALLOW invokes handler, returns string content + isError: false + ALLOW metadata", async () => {
  let handlerCalled = false;
  const handler = new GovernedAnthropicHandler({
    client: allowingClient("warrant:exec-001"),
    wardId: "w-1", subject: "agent:a",
    handlers: {
      search_database: async (input) => {
        handlerCalled = true;
        return `results for ${input.query as string}`;
      }
    }
  });
  const result = await handler.executeTool("search_database", { query: "hello" });
  assert.equal(handlerCalled, true);
  assert.equal(result.isError, false);
  assert.equal(result.content, "results for hello");
  assert.equal(result._aristotle.decision, "ALLOW");
  assert.equal(result._aristotle.warrant_id, "warrant:exec-001");
  assert.equal(result._aristotle.canonical_action_hash, "sha256:ant-test");
});

test("executeTool: governance context is passed to the handler", async () => {
  let observed: { warrant_id?: string; ward_id?: string; subject?: string } = {};
  const handler = new GovernedAnthropicHandler({
    client: allowingClient("warrant:ctx-001"),
    wardId: "ward-ctx-test", subject: "agent:ctx-test",
    handlers: {
      probe: async (_input, ctx) => {
        observed = { warrant_id: ctx.warrant_id, ward_id: ctx.ward_id, subject: ctx.subject };
        return "ok";
      }
    }
  });
  await handler.executeTool("probe", {});
  assert.equal(observed.warrant_id, "warrant:ctx-001");
  assert.equal(observed.ward_id, "ward-ctx-test");
  assert.equal(observed.subject, "agent:ctx-test");
});

test("executeTool: non-string handler result is JSON-stringified", async () => {
  const handler = new GovernedAnthropicHandler({
    client: allowingClient(),
    wardId: "w", subject: "agent:a",
    handlers: { obj: async () => ({ value: 42, list: [1, 2] }) }
  });
  const result = await handler.executeTool("obj", {});
  assert.equal(result.isError, false);
  assert.equal(JSON.parse(result.content).value, 42);
});

test("executeTool: tool_use_id echoes back when provided", async () => {
  const handler = new GovernedAnthropicHandler({
    client: allowingClient(),
    wardId: "w", subject: "agent:a",
    handlers: { x: async () => "ok" }
  });
  const result = await handler.executeTool("x", {}, { toolUseId: "toolu_01ABC" });
  assert.equal(result.tool_use_id, "toolu_01ABC");
});

test("executeToolUseBlock: dispatches from a tool_use content block", async () => {
  const handler = new GovernedAnthropicHandler({
    client: allowingClient(),
    wardId: "w", subject: "agent:a",
    handlers: { echo: async (input) => `echo: ${input.message as string}` }
  });
  const result = await handler.executeToolUseBlock({
    type: "tool_use",
    id: "toolu_xyz",
    name: "echo",
    input: { message: "hi" }
  });
  assert.equal(result.tool_use_id, "toolu_xyz");
  assert.equal(result.content, "echo: hi");
  assert.equal(result.isError, false);
});

// ---------------------------------------------------------------------------
// Refusal paths — handler must NOT be invoked
// ---------------------------------------------------------------------------

test("executeTool: REFUSE returns isError + GATE_REFUSED metadata, handler NOT invoked", async () => {
  let handlerCalled = false;
  const handler = new GovernedAnthropicHandler({
    client: refusingClient(["FORBIDDEN_BY_POLICY"]),
    wardId: "w", subject: "agent:a",
    handlers: {
      sensitive: async () => {
        handlerCalled = true;
        return "should never happen";
      }
    }
  });
  const result = await handler.executeTool("sensitive", {});
  assert.equal(handlerCalled, false, "REFUSE must not invoke the underlying handler");
  assert.equal(result.isError, true);
  assert.equal(result._aristotle.decision, "REFUSE");
  assert.ok(result._aristotle.reason_codes.includes("GATE_REFUSED"));
  assert.ok(result._aristotle.reason_codes.includes("FORBIDDEN_BY_POLICY"));
  assert.ok(result.content.includes("REFUSE"));
  assert.ok(result.content.includes("FORBIDDEN_BY_POLICY"));
});

test("executeTool: gate unreachable returns isError + GATE_UNREACHABLE, handler NOT invoked", async () => {
  let handlerCalled = false;
  const handler = new GovernedAnthropicHandler({
    client: unreachableClient(),
    wardId: "w", subject: "agent:a",
    handlers: {
      x: async () => {
        handlerCalled = true;
        return "should never happen";
      }
    }
  });
  const result = await handler.executeTool("x", {});
  assert.equal(handlerCalled, false);
  assert.equal(result.isError, true);
  assert.deepEqual(result._aristotle.reason_codes, ["GATE_UNREACHABLE"]);
  assert.ok(result.content.includes("gate unreachable"));
});

test("executeTool: gate HTTP error treated as fail-closed (GATE_UNREACHABLE)", async () => {
  const handler = new GovernedAnthropicHandler({
    client: httpErrorClient(503),
    wardId: "w", subject: "agent:a",
    handlers: { x: async () => "ok" }
  });
  const result = await handler.executeTool("x", {});
  assert.equal(result.isError, true);
  assert.ok(result.content.includes("HTTP 503"));
  assert.deepEqual(result._aristotle.reason_codes, ["GATE_UNREACHABLE"]);
});

test("executeTool: ALLOW without Warrant returns MISSING_WARRANT, handler NOT invoked", async () => {
  let handlerCalled = false;
  const noWarrantClient = {
    evaluate: async (_a: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "ALLOW",
      reason_codes: [],
      canonical_action_hash: "sha256:no-warrant",
      gel_record: { record_id: "rec", record_hash: "rh" }
    } as EvaluateResponse)
  } as unknown as AristotleClient;
  const handler = new GovernedAnthropicHandler({
    client: noWarrantClient,
    wardId: "w", subject: "agent:a",
    handlers: {
      x: async () => {
        handlerCalled = true;
        return "should never happen";
      }
    }
  });
  const result = await handler.executeTool("x", {});
  assert.equal(handlerCalled, false);
  assert.equal(result.isError, true);
  assert.deepEqual(result._aristotle.reason_codes, ["MISSING_WARRANT"]);
});

test("executeTool: handler exception after ALLOW returns isError + HANDLER_THREW", async () => {
  const handler = new GovernedAnthropicHandler({
    client: allowingClient(),
    wardId: "w", subject: "agent:a",
    handlers: {
      thrower: async () => { throw new Error("disk full"); }
    }
  });
  const result = await handler.executeTool("thrower", {});
  assert.equal(result.isError, true);
  assert.ok(result.content.includes("disk full"));
  assert.equal(result._aristotle.decision, "ALLOW");
  assert.deepEqual(result._aristotle.reason_codes, ["HANDLER_THREW"]);
});

test("executeTool: unknown tool name returns isError + UNKNOWN_TOOL", async () => {
  const handler = new GovernedAnthropicHandler({
    client: allowingClient(),
    wardId: "w", subject: "agent:a",
    handlers: { known: async () => "ok" }
  });
  const result = await handler.executeTool("not-registered", {});
  assert.equal(result.isError, true);
  assert.deepEqual(result._aristotle.reason_codes, ["UNKNOWN_TOOL"]);
  assert.ok(result.content.includes("Unknown tool"));
});

// ---------------------------------------------------------------------------
// Action-type derivation
// ---------------------------------------------------------------------------

test("action_type default is anthropic.<toolName>", async () => {
  let observed = "";
  const obs = {
    evaluate: async (a: CanonicalAction): Promise<EvaluateResponse> => {
      observed = a.action_type;
      return {
        decision: "ALLOW", reason_codes: [], canonical_action_hash: "h",
        warrant: { warrant_id: "w", signature: "s" },
        gel_record: { record_id: "r", record_hash: "rh" }
      };
    }
  } as unknown as AristotleClient;
  const handler = new GovernedAnthropicHandler({
    client: obs, wardId: "w", subject: "agent:a",
    handlers: { search_database: async () => "ok" }
  });
  await handler.executeTool("search_database", {});
  assert.equal(observed, "anthropic.search_database");
});

test("actionTypeFor: per-tool override is used", async () => {
  let observed = "";
  const obs = {
    evaluate: async (a: CanonicalAction): Promise<EvaluateResponse> => {
      observed = a.action_type;
      return {
        decision: "ALLOW", reason_codes: [], canonical_action_hash: "h",
        warrant: { warrant_id: "w", signature: "s" },
        gel_record: { record_id: "r", record_hash: "rh" }
      };
    }
  } as unknown as AristotleClient;
  const handler = new GovernedAnthropicHandler({
    client: obs, wardId: "w", subject: "agent:a",
    handlers: { transfer_title: async () => "ok" },
    actionTypeFor: (name) => `title.${name}.v1`
  });
  await handler.executeTool("transfer_title", {});
  assert.equal(observed, "title.transfer_title.v1");
});

test("buildParams: transforms params before they reach the gate", async () => {
  let observed: Record<string, unknown> | undefined;
  const obs = {
    evaluate: async (a: CanonicalAction): Promise<EvaluateResponse> => {
      observed = a.params as Record<string, unknown>;
      return {
        decision: "ALLOW", reason_codes: [], canonical_action_hash: "h",
        warrant: { warrant_id: "w", signature: "s" },
        gel_record: { record_id: "r", record_hash: "rh" }
      };
    }
  } as unknown as AristotleClient;
  const handler = new GovernedAnthropicHandler({
    client: obs, wardId: "w", subject: "agent:a",
    handlers: { x: async () => "ok" },
    buildParams: (_n, input) => ({ ...input, normalized: true })
  });
  await handler.executeTool("x", { foo: "bar" });
  assert.deepEqual(observed, { foo: "bar", normalized: true });
});

test("onDecision: telemetry hook fires with action + decision + elapsedMs", async () => {
  const events: Array<{ tool: string; decision: string }> = [];
  const handler = new GovernedAnthropicHandler({
    client: allowingClient(),
    wardId: "w", subject: "agent:a",
    handlers: { x: async () => "ok" },
    onDecision: (info) => {
      events.push({ tool: info.toolName, decision: info.decision.decision });
    }
  });
  await handler.executeTool("x", {});
  assert.equal(events.length, 1);
  assert.equal(events[0].tool, "x");
  assert.equal(events[0].decision, "ALLOW");
});

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

test("constructor: missing required opts throws", () => {
  // @ts-expect-error — deliberate misuse
  assert.throws(() => new GovernedAnthropicHandler({ wardId: "w", subject: "s", handlers: {} }), /client/);
  // @ts-expect-error — deliberate misuse
  assert.throws(() => new GovernedAnthropicHandler({ client: allowingClient(), subject: "s", handlers: {} }), /wardId/);
  // @ts-expect-error — deliberate misuse
  assert.throws(() => new GovernedAnthropicHandler({ client: allowingClient(), wardId: "w", handlers: {} }), /subject/);
  // @ts-expect-error — deliberate misuse
  assert.throws(() => new GovernedAnthropicHandler({ client: allowingClient(), wardId: "w", subject: "s" }), /handlers/);
});
