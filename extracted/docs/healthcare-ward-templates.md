# Healthcare Ward Templates

Healthcare Wards bind institutional authority, patient context, clinical
privilege, privacy basis, and evidence requirements before clinical automation
can act.

## Starter Wards

### Clinical Operations Ward

Use for care-coordination, documentation, prior authorization, and routine EHR
writeback.

Required runtime registers:

- `patient_context_hash`
- `patient_context_present`
- `patient_identity_verified`
- `tpo_basis`
- `clinician_privilege_active`
- `clinical_context_age_ms`
- `chart_lock_clear`
- `audit_context_present`

### Pharmacy Ward

Use for prior authorization, medication-list update, dispense request, formulary
workflow, and medication reconciliation.

Required runtime registers:

- `allergy_checked`
- `allergy_conflict`
- `medication_interaction_clear`
- `medication_reconciliation_age_ms`
- `pharmacist_authority_present`

### Medical Device Ward

Use for device-setting changes, alarm acknowledgement, telemetry-gated
maintenance, and device-network operations.

Required runtime registers:

- `device_id`
- `device_safety_limits_active`
- `alarm_active`
- `device_telemetry_age_ms`
- `patient_context_hash`

### Research Access Ward

Use for cohort query, dataset export, de-identification assertion, and research
handoff.

Required runtime registers:

- `deidentification_valid`
- `privacy_officer_approval`
- `phi_record_count`
- `patient_context_hash` or cohort-context hash

## Hard Refuse Interlocks

These actions should never receive a Warrant:

- `medication.override_allergy`
- `pharmacy.force_dispense_controlled_substance`
- `device.disable_alarm`
- `device.disable_safety_limit`
- `ehr.delete_patient_record`
- `phi.export_without_consent`
- `claims.force_submit_without_attestation`
- `research.export_identified_dataset`
- `order.force_without_clinician_authority`
- `ehr.modify_record_without_patient_context`

## Template Location

```text
examples/healthcare/ward.hospital_clinical_ops.yaml
examples/healthcare/authority_envelope.clinical_ops_coordinator.yaml
examples/healthcare/policy/clinical_ops.apl
```
