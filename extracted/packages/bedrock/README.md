# @aristotle/bedrock

**Govern AWS Bedrock Converse-API tool calls with AristotleOS.** Drop-in dispatcher that routes every `toolUse` block through the AristotleOS Commit Gate before your tool implementation runs.

```sh
npm install @aristotle/bedrock @aristotle/os-sdk
```

## Quickstart

```ts
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AristotleClient } from "@aristotle/os-sdk";
import { makeBedrockToolDispatcher } from "@aristotle/bedrock";

const aos = new AristotleClient({ baseUrl: "http://127.0.0.1:8181", token });

const dispatch = makeBedrockToolDispatcher({
  client: aos,
  wardId: "ward-agent-ops",
  subject: "agent:assistant-1",
  tools: {
    send_email: async ({ to, body }) => sendEmail(to, body),
    search_db:  async ({ query })   => searchDb(query),
  },
});

// After a ConverseCommand response carrying toolUse blocks:
for (const block of response.output.message.content) {
  if (block.toolUse) {
    const result = await dispatch(block.toolUse);
    // Feed `result` back into the next ConverseCommand as toolResult content.
  }
}
```

## Decision mapping

| Aristotle Gate | Dispatcher returns / throws |
|---|---|
| `ALLOW` | runs the tool implementation, returns `BedrockToolResult` with `status: "success"` |
| `REFUSE` | returns `BedrockToolResult` with `status: "error"` and structured `AristotleToolOutcome` in `content[0].json` (default) — or throws `AristotleGateError` with `onRefuse: "throw"` |
| `ESCALATE` | returns structured `AristotleToolOutcome` (default) — or throws with `onEscalate: "throw"` |
| Gate unreachable | throws `AristotleGateError("GATE_UNREACHABLE", ...)` (default, fail-closed) — or returns outcome with `onError: "tool-result"` |

Same options surface as the other adapters: `actionTypeFor`, `buildAction`, `passthroughTools`, `onDecision`.

## License

Apache-2.0.
