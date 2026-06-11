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
 * Aristotle Verified Title Transaction Layer.
 *
 * Governs consequential vehicle title, lien, registration, and DMV-document actions
 * BEFORE they cross into legal effect. Every title-changing, lien-changing, registration-
 * submitting, or document-signing action is admitted only with valid authority, satisfied
 * jurisdiction rules, bound fraud/identity/NMVTIS/theft checks, and a single-use warrant —
 * producing a hash-chained, signed Governance Evidence Ledger record per decision.
 *
 * This is not a generic AI governance demo. It is the transaction authority and evidence
 * layer that sits ALONGSIDE platforms like Vitu, CVR, Dealertrack, and DDI Technology:
 * those platforms move bits to government endpoints; Aristotle proves the action was
 * authorized, state-rule compliant, fraud-checked, and audit-ready before it executed.
 *
 * Designed to be aligned with (sample / demonstration only — NOT legal advice):
 *   - State Electronic Lien & Title (ELT) participation rules.
 *   - State digital-signature acceptance regimes for DMV documents.
 *   - Federal odometer disclosure (49 CFR Part 580).
 *   - NMVTIS state-of-title and brand reporting.
 *   - DLDV / driver license validation programs.
 *   - State dealer licensing and lender authorization frameworks.
 * All jurisdiction rules shipped in this module are SAMPLE DEMONSTRATION rule sets and
 * must be legally validated before any production use.
 */

export type TitleTransactionType =
  | "new-title"
  | "title-transfer"
  | "duplicate-title"
  | "title-correction"
  | "title-brand-set"
  | "registration-renewal"
  | "registration-interstate"
  | "lien-perfection"
  | "lien-release"
  | "digital-signature-execute"
  | "dmv-submission";

export type TitleAdapterKind =
  | "elt-lien"
  | "title-transaction"
  | "registration"
  | "digital-signature"
  | "dealer-workflow"
  | "lender-workflow"
  | "dmv-submission"
  | "fraud-check"
  | "nmvtis"
  | "historian-write";

export interface TitleAdapterDescriptor {
  kind: TitleAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
  /** Regulatory clauses this boundary is built to satisfy (sample / demonstration). */
  regulatoryBasis: string[];
}

export const TITLE_ADAPTER_CATALOG: TitleAdapterDescriptor[] = [
  {
    kind: "elt-lien",
    label: "Electronic Lien & Title (ELT) Boundary",
    consequenceBoundary: "Lien perfection and lien release at the state ELT endpoint",
    actionExamples: ["lien.perfection.submit", "lien.release.submit"],
    requiredRuntimeRegisters: [
      "telemetry.lender_id",
      "telemetry.signer_authorized",
      "telemetry.lien_exists",
      "telemetry.state_supports_elt"
    ],
    regulatoryBasis: ["State ELT program rules", "UCC Article 9"]
  },
  {
    kind: "title-transaction",
    label: "Title Transaction Boundary",
    consequenceBoundary: "New title, transfer, duplicate, correction, and brand changes",
    actionExamples: ["title.new_title.submit", "title.transfer.submit", "title.duplicate.submit", "title.correction.submit"],
    requiredRuntimeRegisters: [
      "telemetry.vin",
      "telemetry.title_state",
      "telemetry.nmvtis_passed",
      "telemetry.theft_flag_clear",
      "telemetry.odometer_disclosed"
    ],
    regulatoryBasis: ["State title statutes", "49 CFR Part 580 (odometer)", "NMVTIS reporting"]
  },
  {
    kind: "registration",
    label: "Registration Boundary",
    consequenceBoundary: "Vehicle registration renewal and interstate registration submission",
    actionExamples: ["registration.renewal.submit", "registration.interstate.submit"],
    requiredRuntimeRegisters: [
      "telemetry.vin",
      "telemetry.title_state",
      "telemetry.buyer_state",
      "telemetry.required_forms_present"
    ],
    regulatoryBasis: ["State motor-vehicle code"]
  },
  {
    kind: "digital-signature",
    label: "Digital Signature Authority Boundary",
    consequenceBoundary: "Cryptographic signature execution on DMV documents and powers of attorney",
    actionExamples: ["digital_signature.execute"],
    requiredRuntimeRegisters: [
      "telemetry.signer_authorized",
      "telemetry.identity_verified",
      "telemetry.state_supports_digital_signature",
      "telemetry.authority_envelope_unrevoked"
    ],
    regulatoryBasis: ["ESIGN Act", "UETA", "State digital-signature acceptance regimes"]
  },
  {
    kind: "dealer-workflow",
    label: "Dealer Workflow Boundary",
    consequenceBoundary: "Dealer-initiated title transfer, registration, and trade-in payoff actions",
    actionExamples: ["dealer.transfer.submit", "dealer.trade_in.submit"],
    requiredRuntimeRegisters: [
      "telemetry.dealer_id",
      "telemetry.dealer_license_active",
      "telemetry.dealer_state"
    ],
    regulatoryBasis: ["State dealer-licensing statutes"]
  },
  {
    kind: "lender-workflow",
    label: "Lender Workflow Boundary",
    consequenceBoundary: "Lender-initiated lien perfection, satisfaction, and release",
    actionExamples: ["lender.lien.perfection", "lender.lien.satisfaction", "lien.release.submit"],
    requiredRuntimeRegisters: [
      "telemetry.lender_id",
      "telemetry.lender_active",
      "telemetry.signer_authorized"
    ],
    regulatoryBasis: ["UCC Article 9", "State ELT participation"]
  },
  {
    kind: "dmv-submission",
    label: "DMV / State Agency Submission Boundary",
    consequenceBoundary: "Submission of completed packets and forms to state agency endpoints",
    actionExamples: ["dmv.submit"],
    requiredRuntimeRegisters: ["telemetry.jurisdiction", "telemetry.state_rule_version"],
    regulatoryBasis: ["State agency endpoint contracts"]
  },
  {
    kind: "fraud-check",
    label: "Fraud / Identity Check Boundary",
    consequenceBoundary: "DLDV identity validation, sanctions screening, suspicious-pattern checks",
    actionExamples: ["fraud.check.run", "identity.verify"],
    requiredRuntimeRegisters: [
      "telemetry.fraud_risk_score",
      "telemetry.identity_confidence_score",
      "telemetry.identity_verified"
    ],
    regulatoryBasis: ["AAMVA DLDV", "OFAC", "State fraud-prevention programs"]
  },
  {
    kind: "nmvtis",
    label: "NMVTIS Boundary",
    consequenceBoundary: "Vehicle history, brand, and state-of-title verification before consequential action",
    actionExamples: ["nmvtis.check.run"],
    requiredRuntimeRegisters: ["telemetry.nmvtis_passed", "telemetry.brand_status", "telemetry.theft_flag_clear"],
    regulatoryBasis: ["Anti Car Theft Act / NMVTIS"]
  },
  {
    kind: "historian-write",
    label: "Historian / Records Boundary",
    consequenceBoundary: "Operational records and compliance annotations",
    actionExamples: ["historian.record.write"],
    requiredRuntimeRegisters: ["telemetry.actor_id", "telemetry.organization_id"],
    regulatoryBasis: ["State recordkeeping statutes"]
  }
];

