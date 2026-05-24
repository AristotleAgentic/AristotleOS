# Release checklist

Run before tagging a release of AristotleOS / publishing `@aristotle/os-cli`. Every
item has a concrete command and a clear pass condition. CI enforces the starred
(★) items on every push; the rest are release-time gates.

## 1. Build & quality gates

- [ ] **Install (pinned)** — `corepack pnpm install --frozen-lockfile`
- [ ] ★ **Typecheck** — `corepack pnpm -F @aristotle/execution-control-runtime build && corepack pnpm -F @aristotle/os-cli typecheck` → no errors
- [ ] ★ **Tests** — `corepack pnpm test` → all suites pass (governance, execution-control, sandbox, trace, cli, api, chain, adapters)
- [ ] ★ **Boundary self-check** — `node apps/aristotle-cli/dist/index.js pilot` → `PILOT READY`
- [ ] **Benchmark** — `npm run bench:execution-control` → review p50/p95/p99 (writes `reports/execution-control-benchmark.{json,md}`), no regression

## 2. Security & supply chain

- [ ] ★ **Clean-room scan** — `npm run clean-room` → no vendor markers outside the disclaimer allowlist
- [ ] ★ **SBOM** — `npm run sbom` → `sbom.json` regenerates; review component delta
- [ ] **Dependency audit** — `corepack pnpm audit --prod` → triage any new advisories against `sbom.json`
- [ ] **Threat model / audit scope current** — [THREAT_MODEL.md](THREAT_MODEL.md), [AUDIT_SCOPE.md](AUDIT_SCOPE.md) reflect this release
- [ ] **Disclosure path live** — [../SECURITY.md](../SECURITY.md) + `/.well-known/security.txt` accurate (contact + Expires not past)

## 3. Evidence integrity (the product promise)

- [ ] **GEL chain verifies** — `aristotle execution-control audit verify --ledger <gel.jsonl>`
- [ ] **Evidence bundle verifies offline** — `aristotle execution-control evidence verify --bundle <bundle.json>`
- [ ] **Key pinning works** — same with `--trusted-key-ids ed25519:<id>` (rejects unpinned keys)
- [ ] **Revocation honored** — same with `--revocations <list.json>` (rejects revoked ids)
- [ ] **Sandbox receipt verifies** — `aristotle sandbox receipt verify --receipt <r.json> --warrant <w.json>`

## 4. CLI package (publish-readiness)

- [ ] ★ **Pack + packed smoke** — `npm run package:cli:check` → tarball contents correct + packed `aristotle pilot` passes
- [ ] **No secrets/large files in tarball** — confirmed by `package:cli:check` (excludes src/tests/secrets)
- [ ] **License posture** — AristotleOS is currently **proprietary**: `extracted/LICENSE` (all-rights-reserved), `license: "UNLICENSED"`, and the CLI is `"private": true` so it cannot be accidentally published. To publish `@aristotle/os-cli` publicly later, choose a real license, set it on the package, remove `private`, and re-add `publishConfig.access`.
- [ ] **Version bumped** — `apps/aristotle-cli/package.json` + root `package.json`
- [ ] **Dry run** — `cd apps/aristotle-cli && npm publish --dry-run`

## 5. Deployment artifacts

- [ ] **Docker images build** — `npm run pilot:images` (or `docker build -f manifests/docker/execution-control.Dockerfile .`)
- [ ] **Helm chart lints + renders** — `npm run helm:validate` (lint + template, default + kind-smoke)
- [ ] **Kubernetes manifests valid** — `kubectl apply --dry-run=client -f manifests/k8s/` (or `npm run pilot:smoke:kind`)
- [ ] **Production preflight** — `NODE_ENV=production aristotle preflight` → refuses ephemeral signing keys; durable key + auth configured

## 6. Production posture (regulated deployments)

- [ ] Durable Ed25519 signing key mounted read-only (HSM/KMS/secret manager); **not** an ephemeral dev key
- [ ] Operator access control configured (`--api-key` / `--operator` / `--oidc-config`) with an `admin` break-glass credential
- [ ] Ledger backend chosen (SQLite single-node or Postgres HA) and replay protection on
- [ ] Audit sink (SIEM) wired; TLS terminated at ingress/mesh
- [ ] Trace context propagation verified end-to-end (see [observability.md](observability.md))

## 7. Docs & review

- [ ] [getting-started.md](getting-started.md), [cli.md](cli.md), README install paths accurate
- [ ] [auditor-guide.md](auditor-guide.md) current
- [ ] **Clean-Room Review** written in the release notes (Faramesh referenced? copied? vendored? imported? endorsement implied? `CLEAN_ROOM_NOTES.md` accurate?)

## 8. Tag & publish

- [ ] Commit clean working tree; `git tag vX.Y.Z`; push tag
- [ ] (If publishing) `cd apps/aristotle-cli && npm publish`
- [ ] Hand auditors the tag + [AUDIT_SCOPE.md](AUDIT_SCOPE.md), [THREAT_MODEL.md](THREAT_MODEL.md), [auditor-guide.md](auditor-guide.md), `sbom.json`
