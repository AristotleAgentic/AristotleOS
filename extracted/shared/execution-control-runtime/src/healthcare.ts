import {
  type CanonicalActionInput,
  type EvidenceBundle,
  type ExportEvidenceBundleInput,
  type JsonValue,
  type PhysicalInvariantResult,
  type RuntimeRegister,
  type WardManifest,
  evaluatePhysicalInvariants,
  exportEvidenceBundle,
  sha256,
  stableStringify,
  verifyEvidenceBundle
} from "./index.js";

/**
 * Healthcare clinical-operations readiness primitives.
 *
 * These adapters do not diagnose, prescribe, or replace EHR, pharmacy, claims,
 * PACS/RIS, device-management, privacy, or research systems. They translate
 * proposed healthcare operations into Canonical Governed Actions so AristotleOS
 * can bind authority before patient-record, order, medication, PHI, claim,
 * device, message, or dataset consequence.
 */

export type HealthcareDomain =
  | "emergency-department"
  | "icu-critical-care"
  | "pharmacy-operations"
  | "clinical-documentation"
  | "care-coordination"
  | "radiology-imaging"
  | "revenue-cycle"
  | "medical-device-network"
  | "population-health"
  | "research-data-access";

export type HealthcareAdapterKind =
  | "fhir-resource"
  | "hl7-message"
  | "ehr-writeback"
  | "pharmacy-workflow"
  | "prior-authorization"
  | "claims"
  | "imaging-ris-pacs"
  | "medical-device-command"
  | "patient-messaging"
  | "research-export";

export interface HealthcareAdapterDescriptor {
  kind: HealthcareAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
}

export const HEALTHCARE_ADAPTER_CATALOG: HealthcareAdapterDescriptor[] = [
  {
    kind: "fhir-resource",
    label: "FHIR Resource Boundary",
    consequenceBoundary: "FHIR resource create/update/export before an EHR or integration engine receives a mutation",
    actionExamples: ["fhir.resource.write", "phi.export"],
    requiredRuntimeRegisters: ["telemetry.patient_context_hash", "telemetry.fhir_resource_type", "telemetry.tpo_basis", "telemetry.audit_context_present"]
  },
  {
    kind: "hl7-message",
    label: "HL7 v2 Message Boundary",
    consequenceBoundary: "ADT, ORM, ORU, SIU, and billing-interface messages before downstream clinical workflow consequence",
    actionExamples: ["hl7.message.send"],
    requiredRuntimeRegisters: ["telemetry.patient_context_hash", "telemetry.message_type", "telemetry.patient_identity_verified"]
  },
  {
    kind: "ehr-writeback",
    label: "EHR Writeback Boundary",
    consequenceBoundary: "Notes, problem list, medication list, demographics, and care-plan changes before chart mutation",
    actionExamples: ["ehr.note.append", "ehr.problem_list.update", "ehr.medication_list.update"],
    requiredRuntimeRegisters: ["telemetry.patient_context_hash", "telemetry.clinician_privilege_active", "telemetry.chart_lock_clear"]
  },
  {
    kind: "pharmacy-workflow",
    label: "Pharmacy Workflow Boundary",
    consequenceBoundary: "Medication-list update, dispense request, controlled-substance workflow, and formulary action",
    actionExamples: ["pharmacy.prior_auth.submit", "pharmacy.dispense.request"],
    requiredRuntimeRegisters: ["telemetry.allergy_checked", "telemetry.medication_interaction_clear", "telemetry.pharmacist_authority_present"]
  },
  {
    kind: "prior-authorization",
    label: "Prior Authorization Boundary",
    consequenceBoundary: "Payer submission, attachment export, and status update before payer or pharmacy network consequence",
    actionExamples: ["pharmacy.prior_auth.submit"],
    requiredRuntimeRegisters: ["telemetry.tpo_basis", "telemetry.patient_consent_valid", "telemetry.audit_context_present"]
  },
  {
    kind: "claims",
    label: "Claims Boundary",
    consequenceBoundary: "Claim create, adjustment, attestation, and submission before financial consequence",
    actionExamples: ["claims.submit", "claims.adjust"],
    requiredRuntimeRegisters: ["telemetry.claim_attestation_present", "telemetry.claim_amount_usd", "telemetry.tpo_basis"]
  },
  {
    kind: "imaging-ris-pacs",
    label: "RIS / PACS Imaging Boundary",
    consequenceBoundary: "Imaging order, accession update, image release, and radiology workflow mutation",
    actionExamples: ["order.imaging.request", "imaging.study.release"],
    requiredRuntimeRegisters: ["telemetry.order_signing_authority", "telemetry.fhir_resource_type", "telemetry.clinical_context_age_ms"]
  },
  {
    kind: "medical-device-command",
    label: "Medical Device Command Boundary",
    consequenceBoundary: "Device setting update, alarm posture, network segmentation, and safety-limit command",
    actionExamples: ["device.setting.update"],
    requiredRuntimeRegisters: ["telemetry.device_id", "telemetry.device_safety_limits_active", "telemetry.alarm_active", "telemetry.device_telemetry_age_ms"]
  },
  {
    kind: "patient-messaging",
    label: "Patient Messaging Boundary",
    consequenceBoundary: "Patient portal, SMS, discharge, and care-coordination messages before patient-facing consequence",
    actionExamples: ["patient.message.send"],
    requiredRuntimeRegisters: ["telemetry.patient_identity_verified", "telemetry.human_review_present", "telemetry.patient_message_risk_score"]
  },
  {
    kind: "research-export",
    label: "Research Export Boundary",
    consequenceBoundary: "Dataset export, de-identification assertion, cohort query, and research handoff",
    actionExamples: ["research.dataset.export"],
    requiredRuntimeRegisters: ["telemetry.deidentification_valid", "telemetry.privacy_officer_approval", "telemetry.phi_record_count"]
  }
];