/** Regulatory regimes this vertical is designed to align with (DEMONSTRATION ONLY). */
export const TITLE_REGULATORY_PROFILE = [
  "State ELT (Electronic Lien & Title) programs",
  "NMVTIS (National Motor Vehicle Title Information System)",
  "49 CFR Part 580 (odometer disclosure)",
  "ESIGN Act / UETA (digital signatures)",
  "AAMVA DLDV (driver license validation)",
  "UCC Article 9 (secured transactions)",
  "State motor-vehicle codes",
  "State dealer-licensing statutes"
] as const;

/** Sample / demonstration jurisdiction rule sets. NOT LEGAL ADVICE. Validate before production use. */
export interface JurisdictionRuleSet {
  state: string;
  rule_version: string;
  supports_elt: boolean;
  supports_digital_signature: boolean;
  requires_odometer_disclosure: boolean;
  requires_vin_inspection_for_out_of_state_title: boolean;
  requires_lienholder_verification: boolean;
  requires_nmvtis_check: boolean;
  fraud_escalation_threshold: number;
  min_identity_confidence_score: number;
  permitted_transaction_types: TitleTransactionType[];
  required_forms_by_transaction_type: Record<string, string[]>;
  /** Reminder this is sample data; surfaced in UI / docs. */
  demonstration_only: true;
}

