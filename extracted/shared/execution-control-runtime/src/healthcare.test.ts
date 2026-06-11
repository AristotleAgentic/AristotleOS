import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type HealthcareRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  claimsToAction,
  ehrWritebackToAction,
  evaluateExecutionControl,
  evaluateHealthcareSafetyInvariants,
  exportHealthcareEvidenceBundle,
  fhirResourceToAction,
  healthcareAdapterToAction,
  healthcareSnapshotToRuntimeRegister,
  hl7MessageToAction,
  imagingToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  medicalDeviceCommandToAction,
  patientMessagingToAction,
  pharmacyWorkflowToAction,
  priorAuthorizationToAction,
  researchExportToAction,
  verifyHealthcareEvidenceBundle
} from "./index.js";

const now = "2026-05-25T16:00:00.000Z";

const snapshot: HealthcareRuntimeSnapshot = {
  healthcare_system_id: "west-health-system",
  facility_id: "west-hospital",
  department_id: "pharmacy",
  clinical_unit: "pharmacy",
  encounter_id: "enc-2026-0525-008",
  patient_context_hash: "patctx-0f2b8d7c9a1e",
  patient_context_present: true,
  patient_identity_verified: true,
  patient_consent_valid: true,
  tpo_basis: "prior-authorization",
  break_glass_attested: false,
  clinician_id: "clinician:nguyen",
  clinician_role: "pharmacist",
  clinician_privilege_active: true,
  pharmacist_id: "pharmacist:nguyen",
  pharmacist_authority_present: true,
  privacy_officer_id: "privacy:west",
  privacy_officer_approval: false,
  fhir_resource_type: "MedicationRequest",
  order_type: "medication",
  medication_class: "insulin",
  allergy_checked: true,
  allergy_conflict: false,
  medication_interaction_clear: true,
  medication_reconciliation_age_ms: 7200000,
  clinical_context_age_ms: 90000,
  chart_lock_clear: true,
  order_signing_authority: true,
  diagnosis_context_present: true,
  device_id: "infusion-pump-7",
  device_safety_limits_active: true,
  alarm_active: true,
  device_telemetry_age_ms: 1000,
  phi_purpose: "prior-authorization",
  phi_record_count: 8,
  deidentification_valid: false,
  claim_amount_usd: 440,
  claim_attestation_present: true,
  patient_message_risk_score: 0.12,
  human_review_present: true,
  audit_context_present: true,
  manual_fallback_ready: true,
  operator_id: "operator:clinical-supervisor",
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-healthcare-clinical-ops",
  name: "West Hospital Clinical Operations",
  sovereignty_context: "hospital-patient-care-and-privacy",
  authority_domain: "healthcare-clinical-operations",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:clinical-ops-coordinator"],
  physical_bounds: {
    permitted_healthcare_system_id: "west-health-system",
    permitted_healthcare_facility_id: "west-hospital",
    permitted_clinical_units: ["emergency-department", "icu", "pharmacy", "radiology", "care-coordination"],
    permitted_fhir_resource_types: ["Patient", "Encounter", "Observation", "Condition", "MedicationRequest", "MedicationStatement", "ServiceRequest", "DocumentReference", "Claim"],
    permitted_order_types: ["lab", "imaging", "medication", "referral"],
    permitted_medication_classes: ["non-controlled", "antibiotic", "antihypertensive", "insulin"],
    permitted_healthcare_device_ids: ["infusion-pump-7", "monitor-icu-2"],
    permitted_phi_purposes: ["treatment", "payment", "operations", "prior-authorization", "emergency", "research"],
    max_phi_record_count: 25,
    max_claim_amount_usd: 25000,
    max_patient_message_risk_score: 0.35,
    max_clinical_context_age_ms: 300000,
    max_medication_reconciliation_age_ms: 86400000,
    max_device_telemetry_age_ms: 60000,
    require_patient_context: true,
    require_patient_identity_verified: true,
    require_tpo_basis_or_consent: true,
    require_clinician_privilege_active: true,
    require_pharmacist_authority: true,
    require_allergy_checked: true,
    require_no_allergy_conflict: true,
    require_medication_interaction_clear: true,
    require_order_signing_authority: true,
    require_diagnosis_context: true,
    require_device_safety_limits: true,
    require_device_alarm_active: true,
    require_break_glass_attestation: true,
    require_chart_lock_clear: true,
    require_human_review_for_patient_message: true,
    require_claim_attestation: true,
    require_manual_fallback_ready: true,
    require_operator_identity: true,
    require_healthcare_audit_context: true
  },
  criticality: "safety_critical",
  classification: { level: "PHI", caveats: ["HIPAA", "CLINICAL_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-healthcare-clinical-ops-001",
  ward_id: ward.ward_id,
  subject: "agent:clinical-ops-coordinator",
  allowed_actions: [
    "fhir.resource.write",
    "hl7.message.send",
    "ehr.note.append",
    "ehr.problem_list.update",
    "ehr.medication_list.update",
    "order.lab.request",
    "order.imaging.request",
    "pharmacy.prior_auth.submit",
    "pharmacy.dispense.request",
    "claims.submit",
    "claims.adjust",
    "phi.export",
    "patient.message.send",
    "device.setting.update",
    "imaging.study.release",
    "research.dataset.export"
  ],
  denied_actions: [
    "medication.override_allergy",
    "pharmacy.force_dispense_controlled_substance",
    "device.disable_alarm",
    "device.disable_safety_limit",
    "ehr.delete_patient_record",
    "phi.export_without_consent",
    "claims.force_submit_without_attestation",
    "research.export_identified_dataset",
    "order.force_without_clinician_authority",
    "ehr.modify_record_without_patient_context"
  ],
  constraints: {
    required_runtime_registers: [
      "telemetry.patient_context_hash",
      "telemetry.patient_context_present",
      "telemetry.patient_identity_verified",
      "telemetry.tpo_basis",
      "telemetry.clinician_privilege_active",
      "telemetry.clinical_context_age_ms",
      "telemetry.chart_lock_clear",
      "telemetry.allergy_checked",
      "telemetry.medication_interaction_clear",
      "telemetry.order_signing_authority",
      "telemetry.diagnosis_context_present",
      "telemetry.audit_context_present",
      "telemetry.manual_fallback_ready",
      "telemetry.operator_id"
    ],
    dual_control: {
      actions: ["ehr.medication_list.update", "pharmacy.dispense.request", "phi.export", "device.setting.update", "research.dataset.export"],
      required: 2,
      ttl_ms: 900000
    }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-healthcare-root",
  classification: { level: "PHI", caveats: ["HIPAA", "CLINICAL_OPS"] }
};

const ctx = {
  action_id: "act-healthcare-001",
  ward_id: ward.ward_id,
  subject: "agent:clinical-ops-coordinator",
  requested_at: now,
  request_id: "req-healthcare-001",
  snapshot,
  classification: { level: "PHI", caveats: ["HIPAA", "CLINICAL_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-healthcare-")), "gel.jsonl");
}

test("healthcare adapter builders produce Canonical Governed Actions", () => {
  assert.equal(fhirResourceToAction({ resource_type: "Observation", operation: "update", resource_id: "obs-1" }, ctx).action_type, "fhir.resource.write");
  assert.equal(hl7MessageToAction({ message_type: "ORM", target_system: "lis", operation: "send" }, { ...ctx, action_id: "act-healthcare-002" }).action_type, "hl7.message.send");
  assert.equal(ehrWritebackToAction({ resource_type: "note", operation: "append" }, { ...ctx, action_id: "act-healthcare-003" }).action_type, "ehr.note.append");
  assert.equal(pharmacyWorkflowToAction({ medication_class: "insulin", operation: "prior-auth" }, { ...ctx, action_id: "act-healthcare-004" }).action_type, "pharmacy.prior_auth.submit");
  assert.equal(priorAuthorizationToAction({ payer_id: "payer:blue-west", medication_class: "insulin", operation: "submit" }, { ...ctx, action_id: "act-healthcare-005" }).action_type, "pharmacy.prior_auth.submit");
  assert.equal(claimsToAction({ claim_id: "claim-1", amount_usd: 440, operation: "submit" }, { ...ctx, action_id: "act-healthcare-006" }).action_type, "claims.submit");
  assert.equal(imagingToAction({ order_type: "ct", operation: "order" }, { ...ctx, action_id: "act-healthcare-007", snapshot: { ...snapshot, order_type: "imaging", fhir_resource_type: "ServiceRequest" } }).action_type, "order.imaging.request");
  assert.equal(medicalDeviceCommandToAction({ device_id: "infusion-pump-7", command: "update-setting" }, { ...ctx, action_id: "act-healthcare-008", snapshot: { ...snapshot, fhir_resource_type: "Device" } }).action_type, "device.setting.update");
  assert.equal(patientMessagingToAction({ channel: "portal", message_class: "care-coordination" }, { ...ctx, action_id: "act-healthcare-009" }).action_type, "patient.message.send");
  assert.equal(researchExportToAction({ study_id: "study-1", dataset_id: "dataset-1", cohort_size: 42, deidentified: true }, { ...ctx, action_id: "act-healthcare-010", snapshot: { ...snapshot, tpo_basis: "research", phi_purpose: "research", deidentification_valid: true, privacy_officer_approval: true } }).action_type, "research.dataset.export");
  assert.equal(healthcareAdapterToAction({ kind: "claims", request: { claim_id: "claim-2", amount_usd: 120, operation: "adjust" } }, { ...ctx, action_id: "act-healthcare-011" }).action_type, "claims.adjust");
});

test("sample healthcare Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "healthcare");
  const sampleWard = loadWardManifest(path.join(base, "ward.hospital_clinical_ops.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.clinical_ops_coordinator.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "allow_prior_auth.json"));
  const refused = loadCanonicalAction(path.join(base, "actions", "refuse_allergy_override.json"));
  const missing = loadCanonicalAction(path.join(base, "actions", "escalate_missing_patient_context.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const blocked = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: refused, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blocked.decision, "REFUSE");
  assert.equal(blocked.warrant, undefined);

  const escalated = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: missing, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(escalated.decision, "ESCALATE");
  assert.ok(escalated.reason_codes.includes("RUNTIME_STATE_MISSING"));
});

test("healthcare hard interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "device.disable_alarm"], denied_actions: [] };
  const action = medicalDeviceCommandToAction(
    { device_id: "infusion-pump-7", command: "ack-alarm", action_type: "device.disable_alarm" },
    { ...ctx, action_id: "act-healthcare-hard-device-001", snapshot: { ...snapshot, fhir_resource_type: "Device", alarm_active: false } }
  );
  const directPig = evaluateHealthcareSafetyInvariants(action, ward);
  assert.equal(directPig.ok, false);
  assert.ok(directPig.detail.includes("hard healthcare"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control healthcare medication update fails closed without an approval store", () => {
  const action = pharmacyWorkflowToAction({ medication_class: "insulin", operation: "med-list-update" }, { ...ctx, action_id: "act-healthcare-med-dual-001" });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control healthcare medication update issues a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = pharmacyWorkflowToAction({ medication_class: "insulin", operation: "med-list-update" }, { ...ctx, action_id: "act-healthcare-med-dual-002" });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "clinician:attending-west", "approve", "medication reconciliation and patient context verified", now);
  approvalStore.vote(pending.request_id, "pharmacist:nguyen", "approve", "allergy and interaction checks clear", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("healthcare evidence bundle wraps execution evidence without raw PHI", () => {
  const action = priorAuthorizationToAction({ payer_id: "payer:blue-west", medication_class: "insulin", operation: "submit" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: healthcareSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportHealthcareEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    healthcare: {
      healthcare_system_id: "west-health-system",
      facility_id: "west-hospital",
      clinical_domain: "pharmacy-operations",
      clinical_unit: "pharmacy",
      encounter_id: "enc-2026-0525-008",
      patient_context_hash: "patctx-0f2b8d7c9a1e",
      action_family: "prior-authorization",
      actor_subject: "agent:clinical-ops-coordinator",
      clinician_id: "clinician:nguyen",
      pharmacist_id: "pharmacist:nguyen",
      consent_basis: "prior-authorization",
      phi_profile: { purpose: "prior-authorization", record_count: 8, deidentified: false },
      regulatory_profile: ["HIPAA", "HITECH", "FHIR_R4", "HL7_V2", "SOC2", "NIST_HIPAA", "LOCAL_CLINICAL_POLICY"],
      pre_checks: [{ name: "patient context, consent basis, and pharmacist authority verified", ok: true }],
      post_checks: [{ name: "payer submission receipt attached by reference", ok: true }],
      redacted_fields: ["patient_name", "mrn", "date_of_birth", "free_text_clinical_note"],
      retained_fields: ["patient_context_hash", "canonical_action_hash", "warrant_id"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.healthcare-evidence.v1");
  assert.equal(bundle.healthcare.patient_context_hash, "patctx-0f2b8d7c9a1e");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyHealthcareEvidenceBundle(bundle).ok, true);
});
