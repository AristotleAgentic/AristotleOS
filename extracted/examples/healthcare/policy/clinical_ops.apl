ward "West Hospital Clinical Operations" {
  id ward-healthcare-clinical-ops
  domain healthcare-clinical-operations
  sovereignty "hospital-patient-care-and-privacy"
  version 0.1.0
  subject agent:clinical-ops-coordinator
  envelope ae-healthcare-clinical-ops-001
  issuer "aristotle-healthcare-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "HIPAA,CLINICAL_OPS"
  allow fhir.resource.write
  allow hl7.message.send
  allow ehr.note.append
  allow ehr.problem_list.update
  allow ehr.medication_list.update
  allow order.lab.request
  allow order.imaging.request
  allow pharmacy.prior_auth.submit
  allow pharmacy.dispense.request
  allow claims.submit
  allow claims.adjust
  allow phi.export
  allow patient.message.send
  allow device.setting.update
  allow research.dataset.export
  deny medication.override_allergy
  deny pharmacy.force_dispense_controlled_substance
  deny device.disable_alarm
  deny device.disable_safety_limit
  deny ehr.delete_patient_record
  deny phi.export_without_consent
  deny claims.force_submit_without_attestation
  deny research.export_identified_dataset
  deny order.force_without_clinician_authority
  deny ehr.modify_record_without_patient_context
  within west-health-system
  budget calls <= 1000 per 1h
  approve ehr.medication_list.update, pharmacy.dispense.request, phi.export, device.setting.update, research.dataset.export requires 2 within 15m
}
