# aristotle-os-sdk

Typed Python client for the **AristotleOS execution-control boundary**. Govern autonomous actions before they cross into consequence: evaluate → warrant → execute → evidence.

Both a synchronous (`AristotleClient`) and an asynchronous (`AsyncAristotleClient`) client are provided. Both expose the same surface. One runtime dependency: [`httpx`](https://www.python-httpx.org/).

```sh
pip install aristotle-os-sdk
```

Python 3.9+.

## Quickstart (sync)

```python
from aristotle import AristotleClient

aos = AristotleClient(base_url="https://gate.internal:8181", token=os.environ["AOS_TOKEN"])

# Govern an action BEFORE it touches the actuator / state system.
decision = aos.evaluate({
    "action_id": "act-1",
    "ward_id": "ward-finance",
    "subject": "agent:analyst",
    "action_type": "warehouse.read",
    "params": {"table": "customers"},
})

if decision["decision"] != "ALLOW":
    raise RuntimeError(f"refused: {', '.join(decision['reason_codes'])}")

# decision["warrant"]["warrant_id"]   — single-use Ed25519-signed authorization
# decision["gel_record"]              — signed, hash-chained evidence record
# decision["canonical_action_hash"]   — pin for binding receipts back to this action
```

## Quickstart (async)

```python
from aristotle import AsyncAristotleClient

async def main():
    async with AsyncAristotleClient(base_url="https://gate.internal:8181", token=token) as aos:
        decision = await aos.evaluate(action)
        ...
```

## Recipe: govern-and-execute (recommended pattern for agents)

`govern_and_execute` runs the evaluate → execute → evidence chain for you. On `ALLOW` it calls your executor with the warrant in hand; on `REFUSE` it raises; on `ESCALATE` it returns an escalation handle.

**Sync**:

```python
def actuator(decision):
    # Only runs on ALLOW; decision["warrant"]["warrant_id"] is your single-use token.
    return my_state_system.run(warrant_id=decision["warrant"]["warrant_id"])

outcome = aos.govern_and_execute(
    AristotleClient.title_action(
        action_id="act-mt-7",
        ward_id="ward-title",
        subject="agent:lender-orchestrator",
        action_type="title.lien_release",
        vin="1HGCM82633A123456",
        jurisdiction="MT",
        transaction_type="lien-release",
    ),
    actuator,
)

if outcome["decision"] == "ALLOW":
    print("executed under warrant", outcome["warrant"]["warrant_id"], "evidence", outcome["record"]["record_id"])
elif outcome["decision"] == "ESCALATE":
    print("escalated; reason_codes:", outcome["reason_codes"])
```

**Async**:

```python
async def actuator(decision):
    return await my_state_system.run_async(warrant_id=decision["warrant"]["warrant_id"])

outcome = await aos.govern_and_execute(action, actuator)
```

The executor **never runs** on a non-ALLOW outcome — proven by tests for both clients.

## Recipe: dual-control approval

```python
queue = aos.approvals()
for req in [a for a in queue["items"] if a["status"] == "pending"]:
    result = aos.decide_approval(
        request_id=req["request_id"],
        decision="approve",
        reason="policy reviewed and verified",
    )
    print(req["action_type"], "→", result["status"])
```

## Recipe: shadow-mode profiling

```python
report = aos.shadow({
    "actions": candidate_actions,
    "ward": your_ward_draft,
    "authority_envelope": your_envelope_draft,
})
print("would-allow rate:", report["rollout"]["allow_rate"])
```

## Recipe: kill switch (admin)

```python
aos.kill_switch(scope="global", action="arm", reason="incident-2026-05-26")
# All commit gates fail-closed until disarmed.
```

## API surface

Method names mirror the TypeScript SDK using snake_case. Identical surface between `AristotleClient` (sync) and `AsyncAristotleClient` (async — every method `await`-ed).

### Commit Gate

| Method | Boundary route |
|---|---|
| `evaluate(action, *, runtime_register=None, now=None)` | `POST /v1/execution-control/evaluate` |
| `proxy(action)` | `POST /v1/execution-control/proxy` |
| `context()` | `GET /v1/execution-control/context` |
| `health()` | `GET /health` |
| `metrics()` | `GET /v1/execution-control/metrics` |
| `degradation()` | `GET /v1/execution-control/degradation` |

### Evidence

| Method | Boundary route |
|---|---|
| `audit_tail(limit=20)` | `GET /v1/execution-control/audit/tail` |
| `audit_verify()` | `GET /v1/execution-control/audit/verify` |

### Governance authoring (operator)

| Method | Boundary route |
|---|---|
| `compile_governance(draft)` | `POST /v1/execution-control/governance/compile` |
| `diff_governance(before=, after=)` | `POST /v1/execution-control/governance/diff` |
| `explain_governance(input)` | `POST /v1/execution-control/governance/explain` |

### Shadow + reconciliation + conflicts (operator)

| Method | Boundary route |
|---|---|
| `shadow(input)` | `POST /v1/execution-control/shadow` |
| `reconcile(input)` | `POST /v1/execution-control/reconcile` |
| `ingest_conflicts(input)` | `POST /v1/execution-control/conflicts/ingest` |
| `conflicts()` | `GET /v1/execution-control/conflicts` |
| `resolve_conflict(action_id=, action=, reason=None)` | `POST /v1/execution-control/conflicts/resolve` |

### Dual-control approvals (operator + admin)

| Method | Boundary route |
|---|---|
| `approvals()` | `GET /v1/execution-control/approvals` |
| `decide_approval(request_id=, decision=, reason=None)` | `POST /v1/execution-control/approvals/decide` |

### Admin

| Method | Boundary route |
|---|---|
| `kill_switch(scope=, action=, reason=None)` | `POST /v1/execution-control/admin/kill` |
| `revoke_envelope(envelope_id=, reason=None)` | `POST /v1/execution-control/admin/revoke` |

### Ward Marshal (operator)

| Method | Boundary route |
|---|---|
| `marshal_census(input)` | `POST /v1/execution-control/marshal/census` |
| `marshal_behavior(input)` | `POST /v1/execution-control/marshal/behavior` |

### High-level helpers

- `govern_and_execute(action, executor, *, runtime_register=None, now=None)` — evaluate → on ALLOW run executor, on REFUSE raise `AristotleApiError`, on ESCALATE return an escalation handle. Sync expects a sync callable; async expects an async coroutine function. Executor never runs on non-ALLOW.
- `AristotleClient.title_action(*, action_id, ward_id, subject, action_type, vin, jurisdiction, transaction_type, params=None, telemetry=None)` — static builder for Title vertical canonical actions. Refuses `action_type` outside the `title.*` namespace.

## Auth

Pass `token` (Bearer / OIDC) or `api_key` (`X-API-Key`). Both headers are sent when both are provided. Any non-2xx response raises `AristotleApiError` carrying `.status` and the parsed `.body`.

## Inject a transport for tests

```python
import httpx
from aristotle import AristotleClient

def handler(request):
    return httpx.Response(200, json={"decision": "ALLOW", "reason_codes": [], "canonical_action_hash": "h", "gel_record": {...}, "warrant": {"warrant_id": "wr1"}})

transport = httpx.MockTransport(handler)
client = AristotleClient(base_url="https://gate.internal", token="t", transport=transport)
```

## License

Proprietary. See `LICENSE` and `NOTICE`.
