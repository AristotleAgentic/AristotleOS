# Secure deployment reference

A hardened reference for running the AristotleOS control plane on Kubernetes. The
Helm chart (`charts/aristotle-governance-os`) already ships most of these controls;
this guide ties them together and points at the knobs.

> Quickest path: apply the hardened overlay on top of an environment profile.
> ```bash
> helm upgrade --install aristotle charts/aristotle-governance-os \
>   -f charts/aristotle-governance-os/values-pilot.yaml \
>   -f charts/aristotle-governance-os/values-hardened.yaml
> ```

## 1. Pod & container hardening

Built into the chart (`templates/deployments.yaml`):

- `runAsNonRoot: true`, `runAsUser/Group: 1000`, `seccompProfile: RuntimeDefault`
- `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`
- Resource requests/limits on every service; PodDisruptionBudget on the gateway
- **`readOnlyRootFilesystem`** — opt-in via `podSecurity.readOnlyRootFilesystem: true`
  (set by `values-hardened.yaml`). Mounts the rootfs read-only and gives each pod a
  writable `emptyDir` at `/tmp`; durable state still goes to the PV at
  `/var/lib/aristotle`.

`podSecurity.enforceRestricted` aligns with the Pod Security **restricted** profile —
label the namespace `pod-security.kubernetes.io/enforce: restricted`.

## 2. mTLS between components

Two supported paths (pick one):

- **SPIFFE/SPIRE** — `identity.spiffe.enabled: true` mounts the Workload API socket
  via the SPIFFE CSI driver so services obtain SVIDs for mTLS. See
  `values-spiffe.example.yaml`.
- **Service mesh** — `identity.mesh.inject: true` adds the sidecar-injection
  annotation (e.g. Istio) and lets the mesh enforce STRICT mTLS.

North–south TLS is terminated at the ingress: set `ingress.enabled: true` with
`ingress.tls` (a cert-manager-issued secret). The boundary itself speaks plain HTTP
behind the ingress/mesh by design.

## 3. Network policy

`networkPolicy.enabled: true` (default on; in the hardened overlay) installs a
default-deny posture with scoped allows between components. Keep it on and add
explicit egress rules only for your OIDC issuer (JWKS), OTel collector, and ledger
database.

## 4. Secrets & signing keys

- All credentials come from a pre-provisioned Secret (`secrets.existingSecret`),
  consumed via `envFrom.secretRef` — **never** baked into the image or values.
- Sync that Secret from a managed store (AWS/GCP/Azure/Vault) with the External
  Secrets Operator, or load the signing key at runtime with the managed signer
  (`createSignerFromKeyProvider`, `examples/signers/`). See **`docs/key-management.md`**
  for custody tiers and dual-key **rotation**.
- OIDC operator tokens verify against a **live JWKS** (`jwksUri`) that auto-rotates;
  see `docs/ACCESS_CONTROL.md`.

## 5. Fail-closed runtime posture

The hardened overlay pins:

- `NODE_ENV: production` + `ALLOW_INSECURE_PRODUCTION_BOOT: "false"` — the boundary
  refuses to start with an ephemeral signing key (`aristotle preflight` enforces this).
- `OPERATOR_SESSION_ENFORCEMENT` / `OPERATOR_ROLE_ENFORCEMENT: "true"` — RBAC at the
  boundary (viewer < operator < admin), admin-only kill/revoke.
- `GOVERNANCE_CHAIN_MODE: enforce` — the Ward/Warrant chain blocks, not just observes.

## 6. Sandboxed tool execution

For agent/tool execution, use the **container** or **wasm** sandbox provider (real
namespace+cgroup / WASI isolation) rather than `local-process`. See
`docs/sandboxes.md`. Kernel-level isolation for hostile multi-tenant workloads
(gVisor/Kata, seccomp/LSM profiles, eBPF attestation) is roadmap — see
`THREAT_MODEL.md`.

## 7. Observability

`telemetry.otel.enabled` (W3C trace context → OTLP) and `observability.serviceMonitor`
/ `prometheusRules` wire metrics + alerts. Ship the structured JSON audit log and the
GEL to your SIEM (`docs/` audit sink).

## Production checklist

- [ ] `helm ... -f values-<env>.yaml -f values-hardened.yaml`
- [ ] Namespace labeled Pod Security **restricted**
- [ ] `existingSecret` populated from a managed store (signing key + operator creds)
- [ ] Signing key is non-ephemeral; `aristotle preflight` passes; rotation runbook in place
- [ ] OIDC `jwksUri` configured; admin break-glass token stored separately
- [ ] mTLS via SPIFFE **or** mesh; ingress TLS terminated
- [ ] `networkPolicy.enabled: true`; egress allow-list reviewed
- [ ] OTel + SIEM receiving traces, metrics, audit log, and GEL
- [ ] Backups + recovery drill (`enterprise:drill`) green; `docs/release-checklist.md` complete
