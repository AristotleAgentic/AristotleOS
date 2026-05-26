# @aristotle/os-sdk

Typed TypeScript client for the **AristotleOS execution-control boundary**. Govern autonomous actions before they cross into consequence: evaluate → warrant → execute → evidence.

**Zero runtime dependencies**, isomorphic (Node 18+, Deno, edge, browser). Inject `fetch` or use the global.

```sh
npm install @aristotle/os-sdk
# or
pnpm add @aristotle/os-sdk
```

## Quickstart

```ts
import { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";

const aos = new AristotleClient({
  baseUrl: "https://gate.internal:8181",
  token: process.env.AOS_TOKEN   // or: apiKey: process.env.AOS_API_KEY
});

// Govern an action BEFORE it touches the actuator / state system
const decision = await aos.evaluate({
  action_id: "act-1",
  ward_id: "ward-finance",
  subject: "agent:analyst",
  action_type: "warehouse.read",
  params: { table: "customers" }
});

if (decision.decision !== "ALLOW") {
  throw new Error(`refused: ${decision.reason_codes.join(", ")}`);
}

// decision.warrant.warrant_id  — single-use Ed25519-signed authorization
// decision.gel_record          — signed, hash-chained Governance Evidence Ledger record
// decision.canonical_action_hash — pin for binding receipts back to this action
```

## Recipe: govern-and-execute (recommended pattern for agents)

`governAndExecute` runs the evaluate → execute → evidence chain for you. On ALLOW it runs your executor with the warrant in hand; on REFUSE it throws; on ESCALATE it returns an escalation handle so you can surface it to a human or hand it to the dual-control approvals workflow.

```ts
const outcome = await aos.governAndExecute(
  {
    action_id: "act-mt-7",
    ward_id: "ward-title",
    subject: "agent:lender-orchestrator",
    action_type: "title.lien_release",
    params: { vin: "1HGCM82633A123456", jurisdiction: "MT", transaction_type: "lien-release" }
  },
  async (decision) => {
    // Only runs on ALLOW; decision.warrant.warrant_id is your single-use token.
    return await myActuator.run({ warrantId: decision.warrant!.warrant_id });
  }
);

if (outcome.decision === "ALLOW") {
  console.log("executed under warrant", outcome.warrant?.warrant_id, "evidence", outcome.record.record_id);
} else if (outcome.decision === "ESCALATE") {
  console.log("escalated; pending approvals:", outcome.reason_codes);
}
```

## Recipe: dual-control approval

```ts
const queue = await aos.approvals();
const pending = queue.items.filter((a) => a.status === "pending");

for (const req of pending) {
  const result = await aos.decideApproval({
    request_id: req.request_id,
    decision: "approve",
    reason: "policy reviewed and verified"
  });
  console.log(req.action_type, "→", result.status);
}
```

## Recipe: shadow-mode profiling before enforcement

```ts
const report = await aos.shadow({
  actions: candidateActions,
  ward: yourWardDraft,
  authority_envelope: yourEnvelopeDraft
});
console.log("would-allow rate:", report.rollout.allow_rate);
```

## Recipe: kill switch (admin)

```ts
await aos.killSwitch({ scope: "global", action: "arm", reason: "incident-2026-05-26" });
// All commit gates fail-closed until disarmed.
```

## API surface

### Commit Gate

| Method | Boundary route | Role |
|---|---|---|
| `evaluate(action, opts?)` | `POST /v1/execution-control/evaluate` | operator |
| `proxy(action)` | `POST /v1/execution-control/proxy` | operator |
| `context()` | `GET /v1/execution-control/context` | viewer |
| `health()` | `GET /health` | open |
| `metrics()` | `GET /v1/execution-control/metrics` | viewer |
| `degradation()` | `GET /v1/execution-control/degradation` | viewer |

### Evidence

| Method | Boundary route | Role |
|---|---|---|
| `auditTail(limit?)` | `GET /v1/execution-control/audit/tail` | viewer |
| `auditVerify()` | `GET /v1/execution-control/audit/verify` | viewer |

### Governance authoring (operator)

| Method | Boundary route |
|---|---|
| `compileGovernance(draft)` | `POST /v1/execution-control/governance/compile` |
| `diffGovernance({before, after})` | `POST /v1/execution-control/governance/diff` |
| `explainGovernance(input)` | `POST /v1/execution-control/governance/explain` |

### Shadow + reconciliation + conflicts (operator)

| Method | Boundary route |
|---|---|
| `shadow(input)` | `POST /v1/execution-control/shadow` |
| `reconcile(input)` | `POST /v1/execution-control/reconcile` |
| `ingestConflicts(input)` | `POST /v1/execution-control/conflicts/ingest` |
| `conflicts()` | `GET /v1/execution-control/conflicts` |
| `resolveConflict(input)` | `POST /v1/execution-control/conflicts/resolve` |

### Dual-control approvals (operator + admin)

| Method | Boundary route |
|---|---|
| `approvals()` | `GET /v1/execution-control/approvals` |
| `decideApproval({request_id, decision, reason?})` | `POST /v1/execution-control/approvals/decide` |

### Admin

| Method | Boundary route |
|---|---|
| `killSwitch({scope, action, reason?})` | `POST /v1/execution-control/admin/kill` |
| `revokeEnvelope({envelope_id, reason?})` | `POST /v1/execution-control/admin/revoke` |

### Ward Marshal (operator)

| Method | Boundary route |
|---|---|
| `marshalCensus(input)` | `POST /v1/execution-control/marshal/census` |
| `marshalBehavior(input)` | `POST /v1/execution-control/marshal/behavior` |

### High-level helpers

- `governAndExecute(action, executor, opts?)` — evaluate → on ALLOW run executor, on REFUSE throw `AristotleApiError`, on ESCALATE return an escalation handle. Never runs the executor on a non-ALLOW outcome.
- `AristotleClient.titleAction({…})` — static builder for Title vertical canonical actions; produces a `CanonicalAction` with `action_type: "title.*"` and the required `params` already namespaced.

## Auth

Pass `token` (Bearer / OIDC) or `apiKey` (`X-API-Key` header). One or both — the SDK sets both headers when both are provided. Any non-2xx response throws `AristotleApiError` carrying `.status` and the parsed `.body`.

## Custom fetch

```ts
import { AristotleClient } from "@aristotle/os-sdk";
import fetch from "undici";   // or any fetch-shaped impl
const aos = new AristotleClient({ baseUrl, token, fetch });
```

## License

Apache-2.0. See the repo root `LICENSE` and `NOTICE`.
