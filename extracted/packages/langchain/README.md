# @aristotle/langchain

**Govern every LangChain.js tool invocation through the AristotleOS Commit Gate before it runs.**

Drop-in wrapper for any LangChain.js tool — the value returned by `tool()`, a `StructuredTool` subclass, or anything that exposes `{ name, description, invoke() }`. Every call goes through `aos.evaluate()` first; `ALLOW` runs the underlying tool, `REFUSE` throws `ToolGovernanceError`, `ESCALATE` throws `ToolEscalationError` so the host can route to dual-control.

```sh
npm install @aristotle/langchain @aristotle/os-sdk @langchain/core
```

## Quickstart

```ts
import * as z from "zod";
import { tool } from "langchain";
import { AristotleClient } from "@aristotle/os-sdk";
import { governTools } from "@aristotle/langchain";

const aos = new AristotleClient({
  baseUrl: "http://127.0.0.1:8181",
  token: process.env.AOS_TOKEN
});

const searchDatabase = tool(({ query, limit }) => `Found ${limit} results for '${query}'`, {
  name: "search_database",
  description: "Search the customer database.",
  schema: z.object({ query: z.string(), limit: z.number() })
});

const sendEmail = tool(({ to, body }) => `sent to ${to}`, {
  name: "send_email",
  description: "Send an email.",
  schema: z.object({ to: z.string(), body: z.string() })
});

// Wrap. Same shape, governed invoke.
const guarded = governTools([searchDatabase, sendEmail], {
  client: aos,
  wardId: "ward-agent-ops",
  subject: "agent:assistant-1"
});

// Drop into your existing agent. Every invoke now passes the gate first.
agent.bindTools(guarded);
```

## Decision mapping

| Aristotle Gate | What the tool sees |
|---|---|
| `ALLOW` | Underlying tool's `invoke()` runs with the original input + config. Warrant id is in `decision.warrant.warrant_id` if you observe it via `onDecision`. |
| `REFUSE` | Throws `ToolGovernanceError` carrying `toolName`, `action`, `reasonCodes`, `gelRecordId`. The underlying tool **never runs**. |
| `ESCALATE` | Throws `ToolEscalationError` (default) carrying same fields. Configure `onEscalate: "return"` to instead return a marker string so the agent itself sees a structured response. The underlying tool **never runs**. |
| Gate unreachable | Throws `ToolGovernanceError` (fail-closed default). Configure `onError: "escalate"` to raise `ToolEscalationError`, or `onError: "throw"` to surface the original network exception. |

## Mapping: LangChain tool → CanonicalAction

By default:

```ts
{
  action_id:    <fresh per-invocation id>,
  ward_id:      <options.wardId>,
  subject:      <options.subject>,
  action_type:  `tool.${tool.name.toLowerCase()}`,
  params:       <tool input>,                      // the validated zod object
  requested_at: <ISO now>,
  telemetry:    { agent_runtime: "langchain-js" }
}
```

Override:

- `actionTypePrefix: "agent.ops.tool"` — change the default prefix.
- `actionTypeFor: (toolName) => "title.transfer"` — route specific tools into a vertical namespace.
- `buildAction({...}) => CanonicalAction` — take full control.

## Recipe: route a vertical's tool calls through that vertical's authority

```ts
const guarded = governTools([transferTitle, releaseLien], {
  client: aos,
  wardId: "ward-title-transaction-ops",
  subject: "agent:title-orchestrator",
  actionTypeFor: (n) =>
    n === "transfer_title"  ? "title.transfer" :
    n === "release_lien"    ? "title.lien_release" :
    `tool.${n.toLowerCase()}`
});
```

Now the Title vertical's `JURISDICTION_RULE_PRESETS`, NMVTIS pre-checks, dual-control rules, and demonstration-only warnings all apply to those tool calls — no other code change in the adapter.

## Recipe: passthrough read-only tools

```ts
governTools(tools, {
  client: aos,
  wardId,
  subject,
  passthroughTools: ["read_database", "search_docs", "list_users"]
});
```

## Recipe: catch escalations in the AgentExecutor

```ts
import { ToolEscalationError } from "@aristotle/langchain";

try {
  const result = await executor.invoke({ input: "send a refund to alice" });
} catch (err) {
  if (err instanceof ToolEscalationError) {
    // route to dual-control approvals
    await aos.decideApproval({ request_id: ..., decision: "approve", reason: "..." });
  } else {
    throw err;
  }
}
```

## Recipe: telemetry / audit

```ts
governTools(tools, {
  client: aos,
  wardId,
  subject,
  onDecision: ({ toolName, decision, elapsedMs }) => {
    metrics.gate.observed({ tool: toolName, ms: elapsedMs, decision: decision.decision });
  }
});
```

## Exports

```ts
import {
  governTool,
  governTools,
  ToolGovernanceError,    // thrown on REFUSE
  ToolEscalationError,    // thrown on ESCALATE (unless onEscalate:"return")
  AristotleClient,        // re-exported from @aristotle/os-sdk
  AristotleApiError,      // re-exported
  type LangChainToolLike,
  type GovernToolOptions
} from "@aristotle/langchain";
```

## Doesn't mutate your tools

`governTool(tool, options)` returns a **new** object — your original tool is untouched. Safe to call inside library code, on tools passed in by callers, etc.

## License

Proprietary. See `LICENSE` and `NOTICE`.
