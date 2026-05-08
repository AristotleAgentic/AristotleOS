# Aristotle Autonomous Governance OS

This repository turns the Aristotle Autonomous Governance Console into a service-backed governance operating system prototype. The UI remains the operator surface. Services enforce meta-authority, authority, witness, execution, evidence, and replay boundaries.

The runtime now includes a persistent mission plane:
- `agent-os` stores agent, mission, workspace, lease, and memory state on disk
- `evidence-ledger` stores committed and hypothetical replay state on disk
- `agent-os` now also manages an execution queue and emits execution receipts as governed missions advance
- execution lifecycle transitions are mirrored into `evidence-ledger` replay events so task-level audit survives independently of `agent-os` state
- before a task can dispatch or finalize, `agent-os` now compiles mission policy, validates an authority envelope, evaluates admissibility, and requests a governance warrant
- after those artifacts are assembled, task dispatch now passes through `execution-gate` as an explicit commit-point boundary where kill-switch, identity, authority, and telemetry conditions are checked before execution begins
- those governance decisions are attached to task state so the operator surface can show why a task was approved or blocked and which policy/envelope/warrant artifacts were involved
- when completion is approved, `agent-os` now drives witness quorum verification, asks `execution-gate` for the final allow/deny decision, and emits a finality certificate into the ledger-backed audit trail
- when the runtime restarts, `agent-os` reconciles persisted state by re-queuing interrupted work, revoking stale leases, normalizing workspace and mission posture, and emitting recovery evidence so restart behavior remains auditable
- `agent-os` now also exposes worker-facing task claim, heartbeat, and completion routes with workspace and command hints, so governed execution can be driven by external agents instead of only by operator mission advancement
- `agent-os` now tracks governed tool actions beneath each task, allowing worker runtimes to propose and execute concrete shell, read, edit, and write operations against leased tools with auditable approval state
- long-running tasks now renew leased tools on active heartbeats, reconcile stale execution back into the queue, and enforce a bounded retry budget so worker autonomy stays durable without becoming unbounded drift
