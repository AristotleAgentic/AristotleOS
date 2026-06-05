# ADR-0008 — OCI-style signed policy bundles

**Status:** Accepted

## Context

Policy lives in source repositories during development but must
reach production gates as a deployable, signed artifact. The
question: what's the artifact format?

Three options:
1. Raw JSON / YAML files committed to operator-managed config repos
   and pulled at boot.
2. A bespoke `.aplbundle` format defined by AristotleOS.
3. An OCI image format reusing the ecosystem (registries, signing
   tools, scanning) operators already have.

## Decision

The substrate's `@aristotle/policy-pipeline` ships an OCI-style
bundle:

- Compiled `GovernanceManifest` (Ward + AuthorityEnvelope + APL
  source + manifest hashes) packaged as an OCI artifact.
- Signed with the operator's Ed25519 signer; the signature is an OCI
  layer.
- Content-addressed via the OCI manifest digest — any byte change
  produces a different digest, so policy version drift is visible
  in the registry.
- Pushable to any OCI registry (Docker Hub, ghcr.io, ECR, internal
  Harbor). Pullable by Wards / Gates at boot.
- Verifiable offline given the registry-reported digest + the
  signer's public key — no live registry call needed at verify
  time.

## Alternatives considered

- **Raw JSON in config repos.** Works but doesn't capture
  provenance (who built this? when? against which source commit?)
  without operator-side discipline. Easy to drift between dev /
  staging / prod versions.
- **Bespoke .aplbundle.** Considered. The substrate could define
  its own tarball format. Rejected because it'd require defining
  its own registry, signing tooling, scanning integration —
  reinventing what OCI already standardized.
- **JFrog Artifactory / Maven / npm.** Rejected. Each has its own
  conventions and operators in different ecosystems have different
  preferences. OCI is the lowest common denominator that works
  across cloud, on-prem, and air-gapped.

## Consequences

- Operators get policy versioning for free — every push to the
  registry is a new tag + a stable digest.
- The compiled `GovernanceManifest` carries its hash chain
  (manifest_hash references ward_hash + authority_envelope_hash);
  the bundle layer's content addressing is consistent with this.
- Validating a bundle is offline-possible: pull layer bytes,
  recompute hashes, verify signature against trusted public key.
  No runtime dependency on the registry beyond initial pull.
- Operators can reuse their existing OCI tooling (scanning, signing
  with cosign, multi-arch, etc.). The substrate doesn't reinvent
  those.
- Bundle format is documented in `@aristotle/policy-pipeline/README.md`;
  schema and verification semantics are stable across versions.
- Deployments without an OCI registry (e.g., air-gapped scientific
  instruments) can use the bundle as a tarball on a filesystem —
  the same content-addressed format works either way.

## See also

- `@aristotle/policy-pipeline` — bundle build + sign + verify
- `@aristotle/policy-pipeline/src/oci.ts` + `oci.test.ts` — OCI marshaling
- ADR-0001 (single-use Warrants) — Warrants chain to the
  AuthorityEnvelope in the bundle
- ADR-0005 (small APL) — APL is the bundle's source input
- [docs/concepts/wards.md](../concepts/wards.md) — Wards as the addressable unit a bundle carries