export const JURISDICTION_RULE_PRESETS: Record<string, JurisdictionRuleSet> = {
  // SAMPLE / DEMONSTRATION ONLY — not legal advice.
  MT: {
    state: "MT",
    rule_version: "demo-2026.05.25",
    supports_elt: true,
    supports_digital_signature: true,
    requires_odometer_disclosure: true,
    requires_vin_inspection_for_out_of_state_title: true,
    requires_lienholder_verification: true,
    requires_nmvtis_check: true,
    fraud_escalation_threshold: 0.7,
    min_identity_confidence_score: 0.8,
    permitted_transaction_types: ["new-title", "title-transfer", "duplicate-title", "registration-renewal", "registration-interstate", "lien-perfection", "lien-release", "digital-signature-execute", "dmv-submission"],
    required_forms_by_transaction_type: {
      "title-transfer": ["MV1", "MV6", "odometer-statement"],
      "registration-interstate": ["MV1", "vin-inspection", "proof-of-insurance"],
      "lien-release": ["lien-release-statement"]
    },
    demonstration_only: true
  },
  OR: {
    state: "OR",
    rule_version: "demo-2026.05.25",
    supports_elt: true,
    supports_digital_signature: true,
    requires_odometer_disclosure: true,
    requires_vin_inspection_for_out_of_state_title: true,
    requires_lienholder_verification: true,
    requires_nmvtis_check: true,
    fraud_escalation_threshold: 0.65,
    min_identity_confidence_score: 0.85,
    permitted_transaction_types: ["new-title", "title-transfer", "duplicate-title", "registration-renewal", "registration-interstate", "lien-release", "digital-signature-execute"],
    required_forms_by_transaction_type: {
      "title-transfer": ["form-735-226", "odometer-statement"],
      "registration-interstate": ["form-735-226", "vin-inspection"]
    },
    demonstration_only: true
  },
  CA: {
    state: "CA",
    rule_version: "demo-2026.05.25",
    supports_elt: true,
    supports_digital_signature: true,
    requires_odometer_disclosure: true,
    requires_vin_inspection_for_out_of_state_title: true,
    requires_lienholder_verification: true,
    requires_nmvtis_check: true,
    fraud_escalation_threshold: 0.6,
    min_identity_confidence_score: 0.9,
    permitted_transaction_types: ["new-title", "title-transfer", "duplicate-title", "registration-renewal", "registration-interstate", "lien-perfection", "lien-release", "digital-signature-execute"],
    required_forms_by_transaction_type: {
      "title-transfer": ["reg-227", "odometer-statement", "smog-certificate"],
      "registration-interstate": ["reg-343", "vin-inspection"]
    },
    demonstration_only: true
  },
  TX: {
    state: "TX",
    rule_version: "demo-2026.05.25",
    supports_elt: true,
    supports_digital_signature: false, // sample only — varies by transaction type
    requires_odometer_disclosure: true,
    requires_vin_inspection_for_out_of_state_title: true,
    requires_lienholder_verification: true,
    requires_nmvtis_check: true,
    fraud_escalation_threshold: 0.65,
    min_identity_confidence_score: 0.85,
    permitted_transaction_types: ["new-title", "title-transfer", "duplicate-title", "registration-renewal", "registration-interstate", "lien-perfection", "lien-release"],
    required_forms_by_transaction_type: {
      "title-transfer": ["form-130-u", "odometer-statement"],
      "registration-interstate": ["form-130-u", "vin-inspection"]
    },
    demonstration_only: true
  },
  FL: {
    state: "FL",
    rule_version: "demo-2026.05.25",
    supports_elt: true,
    supports_digital_signature: true,
    requires_odometer_disclosure: true,
    requires_vin_inspection_for_out_of_state_title: true,
    requires_lienholder_verification: true,
    requires_nmvtis_check: true,
    fraud_escalation_threshold: 0.7,
    min_identity_confidence_score: 0.8,
    permitted_transaction_types: ["new-title", "title-transfer", "duplicate-title", "title-correction", "registration-renewal", "registration-interstate", "lien-perfection", "lien-release", "digital-signature-execute"],
    required_forms_by_transaction_type: {
      "title-transfer": ["form-hsmv-82040", "odometer-statement"],
      "title-correction": ["form-hsmv-82101"]
    },
    demonstration_only: true
  }
};

