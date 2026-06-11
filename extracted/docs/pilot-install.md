# AristotleOS Pilot Install

This is the pilot path for installing AristotleOS as governed autonomous execution infrastructure.

The install path preserves the core doctrine:

> Governance must bind at the execution boundary before irreversible state mutation or external action occurs.

## Prerequisites

- Kubernetes cluster with a default StorageClass
- `helm`
- `kubectl`
- AristotleOS images pushed with one immutable tag, for example `0.1.0-pilot.1`
- Prometheus Operator CRDs if `observability.serviceMonitor.enabled=true`
- SPIRE plus the SPIFFE CSI driver, or a mesh with SPIFFE-compatible workload identity, if `identity.spiffe.enabled=true`
- OTLP/HTTP collector reachable by the cluster if `telemetry.otel.enabled=true`

On this Windows workstation, local Kubernetes smoke tools are installed under:

```powershell
C:\Users\Pepper\Downloads\aristotle-k8s-tools\bin
```

For the current shell:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -Command ". .\scripts\use-k8s-tools.ps1; helm version --short; kind version; minikube version"
```

## Required Runtime Secrets

Set these locally before running the one-command installer:

```powershell
$env:OPERATOR_API_KEY="replace-with-real-operator-secret"
$env:OPERATOR_SESSION_SECRET="replace-with-real-session-secret"
$env:EVIDENCE_LEDGER_SIGNING_SECRET="replace-with-real-ledger-signing-secret"
$env:GOVERNANCE_CHAIN_SIGNING_SECRET="replace-with-real-chain-signing-secret"
```

## One-Command Install

Build and optionally push the immutable image set first:

```powershell
npm.cmd run pilot:images -- --registry ghcr.io --repository-prefix aristotle-os --tag 0.1.0-pilot.1 --push
```

```powershell
npm.cmd run pilot:install -- --release aristotle --namespace aristotle-governance-os --registry ghcr.io --repository-prefix aristotle-os --tag 0.1.0-pilot.1
```

The installer:

- runs deployment and UI safety contract checks
- generates a release manifest
- creates/updates the runtime Secret from the required env vars
- installs or upgrades the Helm chart
- waits for Kubernetes rollout readiness

Use an enterprise-managed Secret instead:

```powershell
npm.cmd run pilot:install -- --existing-secret aristotle-runtime-secrets --skip-secret-apply --tag 0.1.0-pilot.1
```

## Local Kubernetes Smoke Install

Use this before claiming a pilot build is installable. It creates or reuses a local `kind` or `minikube` cluster, builds the immutable AristotleOS image set, loads the images into the cluster, installs the Helm chart, port-forwards the gateway and console, and proves the execution boundary:

For local `kind` or Docker-backed `minikube`, Docker Desktop must be running before the cluster can be created or reached.

```powershell
npm.cmd run pilot:smoke:kind -- --tag 0.1.0-smoke --keep-port-forward
```

For minikube:

```powershell
npm.cmd run pilot:smoke:minikube -- --cluster aristotle-pilot --tag 0.1.0-smoke --keep-port-forward
```

The smoke harness verifies:

- `GET /ready` reaches strict gateway readiness
- `GET /console-health` reaches console readiness
- the payments refund scenario returns `DEFER` with no warrant before approval
- approval issues a single-use warrant
- GEL contains the deferred and permitted execution records
- a missing Authority Envelope binding returns `FAIL_CLOSED`
- `/public` and `/try` render from the cluster console service

It writes a machine-readable report:

```text
reports/k8s-smoke-report.json
```

When `--keep-port-forward` is used, the local URLs are:

```text
http://127.0.0.1:14173/public
http://127.0.0.1:14173/try
http://127.0.0.1:18080/ready
```

Useful options:

```powershell
npm.cmd run pilot:smoke -- --runtime kind --cluster aristotle-pilot --tag 0.1.0-smoke
npm.cmd run pilot:smoke -- --runtime minikube --cluster aristotle-pilot --tag 0.1.0-smoke
npm.cmd run pilot:smoke -- --skip-build --skip-load --skip-install --keep-port-forward
```

## Helm Chart

Chart path:

```text
charts/aristotle-governance-os
```

The chart deploys:

- governance kernel
- policy compiler
- evidence ledger
- meta authority registry
- authority router
- witness service
- execution gate
- simulation engine
- agent OS
- HTTP gateway
- operator console, public landing page, and browser playground
- PVCs for durable governance state
- default-deny ingress NetworkPolicy
- gateway ingress and east-west governance policies
- optional Ingress for the public trial/operator surface
- Prometheus ServiceMonitor and PrometheusRule
- restricted Pod Security namespace labels

## Real Image Tags

Do not deploy `latest` for a pilot.

Set one immutable tag for every AristotleOS component:

```powershell
npm.cmd run pilot:install -- --registry ghcr.io --repository-prefix aristotle-os --tag 0.1.0-pilot.1
```

The chart resolves images like:

```text
ghcr.io/aristotle-os/http-gateway:0.1.0-pilot.1
ghcr.io/aristotle-os/governance-kernel:0.1.0-pilot.1
ghcr.io/aristotle-os/evidence-ledger:0.1.0-pilot.1
ghcr.io/aristotle-os/console-ui:0.1.0-pilot.1
```

## SPIFFE / mTLS Story

The pilot chart supports SPIFFE identity without coupling AristotleOS to a single mesh:

- `identity.spiffe.enabled=true` mounts the SPIRE Workload API socket into each runtime pod through the SPIFFE CSI driver, avoiding privileged node `hostPath` mounts.
- The AristotleOS ServiceAccount is annotated with the SPIFFE ID.
- `SPIFFE_TRUST_DOMAIN` and `SPIFFE_SOCKET_PATH` are injected into runtime config.
- `identity.mesh.inject=true` applies mesh sidecar annotations so Istio, Linkerd, or another mesh can enforce mTLS between services.

Example:

```powershell
npm.cmd run pilot:install -- --tag 0.1.0-pilot.1 --values charts/aristotle-governance-os/values-spiffe.example.yaml
```

For a pilot, mTLS should be enforced by the mesh while AristotleOS continues enforcing execution admissibility at the Commit Gate.

## OpenTelemetry Traces

The HTTP gateway emits OTLP/HTTP spans when these are configured:

```text
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.monitoring.svc.cluster.local:4318
OTEL_SERVICE_NAME=aristotle-http-gateway
```

Gateway spans include:

- HTTP method and route
- response status
- latency
- whether the route touches the execution boundary
- whether the gateway entered fail-closed posture

## Operator Workflow

1. Port-forward the console:

```powershell
kubectl -n aristotle-governance-os port-forward svc/console-ui 4173:4173
```

2. Open the public trial at `http://127.0.0.1:4173/public`.
3. Open the playground at `http://127.0.0.1:4173/try` and verify the payments scenario reaches Commit Gate `DEFER`.
4. Open the operator console at `http://127.0.0.1:4173`.
5. Confirm the Operator Safety Gate is admissible.
6. Create a governed mission in Mission Command.
7. Register or select an operator agent.
8. Advance the mission until a task is release-ready.
9. Execute only after Commit Boundary admissibility and warrant issuance.
10. Export the governance evidence bundle from the Pilot Workflow panel.

