/**
 * @aristotle/mcp-server-stdio
 *
 * Stdio transport adapter for @aristotle/mcp-server. Wires a
 * `GovernedMcpServer` (the gate-wrapped tool host produced by
 * `createGovernedMcpServer`) to the official
 * `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport` so
 * operators can install AristotleOS as a real Claude Desktop MCP
 * server.
 *
 * The MCP SDK is a peer dependency and is loaded via dynamic import.
 * That keeps the package compilable + testable without the SDK
 * installed; consumers who actually want to run a stdio server install
 * `@modelcontextprotocol/sdk` alongside this package.
 *
 *   // operator-side wiring (in a service / bin entry of their own)
 *   import { AristotleClient } from "@aristotle/os-sdk";
 *   import { createGovernedMcpServer } from "@aristotle/mcp-server";
 *   import { runStdioMcpServer } from "@aristotle/mcp-server-stdio";
 *
 *   const client = new AristotleClient({ baseUrl, token });
 *   const server = createGovernedMcpServer({
 *     client, wardId: "ward-desktop", subject: "agent:claude-desktop",
 *     tools: [ /* UnwrappedMcpTool[] *​/ ]
 *   });
 *
 *   await runStdioMcpServer({
 *     server,
 *     serverInfo: { name: "aristotle-governed-tools", version: "0.1.0" }
 *   });
 *   // resolves when the stdio transport closes (claude desktop disconnects)
 *
 * Wire shape:
 *
 *   The MCP SDK's `Server` exposes `setRequestHandler(Schema, handler)`.
 *   We register two:
 *     - ListToolsRequestSchema  -> server.listTools()
 *     - CallToolRequestSchema   -> server.callTool(name, args)
 *
 *   Tool refusals from the governed server already carry MCP-compatible
 *   { content: [...], isError: true } shape, so they pass through
 *   unchanged. The substrate's _aristotle metadata block rides along on
 *   the result and is visible to MCP clients that surface unknown
 *   keys (most don't, but it's there for forensic capture).
 */

import type {
  GovernedMcpServer,
  McpCallResult,
  McpInputSchema
} from "@aristotle/mcp-server";

// ---------------------------------------------------------------------------
// Type-only shims for the @modelcontextprotocol/sdk symbols we reach for.
// Declared locally so this package compiles without the peer dep installed.
// At runtime, the dynamic imports below produce the real values; the shapes
// match the SDK's public surface as of >=1.0.0.
// ---------------------------------------------------------------------------

/** Mirror of the SDK's `Tool` definition shape used in ListTools responses. */
export interface Tool {
  name: string;
  description?: string;
  inputSchema: McpInputSchema;
}

/** Opaque marker for the SDK's request schemas (Zod-shaped at runtime). */
export interface RequestSchema {
  readonly _tag?: "mcp-request-schema";
}

/** Shapes of the requests the SDK delivers to setRequestHandler handlers. */
export interface ListToolsRequest {
  method: "tools/list";
  params?: Record<string, unknown>;
}

