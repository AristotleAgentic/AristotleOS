# Architecture Decision Records

Records of the substrate's most consequential design decisions. Each
ADR captures the context, the alternatives considered, the decision,
and the consequences — so a reviewer or future contributor doesn't
have to reverse-engineer the rationale from the code.

Format: a lightweight variant of [Michael Nygard's ADR template](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

Closes [ROADMAP_TO_100.md](../../ROADMAP_TO_100.md) Category 3
*"Author ADRs for the top 15 design decisions"*. All 15 ship.
Future ADRs document new design decisions as they're made; the
next number to use is 0016.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-single-use-warrants-vs-jwt.md) | Single-use Warrants instead of JWT-style bearer tokens | Accepted |
| [0002](0002-deterministic-gate.md) | Deterministic Commit Gate decision function | Accepted |
| [0003](0003-gel-hash-chain.md) | Hash-chained Governance Evidence Ledger | Accepted |
| [0004](0004-fluidity-tokens.md) | Fluidity Tokens for disconnected operation | Accepted |
| [0005](0005-small-apl.md) | Small Aristotle Policy Language | Accepted |
| [0006](0006-mesh-role-separation.md) | Mesh role separation: Root / Witness / Edge | Accepted |
| [0007](0007-per-tenant-ledger-isolation.md) | Per-tenant ledger isolation | Accepted |
| [0008](0008-oci-policy-bundles.md) | OCI-style signed policy bundles | Accepted |
| [0009](0009-evidence-bundle-format.md) | Evidence bundle format for offline verification | Accepted |
| [0010](0010-productionmode-lockdown.md) | `productionMode: true` constructor lockdown | Accepted |
| [0011](0011-http-gateway-only-network-boundary.md) | HTTP gateway is the only network boundary | Accepted |
| [0012](0012-replay-artifact-third-party-verifiable.md) | Replay artifact as third-party-verifiable evidence | Accepted |
| [0013](0013-no-substrate-ui.md) | The substrate ships no UI | Accepted |
| [0014](0014-adapter-production-validated-default-false.md) | Adapters default `production_validated: false` | Accepted |
| [0015](0015-one-package-per-substrate-concept.md) | One package per substrate concept | Accepted |

## Conventions

- Number ADRs sequentially. Don't reuse numbers.
- Status is one of: Proposed | Accepted | Deprecated | Superseded by ADR-N.
- Don't edit Accepted ADRs in place — write a new ADR that supersedes
  the old one, and update the old one's Status to "Superseded by ADR-N".
- Cross-reference: when one ADR depends on or contradicts another, link
  to it. The decision graph is more useful than the individual decisions.

## Why ADRs at all

The substrate makes choices that look weird to anyone who comes in
expecting one of the obvious alternatives. *"Why not JWT?"*, *"Why
make APL so small?"*, *"Why a hash chain instead of an append-only
log with an external signature?"* — each has a real answer rooted
in the substrate's threat model and operational reality. ADRs are
the version-controlled, citable, can't-be-forgotten answer.
