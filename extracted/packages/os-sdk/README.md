# @aristotle/os-sdk

Typed TypeScript client for the AristotleOS execution-control boundary. **Zero
dependencies**, isomorphic (Node 18+, Deno, edge, browser) — inject `fetch` or use
the global.

```ts
import { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";

const aos = new AristotleClient({ baseUrl: "https://gate.internal:8181", token: process.env.AOS_TOKEN });

// Govern an action before it runs
const decision = await aos.evaluate({
  action_id: "act-1",
  ward_id: "ward-finance",
  subject: "agent:analyst",
  action_type: "warehouse.read",
  params: { table: "customers" }
});
if (decision.decision !== "ALLOW") throw new Error(`refused: ${decision.reason_codes.join(", ")}`);
// decision.warrant.warrant_id is your single-use authorization; decision.gel_record is the signed evidence
```

## API

| Method | Boundary route | Role |
|--------|----------------|------|
| `evaluate(action, opts?)` | `POST /v1/execution-control/evaluate` | operator |
| `proxy(action)` | `POST /v1/execution-control/proxy` | operator |
| `context()` | `GET /v1/execution-control/context` | viewer |
| `health()` | `GET /health` | open |
| `auditTail(limit?)` | `GET /v1/execution-control/audit/tail` | viewer |
| `auditVerify()` | `GET /v1/execution-control/audit/verify` | viewer |
| `compileGovernance(draft)` | `POST /v1/execution-control/governance/compile` | operator |
| `diffGovernance({before,after})` | `POST /v1/execution-control/governance/diff` | operator |
| `explainGovernance(input)` | `POST /v1/execution-control/governance/explain` | operator |

Auth: pass `token` (Bearer/OIDC) or `apiKey` (X-API-Key). Any non-2xx throws
`AristotleApiError` carrying `.status` and the parsed `.body`.

> Proprietary / UNLICENSED. Not yet published; consume via the workspace.
