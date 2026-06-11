ward "Montana Lender Title Operations (DEMO)" {
  id ward-title-mt-lender-ops
  domain title-transaction-ops
  sovereignty "state-mt-mvd-authority"
  version 0.1.0
  subject agent:title-orchestrator
  envelope ae-title-operations-001
  issuer "aristotle-title-ops-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "TITLE_OPS"

  allow lien.release.submit, lien.perfection.submit, registration.renewal.submit, digital_signature.execute, nmvtis.check.run, fraud.check.run, historian.record.write when telemetry.transaction_id, telemetry.transaction_type, telemetry.jurisdiction, telemetry.signer_authorized, telemetry.nmvtis_passed, telemetry.theft_flag_clear, telemetry.odometer_disclosed, telemetry.identity_verified, telemetry.authority_envelope_unrevoked, telemetry.warrant_unused, telemetry.required_forms_present, telemetry.state_supports_elt, telemetry.operator_qualified
  allow title.transfer.submit, title.correction.submit, registration.interstate.submit, dmv.submit when telemetry.transaction_id, telemetry.transaction_type, telemetry.jurisdiction, telemetry.signer_authorized, telemetry.nmvtis_passed, telemetry.theft_flag_clear, telemetry.odometer_disclosed, telemetry.identity_verified, telemetry.authority_envelope_unrevoked, telemetry.warrant_unused, telemetry.required_forms_present, telemetry.operator_qualified
  deny title.override_lien_release, title.bypass_nmvtis, title.bypass_theft_check, title.bypass_state_rules, title.override_dealer_license, title.override_odometer_disclosure, title.disable_identity_verification, signature.bypass_jurisdiction_acceptance, warrant.reuse_attempt

  within MT
  budget calls <= 5000 per 1h
  approve title.transfer.submit, title.correction.submit, registration.interstate.submit, dmv.submit requires 2 within 10m
}
