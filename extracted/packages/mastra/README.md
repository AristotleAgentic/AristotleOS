# @aristotle/mastra

**Govern Mastra tool calls with AristotleOS.** Wraps a Mastra `Tool`'s `execute` so every invocation routes through the AristotleOS Commit Gate before it runs.

```sh
npm install @aristotle/mastra @aristotle/os-sdk @mastra/core
```

## Quickstart

```ts
import { createTool } from "@mastra/core/tools";
import { Agent } from "@mastra/core/agent";
import { AristotleClient } from "@aristotle/os-sdk";
import { governMastraTool } from "@aristotle/mastra";
import { z } from "zod";

const aos = new AristotleClient({ baseUrl: "http://127.0.0.1:8181" });

const raw = createTool({
  id: "send_email",
  description: "Send an email.",
  inputSchema: z.object({ to: z.string(), body: z.string() }),
  execute: async ({ context }) => sendEmail(context.to, context.body),
});

const governed = governMastraTool(raw, { client: aos, wardId: "ward-ops", subject: "agent:1" });

const agent = new Agent({ name: "ops", instructions: "...", model: openai("gpt-4o"), tools: { send_email: governed } });
```

Or wrap the whole tools record:

```ts
import { governMastraTools } from "@aristotle/mastra";

const tools = governMastraTools({ send_email, search_db, transfer_title }, { client: aos, wardId, subject });
const agent = new Agent({ ..., tools });
```

## Decision mapping

| Aristotle Gate | Wrapped execute |
|---|---|
| `ALLOW` | invokes original execute, returns its output |
| `REFUSE` | returns `AristotleToolOutcome` (default) or throws `AristotleGateError` |
| `ESCALATE` | returns `AristotleToolOutcome` (default) or throws |
| Gate unreachable | throws (default, fail-closed) or returns outcome with `onError: "return-outcome"` |

Same options surface (`actionTypeFor`, `buildAction`, `passthroughTools`, `onDecision`) as the other 11 adapters.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
