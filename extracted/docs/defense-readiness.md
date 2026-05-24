# Defense readiness — hardening roadmap

Derived from an independent defense-evaluator review of v0.1.4. Each item maps a
review finding to a concrete fix. Tiers are honest about what code can close vs.
what needs hardware, external parties, or a program gate — we track the latter as
gates, we do not pretend code closes them.

Status: `done` · `wip` · `planned` · `gated` (external/program).

## Tier A — pure code

| ID | Fix | Finding | Status |
|----|-----|---------|--------|
| A1 | Property/formal verification of the gate invariants | 2.11 | done |
| A2 | Trusted time + nonce-bound warrants (staleness-deny) | 2.2 | planned |
| A3 | Asymmetric (Ed25519) credential minter; HMAC → dev-only | 2.3 | planned |
| A4 | Supply-chain: blocking dep audit + signed-artifact provenance | 2.9 | planned |
| A5 | Evaluator quickstart + console honesty + replay/idempotency docs | 2.10 | planned |

## Tier B — code + an explicit integration boundary

| ID | Fix | Finding | Status |
|----|-----|---------|--------|
| B1 | Attested-telemetry binding for physical invariants | 2.1 | planned |
| B2 | DDIL / captured-edge containment (staleness-deny, offline quota) | 2.5 | planned |
| B3 | Fail-mode per Ward criticality + gate-HA topology docs | 2.6 | planned |
| B4 | mTLS + PIV/CAC client-cert auth seam; gate the admin key | 2.8 | planned |
| B5 | FIPS-mode boot guard + crypto-posture doc | 2.3 | planned |
| B6 | MLS classification labels + CDS boundary | 2.7 | planned |

## Tier C — cannot be closed in code (gates, not pretense)

| ID | Item | Finding | Nature |
|----|------|---------|--------|
| C1 | HSM-resident **async** signing | 2.4 | path is code; HSM is hardware/ops |
| C2 | FIPS 140-3 **validated module** deployment | 2.3 | must run on a validated build |
| C3 | Third-party security audit | 2.11 | external party |
| C4 | ATO / STIG / RMF artifacts | 2.11 | program-gated |
| C5 | Accredited CDS, DoD PKI/OCSP, Type-1 | 2.7/2.8 | accreditation + gov infra |
| C6 | Multi-node cluster soak + chaos on target hardware | 2.6 | needs real infrastructure |

## The honest line

The hard, structural part — a deterministic, fail-closed decision boundary with
cryptographically verifiable, offline-checkable evidence — is built and correct.
Tier A and B are hardening and assurance on that foundation; Tier C is the cost of
fielding in a classified/safety-critical program and is owned by the program, not
the codebase.
