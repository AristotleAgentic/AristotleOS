# @aristotle/openai-agents

**Govern every OpenAI Agents SDK tool call through the AristotleOS Commit Gate before it runs.**

Drop-in `ToolInputGuardrail` for `@openai/agents`. Every tool invocation is admitted only on `ALLOW` + warrant; `REFUSE` becomes a structured `rejectContent` so the agent sees a refusal it can incorporate into its response; `ESCALATE` becomes `rejectContent` (default) or `throwException` (configurable) so the host's approval workflow can pick it up.

This integration uses the SDK's **first-class guardrail primitive** (`ToolInputGuardrailDefinition`) — no monkey-patching, no wrapping, fully traced by the SDK's runtime.

```sh
npm install @aristotle/openai-agents @aristotle/os-sdk @openai/agents
```

## Quickstart

```ts
import { tool, Agent, Runner } from "@openai/agents";
import { AristotleClient } from "@aristotle/os-sdk";
import { aristotleToolInputGuardrail } from "@aristotle/openai-agents";
import { z } from "zod";

const aos = new AristotleClient({
  baseUrl: "http://127.0.0.1:8181",
  token: process.env.AOS_TOKEN
});

// Build the guardrail once — reuse it across as many tools as you like.
const aristotleGate = aristotleToolInputGuardrail({
  client: aos,
  wardId: "ward-agent-ops",
  subject: "agent:assistant-1"
});

const sendEmail = tool({
  name: "send_email",
  description: "Send an email.",
  parameters: z.object({ to: z.string(), body: z.string() }),
  execute: async (args) => `sent to ${args.to}`,
  toolInputGuardrails: [aristotleGate]
});

const searchDb = tool({
  name: "search_database",
  description: "Search customer records.",
  parameters: z.object({ query: z.string() }),
  execute: async (args) => `result for ${args.query}`,
  toolInputGuardrails: [aristotleGate]
});

const agent = new Agent({
  name: "ops-assistant",
  instructions: "Help reconcile customer refunds.",
  tools: [sendEmail, searchDb]
});

const result = await Runner.run(agent, "Reconcile alice's refund and email her.");
```

Every tool the agent invokes first becomes a `CanonicalAction` (`action_type: "tool.send_email"`, `tool.search_database`, ...), gets sent to the Aristotle Commit Gate, and runs only on `ALLOW`. The `outputInfo` on the guardrail result carries the `warrant_id` and `gel_record_id` so they show up in the agent run trace.

## Decision mapping

| Aristotle Gate | Guardrail behavior | What the agent sees |
|---|---|---|
| `ALLOW` | `{ type: "allow" }` | Tool runs. `outputInfo` carries `warrantId` + `gelRecordId`. |
| `REFUSE` | `{ type: "rejectContent", message: "..." }` | Tool blocked. Agent sees the reason and can adapt its plan. |
| `ESCALATE` | `{ type: "rejectContent", message: "..." }` (default) — or `{ type: "throwException" }` with `onEscalate: "throwException"` | Agent sees a structured escalation message — OR runner halts. |
| Gate unreachable | `{ type: "rejectContent", message: "..." }` (default, fail-closed) — or `{ type: "throwException" }` with `onError: "throwException"` | Agent sees a fail-closed message — OR runner halts. |

## Mapping: tool call → CanonicalAction

By default, an OpenAI Agents SDK tool call becomes:

```ts
{
  action_id:    <toolCall.callId>,
  ward_id:      <options.wardId>,
  subject:      <options.subject>,
  action_type:  `tool.${tool.name.toLowerCase()}`,
  params:       <parsed JSON of toolCall.arguments>,
  requested_at: <ISO now>,
  telemetry:    { agent_runtime: "openai-agents-sdk", agent_name: <agent.name> }
}
```

Customize:

- `actionTypePrefix: "agent.ops.tool"` — change the default `"tool"` prefix.
- `actionTypeFor: (toolName) => "title.transfer"` — route specific tools into a vertical namespace.
- `buildAction({...}) => CanonicalAction` — take full control.
- `passthroughTools: ["read_db", "search_docs"]` — skip the gate for read-only tools.
- `onDecision({...})` — telemetry callback fired after every decision.

## Recipe: route a vertical's tool calls through that vertical's authority

```ts
const titleGate = aristotleToolInputGuardrail({
  client: aos,
  wardId: "ward-title-transaction-ops",
  subject: "agent:title-orchestrator",
  guardrailName: "aristotle-title-vertical-gate",
  actionTypeFor: (n) =>
    n === "transfer_title"  ? "title.transfer" :
    n === "release_lien"    ? "title.lien_release" :
    `tool.${n.toLowerCase()}`
});
```

Tools using this guardrail now trip the Title vertical's `JURISDICTION_RULE_PRESETS`, NMVTIS pre-checks, dual-control rules, and demonstration-only warnings — with no other code change.

## Recipe: catch escalations at the agent level

```ts
import { Runner } from "@openai/agents";

const result = await Runner.run(agent, prompt);
// Inspect run items for guardrail rejections:
for (const item of result.history) {
  if (item.type === "tool_call" && item.guardrailResults?.toolInput) {
    for (const g of item.guardrailResults.toolInput) {
      if (g.output.outputInfo?.aristotle === "escalate") {
        // route to dual-control via aos.decideApproval(...)
      }
    }
  }
}
```

## Recipe: telemetry

```ts
const gate = aristotleToolInputGuardrail({
  client: aos,
  wardId,
  subject,
  onDecision: ({ toolName, decision, elapsedMs }) => {
    metrics.gate.observed({ tool: toolName, ms: elapsedMs, decision: decision.decision });
  }
});
```

`onDecision` fires after every gate call (including errors). Same shape as the Claude Agent and LangChain integrations.

## Exports

```ts
import {
  aristotleToolInputGuardrail,
  AristotleClient,             // re-exported from @aristotle/os-sdk
  AristotleApiError,           // re-exported
  type ToolGuardrailBehavior,
  type ToolGuardrailFunctionOutput,
  type ToolInputGuardrailDefinition,
  type ToolInputGuardrailData,
  type SdkFunctionCall,
  type AristotleToolInputGuardrailOptions
} from "@aristotle/openai-agents";
```

## Notes

- The package defines minimal structural types for the SDK's guardrail shape locally; `@openai/agents` is a `peerDependencies` only (optional at compile time). The structural type matches `ToolInputGuardrailDefinition` from `@openai/agents-core` 0.11.x and is forward-compatible.
- The guardrail is **stateless and reusable** — build once, attach to as many tools as you like.
- The same `actionTypeFor` recipe used in `@aristotle/claude-agents` and `@aristotle/langchain` works here unchanged: a tool whose name matches `transfer_title` can be routed through the Title vertical's `JURISDICTION_RULE_PRESETS` simply by mapping its action_type.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
