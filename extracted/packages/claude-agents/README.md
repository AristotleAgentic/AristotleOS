# @aristotle/claude-agents

**Govern every Claude Agent SDK tool call through the AristotleOS Commit Gate before it runs.**

A drop-in `PreToolUse` hook for `@anthropic-ai/claude-agent-sdk`. Every tool the agent invokes is admitted ONLY on `ALLOW` + warrant; `REFUSE` becomes a `deny` returned to the agent; `ESCALATE` becomes an `ask` so the host can route it to a human approver (or to the dual-control approvals queue via `AristotleClient.decideApproval()`).

```sh
npm install @aristotle/claude-agents @aristotle/os-sdk @anthropic-ai/claude-agent-sdk
```

## Quickstart

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { AristotleClient } from "@aristotle/os-sdk";
import { aristotleGuard } from "@aristotle/claude-agents";

const aos = new AristotleClient({
  baseUrl: "https://gate.internal:8181",
  token: process.env.AOS_TOKEN
});

const guard = aristotleGuard({
  client: aos,
  wardId: "ward-agent-ops",
  subject: "agent:assistant-1"
});

for await (const msg of query({
  prompt: "Help me reconcile the customer refund",
  options: { hooks: guard.hooksConfig }
})) {
  if (msg.type === "assistant" || msg.type === "result") {
    console.log(msg);
  }
}
```

Every tool the agent tries to call — `Bash`, `Write`, `Edit`, `Read`, MCP tools — first becomes a `CanonicalAction` (`action_type: "tool.bash"`, `tool.write`, etc.), gets sent to the Aristotle Commit Gate, and only runs on `ALLOW`. The reason string the agent receives includes the warrant id and the GEL record id, so the agent can cite them in its response.

## What the hook does

| Aristotle Gate decision | Hook returns | What happens |
|---|---|---|
| `ALLOW` | `permissionDecision: "allow"` | Tool runs. Reason string carries `warrant_id` + `gel_record_id`. |
| `REFUSE` | `permissionDecision: "deny"` | Tool is blocked. Reason string carries the gate's `reason_codes`. |
| `ESCALATE` | `permissionDecision: "ask"` | Claude Agent SDK routes to user / approval workflow. |
| Gate unreachable | `permissionDecision: "deny"` (default) | Fail-closed; configurable via `onError: "ask"`. |
| Non-`PreToolUse` event | `{}` (no-op) | Defensive guard. |

## Mapping: Claude tool → CanonicalAction

By default, a Claude tool invocation becomes:

```ts
{
  action_id:   <toolUseId>,                       // pins this exact invocation
  ward_id:     <options.wardId>,
  subject:     <options.subject>,
  action_type: `tool.${tool_name.toLowerCase()}`, // e.g. "tool.bash"
  params:      <tool_input>,                      // the agent's tool arguments
  request_id:  <session_id>,                      // ties to the agent session
  requested_at: <ISO now>,
  telemetry:   { agent_runtime: "claude-agent-sdk", cwd }
}
```

Override any part of this mapping:

- `actionTypePrefix: "agent.ops.tool"` — change the default prefix.
- `actionTypeFor: (toolName) => "infra.shell.run"` — route specific tools into a vertical namespace.
- `buildAction({...}) => CanonicalAction` — take full control over the action shape.

## Recipe: passthrough read-only tools

Reads are usually safe; you may not want to round-trip them through the gate.

```ts
const guard = aristotleGuard({
  client: aos,
  wardId: "ward-agent-ops",
  subject: "agent:assistant-1",
  passthroughTools: ["Read", "Glob", "Grep"]
});
```

Or use the SDK's built-in `matcher` to apply the hook only to the tools you care about:

```ts
const guard = aristotleGuard({ client: aos, wardId, subject });
const options = {
  hooks: {
    PreToolUse: [
      { matcher: "Bash|Write|Edit", hooks: [guard.hook] }   // only gate these
    ]
  }
};
```

## Recipe: route a vertical's tool calls through that vertical's authority

```ts
const guard = aristotleGuard({
  client: aos,
  wardId: "ward-title-transaction-ops",
  subject: "agent:title-orchestrator",
  actionTypeFor: (toolName) =>
    toolName === "mcp__title__lien_release" ? "title.lien_release" :
    toolName === "mcp__title__transfer"     ? "title.transfer" :
    `tool.${toolName.toLowerCase()}`
});
```

Now the Title vertical's `JURISDICTION_RULE_PRESETS`, NMVTIS pre-checks, dual-control rules, and demonstration-only warnings all apply to those tool calls.

## Recipe: telemetry / audit

```ts
const guard = aristotleGuard({
  client: aos,
  wardId,
  subject,
  onDecision: ({ toolName, decision, elapsedMs }) => {
    metrics.gate.observed({ tool: toolName, ms: elapsedMs, decision: decision.decision });
  }
});
```

`onDecision` fires after every gate call (including errors). The full `CanonicalAction` that was sent and the full `EvaluateResponse` that came back are both available.

## Recipe: fail-closed vs ask-on-error

```ts
// Default: gate unreachable -> deny (matches the Commit Gate's own fail-closed posture).
aristotleGuard({ client: aos, wardId, subject });

// Permissive: gate unreachable -> ask (route to user); use only when the agent
// runs in an interactive context where the user can resolve the gap.
aristotleGuard({ client: aos, wardId, subject, onError: "ask" });
```

## Auth

The hook uses whatever auth you configured on the `AristotleClient` you pass in (`token` Bearer / OIDC, or `apiKey` `X-API-Key`). No extra config in the hook itself.

## Exports

```ts
import {
  aristotleGuard,             // the hook factory
  AristotleClient,            // re-exported from @aristotle/os-sdk
  AristotleApiError,          // re-exported
  type PreToolUseHookInput,   // documented hook input shape
  type PreToolUseHookOutput,  // documented hook output shape
  type PreToolUseHook,        // hook signature
  type AristotleGuardOptions,
  type AristotleGuardResult
} from "@aristotle/claude-agents";
```

## License

Proprietary. See `LICENSE` and `NOTICE`.
