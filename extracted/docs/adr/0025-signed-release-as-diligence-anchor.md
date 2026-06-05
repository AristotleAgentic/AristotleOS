# ADR-0025 — Signed release artifacts as the diligence anchor

**Status:** Accepted

## Context

A skeptical reviewer of a substrate that gates execution has a
chicken-and-egg problem: the substrate is supposed to prove who's
allowed to do what, but the reviewer first needs to prove **the
substrate they're running is the one the maintainer published**.

If the published artifact is unsigned, the reviewer either:
- Trusts the package registry's integrity (npm, GitHub Releases),
  which adds the registry as a trust party.
- Builds from source, which adds the source repo's hosting as a
  trust party.

Both are reasonable but neither is provable to a third party. A
signed release is the missing layer.

## Decision

**Every tagged release goes through `.github/workflows/release.yml`
which produces Sigstore-cosign-signed artifacts.** Specifically:

1. CI starts from a tag matching `v*`.
2. The reviewer-verify gate runs first (18/18 required).
3. A tarball + CycloneDX SBOM are built and signed via Sigstore
   keyless OIDC signing (the GitHub Actions OIDC token is the
   identity).
4. `cosign verify-blob` runs against the signature as a paranoia
   check before publishing.
5. The signed artifacts + verification instructions are attached
   to the GitHub Release.

Reviewers verify the published artifact with:
```sh
cosign verify-blob \
  --certificate-identity-regexp '^https://github\.com/AristotleAgentic/AristotleOS/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --signature aristotle-os-vX.Y.Z.tar.gz.sig \
  --bundle aristotle-os-vX.Y.Z.tar.gz.bundle \
  aristotle-os-vX.Y.Z.tar.gz
```

If `verify-blob` exits zero, the reviewer has proven: this tarball
was produced by the published release workflow of the named GitHub
repository on the date stamped in the bundle.

## Alternatives considered

- **Unsigned releases, trust the registry.** Rejected. The substrate
  exists in part to NOT add trust parties; making npm or GitHub a
  trust party for the substrate's integrity contradicts the
  substrate's own threat model.
- **PGP-signed releases.** Considered. PGP works but the key
  management story (who has the maintainer's private key, key
  rotation, key revocation) is operationally heavier. Sigstore's
  keyless OIDC signing avoids the long-lived-private-key problem
  by binding signatures to the CI workflow's identity.
- **Self-hosted Rekor-style log of releases.** Considered. The
  substrate ships a Rekor client (`@aristotle/sigstore-rekor`) for
  TSA-style GEL anchoring, but using a self-hosted log for release
  artifacts adds infrastructure the substrate doesn't operate.
  Sigstore's public log is the operator-facing answer.
- **Sign every per-package npm tarball additionally.** Considered.
  npm provenance via `npm publish --provenance` does this; the
  substrate's `release.yml` includes it. ADR-0010 (productionMode)
  + ADR-0025 (this) + npm provenance compose to "the substrate's
  trust chain is operator-verifiable end-to-end."

## Consequences

- Every release has a verifiable provenance chain back to the
  GitHub Actions workflow that produced it. Reviewer-grade.
- A future compromise of the maintainer's GitHub account would
  produce signatures bound to the attacker's workflow run — a
  different OIDC identity than the published one. Reviewers pinning
  the certificate-identity-regexp catch this; reviewers who don't
  pin it don't catch it. Operator discipline.
- Signing happens AFTER reviewer-verify gates pass. A release that
  fails the gates never gets signed.
- The release workflow itself is in the repo, reviewable, and its
  OIDC identity is recorded in the Sigstore log. There's no
  out-of-band signing infrastructure.
- Diligence conversations have a one-command answer to "prove this
  tarball is what you say it is." Before this ADR, that answer was
  "trust npm." Now it's `cosign verify-blob`.

## See also

- `.github/workflows/release.yml` — the signing workflow
- ADR-0017 (TimestampAuthority substitution point) — the GEL-record-level cousin of release signing
- ADR-0012 (replay artifact format) — another piece of the verifiability story
- [Sigstore docs](https://docs.sigstore.dev/)
- [cosign keyless signing](https://docs.sigstore.dev/cosign/signing/overview/)