export interface HealthcareRuntimeSnapshot {
  healthcare_system_id: string;
  facility_id: string;
  department_id: string;
  clinical_unit: string;
  encounter_id: string;
  patient_context_hash: string;
  patient_context_present: boolean;
  patient_identity_verified: boolean;
  patient_consent_valid: boolean;
  tpo_basis: "treatment" | "payment" | "operations" | "prior-authorization" | "emergency" | "research" | string;
  break_glass_attested: boolean;
  clinician_id: string;
  clinician_role: string;
  clinician_privilege_active: boolean;
  supervising_clinician_id?: string;
  pharmacist_id?: string;
  pharmacist_authority_present: boolean;
  privacy_officer_id?: string;
  privacy_officer_approval: boolean;
  fhir_resource_type: string;
  order_type?: string;
  medication_class?: string;
  controlled_substance_schedule?: string;
  allergy_checked: boolean;
  allergy_conflict: boolean;
  medication_interaction_clear: boolean;
  medication_reconciliation_age_ms: number;
  clinical_context_age_ms: number;
  chart_lock_clear: boolean;
  order_signing_authority: boolean;
  diagnosis_context_present: boolean;
  device_id?: string;
  device_safety_limits_active: boolean;
  alarm_active: boolean;
  device_telemetry_age_ms?: number;
  phi_purpose: string;
  phi_record_count: number;
  deidentification_valid: boolean;
  claim_amount_usd?: number;
  claim_attestation_present: boolean;
  patient_message_risk_score: number;
  human_review_present: boolean;
  audit_context_present: boolean;
  manual_fallback_ready: boolean;
  operator_id?: string;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface HealthcareActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: HealthcareRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface FhirResourceRequest {
  resource_type: string;
  operation: "create" | "update" | "patch" | "export" | string;
  resource_id?: string;
  action_type?: string;
}

export interface Hl7MessageRequest {
  message_type: "ADT" | "ORM" | "ORU" | "SIU" | "DFT" | string;
  target_system: string;
  operation: "send" | "hold" | "route" | string;
  action_type?: string;
}

export interface EhrWritebackRequest {
  resource_type: "note" | "problem-list" | "medication-list" | "demographics" | "care-plan" | string;
  operation: "append" | "update" | "correct" | string;
  field?: string;
  action_type?: string;
}

export interface PharmacyWorkflowRequest {
  medication_class: string;
  operation: "prior-auth" | "dispense-request" | "med-list-update" | "formulary-check" | string;
  controlled_substance_schedule?: string;
  action_type?: string;
}

export interface PriorAuthorizationRequest {
  payer_id: string;
  medication_class: string;
  operation: "submit" | "attach" | "status-update" | string;
  action_type?: string;
}

export interface ClaimsRequest {
  claim_id: string;
  amount_usd: number;
  operation: "submit" | "adjust" | "void" | string;
  action_type?: string;
}

export interface ImagingRequest {
  accession_id?: string;
  order_type: "xray" | "ct" | "mri" | "ultrasound" | "nuclear" | string;
  operation: "order" | "release-study" | "update-accession" | string;
  action_type?: string;
}

export interface MedicalDeviceCommandRequest {
  device_id: string;
  command: "update-setting" | "ack-alarm" | "set-limit" | "maintenance-mode" | string;
  setting_name?: string;
  action_type?: string;
}

export interface PatientMessagingRequest {
  channel: "portal" | "sms" | "email" | "phone" | string;
  message_class: "care-coordination" | "discharge" | "billing" | "results" | string;
  action_type?: string;
}

export interface ResearchExportRequest {
  study_id: string;
  dataset_id: string;
  cohort_size: number;
  deidentified: boolean;
  action_type?: string;
}

export type HealthcareAdapterRequest =
  | { kind: "fhir-resource"; request: FhirResourceRequest }
  | { kind: "hl7-message"; request: Hl7MessageRequest }
  | { kind: "ehr-writeback"; request: EhrWritebackRequest }
  | { kind: "pharmacy-workflow"; request: PharmacyWorkflowRequest }
  | { kind: "prior-authorization"; request: PriorAuthorizationRequest }
  | { kind: "claims"; request: ClaimsRequest }
  | { kind: "imaging-ris-pacs"; request: ImagingRequest }
  | { kind: "medical-device-command"; request: MedicalDeviceCommandRequest }
  | { kind: "patient-messaging"; request: PatientMessagingRequest }
  | { kind: "research-export"; request: ResearchExportRequest };

export interface HealthcareEvidenceContext {
  healthcare_system_id: string;
  facility_id: string;
  clinical_domain: HealthcareDomain;
  clinical_unit: string;
  encounter_id: string;
  patient_context_hash: string;
  action_family: string;
  actor_subject: string;
  clinician_id?: string;
  pharmacist_id?: string;
  privacy_officer_id?: string;
  approver_ids?: string[];
  consent_basis: string;
  phi_profile: {
    purpose: string;
    record_count: number;
    deidentified: boolean;
  };
  regulatory_profile: Array<"HIPAA" | "HITECH" | "FHIR_R4" | "HL7_V2" | "SOC2" | "NIST_HIPAA" | "LOCAL_CLINICAL_POLICY">;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface HealthcareEvidenceBundle {
  bundle_version: "aristotle.healthcare-evidence.v1";
  exported_at: string;
  healthcare: HealthcareEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    healthcare_context_hash: string;
    execution_bundle_hash: string;
    healthcare_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function snapshotParams(snapshot: HealthcareRuntimeSnapshot): Record<string, JsonValue> {
  return {
    healthcare_system_id: snapshot.healthcare_system_id,
    facility_id: snapshot.facility_id,
    department_id: snapshot.department_id,
    clinical_unit: snapshot.clinical_unit,
    encounter_id: snapshot.encounter_id,
    patient_context_hash: snapshot.patient_context_hash,
    patient_context_present: snapshot.patient_context_present,
    patient_identity_verified: snapshot.patient_identity_verified,
    patient_consent_valid: snapshot.patient_consent_valid,
    tpo_basis: snapshot.tpo_basis,
    break_glass_attested: snapshot.break_glass_attested,
    clinician_id: snapshot.clinician_id,
    clinician_role: snapshot.clinician_role,
    clinician_privilege_active: snapshot.clinician_privilege_active,
    ...(snapshot.supervising_clinician_id ? { supervising_clinician_id: snapshot.supervising_clinician_id } : {}),
    ...(snapshot.pharmacist_id ? { pharmacist_id: snapshot.pharmacist_id } : {}),
    pharmacist_authority_present: snapshot.pharmacist_authority_present,
    ...(snapshot.privacy_officer_id ? { privacy_officer_id: snapshot.privacy_officer_id } : {}),
    privacy_officer_approval: snapshot.privacy_officer_approval,
    fhir_resource_type: snapshot.fhir_resource_type,
    ...(snapshot.order_type ? { order_type: snapshot.order_type } : {}),
    ...(snapshot.medication_class ? { medication_class: snapshot.medication_class } : {}),
    ...(snapshot.controlled_substance_schedule ? { controlled_substance_schedule: snapshot.controlled_substance_schedule } : {}),
    allergy_checked: snapshot.allergy_checked,
    allergy_conflict: snapshot.allergy_conflict,
    medication_interaction_clear: snapshot.medication_interaction_clear,
    medication_reconciliation_age_ms: snapshot.medication_reconciliation_age_ms,
    clinical_context_age_ms: snapshot.clinical_context_age_ms,
    chart_lock_clear: snapshot.chart_lock_clear,
    order_signing_authority: snapshot.order_signing_authority,
    diagnosis_context_present: snapshot.diagnosis_context_present,
    ...(snapshot.device_id ? { device_id: snapshot.device_id } : {}),
    device_safety_limits_active: snapshot.device_safety_limits_active,
    alarm_active: snapshot.alarm_active,
    ...(snapshot.device_telemetry_age_ms !== undefined ? { device_telemetry_age_ms: snapshot.device_telemetry_age_ms } : {}),
    phi_purpose: snapshot.phi_purpose,
    phi_record_count: snapshot.phi_record_count,
    deidentification_valid: snapshot.deidentification_valid,
    ...(snapshot.claim_amount_usd !== undefined ? { claim_amount_usd: snapshot.claim_amount_usd } : {}),
    claim_attestation_present: snapshot.claim_attestation_present,
    patient_message_risk_score: snapshot.patient_message_risk_score,
    human_review_present: snapshot.human_review_present,
    audit_context_present: snapshot.audit_context_present,
    manual_fallback_ready: snapshot.manual_fallback_ready,
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {})
  };
}

function healthcareAction(
  ctx: HealthcareActionContext,
  action_type: string,
  target: string,
  params: Record<string, JsonValue>
): CanonicalActionInput {
  const base = snapshotParams(ctx.snapshot);
  return {
    action_id: ctx.action_id,
    ward_id: ctx.ward_id,
    subject: ctx.subject,
    action_type,
    target,
    params: { ...base, ...params },
    requested_at: ctx.requested_at,
    ...(ctx.request_id ? { request_id: ctx.request_id } : {}),
    telemetry: {
      ...base,
      ...(ctx.snapshot.metadata ?? {}),
      ...(ctx.telemetry ?? {})
    },
    ...(ctx.classification ? { classification: ctx.classification } : {})
  };
}

export function fhirResourceToAction(input: FhirResourceRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "export" ? "phi.export" : "fhir.resource.write");
  return healthcareAction(ctx, actionType, `${input.resource_type}:${input.resource_id ?? input.operation}`, {
    adapter: "fhir-resource",
    fhir_resource_type: input.resource_type,
    resource_operation: input.operation,
    ...(input.resource_id ? { resource_id: input.resource_id } : {})
  });
}

export function hl7MessageToAction(input: Hl7MessageRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  return healthcareAction(ctx, input.action_type ?? "hl7.message.send", `${input.message_type}:${input.target_system}:${input.operation}`, {
    adapter: "hl7-message",
    message_type: input.message_type,
    target_system: input.target_system,
    operation: input.operation
  });
}

export function ehrWritebackToAction(input: EhrWritebackRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  const actionType = input.action_type
    ?? (input.resource_type === "medication-list" ? "ehr.medication_list.update"
      : input.resource_type === "problem-list" ? "ehr.problem_list.update"
        : input.resource_type === "note" ? "ehr.note.append"
          : "fhir.resource.write");
  return healthcareAction(ctx, actionType, `${ctx.snapshot.encounter_id}:${input.resource_type}:${input.operation}`, {
    adapter: "ehr-writeback",
    fhir_resource_type: input.resource_type,
    resource_operation: input.operation,
    ...(input.field ? { field: input.field } : {})
  });
}

export function pharmacyWorkflowToAction(input: PharmacyWorkflowRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  const actionType = input.action_type
    ?? (input.operation === "prior-auth" ? "pharmacy.prior_auth.submit"
      : input.operation === "med-list-update" ? "ehr.medication_list.update"
        : "pharmacy.dispense.request");
  return healthcareAction(ctx, actionType, `${ctx.snapshot.patient_context_hash}:${input.medication_class}:${input.operation}`, {
    adapter: "pharmacy-workflow",
    medication_class: input.medication_class,
    operation: input.operation,
    ...(input.controlled_substance_schedule ? { controlled_substance_schedule: input.controlled_substance_schedule } : {})
  });
}

export function priorAuthorizationToAction(input: PriorAuthorizationRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  return healthcareAction(ctx, input.action_type ?? "pharmacy.prior_auth.submit", `${input.payer_id}:${input.medication_class}:${input.operation}`, {
    adapter: "prior-authorization",
    payer_id: input.payer_id,
    medication_class: input.medication_class,
    operation: input.operation
  });
}

export function claimsToAction(input: ClaimsRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "adjust" ? "claims.adjust" : "claims.submit");
  return healthcareAction(ctx, actionType, `${input.claim_id}:${input.operation}`, {
    adapter: "claims",
    claim_id: input.claim_id,
    claim_amount_usd: input.amount_usd,
    operation: input.operation
  });
}

