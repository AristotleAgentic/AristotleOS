# Deployment Runbook

## Purpose
This runbook covers enterprise-style startup, validation, and recovery for the Aristotle Autonomous Governance OS stack.

The goal is to preserve the core constitutional model during deployment:
- pre-execution governance remains intact
- operator access is authenticated and attributable
- sovereign halt remains available
- evidence and replay remain durable
- deployment verification happens before relying on the system operationally

## Required configuration
Before deployment, copy `.env.production.example` to `.env` and set these values:

- `NODE_ENV=production`
- `SERVICE_DISCOVERY_MODE=container`
- `OPERATOR_API_KEY=<strong-secret>`
- `OPERATOR_SESSION_ENFORCEMENT=true`
- `OPERATOR_SESSION_SECRET=<strong-session-secret>`
- `GOVERNANCE_CHAIN_V2=true`
- `GOVERNANCE_CHAIN_MODE=enforce`
- `GOVERNANCE_CHAIN_STATE_PATH=<durable-mounted-path>`
- `GOVERNANCE_CHAIN_SIGNING_SECRET=<strong-chain-signing-secret>` or `GOVERNANCE_CHAIN_SIGNING_PRIVATE_KEY_PATH=<durable-private-key-path>`
- `EVIDENCE_LEDGER_STATE_PATH=<durable-mounted-path>`
- `EVIDENCE_LEDGER_SIGNING_SECRET=<strong-ledger-signing-secret>` or `EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH=<durable-private-key-path>`
- `AGENT_OS_STATE_PATH=<durable-mounted-path>`

Recommended operator identity settings:

- `VITE_OPERATOR_API_KEY=<same-operator-key-when-dashboard-runs-behind-trusted-boundary>`
- `VITE_OPERATOR_ACTOR=<stable-operator-identity>`
- `VITE_OPERATOR_ROLE=operator`
- `OPERATOR_ACTOR=<stable-validation-identity>`
- `OPERATOR_ROLE=operator`

Optional RBAC enforcement:

- `OPERATOR_ROLE_ENFORCEMENT=true`
- `OPERATOR_DEFAULT_ROLE=operator`
- `OPERATOR_READ_ROLES=viewer,operator,admin`
- `OPERATOR_MUTATION_ROLES=operator,admin`
- `OPERATOR_READ_ACTORS=enterprise-console,enterprise-validation`
- `OPERATOR_MUTATION_ACTORS=enterprise-console,enterprise-validation`
- `OPERATOR_SESSION_TTL_MS=900000`
- `OPERATOR_SESSION_SKEW_MS=60000`
- `EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH=./secrets/ledger-ed25519-private.pem`
- `EVIDENCE_LEDGER_SIGNING_PUBLIC_KEY_PATH=./secrets/ledger-ed25519-public.pem`

Do not rely on:

- `ALLOW_INSECURE_PRODUCTION_BOOT=true`
- `SERVICE_DISCOVERY_MODE=local`
- empty operator credentials in production

## Startup procedure
1. Confirm `.env` contains production-safe values.
2. Run `npm run enterprise:preflight`.
   If you want asymmetric immutable evidence, run `npm run enterprise:keys` first and set the ledger signing key paths.
3. Run `npm run stack:up`.
4. Wait for containers to reach healthy status.
5. Run `npm run stack:smoke`.
6. Run `npm run validate:core` if this is a controlled deployment window and deeper runtime validation is appropriate.
7. Run `npm run enterprise:verify` when you want a single end-to-end promotion check.
8. Run `npm run enterprise:release-manifest` and archive `reports/release-manifest.json` with the release evidence.
9. Run `npm run enterprise:backup` after a clean promotion to capture a known-good recovery snapshot.
10. Run `npm run enterprise:drill` on a regular cadence to verify DR readiness without mutating live state.

## Kubernetes deployment
The Kubernetes manifests under `manifests/k8s/` are structured so readiness follows the core thesis: the gateway is not ready unless the critical governance path behind the execution boundary is ready.

For pilot installs, prefer the Helm path in `docs/pilot-install.md`:

