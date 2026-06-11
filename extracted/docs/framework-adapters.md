# Framework Adapters

AristotleOS governs *actions*, not any one AI framework. Every agent framework
ultimately emits a **tool call** (a name + arguments); AristotleOS sits between
that call and its irreversible consequence.

Examples live in `examples/framework-adapters`.

## The adapter harness (recommended)

`govern.ts` is the AristotleOS-native harness. It reduces any framework tool call
to a `ToolCall`, runs it through the real execution-control boundary, and executes
the downstream effect **only after an `ALLOW` with a verified, single-use Warrant**:

```ts
import { governToolCall, type GovernedToolBinding } from "./govern.js";

const outcome = await governToolCall(
  { name: "stripe.refund", arguments: { amount: 8000, currency: "USD", customerId: "cus_17" }, callId: "call_abc123" },
  binding, // { ward, authorityEnvelope, subject, toAction, ... }
  ({ warrant }) => performRefund(warrant)   // runs ONLY on ALLOW + verified Warrant
);
// outcome.status is "executed" | "refused" | "escalated" | "blocked"
```

Properties:

- **Construct** a Canonical Governed Action from the tool call.
- **Decide** at the Commit Gate: `ALLOW` / `REFUSE` / `ESCALATE`.
- **Verify** the Warrant before running (defense in depth); a Warrant that fails
  verification yields `blocked` and never executes.
- **Execute** the effect only on `ALLOW`; `REFUSE`/`ESCALATE` never run.
- **Record** the signed GEL record in every case (auditable whether or not it ran).
- **Idempotency**: when the framework supplies a `callId`, re-delivering the same
  call is caught by single-use replay protection (`REPLAY_DETECTED`).
- **No standing authority / secrets** in the agent: it gets a Warrant for one
  action, or nothing; downstream credentials are brokered server-side.

Tests in `govern.test.ts` cover ALLOW, REFUSE (constraint + denied action),
ESCALATE, and replay. Run them with `npm run test:adapters`.

## Worked examples

All examples run through the harness (real Commit Gate → ALLOW → Warrant → GEL);
shared Ward/Authority fixtures live in `_fixtures.ts`.

| Framework | File | Shows |
|-----------|------|-------|
| OpenAI Agents SDK / function calling | `openai-tool-call.ts` | ALLOW → Warrant → GEL |
| MCP (`tools/call`) | `mcp-tool-call.ts` | returns an MCP-style result |
| Anthropic tool use | `anthropic-tool-use.ts` | `tool_use` block → governed |
| LangChain / LangGraph tool | `langchain-tool.ts` | exported governed tool, branchable outcome |
| AutoGen / CrewAI pre-tool hook | `autogen-agent.ts` | pre-execution gate (`proceed` + Warrant) |
| Plain HTTP API mutation | `http-api-action.ts` | POST allowed / DELETE denied |
| Kubernetes deployment action | `kubernetes-deploy-action.ts` | `apply` allowed / namespace delete denied |
| Drone / robotics action | `drone-robotics-action.ts` | Physical Invariants (out-of-bounds → REFUSE) |

Run any example with `npx tsx examples/framework-adapters/<file>`. Tests
(`npm run test:adapters`) cover ALLOW, REFUSE (constraint, denied action, physical
invariant), ESCALATE, and replay through the shared harness.

## Where AristotleOS sits

```
agent/framework decides to act
   → tool call (name + arguments)
   → AristotleOS: Canonical Governed Action → Commit Gate
   → ALLOW + signed Warrant   (REFUSE / ESCALATE stop here)
   → verify Warrant → execute the effect
   → Governance Evidence Ledger → Evidence Bundle → replay/audit
```

No real external API keys are required: the examples use mock executors with
realistic interfaces. Swap in the credential-brokering proxy
(`aristotle execution-control serve` / `proxyGovernedAction`) to inject scoped,
short-lived credentials server-side at the moment of forwarding.
