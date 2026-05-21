# Ward/Warrant Execution-Control Path

This AristotleOS component is independently developed. It may discuss Faramesh as a public example of the broader runtime authorization and execution-control category, but it does not copy Faramesh source code, documentation, examples, schemas, tests, comments, file names, repository structure, policy syntax, branding, or expressive material. AristotleOS is not affiliated with, certified by, sponsored by, or endorsed by Faramesh.

The AristotleOS doctrine remains unchanged:

> Governance must bind at the execution boundary before irreversible state mutation or external action occurs.

## What It Does

This runtime path takes a proposed governed action, canonicalizes it into deterministic JSON, evaluates it through the Commit Gate, issues a single-use Warrant only on `ALLOW`, and appends a hash-linked Governance Evidence Ledger record for every decision.

The module uses AristotleOS-native names, schemas, examples, and tests:

- Ward Manifest establishes the protected domain and sovereignty context.
- Authority Envelope establishes scoped delegated authority inside the Ward.
- Canonical Governed Action gives the Commit Gate stable decision material.
- Commit Gate returns `ALLOW`, `ESCALATE`, or `REFUSE` with reason codes.
- Warrant proves admissibility at the moment of consequence.
- GEL preserves the decision context as a tamper-evident execution lineage.
- PIG blocks physical invariant violations before execution.

## Runtime Package

Implementation:

```text
shared/execution-control-runtime
```

Core exports:

- `canonicalizeAction`
- `evaluateCommitGate`
- `issueWarrant`
- `verifyWarrant`
- `consumeWarrant`
- `appendGelRecord`
- `verifyGelChain`
- `evaluatePhysicalInvariants`
- `evaluateExecutionControl`
- `createExecutionControlRuntimeServer`
- `submitGovernedAction`

## Demo

Run the vertical slice:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/execution_control/ward.montana_drone_test_range.yaml \
  --envelope examples/execution_control/authority_envelope.survey_planner.yaml \
  --action examples/execution_control/actions/allow_takeoff.json \
  --ledger ./.tmp/gel.jsonl \
  --now 2026-05-21T14:00:00.000Z
```

Expected shape:

```text
decision=ALLOW
reason_codes=ALLOWED
canonical_action_hash=<sha256>
warrant_id=wrn-...
gel_record_hash=<sha256>
ledger_verification=ok
```

## Runtime Daemon

Run the local AristotleOS execution boundary:

```bash
npm run execution-control:dev
```

The daemon listens on `http://127.0.0.1:8181` and exposes:

- `GET /health`
- `POST /v1/execution-control/evaluate`
- `GET /v1/execution-control/audit/tail`
- `GET /v1/execution-control/audit/verify`
- `GET /openapi.json`

Submit an action from another terminal:

```bash
npm run execution-control:submit:allow
```

`execution-control:submit:allow` requires a verified Warrant before treating the action as executable.

Or call it directly:

```bash
curl -s http://127.0.0.1:8181/v1/execution-control/evaluate \
  -H "content-type: application/json" \
  --data-binary @examples/execution_control/actions/allow_takeoff.json
```

Verify the GEL chain:

```bash
npm run execution-control:audit:verify
```

This is the "runs alongside your agent" path: agent runtimes call the local AristotleOS boundary before invoking a consequential tool, then require the Warrant id when `decision=ALLOW`.

Programmatic client helpers are exported from `@aristotle/execution-control-runtime`:

- `submitGovernedAction`
- `requireAllowedWarrant`
- `executionControlOpenApiSpec`

See:

```text
examples/execution_control/agent_runtime_wrapper.ts
```

Refusal example:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/execution_control/ward.montana_drone_test_range.yaml \
  --envelope examples/execution_control/authority_envelope.survey_planner.yaml \
  --action examples/execution_control/actions/refuse_leave_boundary.json \
  --ledger ./.tmp/gel.jsonl
```

Escalation example:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/execution_control/ward.montana_drone_test_range.yaml \
  --envelope examples/execution_control/authority_envelope.survey_planner.yaml \
  --action examples/execution_control/actions/escalate_missing_runtime_state.json \
  --ledger ./.tmp/gel.jsonl
```

## Tests

```bash
npm run test:execution-control
npm test
```

The execution-control tests prove:

- canonical action hash stability across equivalent key orderings
- allowed action produces `ALLOW`
- denied action produces `REFUSE`
- expired Authority Envelope produces `REFUSE`
- missing runtime state produces `ESCALATE`
- physical invariant violation produces `REFUSE`
- `ALLOW` issues a Warrant
- `REFUSE` does not issue a Warrant
- Warrant cannot be consumed twice
- Warrant verification fails for mismatched action hash
- GEL verifies after normal append
- GEL verification fails after tampering
