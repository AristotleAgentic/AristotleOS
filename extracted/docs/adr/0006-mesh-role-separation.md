# ADR-0006 — Mesh role separation: Root / Witness / Edge

**Status:** Accepted

## Context

The substrate runs decisions in three operational positions, and the
positions have genuinely different responsibilities + threat models.
A naive design ("every node is identical, decisions reach consensus")
wastes the structural information available.

## Decision

Three roles, each with its own surface:

- **Root**: authoritative issuer. Mints envelopes, issues Fluidity
  Tokens, issues revocations (single-sig or with witness quorum per
  ADR-implicit). One per ward in the typical deployment; can be
  cold-restored from key material + ledger.

- **Witness**: passive observer + co-signer. Mirrors envelopes,
  forwards revocations to edges, co-signs revocations for quorum
  (ADR-0010 / multi-witness quorum). Multiple per ward; deployed in
  different operational domains so a compromise of one doesn't
  compromise the trust chain.

- **Edge**: decision execution point. Runs the disconnected commit
  gate, issues local Warrants under Fluidity Tokens during partition,
  reconciles on heal. Many per ward; lives next to the actual
  controlled system.

Every role is implemented as a subclass of `MeshNode` (in
`shared/mesh-runtime/src/index.ts`) sharing the HTTP plumbing, the
signer/verifier interfaces, the partition simulation, and the
inbound hardening (rate limit, replay cache, body size, content-type).
Role-specific behavior is the message-handler subclass differences.

## Alternatives considered

- **Single uniform role + consensus protocol.** Rejected. Real
  deployments have asymmetric trust (an edge UAV is trusted less
  than the operator's control-plane node). Pretending otherwise
  forces consensus where the operator wants delegation.
- **Two roles (authority + agent).** Rejected. The
  Witness/Root distinction matters: a Witness can attest to a
  Root-issued revocation (closing the single-root-compromise hole)
  but should not be able to issue new envelopes. Collapsing the two
  loses that. The Witness/Edge distinction matters: a Witness
  observes but doesn't act; an Edge acts but doesn't attest to
  others' actions. Collapsing them lets a compromised actor sign
  attestations for itself.
- **N-role plugin system.** Rejected. Three roles cover every
  deployment shape we've encountered; introducing a plugin API would
  invite operator confusion about which role to deploy.

## Consequences

- Operators must decide topology up front: how many witnesses, where
  they live, how many edges, which trust anchors each carries. This
  is operationally heavier than "deploy N identical nodes." Trade:
  the topology matches the operator's actual trust model.
- The trust-anchor allowlist on every node makes ADR-0004's
  partition story coherent — an edge knows which root + witnesses
  it'll accept attestation from, and ignores everything else.
- Adding a new role (e.g., "auditor") in the future would be
  additive — the role-base-class pattern accommodates it.

## See also

- `shared/mesh-runtime/src/index.ts` — RootNode, WitnessNode, EdgeNode
- ADR-0004 (Fluidity Tokens) — the disconnected-edge half of the role separation
- `docs/PRODUCTION_DEPLOYMENT.md` — operator-facing topology guidance
- `docs/specs/mesh-reconciliation.tla` — formal model includes the role distinction
