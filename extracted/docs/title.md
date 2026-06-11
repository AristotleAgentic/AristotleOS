# Aristotle Verified Title Transaction Layer

## What it is

Aristotle's runtime governance plane for **consequential vehicle title, lien, registration, and DMV-document actions**. Every title-changing, lien-changing, registration-submitting, or document-signing action is admitted only with valid authority, satisfied jurisdiction rules, bound fraud/identity/NMVTIS/theft checks, and a single-use Warrant — producing a hash-chained, signed Evidence Bundle per decision.

**Where it sits in the market**: Platforms like **Vitu, CVR (Computerized Vehicle Registration), Dealertrack, DDI Technology, and Reynolds & Reynolds** digitize the vehicle-to-government workflows. Aristotle's Verified Title Transaction Layer is the **authority and evidence layer** that proves every consequential title action was authorized, state-rule compliant, fraud-checked, and audit-ready **before** it crossed into legal effect. It is complementary, not competing.

> **Demonstration only.** All shipped jurisdiction rules and sample data are demonstration material. They MUST be legally validated before any production use.

## Adapter surfaces

`TITLE_ADAPTER_CATALOG` exposes ten typed boundaries:

| Adapter | Consequence boundary |
|---|---|
| `elt-lien` | Lien perfection, satisfaction, release at state ELT endpoints |
| `title-transaction` | New title, transfer, duplicate, correction, brand changes |
| `registration` | Renewal and interstate registration |
| `digital-signature` | DMV-document signature execution (ESIGN / UETA) |
| `dealer-workflow` | Dealer-initiated transfer and trade-in payoff |
| `lender-workflow` | Lender-initiated lien perfection / satisfaction / release |
| `dmv-submission` | State-agency packet submission |
| `fraud-check` | DLDV, OFAC, suspicious-pattern checks |
| `nmvtis` | Vehicle history / brand / state-of-title check |
| `historian-write` | Operational and compliance recordkeeping |

## What it prevents

**Hard interlocks** that REFUSE even if mistakenly allowed:
- `title.override_lien_release` / `lien_release.override`
- `title.bypass_nmvtis` / `nmvtis.disable`
- `title.bypass_theft_check` / `theft_check.disable`
- `title.bypass_state_rules` / `state_rule.override`
- `title.override_dealer_license` / `dealer_license.override`
- `title.override_odometer_disclosure` / `odometer.bypass`
- `title.disable_identity_verification` / `identity.disable`
- `signature.bypass_jurisdiction_acceptance`
- `warrant.reuse_attempt` / `warrant.replay`

**Per-transaction bounds** enforced at the gate:
- `permitted_jurisdictions`, `permitted_transaction_types`, `permitted_organization_kinds`
- `max_fraud_risk_score`, `min_identity_confidence_score`, `max_warrant_age_ms`
- `require_dealer_license_active`, `require_lender_active`, `require_lender_elt_participant`, `require_signer_authorized`
- `require_nmvtis_passed`, `require_theft_flag_clear`, `require_odometer_disclosed`, `require_identity_verified`
- `require_authority_envelope_unrevoked`, `require_warrant_unused`
- `require_required_forms_present`, `require_vin_inspection_present`
- `require_state_supports_elt`, `require_state_supports_digital_signature`, `require_digital_signature_accepted`
- `require_lien_exists`, `require_lien_release_authority_active`

## Jurisdiction rule presets (DEMO ONLY)

`JURISDICTION_RULE_PRESETS` ships **sample / demonstration** rule sets for **MT, OR, CA, TX, FL**. Each declares: ELT support, digital-signature support, odometer-disclosure requirement, out-of-state VIN-inspection requirement, lienholder-verification requirement, NMVTIS check requirement, fraud-escalation threshold, identity-confidence floor, permitted transaction types, and required forms by transaction type. **None of these are legal rules.** Validate with counsel before pilot use.

## Doctrine

- **Authority before consequence.** No title action without a complete Authority Envelope → Ward → Warrant chain.
- **Warrant before execution.** The Warrant is single-use, time-bounded, signed; consumed *before* the receipt is written.
- **Evidence after every decision.** Every ALLOW, REFUSE, ESCALATE, and FAIL-CLOSED is a hash-chained signed GEL record + Title Evidence Bundle.
- **Fail-closed by design.** Missing primitive, revoked envelope, stale warrant, missing form, failed check → REFUSE.

## How to try it

