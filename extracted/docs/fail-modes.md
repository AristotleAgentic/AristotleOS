# Fail modes & gate HA topology (B3)

Defense-review finding 2.6 asked two questions: **what does the boundary do when
its own dependencies degrade, and is that posture appropriate for every Ward?** A
single global fail-closed is correct but blunt; a fleet needs the posture to scale
with how consequential each Ward is. This is the per-Ward criticality fail-mode
policy plus the gate's high-availability topology.

## 1. Per-Ward criticality

Each Ward declares a `criticality`:

| Criticality | Meaning | Example |
|-------------|---------|---------|
| `safety_critical` | Irreversible physical / life-safety consequence | weapons release, flight-termination |
| `mission_critical` | Mission failure or significant harm (default) | payment movement, infra mutation |
| `routine` | Recoverable, human-reviewable | ticketing, scheduling |
| `best_effort` | Low stakes; throughput over strictness | read-only telemetry, log enrichment |

An **unlabeled Ward defaults to `mission_critical`** — i.e. it fails closed on
infrastructure loss. Criticality can only be set explicitly; the boundary never
infers a *weaker* posture.

## 2. Degradation conditions

The boundary acts on degradation signals it detects or is told about
(`degraded_conditions` on the evaluate request / `degradedConditions` on the gate):

| Condition | Trigger |
|-----------|---------|
| `ledger_unavailable` | the Governance Evidence Ledger cannot be written (no evidence ⇒ no irreversible action) |
| `control_plane_stale` | revocation/time state could not be refreshed within budget (see DDIL containment, T17) |
| `quorum_lost` | HA write-quorum / leader lost — split-brain risk |
| `dependency_timeout` | an attested dependency (e.g. the telemetry signer, T15) timed out |

## 3. The fail-mode matrix

`resolveFailMode(criticality, conditions)` returns the **most restrictive** action
across all active conditions (`refuse` > `escalate` > `allow_degraded` > `allow`):

| condition ↓ / criticality → | safety_critical | mission_critical | routine | best_effort |
|---|---|---|---|---|
| `ledger_unavailable` | refuse | refuse | escalate | allow_degraded |
| `control_plane_stale` | refuse | refuse | escalate | allow_degraded |
| `quorum_lost` | refuse | refuse | escalate | escalate |
| `dependency_timeout` | refuse | escalate | allow_degraded | allow_degraded |

Doctrine notes:

- **Safety-critical fails closed on everything.** No exceptions, no soft modes.
- **`quorum_lost` never resolves softer than `escalate`** at any tier — split-brain
  is the one condition where even best-effort Wards pull a human in, because two
  partitions both believing they hold authority is the worst failure for a
  governance system.
- **`allow_degraded`** means *proceed but mark the decision for reconciliation*.
  The action is admitted; when the dependency recovers, the decision is replayed
  through the [Edge Conflict Inbox](./execution-control-runtime.md) against
  current policy. It is only ever reachable for `routine`/`best_effort` Wards and
  never for the conditions that imply lost authority knowledge at higher tiers.
- An **unknown condition fails closed** (`refuse`).

At the gate, a `refuse` resolution returns `REFUSE` and an `escalate` resolution
returns `ESCALATE`, both with reason code `DEGRADED_MODE`; `allow`/`allow_degraded`
fall through to normal Ward/Authority/invariant evaluation.

### Example

```jsonc
// POST /v1/execution-control/evaluate
{
  "action": { "action_id": "...", "action_type": "drone.takeoff", "...": "..." },
  "degraded_conditions": ["ledger_unavailable"]
}
// safety_critical Ward → { "decision": "REFUSE", "reason_codes": ["DEGRADED_MODE"] }
// routine Ward         → { "decision": "ESCALATE", "reason_codes": ["DEGRADED_MODE"] }
```

## 4. Gate high-availability topology

The fail-mode policy decides *what one boundary does when degraded*; HA decides
*how the boundary stays available and consistent*. AristotleOS supports a standard
active-active topology:

```
            ┌──────────── load balancer (L7) ────────────┐
            │  health: GET /health   readiness: GET /ready │
            ▼                 ▼                 ▼
       boundary-1        boundary-2        boundary-3        (stateless replicas)
            └──────── shared durable ledger (Postgres) ─────┘
                         serialized append + replay
```

- **Stateless replicas.** Each boundary holds no decision state of its own; Ward,
  Authority, signer, and revocation list are configuration/inputs. Scale
  horizontally behind any L7 load balancer.
- **Single source of truth for evidence + replay.** With the Postgres ledger
  backend, appends are **serialized** and replay (`hasPriorAdmission`) is a SQL
  read against shared state, so single-use Warrants and replay protection hold
  *across* replicas — not per-process. This is what makes active-active safe
  rather than a split-brain risk. (`postgres-ledger.ts`, leader-serialized append.)
- **`quorum_lost` ↔ the database.** If a replica cannot reach the durable ledger
  with quorum, it raises `quorum_lost`; the fail-mode matrix above then governs
  per-Ward behavior (mission-critical and above refuse; others escalate).
- **Liveness vs readiness.** `/health` is liveness (process up); `/ready` should
  gate traffic on ledger reachability so a replica that has lost its backing store
  is pulled from rotation instead of failing requests. Kubernetes manifests and
  graceful shutdown (drain in-flight, then exit) ship in `manifests/` and the Helm
  chart.
- **Fail-closed default at the edge.** The kill switch (sovereign halt) and DDIL
  edge-containment staleness-deny (T17) are independent, composable precautions
  that also fail closed; the criticality matrix is the *graduated* layer on top.

## 5. Built-in degradation detectors (self-driving)

The fail-mode policy is fed by real detectors (`degradation.ts`), not by hand:

- **`ledgerUnavailableProbe(path)`** — a filesystem canary (write + remove) on the
  ledger directory. **On by default** when a file-backed ledger is configured, so a
  fresh boundary self-detects "no evidence ⇒ no irreversible action" out of the box.
  Because the ledger can't record its own outage, the server **short-circuits** this
  condition: it resolves the fail-mode and answers with a *governed* degraded
  decision (REFUSE/ESCALATE, or a marked unanchored ALLOW for best-effort) instead
  of an ungoverned 500 from a failed append.
- **`controlPlaneStaleProbe(tracker)`** — reuses the DDIL containment tracker (B2/T17)
  so control-plane staleness and the fail-mode policy share one freshness anchor.
- **`predicateProbe(condition, healthy)`** and **`runWithTimeout(fn, ms)`** — adapt a
  deployment's own heartbeats (DB quorum, dependency liveness) into `quorum_lost` /
  `dependency_timeout`; a throwing health check is itself treated as a degradation.
- **`collectDegradation(probes)`** runs the set each request and de-duplicates;
  detected conditions merge with any caller-supplied `degraded_conditions`.

Configure via the `degradationProbes` server option (`[]` to disable; or supply your
own). Non-ledger conditions flow through the normal decision path, so the degraded
REFUSE/ESCALATE is itself recorded in the evidence ledger.

## Honest residual

- The ledger and control-plane detectors ship and are on by default; **quorum and
  dependency-liveness probes are deployment-specific** — we provide the adapters
  (`predicateProbe`, `runWithTimeout`), the operator wires them to their DB/cluster
  heartbeats.
- True multi-node soak + chaos on target hardware is **Tier C (C6)** — it needs
  real infrastructure and is tracked as a gate, not claimed in code.

See also: `docs/secure-deployment.md`, `docs/THREAT_MODEL.md` (T17, T20),
`shared/execution-control-runtime/src/fail-mode.ts`,
`shared/execution-control-runtime/src/degradation.ts`.
