# Edge Conflict Inbox

AristotleOS is built for edge, frontier, and disconnected operation. When an edge
node reconnects after acting under cached or degraded authority, its decisions must
become **visible, explainable, and resolvable** against central governance. The
Conflict Inbox is that reconciliation surface; this is its backend.

## What it does

`reconcileEdgeRecords` takes the edge's actual decisions and re-evaluates each
action through the real Commit Gate under:

- the **current** policy (what central governance says now), and
- when supplied, the **execution-time** policy snapshot (what was in force when the
  edge acted) — so you can tell whether the edge honored its policy or drifted.

It decides nothing for the operator — it classifies and presents.

## Conflict classification

| `agrees` / `conflict_kind` | Meaning |
|----------------------------|---------|
| `agrees: true` | edge and current decisions match — auto-`reconciled` |
| `edge_more_permissive` | edge ALLOWed what current would REFUSE/ESCALATE — the case to scrutinize |
| `edge_more_restrictive` | edge REFUSED/ESCALATED what current would ALLOW |
| `reason_divergence` | both non-ALLOW but for different reasons |

Each item carries both replays: `replay.against_current` and (when provided)
`replay.against_execution_time` — e.g., an `edge_more_permissive` item whose
execution-time replay is ALLOW shows the edge correctly followed the looser policy
that was active then, and the conflict is a *policy change*, not edge misbehavior.

## Resolution state machine

Conflicts start `open`. `applyResolution(item, action)` is a pure transition,
valid only from `open` or `escalated`:

- `accept` → `accepted` (accept the edge evidence)
- `reject` → `rejected` (revert / disavow)
- `escalate` → `escalated` (send for review)
- `reconcile` → `reconciled` (mark resolved)

Resolving an already-resolved item throws — the inbox never loses track of state.

## CLI

```bash
aristotle reconcile --ward ward.yaml --envelope envelope.yaml --records edge-records.json --out report.json
```

`edge-records.json` is an array of `EdgeRecord`:
`{ action, edge_decision, edge_policy_version?, occurred_at?, executionTimeWard?, executionTimeEnvelope?, gel_record_id? }`.
The command prints agreements/conflicts and exits non-zero when unresolved
conflicts remain (so a reconnection pipeline can gate on operator review).

## UI integration boundary (next layer)

The operator-grade inbox (a Command Center surface) renders `ReconciliationReport`
items side-by-side — central vs edge decision, ward/envelope, replay-against-current
and replay-against-execution-time, GEL reference — with per-item actions wired to
`applyResolution` (accept / reject / escalate / reconcile) and an evidence-bundle
export. The UI holds no reconciliation logic; it presents the report and applies
resolutions. (UI wiring is pending the in-flight console-ui work to avoid collision.)