export function imagingToAction(input: ImagingRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "release-study" ? "imaging.study.release" : "order.imaging.request");
  return healthcareAction(ctx, actionType, `${input.accession_id ?? ctx.snapshot.encounter_id}:${input.order_type}:${input.operation}`, {
    adapter: "imaging-ris-pacs",
    order_type: input.order_type,
    operation: input.operation,
    ...(input.accession_id ? { accession_id: input.accession_id } : {})
  });
}

export function medicalDeviceCommandToAction(input: MedicalDeviceCommandRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  return healthcareAction(ctx, input.action_type ?? "device.setting.update", `${input.device_id}:${input.command}:${input.setting_name ?? "state"}`, {
    adapter: "medical-device-command",
    device_id: input.device_id,
    command: input.command,
    ...(input.setting_name ? { setting_name: input.setting_name } : {})
  });
}

export function patientMessagingToAction(input: PatientMessagingRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  return healthcareAction(ctx, input.action_type ?? "patient.message.send", `${input.channel}:${input.message_class}:${ctx.snapshot.patient_context_hash}`, {
    adapter: "patient-messaging",
    channel: input.channel,
    message_class: input.message_class
  });
}

export function researchExportToAction(input: ResearchExportRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  return healthcareAction(ctx, input.action_type ?? "research.dataset.export", `${input.study_id}:${input.dataset_id}`, {
    adapter: "research-export",
    study_id: input.study_id,
    dataset_id: input.dataset_id,
    cohort_size: input.cohort_size,
    deidentified: input.deidentified
  });
}

