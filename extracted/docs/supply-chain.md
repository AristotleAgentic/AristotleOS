# Supply-chain security (A4)

AristotleOS treats its own build and dependency chain as part of the trust
boundary. Two controls back that up: a **blocking dependency-audit gate** and
**signed release provenance + SBOM attestation**. This closes defense-review
finding 2.9 ("the dependency audit is informational; release artifacts carry no
provenance").

## 1. Blocking dependency audit

The CI `dependency-audit` job is a **gate**, not a notice. Any production-dependency
advisory at or above the fail threshold (default `high`+`critical`) fails the build.

- Engine: `scripts/audit-deps.mjs` (`pnpm audit:ci`). It runs
  `pnpm audit --prod --json`, normalizes the advisory list (handles both the v6
  `advisories` map and the v7+ `vulnerabilities` map), and classifies each finding.
- It runs in CI and locally; the evaluation logic is pure and unit-tested
  (`pnpm test:audit`, also part of `pnpm test`).

### Triage allowlist

A finding can be temporarily accepted only by an explicit, reviewed entry in
`.audit-allowlist.json` at the workspace root — never by silencing the gate:

```json
[
  { "id": "GHSA-xxxx-yyyy-zzzz", "reason": "no exploit path: parser not reachable from the boundary", "expires": "2026-09-01" }
]
```

- `id` matches the GHSA id, the numeric advisory id, or the package key.
- `reason` is mandatory in review (the gate prints it on every run).
- `expires` is mandatory: **an expired exception is itself a build failure**, so a
  "temporary" waiver cannot quietly become permanent. Re-triage or fix before it
  lapses.

Change the threshold with `pnpm audit:ci --fail-on critical` (or evaluate a saved
report with `--input audit.json`).

## 2. Release provenance + SBOM attestation

On a version tag (`v*`), `.github/workflows/release.yml` builds and packs the
`@aristotle/os-cli` tarball, generates a CycloneDX SBOM (`pnpm sbom`), and produces
two OIDC-signed attestations in GitHub's attestation store:

1. **SLSA build provenance** (`actions/attest-build-provenance`) — a signed record
   of *how and where* the tarball was built (repo, commit, workflow, runner),
   bound to the artifact's digest.
2. **SBOM attestation** (`actions/attest-sbom`) — binds the CycloneDX dependency
   manifest to that exact tarball digest.

Signing uses the workflow's short-lived OIDC identity (Sigstore/Fulcio under the
hood); no long-lived signing key is held in the repo. The job requests only
`id-token: write` and `attestations: write`.

### Verifying a release

A consumer who downloads the CLI tarball can verify both attestations offline of
our infrastructure, against GitHub's transparency log:

```bash
# SLSA build provenance — proves the artifact came from this repo's release workflow
gh attestation verify aristotle-os-cli-<version>.tgz --repo <owner>/<repo>

# Inspect the bound SBOM
gh attestation verify aristotle-os-cli-<version>.tgz --repo <owner>/<repo> \
  --predicate-type https://cyclonedx.org/bom
```

A tampered tarball, or one built anywhere other than the release workflow, fails
verification.

## Honest status

- The **audit gate** is live in CI and runnable locally today (`pnpm audit:ci`),
  with unit-tested logic.
- The **attestations** are produced by GitHub Actions on tagged releases and
  require the repository's OIDC identity; they are exercised by the release
  workflow on GitHub, not reproducible on a developer laptop. The workflow is
  committed and ready; the first attested artifact appears on the next `v*` tag.

## Related controls

- Clean-room provenance of the source itself: `pnpm clean-room`
  (`docs/`/threat model T-series).
- Package integrity for the published CLI: `pnpm package:cli:check`.
- Dependency manifest: `pnpm sbom` → `sbom.json` (CycloneDX 1.5).
