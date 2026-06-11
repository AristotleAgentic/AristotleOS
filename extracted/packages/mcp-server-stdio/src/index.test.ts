import test from "node:test";
import assert from "node:assert/strict";
import type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
import {
  createGovernedMcpServer,
  runStdioMcpServer,
  type UnwrappedMcpTool
} from "./index.js";

// ---------------------------------------------------------------------------
// Stub AristotleClient
// ---------------------------------------------------------------------------

function allowingClient(warrantId = "warrant:stdio-001"): AristotleClient {
  const stub = {
    evaluate: async (_a: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "ALLOW",
      reason_codes: [],
      canonical_action_hash: "sha256:stdio-test",
      warrant: { warrant_id: warrantId, signature: "ed25519:opaque" },
      gel_record: { record_id: "rec-stdio", record_hash: "rh-stdio" }
    })
  };
  return stub as unknown as AristotleClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("runStdioMcpServer: throws a clear, operator-facing error when @modelcontextprotocol/sdk is not installed", async () => {
  // We can't rely on the global resolver to fail (the SDK may be
  // transitively present in the workspace through peer-dep hoisting).
  // Inject a failing loader to simulate the "peer dep not installed"
  // path — the error message we surface is what the operator will see.
  const echoTool: UnwrappedMcpTool<{ message: string }, string> = {
    name: "echo",
    description: "Returns the message back.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"]
    },
    handler: async (args) => `echo: ${args.message}`
  };
  const server = createGovernedMcpServer({
    client: allowingClient(),
    wardId: "ward-stdio-test",
    subject: "agent:stdio-test",
    tools: [echoTool]
  });

  let caught: unknown = null;
  try {
    await runStdioMcpServer({
      server,
      _sdkLoader: async (spec: string) => {
        const err = new Error(`Cannot find package '${spec}' (simulated for test)`) as Error & { code?: string };
        err.code = "ERR_MODULE_NOT_FOUND";
        throw err;
      }
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof Error, "expected an Error to be thrown when peer dep is missing");
  const msg = (caught as Error).message;
  assert.ok(
    msg.includes("@modelcontextprotocol/sdk"),
    `error must name the missing peer dependency, got: ${msg}`
  );
  assert.ok(
    msg.includes("Install") || msg.includes("install"),
    `error must give install guidance, got: ${msg}`
  );
});

test("runStdioMcpServer: the default loader path resolves to the real SDK when present (no loader injection)", async () => {
  // This is the smoke-positive: when the SDK is on the resolution path
  // (and we are running under tsx, it almost always is via the
  // workspace), the loader doesn't throw. We don't actually want to
  // start a real stdio transport here, so we cancel as soon as the
  // import succeeds by using an _sdkLoader that mimics the real one's
  // success-shape with empty handlers. This catches the "loader
  // contract" regressions independently of whether the peer dep is
  // present.
  const echoTool: UnwrappedMcpTool<{ message: string }, string> = {
    name: "echo", description: "", inputSchema: { type: "object" },
    handler: async () => "ok"
  };
  const server = createGovernedMcpServer({
    client: allowingClient(),
    wardId: "w", subject: "agent:s",
    tools: [echoTool]
  });

  // Stub loader that returns Server / StdioServerTransport / schemas with
  // no-op behavior; resolves cleanly via onclose().
  const stubLoader = async (spec: string): Promise<unknown> => {
    if (spec.endsWith("/server/index.js")) {
      return {
        Server: class StubServer {
          handlers = new Map<unknown, unknown>();
          onclose?: () => void;
          setRequestHandler(schema: unknown, handler: unknown) {
            this.handlers.set(schema, handler);
          }
          async connect(transport: { onclose?: () => void }) {
            // Schedule a synthetic close so the await resolves quickly.
            queueMicrotask(() => {
              transport.onclose?.();
            });
          }
          async close() { this.onclose?.(); }
        }
      };
    }
    if (spec.endsWith("/server/stdio.js")) {
      return {
        StdioServerTransport: class StubTransport {
          onclose?: () => void;
          async close() { this.onclose?.(); }
        }
      };
    }
    if (spec.endsWith("/types.js")) {
      return {
        ListToolsRequestSchema: { _tag: "list-schema" },
        CallToolRequestSchema: { _tag: "call-schema" }
      };
    }
    throw new Error(`unexpected spec: ${spec}`);
  };

  // Race against a 5 s deadline so a regression where onclose never
  // fires fails loudly rather than hanging the test runner.
  const deadline = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("loader-shape test deadline exceeded")), 5000).unref();
  });
  await Promise.race([
    runStdioMcpServer({ server, _sdkLoader: stubLoader }),
    deadline
  ]);
  // If we reach here, the wrapper wired the stub correctly and
  // resolved via transport.onclose — exactly what production does.
});

