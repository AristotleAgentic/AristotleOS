# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout note

Project source is tracked under `./extracted/`. All commands and paths below are relative to that directory unless otherwise noted. The repo root holds `LICENSE`, `CLAUDE.md`, the original `aristotle-governance-os-enterprise-package.zip` (legacy bundle, kept for reference), and `docs/` (project-level documentation including audits).

Runtime state files (`extracted/services/*/data/*.json`) and personal config (`.claude/settings.local.json`) are gitignored. They live on disk locally for `npm run dev` to function but are not tracked.

## Common commands

Run these from `./extracted/`.

**Install: use pnpm, not npm.** Workspace deps are declared as `workspace:*`, which npm does not understand (`EUNSUPPORTEDPROTOCOL`). The committed `package-lock.json` is stale; `pnpm-lock.yaml` is the real lockfile.

- `corepack pnpm install` — preferred (corepack ships with Node 20+, no global install needed). Two esbuild postinstall scripts are skipped by pnpm default; if Vite/console-ui misbehaves, run `corepack pnpm approve-builds` and reinstall.
- `npm run dev` — runs every service + the console-ui concurrently via `tsx watch` (see `package.json` for the full `concurrently` invocation). Console at `http://localhost:4173`, gateway at `http://localhost:8080`. (Despite the `npm run` form in `package.json` scripts, dispatch them with `corepack pnpm run <script>` or `corepack pnpm <script>` since install is pnpm-managed.)
- `npm run build` — TypeScript build across all workspaces.
- `npm run validate:core` — live end-to-end governance validation against a running gateway. Override target with `GATEWAY_BASE_URL=...`. Honors `OPERATOR_API_KEY` / `OPERATOR_ACTOR` / `OPERATOR_ROLE` env when auth is enabled.
- `npm run stack:up` / `stack:down` / `stack:logs` — docker compose lifecycle for the full mesh.
- `npm run stack:smoke` — health/preflight/dashboard reachability check.
- `npm run stack:verify` — `stack:smoke` + `validate:core`.
- `npm run enterprise:preflight` — refuses production boot unless required env is configured (see `scripts/validate-enterprise-config.mjs`).
- `npm run enterprise:keys` — generate Ed25519 ledger signing keypair under `./secrets/`.
- `npm run enterprise:backup` / `enterprise:restore` / `enterprise:drill` — durable state snapshot/restore and non-destructive DR drill.
- `npm run enterprise:verify` — preflight + full stack/constitutional verification (single promotion gate).

Per-service: each workspace under `services/*`, `adapters/*`, `apps/*`, `shared/*` has `build` (`tsc -p tsconfig.json`), `dev` (`tsx watch src/index.ts`), and `start` (`node src/index.js`) scripts.

`npm run lint` and `npm run test` are intentionally stubs (`echo 'not yet configured'`). Don't claim they ran.

## Running `npm run dev` locally (outside Docker)

One real gotcha when running outside docker-compose:

**Flip `SERVICE_DISCOVERY_MODE=local` in your `.env`.** The example ships with `container`, which makes services resolve each other by docker hostname (`evidence-ledger`, `governance-kernel`, …) and fail with `ENOTFOUND` when run directly. With `local`, the `HOST_*` fallback resolves to `127.0.0.1`. Keep `container` only when running via `docker compose`.

```bash
cp .env.example .env   # if not already present
# edit .env, set SERVICE_DISCOVERY_MODE=local
npm run dev
```

**Why no `dotenv` import is needed:** each service's `src/lib.ts:6-9` calls Node's built-in `process.loadEnvFile?.(rootEnvPath)` at boot, which loads `extracted/.env` automatically on Node 20.6+. No shell-sourcing required. (Docker compose also picks up `.env` via `env_file:`, so both paths converge.)

When the gateway logs `http-gateway upstream bases { ... '127.0.0.1:7001' ... }`, discovery is correctly local. If you see bare service names there, `.env` did not load (Node version too old?) or `SERVICE_DISCOVERY_MODE` is still `container`.

**Restart hygiene:** killing the parent `npm run dev` process on Windows often leaves orphaned `tsx`/`node` workers holding 7001–7009, 8080, and 4173 — the next launch then dies with `EADDRINUSE`. Free them before relaunching:
```powershell
$ports = 7001..7009 + 8080 + 4173
foreach ($p in $ports) {
  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}
```

Healthy boot indicators (`curl http://localhost:8080/health`):
- top-level `ok: true`
- every entry in `services[]` is `{ status: "fulfilled", value: { ok: true, ... } }` — `rejected` entries point at the misrouted/unreachable upstream.

## Architecture (the big picture)

This is a TypeScript / Node 20 / Express monorepo (npm + pnpm workspaces) implementing a service-backed **governance operating system**. The operator-facing console is fixed; the services exist to enforce governance boundaries around AI agent execution.

### Service mesh

Independent Express services, each on a fixed port, talking over HTTP via the gateway:

