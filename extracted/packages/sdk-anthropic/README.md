# @aristotle/sdk-anthropic

First-party tool-wrapping adapter for the official Anthropic Claude SDK (`@anthropic-ai/sdk` Messages API). Govern `tool_use` content blocks through the AristotleOS Commit Gate before the underlying handlers run.

This is distinct from [`@aristotle/claude-agents`](../claude-agents) — that package targets the higher-level `@anthropic-ai/claude-agent-sdk` (Claude Agent SDK) and its `PreToolUse` hook. **This** package targets callers using the lower-level `anthropic.messages.create({ tools })` API directly, where the host is orchestrating the assistant loop.

## Install

```sh
npm install @aristotle/sdk-anthropic @aristotle/os-sdk @anthropic-ai/sdk
```

`@anthropic-ai/sdk` is a peer dependency; the wrapper compiles + tests without it.

## How it works

The Anthropic Messages API does not call your tool handlers itself. It returns `tool_use` content blocks describing what the model wants to invoke. Your host code is responsible for dispatching to a handler and feeding the result back in a follow-up `tool_result` message.

This package supplies a `GovernedAnthropicHandler` that wraps that dispatch step. Every call goes through the substrate's `evaluate -> warrant -> execute -> evidence` pipeline before the handler runs.

## Usage

```ts
import Anthropic from "@anthropic-ai/sdk";
import { AristotleClient } from "@aristotle/os-sdk";
import { GovernedAnthropicHandler, governAnthropicTools } from "@aristotle/sdk-anthropic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const aos = new AristotleClient({ baseUrl: process.env.GATE_URL!, token: process.env.GATE_TOKEN! });

// Wrap the tool DEFINITIONS (preserves the shape Anthropic's API expects).
const tools = governAnthropicTools(
  {
    search_database: {
      name: "search_database",
      description: "Search the customer database.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"]
      }
    },
    send_email: {
      name: "send_email",
      description: "Send an email.",
      input_schema: {
        type: "object",
        properties: { to: { type: "string" }, body: { type: "string" } },
        required: ["to", "body"]
      }
    }
  },
  { client: aos, wardId: "ward-agent-ops", subject: "agent:assistant" }
);

// Wrap the DISPATCH layer with the governance gate.
const handler = new GovernedAnthropicHandler({
  client: aos,
  wardId: "ward-agent-ops",
  subject: "agent:assistant",
  handlers: {
    search_database: async ({ query }) => {
      // ... real database call
      return `results for ${query as string}`;
    },
    send_email: async ({ to, body }) => {
      // ... real email send
      return `sent to ${to as string}`;
    }
  }
});

// In your message loop:
const response = await anthropic.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 1024,
  tools: Object.values(tools),
  messages
});

for (const block of response.content) {
  if (block.type === "tool_use") {
    const result = await handler.executeToolUseBlock({
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>
    });

    messages.push({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: result.isError
      }]
    });
  }
}
```

## Refusal contract

Every dispatch through `executeTool` returns an `ExecuteToolResult`:

```ts
interface ExecuteToolResult {
  tool_use_id?: string;
  content: string;
  isError: boolean;
  _aristotle: {
    decision: "ALLOW" | "REFUSE" | "ESCALATE" | "EXPIRE";
    reason_codes: string[];
    warrant_id?: string;
    canonical_action_hash: string;
    gel_record_id?: string;
  };
}
```

The fail-closed pipeline (matching the cross-adapter contract):

| Outcome | Handler invoked? | `isError` | `reason_codes` |
|---|---|---|---|
| `ALLOW` + Warrant | yes | `false` | `[]` |
| `REFUSE` / `ESCALATE` / `EXPIRE` | **no** | `true` | `["GATE_REFUSED", ...]` |
| Gate unreachable | **no** | `true` | `["GATE_UNREACHABLE"]` |
| Gate HTTP error | **no** | `true` | `["GATE_UNREACHABLE"]` |
| `ALLOW` but no Warrant issued | **no** | `true` | `["MISSING_WARRANT"]` |
| Handler throws after `ALLOW` | n/a | `true` | `["HANDLER_THREW"]` |
| Unknown tool name | n/a | `true` | `["UNKNOWN_TOOL"]` |

Refusals format as content blocks the Messages API can pass back to the model as a `tool_result` with `is_error: true`. The model sees a structured refusal and can adapt.

## License

Apache-2.0. See LICENSE and NOTICE. No warranty.