export interface CallToolRequest {
  method: "tools/call";
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

/** Server info echoed back on initialize. */
export interface ServerInfo {
  name?: string;
  version?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunStdioMcpServerOptions {
  /** A GovernedMcpServer produced by `@aristotle/mcp-server`'s `createGovernedMcpServer`. */
  server: GovernedMcpServer;
  /**
   * Identification surfaced on the MCP `initialize` handshake. Default:
   * `{ name: "aristotle-mcp-server", version: "0.1.0" }`.
   */
  serverInfo?: ServerInfo;
  /**
   * Internal injection hook for tests. Default loads
   * `@modelcontextprotocol/sdk` modules via dynamic import (the real
   * code path). Tests can supply a stub or a deliberately-failing
   * loader to verify error-handling without bringing up a live stdio
   * transport. Not part of the published surface — kept here so the
   * tests in this package can exercise both the success and
   * peer-dep-missing paths without engineering a real subprocess.
   */
  _sdkLoader?: (spec: string) => Promise<unknown>;
}

const PEER_DEP_HINT =
  "@aristotle/mcp-server-stdio requires the peer dependency '@modelcontextprotocol/sdk' (>=1.0.0 <2). " +
  "Install it in the host service: `npm install @modelcontextprotocol/sdk` " +
  "(or the corresponding pnpm/yarn command).";

/**
 * Run a `GovernedMcpServer` over the official MCP stdio transport.
 *
 * Returns a promise that resolves when the stdio transport closes
 * (the MCP client — typically Claude Desktop — disconnects). The
 * caller's process can `await` this to keep the server alive.
 *
 * Throws a clear, actionable error if `@modelcontextprotocol/sdk` is
 * not installed.
 */
export async function runStdioMcpServer(opts: RunStdioMcpServerOptions): Promise<void> {
  if (!opts || !opts.server) {
    throw new Error("runStdioMcpServer: opts.server is required");
  }
  const info: Required<ServerInfo> = {
    name: opts.serverInfo?.name ?? "aristotle-mcp-server",
    version: opts.serverInfo?.version ?? "0.1.0"
  };

  // Dynamic import so this package compiles + tests without the peer dep
  // present. We funnel the import calls through a string-typed indirection
  // so TypeScript does not try to resolve the SDK at compile time (the
  // peer dep is optional; treating its types as `unknown` is correct).
  //
  // The caller can inject `_sdkLoader` to test the failure path or to
  // pre-load the SDK from a non-default location. Default loader uses
  // `new Function` so esbuild / tsc don't follow the spec string.
  //
  // Any failure (module-not-found, peer dep mis-version) is wrapped with
  // operator-facing guidance.
  const dynamicImport = opts._sdkLoader ?? ((spec: string): Promise<unknown> =>
    (new Function("s", "return import(s);") as (s: string) => Promise<unknown>)(spec));

  let serverMod: unknown;
  let stdioMod: unknown;
  let typesMod: unknown;
  try {
    [serverMod, stdioMod, typesMod] = await Promise.all([
      dynamicImport("@modelcontextprotocol/sdk/server/index.js"),
      dynamicImport("@modelcontextprotocol/sdk/server/stdio.js"),
      dynamicImport("@modelcontextprotocol/sdk/types.js")
    ]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${PEER_DEP_HINT} (underlying error: ${reason})`);
  }

  const { Server } = serverMod as unknown as {
    Server: new (
      info: Required<ServerInfo>,
      capabilities: { capabilities: { tools: Record<string, unknown> } }
    ) => {
      setRequestHandler: (schema: RequestSchema, handler: (request: unknown) => Promise<unknown>) => void;
      connect: (transport: unknown) => Promise<void>;
      close: () => Promise<void>;
      onclose?: () => void;
    };
  };
  const { StdioServerTransport } = stdioMod as unknown as {
    StdioServerTransport: new () => {
      onclose?: () => void;
      close: () => Promise<void>;
    };
  };
  const { ListToolsRequestSchema, CallToolRequestSchema } = typesMod as unknown as {
    ListToolsRequestSchema: RequestSchema;
    CallToolRequestSchema: RequestSchema;
  };

  const mcpServer = new Server(info, { capabilities: { tools: {} } });

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    const list = opts.server.listTools();
    // SDK expects { tools: Tool[] }; our shape already matches.
    return { tools: list.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    })) };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request: unknown) => {
    const r = request as CallToolRequest;
    const name = r.params.name;
    const args = (r.params.arguments ?? {}) as Record<string, unknown>;
    const result: McpCallResult = await opts.server.callTool(name, args);
    return result;
  });

  const transport = new StdioServerTransport();

  // Wire close handlers BEFORE connect() so a synchronous close during
  // handshake doesn't slip past us. The SDK's transport.onclose fires
  // on stdin EOF / client disconnect. The mcpServer.onclose covers the
  // case where the Server reports close before the transport does.
  const closed = new Promise<void>((resolve) => {
    const finish = () => resolve();
    transport.onclose = finish;
    mcpServer.onclose = finish;
  });

  await mcpServer.connect(transport);

  await closed;
}

// ---------------------------------------------------------------------------
// Re-exports for caller convenience
// ---------------------------------------------------------------------------

export type {
  GovernedMcpServer,
  McpCallResult,
  McpInputSchema,
  UnwrappedMcpTool,
  GovernanceContext,
  McpContent
} from "@aristotle/mcp-server";
export { createGovernedMcpServer } from "@aristotle/mcp-server";