- `governance-kernel` (7001) — kill-switch state, authority envelopes, execution warrants.
- `policy-compiler` (7002) — compiles mission policy from inputs.
- `evidence-ledger` (7003) — durable, signed audit log of governance + replay events. Persists to `EVIDENCE_LEDGER_STATE_PATH`. Supports HMAC or Ed25519 signing.
- `meta-authority-registry` (7004) — root authority chain resolution.
- `simulation-engine` (7005) — counterfactual / replay simulation.
- `authority-router` (7006) — routes envelopes/decisions across authority domains.
- `witness-service` (7007) — quorum-based witness verification.
- `execution-gate` (7008) — explicit commit-point allow/deny boundary checked at task dispatch and completion (kill-switch, identity legitimacy, authority approval, telemetry satisfaction).
- `agent-os` (7009) — AI runtime layer: missions, agents, workspaces, tool leases, mission memory, execution queue, task lifecycle. Persists to `AGENT_OS_STATE_PATH`.
- `http-gateway` (`adapters/http-gateway`, 8080) — single front door. Owns operator auth (API key, optional signed session, optional RBAC) and a **production preflight** that refuses to boot in `NODE_ENV=production` without the required enterprise config.
- `console-ui` (`apps/console-ui`, 4173) — Vite/React operator dashboard. The single source of truth for the operator surface is `apps/console-ui/src/AristotleAutonomousGovernanceConsole.tsx`. The browser talks to `http://localhost:8080` via the gateway client.

### The constitutional execution loop (read this before touching `agent-os` or `execution-gate`)

When a mission advances and `agent-os` dispatches an execution task, it is **not** a simple queue pop. Each task transition runs through a fixed governance pipeline, and skipping any step breaks the model:

1. `agent-os` compiles mission policy via `policy-compiler`.
2. Validates an authority envelope via `governance-kernel` (which consults `meta-authority-registry`).
3. Evaluates admissibility and requests an execution warrant.
4. **Pre-dispatch:** `execution-gate` checks kill-switch / identity / authority / telemetry at the explicit commit point.
5. Worker (external agent) claims the task, heartbeats, and submits output via `/operator/os/tasks/:taskId/...` routes.
6. **On completion:** `witness-service` runs quorum verification, then `execution-gate` issues a final allow/deny, then a finality certificate is emitted.
7. Every transition (queue, dispatch, claim, heartbeat, complete, halt, block) is committed to `evidence-ledger`. Blocked decisions persist in task state with policy/envelope/warrant references so the console can explain *why*.

Restart reconciliation: on boot, `agent-os` re-queues in-flight tasks, revokes expired or closed-mission leases, normalizes workspace posture, and emits recovery evidence. Active heartbeats renew leased tools; lapsed heartbeats re-queue stale work; retries are capped by `AGENT_OS_TASK_MAX_ATTEMPTS`.

### Shared packages

- `shared/types` (`@aristotle/shared-types`) — TS types for `AuthorityEnvelope`, `ExecutionWarrant`, `KillSwitchEvent`, etc. Used across services.
- `shared/schemas` (`@aristotle/shared-schemas`) — Zod schemas mirroring those types.

Workspace deps are referenced as `workspace:*` (pnpm) — when adding a service-to-service dependency on shared types, follow the existing pattern in any `services/*/package.json`.

### Service discovery

Hosts are resolved as `HOST_<SERVICE>` env vars, falling back to `127.0.0.1` when `SERVICE_DISCOVERY_MODE=local`, otherwise to the docker-compose service name. Production preflight rejects `local` mode. When adding a new service, follow this pattern in its `index.ts` and add a port + optional `HOST_*` to `.env.example`.

### Operator surface contract

All gateway operator routes live under `/operator/*`. Auth layers (in order, all optional, all configured via env):

1. `OPERATOR_API_KEY` — bearer credential.
2. `OPERATOR_SESSION_ENFORCEMENT=true` + `OPERATOR_SESSION_SECRET` — short-lived signed sessions minted at `POST /operator/auth/session`.
3. `OPERATOR_ROLE_ENFORCEMENT=true` — RBAC via `OPERATOR_{READ,MUTATION}_{ROLES,ACTORS}` and `OPERATOR_DEFAULT_ROLE`. Defaults: `viewer/operator/admin` may read; `operator/admin` may mutate.

In production (`NODE_ENV=production`), the gateway refuses to start unless `OPERATOR_API_KEY`, durable `EVIDENCE_LEDGER_STATE_PATH` and `AGENT_OS_STATE_PATH`, and non-`local` discovery are set. `ALLOW_INSECURE_PRODUCTION_BOOT=true` is an emergency override only.

The full operator API (mission lifecycle, task claim/heartbeat/complete/retry, governed tool actions, lease renewal) is documented in `docs/api-contracts.md` and the README.

## Conventions worth knowing

- Each service is a single-file-ish Express app: `src/index.ts` is the route layer, `src/lib.ts` is helpers (`createApp`, `id`, `now`). Compiled `.js` and `.d.ts` siblings are checked in alongside `.ts` sources — when editing `.ts`, the build will refresh the `.js`/`.d.ts` outputs; don't hand-edit the generated files.
- Health endpoint convention: every service exposes `GET /health` returning `{ ok: true, service: "<name>", ... }`. The compose healthchecks and gateway preflight depend on this.
- New governance events should be persisted into `evidence-ledger` and, where they affect agent runtime, mirrored into `agent-os` task state — the audit trail must survive independently of `agent-os` state.