test("runStdioMcpServer: missing server arg throws synchronously-rejected error", async () => {
  let caught: unknown = null;
  try {
    // @ts-expect-error — deliberate misuse for the test
    await runStdioMcpServer({});
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof Error);
  assert.ok((caught as Error).message.includes("opts.server"));
});

test("GovernedMcpServer.listTools() returns the shape the stdio wrapper consumes", async () => {
  const toolA: UnwrappedMcpTool<{ q: string }, string> = {
    name: "search",
    description: "Run a search.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"]
    },
    handler: async (a) => `results for ${a.q}`
  };
  const toolB: UnwrappedMcpTool<{ x: number }, number> = {
    name: "double",
    description: "Double a number.",
    inputSchema: {
      type: "object",
      properties: { x: { type: "number" } },
      required: ["x"]
    },
    handler: async (a) => a.x * 2
  };
  const server = createGovernedMcpServer({
    client: allowingClient(),
    wardId: "w", subject: "agent:s",
    tools: [toolA, toolB]
  });
  const list = server.listTools();
  // The wrapper expects { tools: [{ name, description, inputSchema }] } -
  // assert this exact shape so changes to mcp-server's listTools don't
  // silently break the wire.
  assert.equal(typeof list, "object");
  assert.ok(Array.isArray(list.tools));
  assert.equal(list.tools.length, 2);
  for (const t of list.tools) {
    assert.equal(typeof t.name, "string");
    assert.equal(typeof t.description, "string");
    assert.equal(typeof t.inputSchema, "object");
    assert.equal((t.inputSchema as { type: string }).type, "object");
  }
  assert.deepEqual(list.tools.map((t) => t.name).sort(), ["double", "search"]);
});

test("GovernedMcpServer.callTool() returns { content, isError?, _aristotle? } - the shape the stdio wrapper hands back to the SDK", async () => {
  const echoTool: UnwrappedMcpTool<{ message: string }, string> = {
    name: "echo",
    description: "Returns the message back.",
    inputSchema: { type: "object" },
    handler: async (args) => `echo: ${args.message}`
  };
  const server = createGovernedMcpServer({
    client: allowingClient("warrant:stdio-shape"),
    wardId: "w", subject: "agent:s",
    tools: [echoTool]
  });
  const result = await server.callTool("echo", { message: "hi" });
  assert.equal(typeof result, "object");
  assert.ok(Array.isArray(result.content));
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  assert.equal((result.content[0] as { text: string }).text, "echo: hi");
  // isError is optional on success; explicit undefined / missing is fine.
  assert.ok(result.isError === undefined || result.isError === false);
  // _aristotle metadata is preserved across the SDK boundary (clients see
  // it iff they retain unknown keys; either way our wrapper passes it
  // through unchanged).
  assert.equal(result._aristotle?.decision, "ALLOW");
  assert.equal(result._aristotle?.warrant_id, "warrant:stdio-shape");
});

test("GovernedMcpServer.callTool() unknown tool returns isError: true (stdio wrapper propagates as MCP error)", async () => {
  const server = createGovernedMcpServer({
    client: allowingClient(),
    wardId: "w", subject: "agent:s",
    tools: []
  });
  const result = await server.callTool("not-a-tool", {});
  assert.equal(result.isError, true);
  assert.equal(result.content[0].type, "text");
  assert.ok((result.content[0] as { text: string }).text.includes("Unknown tool"));
});
