# Title threat model addendum

Scope: an AI agent, dealer DMS, lender system, or DMV-facing platform proposing a vehicle title, lien, registration, or DMV-document action. The Commit Gate is the boundary; nothing crosses into legal effect without a verified single-use Warrant.

## Assets

- **Legal**: vehicle title (right of ownership), lien instruments, registration record, DMV-accepted document.
- **Financial**: vehicle equity, lender collateral position, sales-tax revenue, dealer fees.
- **Governance**: the Ward, Authority Envelope, issued Warrants, Authority-Envelope revocation state, and the tamper-evident GEL.
- **Identity**: buyer/seller identity confidence, RPIC/dealer/lender signer attestations, DLDV state.

## Primary threats and controls

| # | Threat | Control |
|---|---|---|
| T1 | Unauthorized lien release (fraudulent payoff or insider abuse) | `require_signer_authorized`, `require_lender_active`, `require_lien_release_authority_active`, `require_lien_exists`, `require_lender_elt_participant` — REFUSE if any fail |
| T2 | Title fraud / VIN cloning / curbstoning | `require_nmvtis_passed`, `require_theft_flag_clear`, identity verification + fraud-score thresholds |
| T3 | Odometer fraud (49 CFR Part 580 violation) | `require_odometer_disclosed` — REFUSE if disclosure missing |
| T4 | Suspended-dealer transactions | `require_dealer_license_active` — REFUSE if inactive |
| T5 | Out-of-state title without VIN inspection | `require_vin_inspection_present` — REFUSE; transfer dual-controlled |
| T6 | Digital signature on a document the jurisdiction doesn't accept | `require_state_supports_digital_signature`, `require_digital_signature_accepted` |
| T7 | Authority envelope revoked but agent continues to act | `require_authority_envelope_unrevoked` — REFUSE |
| T8 | Warrant replay (single-use bypass) | `require_warrant_unused`; `warrant.reuse_attempt` is a hard interlock; the governance-core consumes Warrants before receipt |
| T9 | Bypass of state rules / fraud / theft / NMVTIS checks | Hard interlocks on every `*.bypass_*` and `*.disable_*` action type |
| T10 | Insider mutates the GEL after the fact | Hash-chained GEL with offline verifier; tampering detected on load (covered by `test:title`) |
| T11 | Inter-tenant title leakage (dealer A acts under dealer B's envelope) | `permitted_organization_kinds`, `Ward.permitted_subjects`, `Authority Envelope.subject` |
| T12 | Stale authority used to submit packets long after issuance | `max_warrant_age_ms`, envelope `expires_at` |

## Fail-closed posture

Title Wards should be `safety_critical`. Under any unresolved degradation — NMVTIS unreachable, DLDV down, ELT endpoint down, audit-sink unwritable — the gate REFUSES rather than admitting an ungoverned title action.

## Operational recommendations (exceeding the minimum)

- **Dual-control every consequential action**: transfer, correction, interstate registration, DMV submission, lien release where lender policy requires it.
- **Short Warrant TTLs** (minutes), refreshed on each successful authority sync. Treat any warrant older than the TTL as stale.
- **Per-VIN deduplication**: track per-VIN replay so a single bad actor cannot retry until the gate gives up.
- **Sign and archive a Title Evidence Bundle for every consequential decision** — this is the auditable substrate for state DMV / NMVTIS / consumer-protection investigations.
- **State-rule version pinning**: include `state_rule_version` in every Warrant and Evidence Bundle. When a rule set changes, in-flight transactions must be re-evaluated against the new version.
- **Treat jurisdiction-rule presets as demonstration material** until counsel has validated them against the actual state statutes and ELT contracts.