export function healthcareAdapterToAction(input: HealthcareAdapterRequest, ctx: HealthcareActionContext): CanonicalActionInput {
  if (input.kind === "fhir-resource") return fhirResourceToAction(input.request, ctx);
  if (input.kind === "hl7-message") return hl7MessageToAction(input.request, ctx);
  if (input.kind === "ehr-writeback") return ehrWritebackToAction(input.request, ctx);
  if (input.kind === "pharmacy-workflow") return pharmacyWorkflowToAction(input.request, ctx);
  if (input.kind === "prior-authorization") return priorAuthorizationToAction(input.request, ctx);
  if (input.kind === "claims") return claimsToAction(input.request, ctx);
  if (input.kind === "imaging-ris-pacs") return imagingToAction(input.request, ctx);
  if (input.kind === "medical-device-command") return medicalDeviceCommandToAction(input.request, ctx);
  if (input.kind === "patient-messaging") return patientMessagingToAction(input.request, ctx);
  return researchExportToAction(input.request, ctx);
}

export function healthcareSnapshotToRuntimeRegister(snapshot: HealthcareRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateHealthcareSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
  return evaluatePhysicalInvariants(action, ward.physical_bounds);
}

function evidenceBundleMaterialHash(bundle: EvidenceBundle): string {
  return sha256(stableStringify({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    hashes: bundle.hashes,
    selected_record: bundle.selected_record
  }));
}

function healthcareBundleHash(input: Omit<HealthcareEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<HealthcareEvidenceBundle["hashes"], "healthcare_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportHealthcareEvidenceBundle(input: ExportEvidenceBundleInput & { healthcare: HealthcareEvidenceContext }): HealthcareEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.healthcare-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    healthcare: JSON.parse(stableStringify(input.healthcare)) as HealthcareEvidenceContext,
    execution_bundle
  };
  const hashes = {
    healthcare_context_hash: sha256(stableStringify(partial.healthcare)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    healthcare_bundle_hash: ""
  };
  hashes.healthcare_bundle_hash = healthcareBundleHash({
    ...partial,
    hashes: {
      healthcare_context_hash: hashes.healthcare_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: HealthcareEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyHealthcareEvidenceBundle(draft) };
}

export function verifyHealthcareEvidenceBundle(bundle: HealthcareEvidenceBundle): HealthcareEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.healthcare-evidence.v1") failures.push("unsupported healthcare evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.healthcare));
  if (contextHash !== bundle.hashes.healthcare_context_hash) failures.push("healthcare context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = healthcareBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    healthcare: bundle.healthcare,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      healthcare_context_hash: bundle.hashes.healthcare_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.healthcare_bundle_hash) failures.push("healthcare bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
