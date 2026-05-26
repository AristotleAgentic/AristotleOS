# Title Ward templates (DEMONSTRATION)

> **Sample / demonstration only.** None of the rules below are legally validated. Validate with counsel before any production use.

Each template is a `physical_bounds` profile for a class of title operation. Copy `examples/title/ward.mt_lender_ops.yaml` and adjust.

## Lender ELT operations (default example — Montana)

Lender-side perfection, satisfaction, and release of liens via state ELT endpoints. Lien-existence and authority requirements are load-bearing.

```yaml
physical_bounds:
  permitted_jurisdictions: [MT]
  permitted_transaction_types: [lien-perfection, lien-release]
  permitted_organization_kinds: [lender]
  max_fraud_risk_score: 0.7
  min_identity_confidence_score: 0.8
  max_warrant_age_ms: 600000
  require_signer_authorized: true
  require_lender_active: true
  require_lender_elt_participant: true
  require_lien_exists: true
  require_lien_release_authority_active: true
  require_nmvtis_passed: true
  require_theft_flag_clear: true
  require_authority_envelope_unrevoked: true
  require_warrant_unused: true
  require_state_supports_elt: true
  require_operator_qualified: true
```

## Dealer title-transfer operations

Dealer-initiated transfers. Add dealer-license and odometer requirements; dual-control transfers and dmv-submissions.

```yaml
physical_bounds:
  permitted_organization_kinds: [dealer]
  permitted_transaction_types: [title-transfer, registration-renewal, registration-interstate, dmv-submission]
  require_dealer_license_active: true
  require_odometer_disclosed: true
  require_identity_verified: true
  require_required_forms_present: true
```

## Interstate title and registration

Cross-state submissions. Require VIN inspection and identity verification; the transfer/registration action is dual-controlled.

```yaml
physical_bounds:
  permitted_transaction_types: [title-transfer, registration-interstate]
  require_vin_inspection_present: true
  require_required_forms_present: true
  require_identity_verified: true
  require_nmvtis_passed: true
```

## Digital signature authority

Document signing under ESIGN/UETA where the state accepts digital execution.

```yaml
physical_bounds:
  permitted_transaction_types: [digital-signature-execute]
  require_state_supports_digital_signature: true
  require_digital_signature_accepted: true
  require_signer_authorized: true
  require_authority_envelope_unrevoked: true
  require_identity_verified: true
```

## Fraud-screened transaction

Highest fraud sensitivity: stricter identity and fraud thresholds.

```yaml
physical_bounds:
  max_fraud_risk_score: 0.4
  min_identity_confidence_score: 0.95
  require_nmvtis_passed: true
  require_theft_flag_clear: true
  require_identity_verified: true
```

## Sample Authority Envelopes

See `examples/title/authority_envelope.title_orchestrator.yaml`. Put `title.transfer.submit`, `title.correction.submit`, `registration.interstate.submit`, and `dmv.submit` under `dual_control`. Always list the safety-bypass action types under `denied_actions` (they are also hard interlocks at the gate, so this is defense in depth).
