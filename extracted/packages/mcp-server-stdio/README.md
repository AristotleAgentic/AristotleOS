# @aristotle/mcp-server-stdio

Stdio transport adapter for [`@aristotle/mcp-server`](../mcp-server). Wires the substrate's governed MCP tool host to the official `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport` so operators can install AristotleOS as a real Claude Desktop MCP server (or wire it to any MCP client that speaks stdio).

## Install

```sh
npm install @aristotle/mcp-server @aristotle/mcp-server-stdio @aristotle/os-sdk @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk` is a peer dependency; the package is loaded via dynamic import. If it is not installed, `runStdioMcpServer` throws an explicit error naming the missing dependency.

## Usage

```ts
import { AristotleClient } from "@aristotle/os-sdk";
import { createGovernedMcpServer } from "@aristotle/mcp-server";
import { runStdioMcpServer } from "@aristotle/mcp-server-stdio";

const client = new AristotleClient({ baseUrl: process.env.GATE_URL!, token: process.env.GATE_TOKEN! });

const server = createGovernedMcpServer({
  client,
  wardId: "ward-desktop",
  subject: "agent:claude-desktop",
  tools: [
    {
      name: "search_database",
      description: "Search the customer database",
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      handler: async ({ q }) => `results for ${q}`
    }
  ]
});

await runStdioMcpServer({
  server,
  serverInfo: { name: "aristotle-governed-tools", version: "0.1.0" }
});
```

The returned promise resolves when the stdio transport closes (the MCP client — typically Claude Desktop — disconnects).

## How governance flows over stdio

1. Claude Desktop sends a `tools/list` request over stdio. We respond with the governed tool catalog (name + description + JSON Schema), exactly as the substrate's `GovernedMcpServer.listTools()` returns.
2. Claude Desktop sends `tools/call` with a tool name + arguments. We dispatch to `GovernedMcpServer.callTool(name, args)`, which builds a `CanonicalAction`, calls `client.evaluate(action)`, and gates execution on the gate's decision.
3. `ALLOW` → the tool's handler runs; the result is formatted as MCP content blocks. `REFUSE` / `EXPIRE` → MCP error response with the substrate's reason codes. `GATE_UNREACHABLE` → MCP error (fail-closed). `HANDLER_THREW` → MCP error.
4. Every result carries an `_aristotle` metadata block (decision, reason codes, warrant id, GEL record id, canonical action hash). MCP clients that surface unknown keys can render this for forensic capture; clients that strip it still see the correct error / success behavior.

The wire format is compliant with MCP `>=1.0.0`. The gate, not the MCP server, is the source of truth — there is no path from a connected MCP client to a tool handler that bypasses `client.evaluate`.

## License

Apache-2.0. See LICENSE and NOTICE. No warranty.