```bash
npm run test:title
npm run aristotle -- execution-control evaluate \
  --ward examples/title/ward.mt_lender_ops.yaml \
  --envelope examples/title/authority_envelope.title_orchestrator.yaml \
  --action examples/title/actions/allow_lien_release_clean_mt.json \
  --ledger ./.tmp/title.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

`refuse_unauthorized_signer.json` and `refuse_revoked_envelope.json` demonstrate fail-closed refusals.

## Demo scenarios (covered by `test:title`)

1. **Clean Montana lien release** → ALLOW
2. **Unauthorized lender employee** lien release → REFUSE
3. **Interstate title transfer** (dual-controlled) → ESCALATE
4. **Digital signature with revoked authority envelope** → REFUSE
5. **Dealer transaction with fraud risk over threshold** → REFUSE
6. **Title correction** (dual-controlled) → ESCALATE
7. **Suspended dealer license** → REFUSE

Plus a 18-condition refuse sweep, hard interlock test, `warrant.reuse_attempt` replay test, dual-control escalate→approve→ALLOW, signed Title Evidence Bundle round-trip, and **GEL chain tamper detection** (mutating a ledger entry breaks verification).

## Evidence produced

`exportTitleEvidenceBundle()` wraps the signed execution Evidence Bundle with title context (actor, organization kind, jurisdiction, state-rule version, transaction id/type/VIN/title-state, fraud + identity scores, regulatory evidence profile, rule_validation_state, pre/post checks, redacted fields). `verifyTitleEvidenceBundle()` re-verifies it offline. See [title-ward-templates.md](title-ward-templates.md) and [title-threat-model.md](title-threat-model.md).

## Outbound submission adapter (demonstration)

AristotleOS gates the action; the outbound adapter actually delivers the resulting packet to the state ELT hub, DMV portal, or dealer system. The runtime ships a `TitleSubmissionTransport` interface and a `DemonstrationTitleSubmissionTransport` reference implementation.

Cryptographic binding chain:

1. The Commit Gate ALLOWs the canonical action and emits a single-use Warrant signed over the canonical action hash.
2. The orchestrator consumes the Warrant and produces a `TitleSubmissionAuthorization` carrying `warrant_id`, `action_hash`, `consumed=true`, `jurisdiction`, and `transaction_type`.
3. `submitTitlePacket(packet, authz, transport, opts)` enforces defense-in-depth before the transport is invoked:
   - refuses `MISSING_AUTHORIZATION` if authz is null
   - refuses `WARRANT_NOT_CONSUMED` unless `authz.consumed === true`
   - refuses `JURISDICTION_MISMATCH` / `TRANSACTION_TYPE_MISMATCH` if authz scope does not match the packet
   - refuses `DEMONSTRATION_ONLY_BLOCKED` unless `transport.production_validated === true` OR the caller passes `allowDemonstrationTransport: true`
   - surfaces transport exceptions as `TRANSPORT_UNREACHABLE` rather than throwing
4. The transport produces a `TitleSubmissionReceipt` whose `receipt_hash` covers `warrant_id` + `action_hash` + `remote_receipt_id` + ack metadata.
5. The receipt is embedded inside `TitleEvidenceContext.submission_receipt` before `exportTitleEvidenceBundle()` is called. The bundle's `title_context_hash` covers the receipt, so substituting or mutating a receipt after export fails `verifyTitleEvidenceBundle()`.

**Demonstration only.** `DemonstrationTitleSubmissionTransport` is deterministic, never touches the network, and returns `production_validated: false`. The orchestrator refuses to hand it a packet unless the caller explicitly opts in — this is intentional, so a demonstration receipt cannot end up in a real evidence bundle by accident. Real Montana / Oregon / California / Texas / Florida ELT or DMV integration requires:

- per-state credential and signing-key onboarding;
- the state's required payload format (XML / JSON / EDI) and envelope signing;
- end-to-end test against the state's certification environment;
- counsel review of every jurisdiction rule preset referenced by the action;
- promotion of the transport to `production_validated: true` ONLY after the above.

The contract is stable; only the transport implementation changes per jurisdiction.

## Product positioning

> *Aristotle Verified Title Transaction Layer governs consequential title, lien, registration, and DMV document actions before they execute. Each transaction must carry valid authority, satisfy jurisdiction-specific rules, bind required fraud and title checks, and produce a warrant-backed evidence record. The result is faster digital vehicle transactions with stronger proof of authorization, compliance, and auditability.*

For executives:

> *Vitu-style platforms digitize vehicle title and registration workflows. Aristotle makes those workflows provably authorized.*