export interface TitleRuntimeSnapshot {
  /** Identity of the action's transaction artifact (the asset in this vertical is the transaction). */
  asset_id: string;
  asset_type: "title-transaction" | "registration-transaction" | "lien-transaction" | "signature-transaction" | string;
  transaction_id: string;
  transaction_type: TitleTransactionType | string;
  jurisdiction: string;
  state_rule_version: string;
  /** Vehicle. */
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  odometer?: number;
  title_state: string;
  title_number?: string;
  title_status?: "active" | "salvage" | "rebuilt" | "non-repairable" | "suspended" | "lost" | string;
  brand_status: "clean" | "salvage" | "rebuilt" | "flood" | "lemon" | "junk" | string;
  /** Parties. */
  actor_id: string;
  organization_id: string;
  organization_kind: "dealer" | "lender" | "dmv" | "title-agent" | "buyer" | "seller" | string;
  dealer_id?: string;
  dealer_state?: string;
  buyer_state?: string;
  seller_state?: string;
  lender_id?: string;
  /** Authority & posture. */
  dealer_license_active?: boolean;
  lender_active?: boolean;
  lender_elt_participant?: boolean;
  signer_authorized: boolean;
  authority_envelope_unrevoked: boolean;
  warrant_unused?: boolean;
  warrant_age_ms?: number;
  /** Checks. */
  nmvtis_passed: boolean;
  theft_flag_clear: boolean;
  odometer_disclosed: boolean;
  identity_verified: boolean;
  identity_confidence_score: number;
  fraud_risk_score: number;
  /** Lien. */
  lien_exists?: boolean;
  lien_release_authority_active?: boolean;
  /** Forms & state-rule posture. */
  required_forms_present: boolean;
  required_forms_list?: string[];
  vin_inspection_present?: boolean;
  /** State rule support. */
  state_supports_elt: boolean;
  state_supports_digital_signature: boolean;
  digital_signature_accepted: boolean;
  /** Operator. */
  operator_qualified: boolean;
  /** Misc. */
  telemetry_age_ms: number;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface TitleActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: TitleRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface LienReleaseRequest {
  lender_id: string;
  vin: string;
  operation: "release" | "perfection" | "satisfaction";
  action_type?: string;
}

export interface TitleTransactionRequest {
  transaction_id: string;
  operation: "new-title" | "transfer" | "duplicate" | "correction" | "brand-set";
  action_type?: string;
}

export interface RegistrationRequest {
  transaction_id: string;
  operation: "renewal" | "interstate";
  action_type?: string;
}

export interface DigitalSignatureRequest {
  document_id: string;
  document_type: "title-application" | "power-of-attorney" | "odometer-statement" | string;
  operation: "execute";
  action_type?: string;
}

export interface DealerWorkflowRequest {
  dealer_id: string;
  operation: "transfer" | "trade-in";
  action_type?: string;
}

export interface LenderWorkflowRequest {
  lender_id: string;
  operation: "lien-perfection" | "lien-satisfaction" | "lien-release";
  action_type?: string;
}

export interface DmvSubmissionRequest {
  endpoint_id: string;
  operation: "submit";
  packet_ref?: string;
  action_type?: string;
}

export interface FraudCheckRequest {
  check_id: string;
  operation: "run-fraud-check" | "verify-identity";
  action_type?: string;
}

export interface NmvtisRequest {
  vin: string;
  operation: "check";
  action_type?: string;
}

export interface TitleHistorianWriteRequest {
  historian_id: string;
  stream: string;
  record_type: "operator-note" | "compliance-marker" | "audit-marker" | string;
  payload: Record<string, JsonValue>;
  action_type?: string;
}

export type TitleAdapterRequest =
  | { kind: "elt-lien"; request: LienReleaseRequest }
  | { kind: "title-transaction"; request: TitleTransactionRequest }
  | { kind: "registration"; request: RegistrationRequest }
  | { kind: "digital-signature"; request: DigitalSignatureRequest }
  | { kind: "dealer-workflow"; request: DealerWorkflowRequest }
  | { kind: "lender-workflow"; request: LenderWorkflowRequest }
  | { kind: "dmv-submission"; request: DmvSubmissionRequest }
  | { kind: "fraud-check"; request: FraudCheckRequest }
  | { kind: "nmvtis"; request: NmvtisRequest }
  | { kind: "historian-write"; request: TitleHistorianWriteRequest };

export interface TitleEvidenceContext {
  actor_id: string;
  organization_id: string;
  organization_kind: "dealer" | "lender" | "dmv" | "title-agent" | string;
  jurisdiction: string;
  state_rule_version: string;
  transaction_id: string;
  transaction_type: TitleTransactionType | string;
  vin: string;
  title_state: string;
  controller_id: string;
  fraud_risk_score?: number;
  identity_confidence_score?: number;
  regulatory_evidence_profile: Array<
    | "STATE_ELT"
    | "STATE_TITLE_STATUTES"
    | "NMVTIS"
    | "ODOMETER_DISCLOSURE"
    | "DIGITAL_SIGNATURE_ESIGN_UETA"
    | "DLDV"
    | "OFAC"
    | "UCC_ARTICLE_9"
    | "DEALER_LICENSING"
  >;
  /** Whether the jurisdiction rules in effect are sample/demonstration vs. legally validated. */
  rule_validation_state: "demonstration" | "operator-validated" | "counsel-reviewed";
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
  /**
   * Outbound submission receipt produced by a TitleSubmissionTransport after the Commit
   * Gate ALLOWED the action and the Warrant was consumed. Binding this into the Title
   * Evidence Context means the bundle hash covers the receipt — a tampered or substituted
   * receipt fails verifyTitleEvidenceBundle. Absent when the transaction did not produce
   * an outbound submission (e.g. internal correction-only flows).
   */
  submission_receipt?: TitleSubmissionReceipt;
}

export interface TitleEvidenceBundle {
  bundle_version: "aristotle.title-evidence.v1";
  exported_at: string;
  title: TitleEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    title_context_hash: string;
    execution_bundle_hash: string;
    title_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: TitleRuntimeSnapshot): Record<string, JsonValue> {
  return {
    asset_id: snapshot.asset_id,
    asset_type: snapshot.asset_type,
    transaction_id: snapshot.transaction_id,
    transaction_type: snapshot.transaction_type,
    jurisdiction: snapshot.jurisdiction,
    boundary_id: snapshot.jurisdiction,
    state_rule_version: snapshot.state_rule_version,
    vin: snapshot.vin,
    title_state: snapshot.title_state,
    brand_status: snapshot.brand_status,
    ...(snapshot.year !== undefined ? { year: snapshot.year } : {}),
    ...(snapshot.make ? { make: snapshot.make } : {}),
    ...(snapshot.model ? { model: snapshot.model } : {}),
    ...(snapshot.odometer !== undefined ? { odometer: snapshot.odometer } : {}),
    ...(snapshot.title_number ? { title_number: snapshot.title_number } : {}),
    ...(snapshot.title_status ? { title_status: snapshot.title_status } : {}),
    actor_id: snapshot.actor_id,
    organization_id: snapshot.organization_id,
    organization_kind: snapshot.organization_kind,
    ...(snapshot.dealer_id ? { dealer_id: snapshot.dealer_id } : {}),
    ...(snapshot.dealer_state ? { dealer_state: snapshot.dealer_state } : {}),
    ...(snapshot.buyer_state ? { buyer_state: snapshot.buyer_state } : {}),
    ...(snapshot.seller_state ? { seller_state: snapshot.seller_state } : {}),
    ...(snapshot.lender_id ? { lender_id: snapshot.lender_id } : {}),
    ...(snapshot.dealer_license_active !== undefined ? { dealer_license_active: snapshot.dealer_license_active } : {}),
    ...(snapshot.lender_active !== undefined ? { lender_active: snapshot.lender_active } : {}),
    ...(snapshot.lender_elt_participant !== undefined ? { lender_elt_participant: snapshot.lender_elt_participant } : {}),
    signer_authorized: snapshot.signer_authorized,
    authority_envelope_unrevoked: snapshot.authority_envelope_unrevoked,
    ...(snapshot.warrant_unused !== undefined ? { warrant_unused: snapshot.warrant_unused } : {}),
    ...(snapshot.warrant_age_ms !== undefined ? { warrant_age_ms: snapshot.warrant_age_ms } : {}),
    nmvtis_passed: snapshot.nmvtis_passed,
    theft_flag_clear: snapshot.theft_flag_clear,
    odometer_disclosed: snapshot.odometer_disclosed,
    identity_verified: snapshot.identity_verified,
    identity_confidence_score: snapshot.identity_confidence_score,
    fraud_risk_score: snapshot.fraud_risk_score,
    ...(snapshot.lien_exists !== undefined ? { lien_exists: snapshot.lien_exists } : {}),
    ...(snapshot.lien_release_authority_active !== undefined ? { lien_release_authority_active: snapshot.lien_release_authority_active } : {}),
    required_forms_present: snapshot.required_forms_present,
    ...(snapshot.required_forms_list ? { required_forms_list: snapshot.required_forms_list } : {}),
    ...(snapshot.vin_inspection_present !== undefined ? { vin_inspection_present: snapshot.vin_inspection_present } : {}),
    state_supports_elt: snapshot.state_supports_elt,
    state_supports_digital_signature: snapshot.state_supports_digital_signature,
    digital_signature_accepted: snapshot.digital_signature_accepted,
    operator_qualified: snapshot.operator_qualified,
    telemetry_age_ms: snapshot.telemetry_age_ms
  };
}

function titleAction(
  ctx: TitleActionContext,
  action_type: string,
  target: string,
  params: Record<string, JsonValue>
): CanonicalActionInput {
  return {
    action_id: ctx.action_id,
    ward_id: ctx.ward_id,
    subject: ctx.subject,
    action_type,
    target,
    params: { ...snapshotParams(ctx.snapshot), ...params },
    requested_at: ctx.requested_at,
    ...(ctx.request_id ? { request_id: ctx.request_id } : {}),
    telemetry: {
      ...snapshotParams(ctx.snapshot),
      ...(ctx.snapshot.metadata ?? {}),
      ...(ctx.telemetry ?? {})
    },
    ...(ctx.classification ? { classification: ctx.classification } : {})
  };
}

export function lienReleaseToAction(input: LienReleaseRequest, ctx: TitleActionContext): CanonicalActionInput {
  const fallback =
    input.operation === "release"
      ? "lien.release.submit"
      : input.operation === "perfection"
        ? "lien.perfection.submit"
        : "lien.satisfaction.submit";
  return titleAction(ctx, input.action_type ?? fallback, `${input.lender_id}:${input.vin}:${input.operation}`, {
    adapter: "elt-lien",
    lender_id: input.lender_id,
    vin: input.vin,
    operation: input.operation
  });
}

export function titleTransactionToAction(input: TitleTransactionRequest, ctx: TitleActionContext): CanonicalActionInput {
  const fallback = `title.${slug(input.operation)}.submit`;
  return titleAction(ctx, input.action_type ?? fallback, `${input.transaction_id}:title:${input.operation}`, {
    adapter: "title-transaction",
    transaction_id: input.transaction_id,
    operation: input.operation
  });
}

export function registrationToAction(input: RegistrationRequest, ctx: TitleActionContext): CanonicalActionInput {
  const fallback = `registration.${slug(input.operation)}.submit`;
  return titleAction(ctx, input.action_type ?? fallback, `${input.transaction_id}:registration:${input.operation}`, {
    adapter: "registration",
    transaction_id: input.transaction_id,
    operation: input.operation
  });
}

export function digitalSignatureToAction(input: DigitalSignatureRequest, ctx: TitleActionContext): CanonicalActionInput {
  return titleAction(ctx, input.action_type ?? "digital_signature.execute", `${input.document_id}:${input.document_type}`, {
    adapter: "digital-signature",
    document_id: input.document_id,
    document_type: input.document_type,
    operation: input.operation
  });
}

export function dealerWorkflowToAction(input: DealerWorkflowRequest, ctx: TitleActionContext): CanonicalActionInput {
  const fallback = input.operation === "transfer" ? "dealer.transfer.submit" : "dealer.trade_in.submit";
  return titleAction(ctx, input.action_type ?? fallback, `${input.dealer_id}:${input.operation}`, {
    adapter: "dealer-workflow",
    dealer_id: input.dealer_id,
    operation: input.operation
  });
}

export function lenderWorkflowToAction(input: LenderWorkflowRequest, ctx: TitleActionContext): CanonicalActionInput {
  const fallback = `lender.${slug(input.operation)}`;
  return titleAction(ctx, input.action_type ?? fallback, `${input.lender_id}:${input.operation}`, {
    adapter: "lender-workflow",
    lender_id: input.lender_id,
    operation: input.operation
  });
}

export function dmvSubmissionToAction(input: DmvSubmissionRequest, ctx: TitleActionContext): CanonicalActionInput {
  return titleAction(ctx, input.action_type ?? "dmv.submit", `${input.endpoint_id}:submit`, {
    adapter: "dmv-submission",
    endpoint_id: input.endpoint_id,
    operation: input.operation,
    ...(input.packet_ref ? { packet_ref: input.packet_ref } : {})
  });
}

export function fraudCheckToAction(input: FraudCheckRequest, ctx: TitleActionContext): CanonicalActionInput {
  const fallback = input.operation === "run-fraud-check" ? "fraud.check.run" : "identity.verify";
  return titleAction(ctx, input.action_type ?? fallback, `${input.check_id}:${input.operation}`, {
    adapter: "fraud-check",
    check_id: input.check_id,
    operation: input.operation
  });
}

export function nmvtisToAction(input: NmvtisRequest, ctx: TitleActionContext): CanonicalActionInput {
  return titleAction(ctx, input.action_type ?? "nmvtis.check.run", `${input.vin}:nmvtis`, {
    adapter: "nmvtis",
    vin: input.vin,
    operation: input.operation
  });
}

export function titleHistorianWriteToAction(input: TitleHistorianWriteRequest, ctx: TitleActionContext): CanonicalActionInput {
  return titleAction(ctx, input.action_type ?? "historian.record.write", `${input.historian_id}:${input.stream}:${input.record_type}`, {
    adapter: "historian-write",
    historian_id: input.historian_id,
    stream: input.stream,
    record_type: input.record_type,
    payload: input.payload
  });
}

export function titleAdapterToAction(input: TitleAdapterRequest, ctx: TitleActionContext): CanonicalActionInput {
  if (input.kind === "elt-lien") return lienReleaseToAction(input.request, ctx);
  if (input.kind === "title-transaction") return titleTransactionToAction(input.request, ctx);
  if (input.kind === "registration") return registrationToAction(input.request, ctx);
  if (input.kind === "digital-signature") return digitalSignatureToAction(input.request, ctx);
  if (input.kind === "dealer-workflow") return dealerWorkflowToAction(input.request, ctx);
  if (input.kind === "lender-workflow") return lenderWorkflowToAction(input.request, ctx);
  if (input.kind === "dmv-submission") return dmvSubmissionToAction(input.request, ctx);
  if (input.kind === "fraud-check") return fraudCheckToAction(input.request, ctx);
  if (input.kind === "nmvtis") return nmvtisToAction(input.request, ctx);
  return titleHistorianWriteToAction(input.request, ctx);
}

export function titleSnapshotToRuntimeRegister(snapshot: TitleRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateTitleSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function titleBundleHash(input: Omit<TitleEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<TitleEvidenceBundle["hashes"], "title_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportTitleEvidenceBundle(input: ExportEvidenceBundleInput & { title: TitleEvidenceContext }): TitleEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.title-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    title: JSON.parse(stableStringify(input.title)) as TitleEvidenceContext,
    execution_bundle
  };
  const hashes = {
    title_context_hash: sha256(stableStringify(partial.title)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    title_bundle_hash: ""
  };
  hashes.title_bundle_hash = titleBundleHash({
    ...partial,
    hashes: {
      title_context_hash: hashes.title_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: TitleEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyTitleEvidenceBundle(draft) };
}

export function verifyTitleEvidenceBundle(bundle: TitleEvidenceBundle): TitleEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.title-evidence.v1") failures.push("unsupported title evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.title));
  if (contextHash !== bundle.hashes.title_context_hash) failures.push("title context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = titleBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    title: bundle.title,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      title_context_hash: bundle.hashes.title_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.title_bundle_hash) failures.push("title bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}

// ============================================================================
// Outbound Title Submission Adapter (demonstration)
// ----------------------------------------------------------------------------
// AristotleOS gates the action; this section actually delivers the resulting
// packet to a state ELT / DMV / dealer endpoint. The shipped transport is a
// demonstration: it returns a deterministic receipt, never touches a real
// state system, and refuses by default to be used as a production transport.
//
// To wire a real state hub (e.g. Montana ELT, Oregon ELT, AAMVA NMVTIS web
// service), implement the TitleSubmissionTransport interface and set
// production_validated=true ONLY AFTER end-to-end test, counsel review, and
// per-state credential / signing-key onboarding. The orchestrator refuses to
// hand a packet to a non-production-validated transport unless the caller
// EXPLICITLY passes allowDemonstrationTransport=true — this is intentional to
// prevent a demonstration receipt from ending up in a real evidence bundle.
//
// Cryptographic binding: the receipt covers warrant_id + action_hash from
// the consumed warrant. The receipt is embedded inside TitleEvidenceContext,
// so the existing title_bundle_hash covers it — substituting or mutating a
// receipt after export fails verifyTitleEvidenceBundle.
// ============================================================================

export interface TitleSubmissionAuthorization {
  /** Identifier of the single-use Warrant produced by the Commit Gate. */
  warrant_id: string;
  /** Opaque signature material from the Warrant; adapter does not re-verify
   *  the signature itself, but binds the id + action_hash into the receipt. */
  warrant_signature: string;
  /** Must be true. The Warrant must already have been consumed by the gate
   *  before the adapter is invoked. Defense-in-depth against the adapter
   *  ever being called before warrant consume. */
  consumed: true;
  /** ISO timestamp when the Warrant was consumed. */
  consumed_at: string;
  /** Canonical action hash bound at gate time. */
  action_hash: string;
  /** Jurisdiction the authorization is scoped to (e.g. "MT"). */
  jurisdiction: string;
  /** Transaction type the authorization is scoped to. */
  transaction_type: string;
}

export interface TitleSubmissionPacket {
  packet_id: string;
  jurisdiction: string;
  transaction_id: string;
  transaction_type: string;
  vin: string;
  /** Where the packet is going. demonstration-echo is the only built-in
   *  channel and is non-production. */
  channel: "elt-hub" | "dmv-portal" | "dealer-portal" | "demonstration-echo";
  /** The outbound payload. Real integrations should serialize this in the
   *  format the state hub requires (XML / JSON / EDI), sign per state spec,
   *  and encrypt in transit. The orchestrator does not transform payload. */
  payload: Record<string, JsonValue>;
  /** Fields excluded from the payload for PII minimization. */
  redacted_fields: string[];
}

export interface TitleSubmissionReceipt {
  packet_id: string;
  jurisdiction: string;
  transport: string;
  channel: string;
  remote_receipt_id: string;
  ack_at: string;
  ack_kind: "accepted" | "queued" | "pending-review";
  /** Cryptographic binding back to the authorizing Warrant. */
  warrant_id: string;
  /** Cryptographic binding back to the canonical action that the Warrant covered. */
  action_hash: string;
  /** sha256 over the rest of the receipt (excluding receipt_hash itself).
   *  Allows callers to verify a receipt out-of-band before binding it into
   *  the Title Evidence Context. */
  receipt_hash: string;
  /** True if the transport that produced this receipt is production-validated. */
  production_validated: boolean;
}

export type TitleSubmissionRefusalCode =
  | "MISSING_AUTHORIZATION"
  | "WARRANT_NOT_CONSUMED"
  | "JURISDICTION_MISMATCH"
  | "TRANSACTION_TYPE_MISMATCH"
  | "TRANSPORT_REJECTED"
  | "TRANSPORT_UNREACHABLE"
  | "DEMONSTRATION_ONLY_BLOCKED";

export type TitleSubmissionOutcome =
  | { ok: true; receipt: TitleSubmissionReceipt }
  | { ok: false; refusal: { code: TitleSubmissionRefusalCode; detail: string } };

export interface TitleSubmissionTransport {
  readonly id: string;
  /** True if this transport has been onboarded for real state submissions.
   *  Demonstration transports MUST return false. The orchestrator uses this
   *  to refuse a demonstration receipt being attached to real evidence. */
  readonly production_validated: boolean;
  submit(packet: TitleSubmissionPacket, authz: TitleSubmissionAuthorization): Promise<TitleSubmissionOutcome>;
}

/**
 * In-memory transport that simulates a state ELT / DMV hub. Deterministic,
 * never touches the network, and is_production_validated=false. Use ONLY for
 * tests, demos, the operator UI preview, and the CLI dry-run path.
 *
 * Configure with { ackKind } to model "accepted" / "queued" / "pending-review",
 * or { reject: true } to model a hub rejection.
 */
export class DemonstrationTitleSubmissionTransport implements TitleSubmissionTransport {
  readonly id = "demonstration-echo";
  readonly production_validated = false;
  private seq = 0;
  private readonly ackKind: TitleSubmissionReceipt["ack_kind"];
  private readonly reject: boolean;
  private readonly clock: () => string;

  constructor(opts?: {
    ackKind?: TitleSubmissionReceipt["ack_kind"];
    reject?: boolean;
    /** Inject a clock for deterministic tests. */
    clock?: () => string;
  }) {
    this.ackKind = opts?.ackKind ?? "accepted";
    this.reject = opts?.reject ?? false;
    this.clock = opts?.clock ?? (() => new Date().toISOString());
  }

  async submit(
    packet: TitleSubmissionPacket,
    authz: TitleSubmissionAuthorization
  ): Promise<TitleSubmissionOutcome> {
    if (this.reject) {
      return { ok: false, refusal: { code: "TRANSPORT_REJECTED", detail: "demonstration transport configured to reject" } };
    }
    this.seq += 1;
    const partial = {
      packet_id: packet.packet_id,
      jurisdiction: packet.jurisdiction,
      transport: this.id,
      channel: packet.channel,
      remote_receipt_id: `demo-${packet.jurisdiction}-${this.seq.toString().padStart(6, "0")}`,
      ack_at: this.clock(),
      ack_kind: this.ackKind,
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      production_validated: this.production_validated
    };
    const receipt: TitleSubmissionReceipt = {
      ...partial,
      receipt_hash: sha256(stableStringify(partial))
    };
    return { ok: true, receipt };
  }
}

/**
 * Submit a title packet through a transport, enforcing defense-in-depth
 * authorization checks BEFORE the transport is invoked. Refuses if:
 *   - authz is missing or not marked consumed
 *   - authz jurisdiction does not match packet jurisdiction
 *   - authz transaction_type does not match packet transaction_type
 *   - transport.production_validated is false and caller did not opt in
 *
 * On a transport exception, returns a TRANSPORT_UNREACHABLE refusal rather
 * than throwing — the caller decides whether to retry or escalate.
 */
export async function submitTitlePacket(
  packet: TitleSubmissionPacket,
  authz: TitleSubmissionAuthorization,
  transport: TitleSubmissionTransport,
  opts?: { allowDemonstrationTransport?: boolean }
): Promise<TitleSubmissionOutcome> {
  if (!authz) {
    return { ok: false, refusal: { code: "MISSING_AUTHORIZATION", detail: "no warrant authorization provided" } };
  }
  if (authz.consumed !== true) {
    return { ok: false, refusal: { code: "WARRANT_NOT_CONSUMED", detail: "warrant must be consumed by the gate before adapter submit" } };
  }
  if (authz.jurisdiction !== packet.jurisdiction) {
    return { ok: false, refusal: { code: "JURISDICTION_MISMATCH", detail: `authz jurisdiction ${authz.jurisdiction} != packet jurisdiction ${packet.jurisdiction}` } };
  }
  if (authz.transaction_type !== packet.transaction_type) {
    return { ok: false, refusal: { code: "TRANSACTION_TYPE_MISMATCH", detail: `authz transaction_type ${authz.transaction_type} != packet transaction_type ${packet.transaction_type}` } };
  }
  if (!transport.production_validated && opts?.allowDemonstrationTransport !== true) {
    return { ok: false, refusal: { code: "DEMONSTRATION_ONLY_BLOCKED", detail: `transport ${transport.id} is not production-validated; caller must explicitly pass allowDemonstrationTransport=true` } };
  }
  try {
    return await transport.submit(packet, authz);
  } catch (err) {
    return { ok: false, refusal: { code: "TRANSPORT_UNREACHABLE", detail: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * Verify a receipt's internal hash. Returns true if receipt_hash matches the
 * recomputed sha256 over the rest of the receipt fields. Useful before binding
 * a receipt into a Title Evidence Context.
 */
export function verifyTitleSubmissionReceipt(receipt: TitleSubmissionReceipt): boolean {
  const { receipt_hash, ...rest } = receipt;
  return sha256(stableStringify(rest)) === receipt_hash;
}