```powershell
npm.cmd run pilot:install -- --release aristotle --namespace aristotle-governance-os --tag 0.1.0-pilot.1
```

The `pilot:install` command runs deployment/UI safety checks, generates a release manifest, creates or references the runtime Secret, installs/upgrades the Helm chart, and waits for readiness.
After install, port-forward `svc/console-ui` and use `/public` for the public trial, `/try` for the playground, and `/` for the operator workflow from governed mission creation to admitted execution to evidence export.

Apply order:
1. `kubectl apply -f manifests/k8s/namespace.yaml`
2. Create the production secret from a secure secret source. `manifests/k8s/production-secrets.example.yaml` documents the required keys only; replace all values before applying.
3. `kubectl apply -f manifests/k8s/control-plane.yaml`
4. `kubectl apply -f manifests/k8s/network-policy.yaml`
5. `kubectl apply -f manifests/k8s/gateway-deployment.yaml`
6. `kubectl apply -f manifests/k8s/observability.yaml` when Prometheus Operator CRDs are installed.
7. Wait for `http-gateway` readiness to pass on `/ready`.
8. Run `npm run stack:smoke` against the exposed gateway URL.

Kubernetes posture:
- namespace enforces the Kubernetes `restricted` Pod Security profile
- `GOVERNANCE_CHAIN_MODE=enforce` in production control-plane config
- durable PVCs for `evidence-ledger`, `governance-kernel`, and `agent-os`
- service Deployments consume `aristotle-runtime-config` and `aristotle-runtime-secrets`
- stateless governance services run with two replicas
- stateful governance services run with one replica and durable state until a distributed store is introduced
- gateway readiness uses `/ready`; liveness uses `/health`
- pods run as non-root and drop Linux capabilities
- default ingress is denied; the gateway, governance east-west traffic, and monitoring scrape paths are explicit NetworkPolicy exceptions
- `observability.yaml` publishes a ServiceMonitor for `/metrics` and PrometheusRule alerts for fail-closed readiness, critical upstream failure, active sovereign halt, and readiness latency degradation

## Expected healthy endpoints
- Gateway health: `GET /health`
- Gateway readiness: `GET /ready`
- Gateway metrics: `GET /metrics`
- Operator state: `GET /operator/os/state`
- Assurance report: `GET /operator/assurance/report`
- Dashboard: `http://localhost:4173`

Healthy gateway expectations:
- `ok: true`
- `preflight.ok: true`
- `/ready` returns `200`
- `/ready.failClosed` is `false`
- all critical upstream services report `ok: true`
- `aristotle_gateway_ready` is `1` in `/metrics`

Expected production alerts:
- `AristotleGatewayNotReady`
- `AristotleGatewayFailClosed`
- `AristotleCriticalGovernanceUpstreamDown`
- `AristotleGovernanceHaltActive`
- `AristotleGovernanceUpstreamLatencyHigh`

## Post-start validation
Use these checks in order:

1. `npm run stack:smoke`
   Verifies gateway health/preflight, strict readiness, Prometheus metrics, operator reachability, assurance report reachability, governance-chain integrity, and dashboard reachability.

2. `npm run validate:core`
   Verifies governed dispatch, governed tool execution, scoped halt, replay memory, counterfactual routing, assurance reporting, and immutable assurance attestation.

3. `npm run enterprise:preflight`
   Enforces enterprise-safe production configuration for operator auth, signed sessions, service discovery, durability, and operator identity attribution.

4. `npm run enterprise:backup`
   Captures the current evidence-ledger and agent-os durable state with a manifest and SHA-256 digests.

5. `npm run enterprise:drill`
   Verifies backup plus restore-readiness in one non-destructive recovery exercise.

6. `npm run enterprise:ui-safety`
   Verifies that the console keeps operator mutation blocks, scoped halt validation, confirmation prompts, and execution-boundary warning text wired.

7. `npm run enterprise:release-manifest`
   Captures product doctrine, authority-chain contract, workspace surface, external dependency surface, deployment artifact hashes, lockfile hashes, and an optional HMAC signature.

