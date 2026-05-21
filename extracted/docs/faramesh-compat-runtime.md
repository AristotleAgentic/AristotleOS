# Faramesh-Compatible Runtime Path

This branch is not a Faramesh fork. It does not copy Faramesh source code, vendor Faramesh internals, or import Faramesh runtime modules.

It implements an AristotleOS-native compatibility path for the public Faramesh-style runtime execution-control pattern: canonicalize a proposed action, evaluate it deterministically before execution, return an execution-boundary decision, and write tamper-evident evidence.

The AristotleOS doctrine remains unchanged:

> Governance must bind at the execution boundary before irreversible state mutation or external action occurs.

## Concept Mapping

| Faramesh-style concept | AristotleOS compatibility path |
| --- | --- |
| Action Authorization Boundary | Commit Gate |
| Canonical Action Representation | Canonical Governed Action |
| PERMIT / DEFER / DENY | ALLOW / ESCALATE / REFUSE |
| Decision artifact | Warrant plus GEL record |
| Stack / governance context | Ward |
| Policy file | Ward Manifest plus Authority Envelope |
| Audit log | Governance Evidence Ledger |

Faramesh's public positioning emphasizes deterministic pre-execution authorization, canonical action representation, permit/defer/deny decisions, and tamper-evident audit. AristotleOS can speak that runtime-control language while adding institutional governance structure.

## AristotleOS Extensions

Ward establishes the protected domain. It binds the action to a sovereignty context, authority domain, policy version, permitted subjects, and optional physical bounds.

Authority Envelope establishes delegated scope inside the Ward. It binds a subject to allowed and denied actions, constraints, expiry, issuer, and a signing hook.

Commit Gate evaluates admissibility. It deterministically checks Ward presence, subject membership, active Authority Envelope, action allow/deny rules, constraints, runtime register availability, policy version, and physical invariants.

Warrant proves authority at the moment of consequence. It is issued only after `ALLOW`, binds to the canonical action hash, expires quickly, is single-use, and rejects replay.

GEL reconstructs the decision. Every decision appends a hash-linked JSONL record containing action hash, decision, reason codes, policy version, runtime register snapshot, physical invariant result, and warrant id when one was issued.

PIG enforces physical invariants. The compatibility slice includes a deterministic drone-style physical invariant gater for altitude, geofence disable, boundary id, and battery minimum.

## Runtime Package

Implementation:

```text
shared/faramesh-compat-runtime
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
- `evaluateCompat`

## Demo

Run the vertical slice:

```bash
npm run aristotle -- compat evaluate \
  --ward examples/faramesh_compat/ward.montana_drone_test_range.yaml \
  --envelope examples/faramesh_compat/authority_envelope.survey_planner.yaml \
  --action examples/faramesh_compat/actions/allow_takeoff.json \
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

Run the compatibility boundary as a local AristotleOS daemon:

```bash
npm run compat:dev
```

The daemon listens on `http://127.0.0.1:8181` and exposes:

- `GET /health`
- `POST /v1/compat/evaluate`
- `GET /v1/compat/audit/tail`
- `GET /v1/compat/audit/verify`
- `GET /openapi.json`

Submit an action from another terminal:

```bash
npm run compat:submit:allow
```

`compat:submit:allow` requires a verified Warrant before treating the action as executable.

Or call it directly:

```bash
curl -s http://127.0.0.1:8181/v1/compat/evaluate \
  -H "content-type: application/json" \
  --data-binary @examples/faramesh_compat/actions/allow_takeoff.json
```

Verify the GEL chain:

```bash
npm run compat:audit:verify
```

This is the compatibility branch's "runs alongside your agent" path: agent runtimes can call the local AristotleOS boundary before invoking a consequential tool, then require the Warrant id when `decision=ALLOW`.

Programmatic client helpers are exported from `@aristotle/faramesh-compat-runtime`:

- `submitCompatAction`
- `requireAllowedWarrant`
- `compatOpenApiSpec`

See:

```text
examples/faramesh_compat/agent_runtime_wrapper.ts
```

Refusal example:

```bash
npm run aristotle -- compat evaluate \
  --ward examples/faramesh_compat/ward.montana_drone_test_range.yaml \
  --envelope examples/faramesh_compat/authority_envelope.survey_planner.yaml \
  --action examples/faramesh_compat/actions/refuse_leave_boundary.json \
  --ledger ./.tmp/gel.jsonl
```

Escalation example:

```bash
npm run aristotle -- compat evaluate \
  --ward examples/faramesh_compat/ward.montana_drone_test_range.yaml \
  --envelope examples/faramesh_compat/authority_envelope.survey_planner.yaml \
  --action examples/faramesh_compat/actions/escalate_missing_runtime_state.json \
  --ledger ./.tmp/gel.jsonl
```

## Tests

```bash
npm run test:compat
npm test
```

The compatibility tests prove:

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
