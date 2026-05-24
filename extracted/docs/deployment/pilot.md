# Pilot deployment

Operational guide to standing up AristotleOS for an enterprise pilot on Kubernetes
via the `charts/aristotle-governance-os` Helm chart. Pairs with
[../deployment-runbook.md](../deployment-runbook.md) (recovery/validation),
[../observability.md](../observability.md), and the release gate in
[../release-checklist.md](../release-checklist.md).

## Value profiles

Pick a profile; each is a thin overlay on `values.yaml`:

| Profile | File | For |
|---------|------|-----|
| local | `values-local.yaml` | a laptop kind/minikube cluster; single replicas, obs/ingress off, insecure-boot allowed (no real secrets needed) |
| kind-smoke | `values-kind-smoke.yaml` | the automated smoke install/test |
| staging | `values-staging.yaml` | pre-prod; production posture + obs + ingress on non-prod hosts |
| pilot | `values-pilot.yaml` | enterprise pilot; pinned tag, HA, OTel + Prometheus, NetworkPolicy, restricted PodSecurity, TLS ingress |

All profiles are validated in CI (`npm run helm:validate` → `helm lint` + `helm
template` for every profile).

## One-command local cluster (kind / minikube)

```bash
npm run pilot:smoke:kind          # create/reuse a kind cluster, build+load images, install, smoke-test
npm run pilot:smoke:minikube      # same on minikube
```

This builds the immutable image set, installs the chart, and proves the boundary
end to end (deferred action → approval → one-time warrant → GEL commit →
fail-closed missing-authority). Flags: `--tag <t>`, `--release <r>`,
`--namespace <ns>`, `--skip-cluster-create`, `--keep-port-forward`.

## Manual install (any cluster)

1. **Provision the runtime secret** (the chart loads it via `envFrom`):

   ```bash
   kubectl create namespace aristotle-governance-os
   kubectl create secret generic aristotle-runtime-secrets -n aristotle-governance-os \
     --from-literal=OPERATOR_API_KEY="$(openssl rand -hex 32)" \
     --from-literal=OPERATOR_SESSION_SECRET="$(openssl rand -hex 32)" \
     --from-literal=EVIDENCE_LEDGER_SIGNING_SECRET="$(openssl rand -hex 32)" \
     --from-literal=GOVERNANCE_CHAIN_SIGNING_SECRET="$(openssl rand -hex 32)"
   ```

   (See `manifests/k8s/production-secrets.example.yaml`. The `local` profile sets
   `ALLOW_INSECURE_PRODUCTION_BOOT=true` so it boots without this secret — local only.)

2. **Install / upgrade** with a profile and a pinned image tag:

   ```bash
   helm upgrade --install aristotle charts/aristotle-governance-os \
     -n aristotle-governance-os --create-namespace \
     -f charts/aristotle-governance-os/values-pilot.yaml \
     --set global.image.tag=0.1.1
   ```

3. **Status / uninstall**:

   ```bash
   node scripts/pilot-cluster.mjs status                       # helm status + pods/svc/ingress
   node scripts/pilot-cluster.mjs uninstall                    # keeps namespace (PVCs/secrets)
   node scripts/pilot-cluster.mjs uninstall --purge-namespace  # full teardown
   ```

## Secrets handling

- Keys required (all high-entropy): `OPERATOR_API_KEY`, `OPERATOR_SESSION_SECRET`,
  `EVIDENCE_LEDGER_SIGNING_SECRET`, `GOVERNANCE_CHAIN_SIGNING_SECRET`.
- Reference the secret by name via `secrets.existingSecret` (default
  `aristotle-runtime-secrets`); the chart never embeds secret material.
- Use your platform's secret manager (External Secrets Operator, Vault Agent, or
  the cloud CSI secrets driver) to populate it; do not commit real values.

## Certificate & key rotation

- **Signing keys** (evidence ledger / governance chain, Ed25519): rotate by
  provisioning a new key, deploying it, then **revoking** the old key id
  (`aristotle revoke key <id>` / the revocation list) so prior warrants/evidence
  bound to it fail verification. Verifiers pin trusted key ids out of band.
- **TLS** (ingress): terminate at the ingress/mesh. The pilot profile shows a
  cert-manager `cluster-issuer` annotation + a `tls` secret; rotation is handled by
  cert-manager. AristotleOS speaks plain HTTP behind the terminator by design.

## mTLS / workload identity (SPIFFE/SPIRE)

`identity.spiffe.enabled` mounts the SPIFFE Workload API (CSI driver) so services
obtain SVIDs for mTLS; `identity.mesh.inject` adds mesh sidecar annotations. See
`values-spiffe.example.yaml`:

```bash
helm upgrade --install aristotle charts/aristotle-governance-os \
  -n aristotle-governance-os \
  -f charts/aristotle-governance-os/values-pilot.yaml \
  -f charts/aristotle-governance-os/values-spiffe.example.yaml
```

Requires SPIRE + the SPIFFE CSI driver in-cluster. Without them, leave SPIFFE off
and rely on NetworkPolicy + mesh/ingress mTLS.

## Observability

- **OpenTelemetry**: `telemetry.otel.enabled` + `exporterEndpoint` (OTLP/HTTP).
  Governance decisions carry W3C trace context into the signed GEL — see
  [../observability.md](../observability.md).
- **Prometheus**: `observability.serviceMonitor.enabled` and
  `prometheusRules.enabled` (requires the Prometheus Operator CRDs). Scrape
  `/metrics` for decision/reason-code/latency/failure series.

## Operator quickstart (post-install)

1. `node scripts/pilot-cluster.mjs status` — confirm pods Ready and the release deployed.
2. Port-forward the console: `kubectl port-forward svc/console-ui 4173:4173 -n aristotle-governance-os` → http://127.0.0.1:4173.
3. Confirm the gateway is healthy: `kubectl port-forward svc/http-gateway 8080:8080 -n aristotle-governance-os` then `curl localhost:8080/ready`.
4. Profile a batch in **Shadow Mode** before enforcing (see [shadow-mode.md](../shadow-mode.md)).
5. Keep the sovereign halt reachable: the kill switch must be exercised in a drill before go-live (see the runbook).

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Pods `CreateContainerConfigError` | `aristotle-runtime-secrets` missing — create it (above) or use the `local` profile |
| Pods crashloop with insecure-boot refusal | production profile without provisioned signing secrets — provide the secret or use `local` |
| `/ready` returns 503 | a critical upstream is not Ready; `node scripts/pilot-cluster.mjs status` and check the failing service |
| ServiceMonitor/PrometheusRule rejected | Prometheus Operator CRDs absent — install them or set `observability.*.enabled=false` |
| Ingress 404 / no address | ingress controller/class mismatch — set `ingress.className` to your controller |
| SPIFFE CSI mount fails | SPIRE / SPIFFE CSI driver not installed — disable `identity.spiffe.enabled` |
| `helm:validate` fails after edits | a values profile no longer renders — run `node scripts/validate-helm.mjs` for the failing profile |

## Host-enforcement roadmap (not yet implemented — stated plainly)

AristotleOS governs at the **execution boundary** (Commit Gate → Warrant → GEL)
and isolates sandboxed execution at the process level today. The following are
**roadmap**, not current guarantees, and the docs/UI do not claim them:

- kernel-level enforcement (eBPF) of egress/syscalls,
- Wasm / microVM isolation as a built-in sandbox backend,
- zero-copy evidence pipelines.

Until then, pair AristotleOS with your platform's isolation (NetworkPolicy,
PodSecurity, a real isolating sandbox provider — see [sandboxes.md](../sandboxes.md)).
