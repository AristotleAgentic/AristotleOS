# Aristotle Autonomous Governance OS

A service-backed governance operating system prototype behind the fixed Aristotle Autonomous Governance Console operator surface.

AristotleOS is runtime governance for autonomous execution: authority resolution, policy compilation, Commit Gate admissibility, warrant issuance, and evidence finalization before consequential action.

## Try AristotleOS

Run the public playground locally:

```bash
corepack pnpm install
npm run aristotle:demo
```

Open:

```text
http://127.0.0.1:4173/try
```

The first scenario is a payments remediation agent attempting an $8,000 refund. AristotleOS resolves the Ward, checks the Authority Envelope, evaluates the Commit Gate, defers for approval, issues a one-time warrant only after approval, and commits the GEL record.

CLI path:

```bash
npm run aristotle -- init my-governed-agent
cd my-governed-agent
npm --prefix .. run aristotle -- check
npm --prefix .. run aristotle -- plan
npm --prefix .. run aristotle -- demo payments
```

Docs:
- [Quickstart](docs/quickstart.md)
- [CLI](docs/cli.md)
- [Playground](docs/playground.md)
- [Framework adapters](docs/framework-adapters.md)
- [Deployment](docs/deployment.md)
- [Pilot install](docs/pilot-install.md)
- [Ward/Warrant Execution-Control Path](docs/execution-control-runtime.md)

Pilot Kubernetes smoke:

```bash
npm run pilot:smoke:kind -- --tag 0.1.0-smoke --keep-port-forward
```

The smoke path builds the image set, installs the Helm chart into kind, then proves the governance boundary with a deferred payments action, one-time warrant issuance after approval, GEL commit, and fail-closed missing-authority behavior.

## Ward/Warrant Execution-Control Path

This AristotleOS component is independently developed. It may discuss Faramesh as a public example of the broader runtime authorization and execution-control category, but it does not copy Faramesh source code, documentation, examples, schemas, tests, comments, file names, repository structure, policy syntax, branding, or expressive material. AristotleOS is not affiliated with, certified by, sponsored by, or endorsed by Faramesh.

It canonicalizes a proposed action, evaluates it through a Ward and Authority Envelope at the Commit Gate, returns `ALLOW`, `ESCALATE`, or `REFUSE`, issues a single-use Warrant only on `ALLOW`, and appends the decision to a hash-linked Governance Evidence Ledger.

Run the demo:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/execution_control/ward.montana_drone_test_range.yaml \
  --envelope examples/execution_control/authority_envelope.survey_planner.yaml \
  --action examples/execution_control/actions/allow_takeoff.json \
  --ledger ./.tmp/gel.jsonl \
  --now 2026-05-21T14:00:00.000Z
```

Run it as a local execution-control daemon:

```bash
npm run execution-control:dev
```

Then submit an action from another terminal:

```bash
npm run execution-control:submit:allow
```

Export and verify a portable Evidence Bundle:

```bash
npm run execution-control:evidence:demo
npm run execution-control:evidence:verify
```

The runtime also publishes `GET /openapi.json` so agent adapters can discover the execution-boundary contract.

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
- `GET /ready`
- `GET /metrics`
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

Local control plane:
- `npm run local:up` builds the workspace, starts the runtime services in dependency order, waits for health checks, serves the built console, and writes process logs under `logs/local-control-plane/`
- `npm run local:status` shows service health, URLs, and recorded process IDs
- `npm run local:down` stops the services started by the local supervisor
- the local supervisor uses `SERVICE_DISCOVERY_MODE=local`, enables the Ward/Warrant chain in shadow mode by default, and persists local state under `data/`
- use `npm run local:up -- --no-build` when the workspace is already built and you only need a fast restart

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
- `GET /ready` is the strict readiness gate: it fails with `503` when preflight fails or any critical governance upstream is unavailable
- `GET /metrics` exposes Prometheus-compatible readiness, fail-closed, upstream health, upstream latency, and active governance halt gauges
- `GATEWAY_CRITICAL_SERVICES` can narrow or expand the comma-separated critical upstream set used by `/ready`
- `GATEWAY_READINESS_TIMEOUT_MS` controls per-upstream readiness probe timeout
- `ALLOW_INSECURE_PRODUCTION_BOOT=true` exists only as an emergency override and should not be used for normal enterprise deployment

Core validation:
- `npm run validate:core`
- runs a live end-to-end governance validation against the gateway
- checks governed dispatch with route context, scoped kill-switch blocking, replay memory for sovereign halt, and counterfactual reroute branch artifacts
- override the target gateway with `GATEWAY_BASE_URL=http://host:port npm run validate:core`
- if operator auth is enabled, export the same `OPERATOR_API_KEY` before running `npm run validate:core`
- set `OPERATOR_ACTOR` if you want validation-driven operator actions to be attributed consistently in ledger evidence
- set `OPERATOR_ROLE` if role enforcement is enabled and you want validation to act as a permitted role

Runtime benchmarking:
- `npm run benchmark:runtime`
- exercises the governance-core execution boundary in process without requiring a running service mesh
- measures warrant issuance, admissibility commit-gate evaluation, fail-closed missing-warrant handling, revocation blocking, GEL append throughput, and replay/hash-chain verification
- writes machine-readable JSON plus a Markdown operator report under `reports/`
- tune sample size with `npm run benchmark:runtime -- --iterations 5000 --warmup 500 --out reports/runtime-benchmark.json`

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
- Kubernetes production manifests live under `manifests/k8s/`: apply `namespace.yaml`, create a real `aristotle-runtime-secrets` Secret using `production-secrets.example.yaml` as the contract, then apply `control-plane.yaml`, `network-policy.yaml`, `gateway-deployment.yaml`, and `observability.yaml`
- Pilot cluster installs use the Helm chart under `charts/aristotle-governance-os` through `npm run pilot:install -- --tag <immutable-image-tag>`; see `docs/pilot-install.md`
- `npm run stack:up` builds and starts the full service mesh plus the dashboard
- `npm run stack:down` stops the stack
- `npm run stack:logs` tails the full stack logs
- `npm run enterprise:preflight` enforces enterprise-safe production configuration before boot
- `npm run enterprise:contracts` verifies that gateway fail-closed readiness, metrics, Compose healthchecks, Kubernetes control-plane manifests, namespace pod-security posture, network policy boundaries, Prometheus scrape/alert contracts, probes, resources, durable state, and security context stay wired
- `npm run enterprise:ui-safety` verifies that the operator console keeps visible readiness gates, mutation blocks, scoped halt validation, confirmation prompts, and mission/agent form validation wired
- `npm run enterprise:release-manifest` emits a hashed release manifest and Markdown summary under `reports/`; set `RELEASE_MANIFEST_SIGNING_SECRET` to sign it with HMAC
- `npm run enterprise:verify` runs enterprise preflight plus full stack and constitutional verification
- `npm run stack:smoke` verifies gateway health/preflight, deployment posture, deployable catalog, operator reachability, assurance report availability, and dashboard reachability
- `npm run stack:verify` runs both deployment smoke validation and the deeper constitutional runtime validation
- the compose stack now includes:
  - health checks for every governance service
  - startup dependency gating on healthy upstream services
  - `restart: unless-stopped`
  - a containerized `console-ui` on `http://localhost:4173`
- operational deployment and recovery guidance now lives in `docs/deployment-runbook.md`
