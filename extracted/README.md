# Aristotle Autonomous Governance OS

A service-backed governance operating system prototype behind the fixed Aristotle Autonomous Governance Console operator surface.

## Stack
- Node.js 20
- TypeScript
- Express
- Docker Compose

## Services
- governance-kernel
- policy-compiler
- evidence-ledger
- meta-authority-registry
- simulation-engine
- authority-router
- witness-service
- execution-gate
- agent-os
- http-gateway

## Agent OS
`agent-os` adds the AI runtime layer that this repo was missing. It manages mission orchestration, agent registration, workspace sessions, tool leases, and mission memory behind the existing governance mesh.

Runtime persistence:
- `agent-os` persists mission, workspace, lease, agent, and memory state to `AGENT_OS_STATE_PATH`
- `evidence-ledger` persists committed and counterfactual replay history to `EVIDENCE_LEDGER_STATE_PATH`

Execution loop:
- mission advancement can now seed execution tasks, dispatch them to agents, and emit execution receipts
- the console surfaces both the execution queue and recent execution receipts through the live gateway snapshot
- execution task queueing, dispatch, completion, and halt events are now committed into the evidence ledger for durable audit
- each execution task now performs a governance pass before dispatch and completion by compiling mission policy, validating an authority envelope, evaluating admissibility, and requesting a warrant
- pre-execution task dispatch now also passes through an explicit commit-point execution gate so kill-switch state, identity legitimacy, authority approval, and telemetry satisfaction are checked at the execution boundary
- blocked governance decisions are persisted in task state, emitted as receipts, and surfaced in the console with policy, envelope, and warrant references when available
- approved completions now continue through witness verification, execution-gate decisioning, and finality certificate emission before the task is treated as fully closed
- on restart, `agent-os` now reconciles persisted runtime state by re-queuing in-flight tasks, revoking expired or closed-mission leases, normalizing workspace posture, and recording recovery events in both memory and the ledger
- long-running execution now renews active leases on task claim/heartbeat, re-queues stale work when heartbeats lapse, and caps retries with a configurable attempt budget

Gateway routes:
- `GET /operator/os/state`
- `GET /operator/os/missions`
- `POST /operator/os/agents`
- `POST /operator/os/workspaces`
- `POST /operator/os/missions`
- `POST /operator/os/missions/:missionId/advance`
- `POST /operator/os/reconcile`
- `GET /operator/os/tasks/next`
- `POST /operator/os/tasks/:taskId/claim`
- `POST /operator/os/tasks/:taskId/heartbeat`
- `POST /operator/os/tasks/:taskId/complete`
- `POST /operator/os/tasks/:taskId/retry`
- `GET /operator/os/tasks/:taskId/actions`
- `POST /operator/os/tasks/:taskId/actions`
- `POST /operator/os/tasks/:taskId/actions/:actionId/execute`
- `POST /operator/os/leases/:leaseId/renew`

## Quick start
```bash
cp .env.example .env
npm install
npm run dev
```

Dashboard canvas:
- the operator dashboard now runs as a Vite app from `apps/console-ui`
- after `npm run dev`, open `http://localhost:4173`
- the canvas proxies live service calls to the gateway on `http://localhost:8080`
- the command deck now includes deployable-specific operator surfaces for agents, ground vehicles, aerial drones, infrastructure, robotics, industrial systems, cyber operations, maritime systems, and assurance
- deployable surfaces are served by the control plane at `GET /operator/deployables` so domain views stay aligned with the same governance kernel
- set `OPERATOR_API_KEY` in `.env` to require a credential on `/operator/*`
- set `OPERATOR_SESSION_ENFORCEMENT=true` and `OPERATOR_SESSION_SECRET` to require short-lived signed bearer sessions on `/operator/*`
- set `VITE_OPERATOR_API_KEY` for the console app when you want the browser dashboard to authenticate automatically
- set `VITE_OPERATOR_ACTOR` when you want dashboard-issued governance actions to carry a stable enterprise operator identity
- set `VITE_OPERATOR_ROLE` when you want dashboard requests to carry an explicit enterprise operator role

