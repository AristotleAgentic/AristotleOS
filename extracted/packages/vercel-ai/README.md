# @aristotle/vercel-ai

**Govern every Vercel AI SDK tool call through the AristotleOS Commit Gate before it runs.**

A drop-in wrapper for tools used with `generateText` / `streamText` / `Agent` from `ai`. Every tool invocation is admitted only on `ALLOW` + warrant; `REFUSE` and `ESCALATE` either return a structured outcome the agent can incorporate (default) or throw so the SDK emits a `tool-error` part.

The integration wraps a tool's `execute`, so it works uniformly with **any** model provider you wire into the AI SDK (OpenAI, Anthropic, Google, etc.) and with both streaming and non-streaming calls.

```sh
npm install @aristotle/vercel-ai @aristotle/os-sdk ai
```

## Quickstart — wrap the whole `tools` record

```ts
import { generateText, tool } from "ai";
import { z } from "zod";
import { AristotleClient } from "@aristotle/os-sdk";
import { governTools } from "@aristotle/vercel-ai";

const aos = new AristotleClient({
  baseUrl: "http://127.0.0.1:8181",
  token: process.env.AOS_TOKEN
});

const tools = governTools(
  {
    send_email: tool({
      description: "Send an email.",
      inputSchema: z.object({ to: z.string(), body: z.string() }),
      execute: async ({ to, body }) => `sent to ${to}`
    }),
    search_database: tool({
      description: "Search customer records.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => `result for ${query}`
    })
  },
  { client: aos, wardId: "ward-agent-ops", subject: "agent:assistant-1" }
);

const result = await generateText({
  model: anthropic("claude-3-7-sonnet-20250219"),
  prompt: "Help me reconcile alice's refund and email her.",
  tools
});
```

That's it. Every tool the model calls goes through the gate first.

## Quickstart — wrap one tool

```ts
import { governTool } from "@aristotle/vercel-ai";

const safeSendEmail = governTool("send_email",
  tool({
    description: "Send an email.",
    inputSchema: z.object({ to: z.string(), body: z.string() }),
    execute: async ({ to, body }) => _real_send(to, body)
  }),
  { client: aos, wardId, subject }
);

await generateText({ model, prompt, tools: { send_email: safeSendEmail } });
```

The Vercel AI SDK derives a tool's name from the record key, not from a field on the tool itself — so `governTool` requires the name as the first argument.

## Decision mapping

| Aristotle Gate | What `execute` does | What the agent sees |
|---|---|---|
| `ALLOW` | invokes the wrapped `execute` and returns its output | tool runs normally |
| `REFUSE` | returns `AristotleToolOutcome` (default) — or throws `AristotleGateError("REFUSE", ...)` with `onRefuse: "throw"` | structured outcome `{__aristotle: "REFUSE", reasonCodes, gelRecordId, message}` OR `tool-error` part |
| `ESCALATE` | returns `AristotleToolOutcome` (default) — or throws with `onEscalate: "throw"` | structured outcome `{__aristotle: "ESCALATE", ...}` OR `tool-error` part |
| Gate unreachable | throws `AristotleGateError("GATE_UNREACHABLE", ...)` (default, fail-closed) — or returns outcome with `onError: "return-error"` | `tool-error` part OR structured outcome |

The default for `onError` is **throw** (fail-closed) so a downed gate doesn't silently let the model invent its own answer. For `onRefuse` / `onEscalate` the default is **return-error** so the agent gets a structured message it can reason about — that's usually more useful than a generic tool error.

## Mapping: tool call → CanonicalAction

By default, a Vercel tool invocation becomes:

```ts
{
  action_id:    <execOptions.toolCallId>,
  ward_id:      <options.wardId>,
  subject:      <options.subject>,
  action_type:  `tool.${name.toLowerCase()}`,
  params:       <tool input as object>,
  requested_at: <ISO now>,
  telemetry:    { agent_runtime: "vercel-ai-sdk" }
}
```

Customize:

- `actionTypePrefix: "agent.ops.tool"` — change the default `"tool"` prefix.
- `actionTypeFor: (name) => "title.transfer"` — route specific tools into a vertical namespace.
- `buildAction({...}) => CanonicalAction` — take full control.
- `passthroughTools: ["search_docs", "read_kb"]` — skip the gate for read-only tools.
- `onDecision({...})` — telemetry callback fired after every decision.

## Recipe: route a vertical's tool calls through that vertical's authority

```ts
const tools = governTools(
  {
    transfer_title: tool({ ... }),
    release_lien:   tool({ ... }),
    read_history:   tool({ ... })
  },
  {
    client: aos,
    wardId: "ward-title-transaction-ops",
    subject: "agent:title-orchestrator",
    actionTypeFor: (n) =>
      n === "transfer_title" ? "title.transfer" :
      n === "release_lien"   ? "title.lien_release" :
      `tool.${n.toLowerCase()}`
  }
);
```

The Title vertical's `JURISDICTION_RULE_PRESETS`, NMVTIS pre-checks, dual-control rules, and demonstration-only warnings all apply automatically.

## Recipe: handle the structured outcome in the agent's reply

When `onRefuse: "return-error"` (the default), the model receives a structured outcome it can incorporate into its response. To handle it explicitly:

```ts
const result = await generateText({ model, prompt, tools });
for (const step of result.steps) {
  for (const part of step.toolResults) {
    const out = part.output as { __aristotle?: string };
    if (out?.__aristotle === "REFUSE") {
      console.warn(`refused: ${part.toolName}`, out);
    }
  }
}
```

## Recipe: telemetry / audit

```ts
const tools = governTools(rawTools, {
  client: aos, wardId, subject,
  onDecision: ({ toolName, decision, elapsedMs }) => {
    metrics.gate.observed({ tool: toolName, ms: elapsedMs, decision: decision.decision });
  }
});
```

`onDecision` fires after every gate call (including errors).

## Streaming + agent loops

`governTools` works identically with `streamText` and the `Agent` class — the wrapper only changes `execute`, which is called the same way in every mode.

## Exports

```ts
import {
  governTool,
  governTools,
  AristotleGateError,
  AristotleClient,                 // re-exported from @aristotle/os-sdk
  AristotleApiError,               // re-exported
  type AristotleVercelOptions,
  type AristotleToolOutcome,
  type VercelTool,
  type VercelToolSet,
  type VercelToolExecutionOptions
} from "@aristotle/vercel-ai";
```

## Notes

- `ai` is an optional `peerDependencies` — the adapter defines structural types for `Tool` and `ToolExecutionOptions` locally and never imports the peer at compile time, so the package compiles without it. Verified against `ai@6.x` types and forward-compatible with the published `Tool` shape.
- The wrapper preserves every field on the original tool (`description`, `title`, `inputSchema`, `metadata`, `providerOptions`, `needsApproval`, `toModelOutput`, etc.) — only `execute` is replaced. Provider-defined tools (no `execute`) are returned unchanged.
- The same `actionTypeFor` recipe used in `@aristotle/claude-agents`, `@aristotle/langchain`, `@aristotle/openai-agents`, and `aristotle-crewai` works here unchanged.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