8. Dashboard review
   Confirm:
   - `Governed Commit Posture` renders correctly
   - `Assurance Posture` renders correctly
   - `Enterprise Assurance Report` shows reasons
   - recent assurance history is visible
   - kill-switch panel reflects live sovereign state

## Routine operator actions
- Use `ATTEST MISSION` to preserve a mission assurance snapshot.
- Use `ATTEST SYSTEM` to preserve a full system assurance snapshot.
- Use the kill switch panel for scoped sovereign interruption.
- Use the time machine for counterfactual reroute or halt inspection before making high-risk governance decisions.

## Failure handling

### Gateway fails preflight at boot
Likely causes:
- missing `OPERATOR_API_KEY`
- `OPERATOR_SESSION_ENFORCEMENT=true` without `OPERATOR_SESSION_SECRET`
- `SERVICE_DISCOVERY_MODE=local` in production
- missing durable state paths

Action:
1. Fix `.env`.
2. Restart the stack.
3. Re-run `npm run stack:smoke`.

### Operator requests return `401`
Likely causes:
- missing or incorrect `OPERATOR_API_KEY`
- session enforcement enabled but no bearer session minted
- dashboard missing `VITE_OPERATOR_API_KEY`

Action:
1. confirm configured key in `.env`
2. confirm `OPERATOR_SESSION_SECRET` is configured when session enforcement is enabled
3. retry the session bootstrap at `POST /operator/auth/session`
2. confirm browser-side key is present if required
3. restart affected services

### Operator requests return `403`
Likely causes:
- `OPERATOR_ROLE_ENFORCEMENT=true`
- caller role is not permitted for the route type
- caller actor is not on the read or mutation allowlist

Action:
1. verify `VITE_OPERATOR_ROLE` or `OPERATOR_ROLE`
2. verify `VITE_OPERATOR_ACTOR` or `OPERATOR_ACTOR`
2. verify `OPERATOR_READ_ROLES` / `OPERATOR_MUTATION_ROLES`
3. verify `OPERATOR_READ_ACTORS` / `OPERATOR_MUTATION_ACTORS` when actor allowlists are enabled
4. re-run with a permitted enterprise operator role and actor

### Stack is up but governance services are degraded
Action:
1. inspect `npm run stack:logs`
2. inspect `GET /ready`
3. inspect `GET /metrics`
3. confirm durable state paths and mounted volumes
4. if runtime state is interrupted, invoke `/operator/os/reconcile`
5. preserve evidence before manual intervention if the system is already in a degraded governance posture

### Mission execution is blocked unexpectedly
Action:
1. inspect `Enterprise Assurance Report` reasons
2. inspect focused task governance posture
3. inspect kill-switch scopes
4. inspect mission artifact timeline and receipts
5. inspect authority route continuity posture

## Recovery procedure
1. Restore service availability.
2. Confirm gateway preflight is passing.
3. Run `npm run stack:smoke`.
4. Run `npm run validate:core` if recovery scope allows.
5. Use `/operator/os/reconcile` if tasks were interrupted.
6. Commit a fresh mission or system assurance attestation after recovery.

### Snapshot restore
Use when durable state has been lost or corrupted and you need a controlled rollback:
1. Stop the affected stack or services.
2. Run `npm run enterprise:restore` to restore the latest governed snapshot.
3. Start the stack again.
4. Run `npm run stack:smoke`.
5. Run `npm run validate:core`.
6. Run `/operator/os/reconcile` if in-flight work was interrupted.

## Change management guidance
Before promoting deployment changes:
- build the monorepo with `npm run build`
- generate `npm run enterprise:release-manifest`
- run `npm run stack:smoke`
- run `npm run validate:core`
- verify operator auth and role behavior if enabled
- verify assurance attestation still lands in immutable evidence

## Escalation guidance
Escalate immediately if:
- sovereign halt cannot be asserted
- gateway preflight is bypassed in production without explicit approval
- evidence or replay durability is lost
- operator identity or role attribution is missing for control-plane mutations