Gateway production preflight:
- when `NODE_ENV=production`, the gateway now refuses to start unless critical enterprise controls are configured
- production boot requires:
  - `OPERATOR_API_KEY`
  - `OPERATOR_SESSION_SECRET` when `OPERATOR_SESSION_ENFORCEMENT=true`
  - `SERVICE_DISCOVERY_MODE` not equal to `local`
  - explicit `EVIDENCE_LEDGER_STATE_PATH`
  - explicit `AGENT_OS_STATE_PATH`
- `GET /health` now includes gateway preflight posture and checks
- `ALLOW_INSECURE_PRODUCTION_BOOT=true` exists only as an emergency override and should not be used for normal enterprise deployment

Core validation:
- `npm run validate:core`
- runs a live end-to-end governance validation against the gateway
- checks governed dispatch with route context, scoped kill-switch blocking, replay memory for sovereign halt, and counterfactual reroute branch artifacts
- override the target gateway with `GATEWAY_BASE_URL=http://host:port npm run validate:core`
- if operator auth is enabled, export the same `OPERATOR_API_KEY` before running `npm run validate:core`
- set `OPERATOR_ACTOR` if you want validation-driven operator actions to be attributed consistently in ledger evidence
- set `OPERATOR_ROLE` if role enforcement is enabled and you want validation to act as a permitted role

Operator RBAC:
- set `OPERATOR_ROLE_ENFORCEMENT=true` to enforce operator roles at the gateway
- `OPERATOR_READ_ROLES` controls which roles may use read-only `/operator/*` routes
- `OPERATOR_MUTATION_ROLES` controls which roles may mutate the governance plane
- `OPERATOR_READ_ACTORS` optionally allowlists named operator actors for read routes
- `OPERATOR_MUTATION_ACTORS` optionally allowlists named operator actors for mutation routes
- `OPERATOR_DEFAULT_ROLE` is used when no `x-operator-role` header is supplied
- `OPERATOR_SESSION_ENFORCEMENT=true` requires callers to mint a signed session at `POST /operator/auth/session` before using `/operator/*`
- `OPERATOR_SESSION_SECRET` signs those bearer sessions
- `npm run enterprise:keys` generates an Ed25519 ledger keypair under `./secrets`
- set `EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH` and `EVIDENCE_LEDGER_SIGNING_PUBLIC_KEY_PATH` to move immutable evidence from HMAC signing to asymmetric Ed25519 signing
- `npm run enterprise:backup` snapshots the governed durable state into `./backups`
- `npm run enterprise:restore` restores the latest snapshot back into the governed state paths
- `npm run enterprise:drill` runs a non-destructive disaster recovery drill: backup plus restore verification
- by default:
  - `viewer`, `operator`, and `admin` may read
  - `operator` and `admin` may mutate

Or:
```bash
docker compose up --build
```

Enterprise stack:
- use `.env.production.example` as the starting template for production promotion
- `npm run stack:up` builds and starts the full service mesh plus the dashboard
- `npm run stack:down` stops the stack
- `npm run stack:logs` tails the full stack logs
- `npm run enterprise:preflight` enforces enterprise-safe production configuration before boot
- `npm run enterprise:verify` runs enterprise preflight plus full stack and constitutional verification
- `npm run stack:smoke` verifies gateway health/preflight, deployment posture, deployable catalog, operator reachability, assurance report availability, and dashboard reachability
- `npm run stack:verify` runs both deployment smoke validation and the deeper constitutional runtime validation
- the compose stack now includes:
  - health checks for every governance service
  - startup dependency gating on healthy upstream services
  - `restart: unless-stopped`
  - a containerized `console-ui` on `http://localhost:4173`
- operational deployment and recovery guidance now lives in `docs/deployment-runbook.md`