The `console-ui` pod serves the built public/operator UI and proxies `/operator`, `/v1`, `/ready`, `/health`, and `/metrics` to `http-gateway` through `CONSOLE_GATEWAY_BASE_URL`. This keeps browser traffic simple while the Governance Plane remains behind the gateway.

## Optional Ingress

Port-forwarding is the default pilot path. To expose the console through an ingress controller:

```powershell
npm.cmd run pilot:install -- --tag 0.1.0-pilot.1 --values values-pilot-ingress.yaml
```

Example values:

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: aristotle.example.com
      paths:
        - path: /
          pathType: Prefix
          serviceName: console-ui
          servicePort: 4173
```

## Post-Install Verification

```powershell
kubectl -n aristotle-governance-os port-forward svc/http-gateway 8080:8080
curl http://127.0.0.1:8080/ready
curl http://127.0.0.1:8080/metrics
kubectl -n aristotle-governance-os port-forward svc/console-ui 4173:4173
curl http://127.0.0.1:4173/console-health
```

Healthy expectations:

- `/ready` returns `200`
- `failClosed` is `false`
- `aristotle_gateway_ready` is `1`
- no critical upstream service is down
- `/console-health` returns `ok: true`
- `/public` and `/try` render from the console service
- evidence export succeeds from `/operator/governance-chain/gel/export`
