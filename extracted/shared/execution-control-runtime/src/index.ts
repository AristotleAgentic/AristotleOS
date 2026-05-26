import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import {
  type AristotleSigner,
  type SignatureAlgorithm,
  getDefaultDevSigner,
  resolveWarrantSigner,
  verifyEd25519
} from "./signing.js";
import { type CredentialBroker, proxyGovernedAction } from "./proxy.js";
import { PLAYGROUND_HTML } from "./playground.js";
import { type RevocationKind, type RevocationList, addRevocation, loadRevocationList, revocationReason } from "./revocation.js";
import { assertValidAuthorityEnvelope, assertValidWardManifest } from "./validation.js";
import { type AuditEvent, deliverAuditEvent } from "./audit-sink.js";
import {
  type AuthConfig,
  type AuthMethod,
  type OperatorCredential,
  type OperatorRole,
  type OidcConfig,
  type Principal,
  authEnabled,
  presentedCredential,
  resolvePrincipal,
  roleSatisfies
} from "./auth.js";
import {
  type AristotleTracer,
  type TraceContext,
  normalizeTraceContext,
  parseTraceparent,
  traceSpan
} from "./trace.js";
import { RuntimeMetrics } from "./metrics.js";
import { type GovernanceDraft, compileGovernanceManifest, diffGovernanceManifests, explainPolicy } from "./builder.js";
import { type ShadowAction, profileShadowMode } from "./shadow.js";
import { type EdgeRecord, type ResolutionAction, reconcileEdgeRecords } from "./reconcile.js";
import { ConflictInboxStore } from "./conflict-inbox.js";
import { type AgentObservation, type AgentRegistry, runWardMarshalCensus } from "./ward-marshal.js";
import { type BehaviorAnalysisConfig, type BehaviorEvent, analyzeAgentBehavior } from "./marshal-behavior.js";
import { type Classification, enforceClassification } from "./classification.js";
import { type DegradationCondition, type WardCriticality, resolveFailMode } from "./fail-mode.js";
import { type DegradationProbe, collectDegradation, ledgerUnavailableProbe } from "./degradation.js";
import { BudgetGovernor, type BudgetPolicy, budgetPolicyFrom } from "./budget.js";
import { ApprovalStore, dualControlPolicyFrom } from "./dual-control.js";

export * from "./proxy.js";
export * from "./mcp.js";
export * from "./playground.js";
export * from "./revocation.js";
export * from "./credential-revocation.js";
export * from "./validation.js";
export * from "./sqlite-ledger.js";
export * from "./postgres-ledger.js";
export * from "./audit-sink.js";
export * from "./auth.js";
export * from "./trace.js";
export * from "./metrics.js";
export * from "./sandbox.js";
export * from "./shadow.js";
export * from "./builder.js";
export * from "./policy-dsl.js";
export * from "./reconcile.js";
export * from "./conflict-inbox.js";
export * from "./ward-marshal.js";
export * from "./ward-marshal-adapters.js";
export * from "./marshal-behavior.js";
export * from "./marshal-collectors.js";
export * from "./credential-minter.js";
export * from "./attestation.js";
export * from "./crypto-posture.js";
export * from "./edge-containment.js";
export * from "./classification.js";
export * from "./fail-mode.js";
export * from "./degradation.js";
export * from "./budget.js";
export * from "./dual-control.js";
export * from "./telecom.js";
export * from "./automotive.js";
export * from "./grid.js";
export * from "./rail.js";
export * from "./pipeline.js";
export * from "./mining.js";
export * from "./port.js";
export * from "./water.js";
export * from "./aviation.js";
export * from "./robotics.js";
export * from "./logistics.js";
export * from "./swarm.js";
export * from "./healthcare.js";

export {
  type AristotleSigner,
  type KeyMaterialProvider,
  type SignatureAlgorithm,
  createEd25519Signer,
  createEphemeralDevSigner,
  createSignerFromKeyProvider,
  deriveKeyId,
  getDefaultDevSigner,
  loadWarrantSignerFromEnv,
  requireProductionSigner,
  resolveWarrantSigner,
  verifyEd25519
} from "./signing.js";

export type ExecutionControlDecision = "ALLOW" | "REFUSE" | "ESCALATE";

export type ExecutionControlReasonCode =
  | "WARD_NOT_FOUND"
  | "SUBJECT_NOT_IN_WARD"
  | "ENVELOPE_EXPIRED"
  | "ACTION_DENIED"
  | "ACTION_NOT_ALLOWED"
  | "CONSTRAINT_FAILED"
  | "PHYSICAL_INVARIANT_FAILED"
  | "RUNTIME_STATE_MISSING"
  | "POLICY_VERSION_MISMATCH"
  | "KILL_SWITCH_ENGAGED"
  | "REPLAY_DETECTED"
  | "BUDGET_EXCEEDED"
  | "DUAL_CONTROL_REQUIRED"
  | "DUAL_CONTROL_STORE_MISSING"
  | "AUTHORITY_REVOKED"
  | "CLASSIFICATION_VIOLATION"
  | "DEGRADED_MODE"
  | "ALLOWED";

export interface WardManifest {
  ward_id: string;
  name: string;
  sovereignty_context: string;
  authority_domain: string;
  policy_version: string;
  evidence_ledger_path?: string;
  permitted_subjects: string[];
  physical_bounds?: PhysicalBounds;
  metadata?: Record<string, JsonValue>;
  /** MLS clearance ceiling for this Ward; actions whose data label it cannot dominate are refused. */
  classification?: Classification;
  /** Criticality tier driving the degraded-mode fail policy (default mission_critical). */
  criticality?: WardCriticality;
}

export interface AuthorityEnvelope {
  envelope_id: string;
  ward_id: string;
  subject: string;
  allowed_actions: string[];
  denied_actions: string[];
  constraints: Record<string, JsonValue>;
  expires_at: string;
  issuer: string;
  signature?: string;
  /** MLS clearance granted by this Authority Envelope. */
  classification?: Classification;
}

export interface CanonicalActionInput {
  action_id: string;
  ward_id: string;
  subject: string;
  action_type: string;
  target: string;
  params: Record<string, JsonValue>;
  requested_at: string;
  nonce?: string;
  request_id?: string;
  telemetry?: Record<string, JsonValue>;
  /** MLS data label of this action; must be dominated by the Ward/Envelope clearance. */
  classification?: Classification;
}

export interface CanonicalAction {
  canonical_json: string;
  canonical_action_hash: string;
  action: CanonicalActionInput;
}

export interface RuntimeRegister {
  policy_version?: string;
  registers?: Record<string, JsonValue>;
  [key: string]: JsonValue | Record<string, JsonValue> | undefined;
}

export interface PhysicalBounds {
  max_altitude_m?: number;
  permitted_boundary_id?: string;
  battery_minimum_pct?: number;
  max_speed_mps?: number;
  permitted_odd_id?: string;
  permitted_road_classes?: string[];
  min_map_confidence?: number;
  min_localization_confidence?: number;
  min_perception_confidence?: number;
  require_mrc_available?: boolean;
  permitted_drive_states?: string[];
  min_voltage_kv?: number;
  max_voltage_kv?: number;
  min_frequency_hz?: number;
  max_frequency_hz?: number;
  max_feeder_load_pct?: number;
  max_transformer_load_pct?: number;
  max_der_export_mw?: number;
  max_telemetry_age_ms?: number;
  permitted_topology_model_id?: string;
  permitted_voltage_classes?: string[];
  permitted_asset_types?: string[];
  permitted_grid_states?: string[];
  require_switching_order?: boolean;
  require_clearance_released?: boolean;
  require_protection_known?: boolean;
  require_scada_fresh?: boolean;
  require_manual_fallback_ready?: boolean;
  permitted_territory_id?: string;
  permitted_route_classes?: string[];
  permitted_track_classes?: string[];
  permitted_signal_aspects?: string[];
  permitted_train_types?: string[];
  permitted_operating_states?: string[];
  max_authority_speed_mph?: number;
  min_train_separation_m?: number;
  max_train_length_ft?: number;
  max_train_tonnage?: number;
  max_ptc_telemetry_age_ms?: number;
  require_ptc_active?: boolean;
  require_switch_proven?: boolean;
  require_signal_not_stop?: boolean;
  require_work_zone_released?: boolean;
  require_track_bulletin_ack?: boolean;
  require_dispatcher_identity?: boolean;
  require_brake_test_current?: boolean;
  require_consist_verified?: boolean;
  require_grade_crossing_protected?: boolean;
  require_crew_acknowledged?: boolean;
  require_no_conflicting_authority?: boolean;
  // Pipeline (oil & gas / energy) bounds. asset types reuse permitted_asset_types and
  // telemetry freshness reuses max_telemetry_age_ms.
  permitted_segment_id?: string;
  permitted_system_model_id?: string;
  permitted_pipeline_states?: string[];
  max_pressure_psig?: number;
  min_pressure_psig?: number;
  max_pressure_pct_maop?: number;
  max_flow_bbl_per_day?: number;
  max_flow_mmscfd?: number;
  require_leak_detection_armed?: boolean;
  require_overpressure_protection?: boolean;
  require_esd_ready?: boolean;
  require_segment_isolation_ready?: boolean;
  require_pump_primed?: boolean;
  require_pipeline_scada_fresh?: boolean;
  require_operator_qualified?: boolean;
  // Mining bounds (surface, underground, tailings). asset types reuse permitted_asset_types,
  // telemetry freshness reuses max_telemetry_age_ms, operator qualification reuses require_operator_qualified.
  permitted_mine_site_id?: string;
  permitted_mine_zones?: string[];
  permitted_mine_states?: string[];
  max_methane_pct?: number;
  max_co_ppm?: number;
  min_oxygen_pct?: number;
  min_airflow_cfm?: number;
  max_haulage_speed_kph?: number;
  max_tailings_pond_level_m?: number;
  min_tailings_freeboard_m?: number;
  max_hoist_load_kg?: number;
  require_proximity_detection?: boolean;
  require_exclusion_zone_clear?: boolean;
  require_personnel_cleared?: boolean;
  require_ground_control_stable?: boolean;
  require_gas_monitoring?: boolean;
  require_ventilation_on?: boolean;
  require_piezometer_monitoring?: boolean;
  require_overspeed_protection?: boolean;
  require_mining_scada_fresh?: boolean;
  permitted_port_id?: string;
  permitted_terminal_id?: string;
  permitted_berth_ids?: string[];
  permitted_yard_blocks?: string[];
  permitted_gate_ids?: string[];
  permitted_cargo_types?: string[];
  permitted_hazmat_classes?: string[];
  permitted_terminal_zones?: string[];
  max_container_weight_kg?: number;
  min_pnt_confidence?: number;
  max_ais_track_age_ms?: number;
  max_port_telemetry_age_ms?: number;
  max_wind_speed_kn?: number;
  min_reefer_temp_c?: number;
  max_reefer_temp_c?: number;
  require_customs_release?: boolean;
  require_no_security_hold?: boolean;
  require_no_inspection_hold?: boolean;
  require_vgm_verified?: boolean;
  require_crane_exclusion_clear?: boolean;
  require_spreader_safe?: boolean;
  require_berth_clear?: boolean;
  require_tide_window_open?: boolean;
  require_vessel_clearance?: boolean;
  require_truck_appointment?: boolean;
  require_driver_identity?: boolean;
  require_cold_chain_valid?: boolean;
  require_shore_power_lockout?: boolean;
  require_shore_power_isolated?: boolean;
  require_fire_watch_ready?: boolean;
  require_hazmat_route_approved?: boolean;
  require_gate_access_granted?: boolean;
  require_operator_identity?: boolean;
  require_no_vendor_remote_session?: boolean;
  permitted_water_system_id?: string;
  permitted_facility_id?: string;
  permitted_pressure_zones?: string[];
  permitted_process_areas?: string[];
  permitted_water_asset_types?: string[];
  permitted_discharge_permit_ids?: string[];
  max_chlorine_dose_mg_l?: number;
  min_chlorine_residual_mg_l?: number;
  min_pressure_psi?: number;
  max_pressure_psi?: number;
  min_tank_level_pct?: number;
  max_tank_level_pct?: number;
  max_wetwell_level_pct?: number;
  max_turbidity_ntu?: number;
  min_ph?: number;
  max_ph?: number;
  max_sensor_age_ms?: number;
  max_lab_sample_age_min?: number;
  max_flow_mgd?: number;
  min_uv_intensity_pct?: number;
  require_water_scada_fresh?: boolean;
  require_backflow_clear?: boolean;
  require_disinfection_active?: boolean;
  require_chemical_inventory_ok?: boolean;
  require_pump_available?: boolean;
  require_valve_interlock_clear?: boolean;
  require_discharge_permit_window?: boolean;
  require_no_bypass_active?: boolean;
  // Aviation / UAV / eVTOL bounds. asset types reuse permitted_asset_types, telemetry
  // freshness reuses max_telemetry_age_ms, RPIC certification reuses require_operator_qualified.
  permitted_airspace_id?: string;
  permitted_airspace_classes?: string[];
  permitted_operation_volumes?: string[];
  permitted_flight_states?: string[];
  max_altitude_agl_ft?: number;
  max_groundspeed_kts?: number;
  min_battery_soc_pct?: number;
  max_wind_speed_kts?: number;
  min_visibility_sm?: number;
  min_ceiling_ft?: number;
  max_payload_kg?: number;
  require_geofence_active?: boolean;
  require_remote_id_broadcasting?: boolean;
  require_daa_active?: boolean;
  require_c2_link_healthy?: boolean;
  require_airspace_authorization?: boolean;
  require_no_active_tfr?: boolean;
  require_vlos_or_waiver?: boolean;
  require_rtl_available?: boolean;
  require_vertiport_clearance?: boolean;
  require_weather_within_limits?: boolean;
  require_ops_over_people_authorized?: boolean;
  // Robotics / humanoid bounds. asset types reuse permitted_asset_types, telemetry freshness
  // reuses max_telemetry_age_ms, payload reuses max_payload_kg, qualification reuses require_operator_qualified.
  permitted_workcell_id?: string;
  permitted_robot_zones?: string[];
  permitted_operating_modes?: string[];
  permitted_robot_states?: string[];
  max_tcp_speed_mm_s?: number;
  max_force_n?: number;
  max_torque_nm?: number;
  max_power_w?: number;
  min_separation_distance_mm?: number;
  max_com_deviation_mm?: number;
  max_step_height_mm?: number;
  require_estop_functional?: boolean;
  require_protective_stop_armed?: boolean;
  require_ssm_active?: boolean;
  require_pfl_active?: boolean;
  require_collision_detection_active?: boolean;
  require_safety_scanner_active?: boolean;
  require_balance_controller_active?: boolean;
  require_fall_protection_armed?: boolean;
  require_collaborative_mode_when_human_present?: boolean;
  require_teleop_link_healthy?: boolean;
  // Trucking / logistics bounds. Temperature reuses min_reefer_temp_c and
  // max_reefer_temp_c; telemetry freshness can reuse max_telemetry_age_ms where
  // the action is not ELD-specific.
  permitted_logistics_network_id?: string;
  permitted_logistics_facility_ids?: string[];
  permitted_route_ids?: string[];
  permitted_geofence_ids?: string[];
  permitted_carrier_ids?: string[];
  permitted_driver_ids?: string[];
  permitted_cargo_classes?: string[];
  permitted_logistics_hazmat_classes?: string[];
  permitted_trailer_types?: string[];
  permitted_cdl_classes?: string[];
  max_gross_weight_lbs?: number;
  max_cargo_value_usd?: number;
  max_fuel_advance_usd?: number;
  max_accessorial_amount_usd?: number;
  max_fraud_score?: number;
  max_double_broker_risk_score?: number;
  max_eld_event_age_ms?: number;
  max_telematics_age_ms?: number;
  max_route_deviation_km?: number;
  min_remaining_drive_minutes?: number;
  min_remaining_duty_minutes?: number;
  require_driver_qualified?: boolean;
  require_medical_card_valid?: boolean;
  require_carrier_authority_active?: boolean;
  require_carrier_insurance_valid?: boolean;
  require_broker_authority_active?: boolean;
  require_hos_available?: boolean;
  require_eld_fresh?: boolean;
  require_route_permitted?: boolean;
  require_restricted_area_clear?: boolean;
  require_vehicle_maintenance_clear?: boolean;
  require_dvir_clear?: boolean;
  require_trailer_seal_intact?: boolean;
  require_cargo_secured?: boolean;
  require_temperature_in_range?: boolean;
  require_logistics_hazmat_endorsement?: boolean;
  require_customs_clearance?: boolean;
  require_logistics_appointment_valid?: boolean;
  require_dock_available?: boolean;
  require_yard_gate_access?: boolean;
  require_fuel_card_active?: boolean;
  require_logistics_dispatcher_identity?: boolean;
  require_no_double_broker_risk?: boolean;
  // Swarm / disconnected-operation bounds. Reuses many aviation flags (geofence, DAA, C2,
  // Remote ID, airspace authorization, TFR, weather, max_altitude_agl_ft, max_groundspeed_kts,
  // max_wind_speed_kts, min_visibility_sm, max_payload_kg, permitted_flight_states) and
  // operator qualification.
  permitted_swarm_id?: string;
  permitted_mission_classes?: string[];
  min_swarm_size?: number;
  max_swarm_size?: number;
  max_swarm_radius_m?: number;
  min_unit_separation_m?: number;
  max_unit_separation_m?: number;
  min_swarm_battery_soc_pct?: number;
  min_mesh_link_quality?: number;
  max_mesh_hops?: number;
  max_lost_link_seconds?: number;
  max_authority_sync_age_ms?: number;
  require_mesh_relay_healthy?: boolean;
  require_fluidity_token_valid?: boolean;
  require_launch_readiness_approved?: boolean;
  require_recovery_plan_active?: boolean;
  // Balloon / mothership (Part 101) stress case.
  require_balloon_position_monitor_active?: boolean;
  require_balloon_within_envelope?: boolean;
  // Healthcare clinical-operations bounds. Patient identity and PHI context are
  // represented as hashes/flags so evidence can remain useful without carrying raw PHI.
  permitted_healthcare_system_id?: string;
  permitted_healthcare_facility_id?: string;
  permitted_clinical_units?: string[];
  permitted_fhir_resource_types?: string[];
  permitted_order_types?: string[];
  permitted_medication_classes?: string[];
  permitted_healthcare_device_ids?: string[];
  permitted_phi_purposes?: string[];
  max_phi_record_count?: number;
  max_claim_amount_usd?: number;
  max_patient_message_risk_score?: number;
  max_clinical_context_age_ms?: number;
  max_medication_reconciliation_age_ms?: number;
  max_device_telemetry_age_ms?: number;
  require_patient_context?: boolean;
  require_patient_identity_verified?: boolean;
  require_tpo_basis_or_consent?: boolean;
  require_clinician_privilege_active?: boolean;
  require_pharmacist_authority?: boolean;
  require_allergy_checked?: boolean;
  require_no_allergy_conflict?: boolean;
  require_medication_interaction_clear?: boolean;
  require_order_signing_authority?: boolean;
  require_diagnosis_context?: boolean;
  require_device_safety_limits?: boolean;
  require_device_alarm_active?: boolean;
  require_privacy_officer_approval?: boolean;
  require_deidentification_valid?: boolean;
  require_break_glass_attestation?: boolean;
  require_chart_lock_clear?: boolean;
  require_human_review_for_patient_message?: boolean;
  require_claim_attestation?: boolean;
  require_healthcare_audit_context?: boolean;
}

export interface PhysicalInvariantResult {
  ok: boolean;
  reason_codes: ExecutionControlReasonCode[];
  detail: string;
}

export interface CommitGateInput {
  ward?: WardManifest | null;
  authorityEnvelope?: AuthorityEnvelope | null;
  action: CanonicalActionInput;
  runtimeRegister?: RuntimeRegister;
  now?: string;
  /** Active infrastructure-degradation signals; the Ward's criticality decides the fail action. */
  degradedConditions?: DegradationCondition[];
}

export interface CommitGateDecision {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  canonical_action_hash: string;
  policy_version?: string;
  authority_envelope_id?: string;
  runtime_register_snapshot: RuntimeRegister;
  physical_invariant_result?: PhysicalInvariantResult;
}

export interface Warrant {
  warrant_id: string;
  ward_id: string;
  authority_envelope_id: string;
  canonical_action_hash: string;
  subject: string;
  action_type: string;
  decision: "ALLOW";
  issued_at: string;
  expires_at: string;
  single_use: true;
  consumed: boolean;
  /** Per-issuance random nonce, signed into the Warrant material; lets a verifier
   *  detect replay of the Warrant artifact itself (independent of action content). */
  nonce?: string;
  issuer: string;
  /** Base64 Ed25519 signature over the canonical Warrant material. */
  signature: string;
  signature_algorithm: SignatureAlgorithm;
  /** Content-addressed id of the signing key (e.g. ed25519:...). */
  signing_key_id: string;
  /** SPKI PEM of the signing public key, embedded for offline verification. */
  signing_public_key: string;
}

export interface WarrantVerification {
  ok: boolean;
  reason?:
    | "WARRANT_CONSUMED"
    | "WARRANT_EXPIRED"
    | "WARRANT_NOT_YET_VALID"
    | "WARRANT_LIFETIME_EXCEEDED"
    | "WARRANT_REPLAYED"
    | "ACTION_HASH_MISMATCH"
    | "DECISION_NOT_ALLOWED"
    | "SIGNATURE_MISMATCH"
    | "UNTRUSTED_SIGNING_KEY"
    | "REVOKED";
}

/** A seen-nonce set for detecting Warrant-artifact replay (e.g. a Set or a store). */
export interface NonceSeenSet {
  has(nonce: string): boolean;
}

export interface WarrantVerifyOptions {
  /** When set, the Warrant's signing key id must appear in this allowlist. */
  trustedKeyIds?: string[];
  /** When set, the Warrant is rejected if its key/envelope/id is revoked. */
  revocations?: RevocationList;
  /** Trusted-time hardening: reject a Warrant whose issued_at is more than this many
   *  ms in the future relative to `now` (defends against a forward-skewed issuer). Default 60000. */
  maxClockSkewMs?: number;
  /** Verifier-policy ceiling: reject a Warrant whose lifetime (expires_at − issued_at)
   *  exceeds this many ms, regardless of what the issuer signed. Unset = no ceiling. */
  maxLifetimeMs?: number;
  /** When provided, reject a Warrant whose nonce has already been seen (artifact replay). */
  seenNonces?: NonceSeenSet;
}

/** The authenticated operator/principal attributed to a ledger record. */
export interface GelActor {
  subject: string;
  role: OperatorRole;
  auth: AuthMethod;
  /** OIDC issuer (iss), when authenticated via OIDC. */
  issuer?: string;
  /** Static-token label or JWT `kid`. Never the token/secret itself. */
  key_id?: string;
}

export interface GelRecord {
  record_id: string;
  previous_hash: string;
  record_hash: string;
  timestamp: string;
  ward_id: string;
  subject: string;
  canonical_action_hash: string;
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  authority_envelope_id?: string;
  warrant_id?: string;
  policy_version?: string;
  /** Caller/idempotency request id (from the action), surfaced for correlation. */
  request_id?: string;
  /** W3C distributed-trace context, when provided, so evidence joins your traces. */
  trace_context?: TraceContext;
  /** Authenticated operator/principal behind the request (RBAC attribution). Part of the signed hash material. */
  actor?: GelActor;
  runtime_register_snapshot: RuntimeRegister;
  physical_invariant_result?: PhysicalInvariantResult;
  /** Base64 Ed25519 signature over record_hash. Present when a signer is configured. */
  signature?: string;
  signature_algorithm?: SignatureAlgorithm;
  signing_key_id?: string;
  signing_public_key?: string;
}

/** Fields excluded from the hash-chain material (the hash + the signature over it). */
const GEL_NON_MATERIAL_FIELDS = [
  "record_hash",
  "signature",
  "signature_algorithm",
  "signing_key_id",
  "signing_public_key"
] as const;

export interface EvaluateExecutionControlInput extends CommitGateInput {
  ledgerPath: string;
  /** Signer for the issued Warrant. Defaults to a process-stable dev key. */
  signer?: AristotleSigner;
  /** When this file exists, the gate refuses every action (sovereign halt). */
  killSwitchPath?: string;
  /** When true, a previously-admitted identical action is refused as a replay. */
  replayProtection?: boolean;
  /** Path to a revocation list file; revoked keys/envelopes are refused at the gate. */
  revocationListPath?: string;
  /** Optional in-memory ledger index for O(1) append/replay on the server hot path. */
  ledger?: LedgerStore;
  /** Warrant lifetime in seconds (default 60). */
  warrantTtlSeconds?: number;
  /** Authenticated operator attributed to the decision in the GEL. */
  actor?: GelActor;
  /** W3C trace context stamped into the GEL record for correlation. */
  trace_context?: TraceContext;
  /** Optional OpenTelemetry-shaped tracer; emits spans around the decision phases. */
  tracer?: AristotleTracer;
  /** When set, enforces the Authority Envelope's budget (constraints.budget) per subject. */
  budgetGovernor?: BudgetGovernor;
  /** When set, enforces M-of-N approval (constraints.dual_control) for the gravest actions. */
  approvalStore?: ApprovalStore;
}

export interface EvaluateExecutionControlResult {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  canonical_action_hash: string;
  warrant?: Warrant;
  gel_record: GelRecord;
  ledger_verification: { ok: boolean; count: number; failure?: string };
}

export interface EvidenceBundleSignature {
  algorithm: SignatureAlgorithm;
  key_id: string;
  /** SPKI PEM of the attesting key, embedded for offline verification. */
  public_key: string;
  /** Base64 Ed25519 signature over hashes.bundle_hash. */
  value: string;
}

export interface EvidenceBundle {
  bundle_version: "aristotle.execution-evidence.v1";
  exported_at: string;
  ward: WardManifest;
  authority_envelope?: AuthorityEnvelope;
  selected_record: GelRecord;
  ledger_chain: GelRecord[];
  warrant?: Warrant;
  hashes: {
    ward_manifest_hash: string;
    authority_envelope_hash?: string;
    selected_record_hash: string;
    ledger_tip_hash: string;
    bundle_hash: string;
  };
  /** Present when the bundle was exported with a configured signer. */
  bundle_signature?: EvidenceBundleSignature;
  verification: EvidenceBundleVerification;
}

export interface EvidenceBundleVerification {
  ok: boolean;
  failures: string[];
  ledger: { ok: boolean; count: number; failure?: string };
  warrant?: WarrantVerification;
  bundle_hash?: string;
  bundle_signature_ok?: boolean;
}

export interface ExportEvidenceBundleInput {
  ledgerPath: string;
  ward: WardManifest;
  authorityEnvelope?: AuthorityEnvelope;
  recordId?: string;
  warrant?: Warrant;
  exportedAt?: string;
  /** When provided, attaches a bundle-level Ed25519 attestation over bundle_hash. */
  signer?: AristotleSigner;
}

export interface VerifyEvidenceBundleOptions {
  /** When set, both the Warrant and bundle signatures must use a key id in this allowlist. */
  trustedKeyIds?: string[];
  /** When set, a bundle bound to a revoked key/envelope/warrant fails verification. */
  revocations?: RevocationList;
}

export interface ExecutionControlRuntimeServerOptions {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  ledgerPath: string;
  now?: string;
  /** Signer for issued Warrants. Defaults to a process-stable dev key. */
  signer?: AristotleSigner;
  /** When set, enables the credential-brokering proxy route. */
  broker?: CredentialBroker;
  /** When true, serves the no-install playground UI at GET / and /playground. */
  servePlayground?: boolean;
  /** When this file exists, the boundary refuses every action (sovereign halt). */
  killSwitchPath?: string;
  /** When true, identical previously-admitted actions are refused as replays. Defaults to true. */
  replayProtection?: boolean;
  /** When set, /v1 routes require this bearer token / x-api-key (full-access / admin). */
  apiKey?: string;
  /** Role-scoped static bearer tokens (viewer/operator/admin) with operator identities. */
  operators?: OperatorCredential[];
  /** OIDC bearer-token verification; the token `sub` is attributed as the operator. */
  oidc?: OidcConfig;
  /** Path to a revocation list file; revoked keys/envelopes are refused at the gate. */
  revocationListPath?: string;
  /** Path to the Conflict Inbox state file; when unset, an in-memory store is used. */
  conflictInboxPath?: string;
  /** When set, enforces Authority-Envelope budgets (constraints.budget) per subject;
   *  a path makes the spend window durable across restarts, else it is in-memory. */
  budgetStatePath?: string;
  /** Disable budget enforcement entirely (default: enabled with an in-memory window). */
  budgetDisabled?: boolean;
  /** Path to the dual-control approval store; when set, enables M-of-N approval
   *  enforcement (durable across restarts). When unset, an in-memory store is used. */
  approvalStatePath?: string;
  /** Disable dual-control enforcement entirely (default: enabled, in-memory). */
  dualControlDisabled?: boolean;
  /**
   * Degradation detectors run per request; detected conditions feed the per-Ward
   * fail-mode policy. Defaults to a ledger-writability probe when a file ledger path
   * is configured (set to [] to disable; supply your own for control-plane/quorum).
   */
  degradationProbes?: DegradationProbe[];
  /** Warrant lifetime in seconds (default 60). */
  warrantTtlSeconds?: number;
  /** When set, limits requests per subject per minute (429 when exceeded). */
  rateLimitPerMinute?: number;
  /** When "json", emit a structured decision log line per request to stderr. */
  logFormat?: "json";
  /** Pre-built ledger store (e.g. a SQLite-backed one). Defaults to a file store at ledgerPath. */
  ledger?: LedgerStore;
  /** Pre-built async ledger store (e.g. Postgres-backed) for the async evaluate path. */
  asyncLedger?: AsyncLedgerStore;
  /** When set, each decision's signed GEL record is forwarded to this URL (best-effort). */
  auditSink?: string;
  /** Optional OpenTelemetry-shaped tracer; emits spans around each decision. */
  tracer?: AristotleTracer;
}

export interface ExecutionControlRuntimeServer {
  server: Server;
}

export interface ExecutionControlClientOptions {
  endpoint?: string;
  action: CanonicalActionInput;
  runtimeRegister?: RuntimeRegister;
  now?: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const GENESIS_HASH = "GENESIS";

export function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableNormalize(item));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical action cannot contain non-finite numbers");
    return Number(value);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableNormalize(entry)])
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableNormalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeAction(action: CanonicalActionInput): CanonicalAction {
  const canonical_json = stableStringify({
    action_id: action.action_id,
    action_type: action.action_type,
    nonce: action.nonce,
    params: action.params,
    request_id: action.request_id,
    requested_at: action.requested_at,
    subject: action.subject,
    target: action.target,
    telemetry: action.telemetry,
    ward_id: action.ward_id
  });
  return {
    action: JSON.parse(canonical_json) as CanonicalActionInput,
    canonical_json,
    canonical_action_hash: sha256(canonical_json)
  };
}

export function evaluatePhysicalInvariants(action: CanonicalActionInput, bounds?: PhysicalBounds): PhysicalInvariantResult {
  if (!bounds) return { ok: true, reason_codes: [], detail: "no physical bounds declared" };
  if (action.action_type === "drone.disable_geofence") {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "geofence disable is a hard physical interlock violation" };
  }
  if (action.action_type === "vehicle.disable_safety_envelope" || action.action_type === "vehicle.override.mrc") {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard vehicle safety interlock violation` };
  }
  if (action.action_type === "grid.disable_protection" || action.action_type === "relay.protection.disable") {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard grid protection interlock violation` };
  }
  if (action.action_type === "rail.disable_ptc" || action.action_type === "ptc.override.enforcement" || action.action_type === "signal.force_clear" || action.action_type === "switch.force_unlock") {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard rail safety interlock violation` };
  }
  if (
    action.action_type === "pipeline.disable_leak_detection" ||
    action.action_type === "leak_detection.disable" ||
    action.action_type === "pipeline.disable_overpressure_protection" ||
    action.action_type === "pressure.relief.disable" ||
    action.action_type === "pipeline.disable_esd" ||
    action.action_type === "esd.override" ||
    action.action_type === "pipeline.isolation.bypass" ||
    action.action_type === "pump.overpressure_override" ||
    action.action_type === "compressor.safety_shutdown_disable"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard pipeline safety interlock violation` };
  }
  if (
    action.action_type === "mining.disable_proximity_detection" ||
    action.action_type === "proximity_detection.disable" ||
    action.action_type === "mining.disable_gas_monitoring" ||
    action.action_type === "gas_monitoring.disable" ||
    action.action_type === "mining.disable_ventilation" ||
    action.action_type === "ventilation.force_off" ||
    action.action_type === "mining.disable_ground_control_monitoring" ||
    action.action_type === "mining.disable_tailings_monitoring" ||
    action.action_type === "piezometer.disable" ||
    action.action_type === "hoist.disable_overspeed_protection" ||
    action.action_type === "blast.force_initiate"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard mining safety interlock violation` };
  }
  if (
    action.action_type === "port.disable_crane_interlock" ||
    action.action_type === "crane.override_exclusion_zone" ||
    action.action_type === "customs.force_release_hold" ||
    action.action_type === "gate.force_open" ||
    action.action_type === "shore-power.force_energize" ||
    action.action_type === "pnt.override_confidence"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard port safety interlock violation` };
  }
  if (
    action.action_type === "water.disable_disinfection" ||
    action.action_type === "chemical.force_overfeed" ||
    action.action_type === "plc.force_override" ||
    action.action_type === "valve.force_open" ||
    action.action_type === "pump.force_run_dry" ||
    action.action_type === "wastewater.bypass.force_open"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard water safety interlock violation` };
  }
  if (
    action.action_type === "uas.disable_geofence" ||
    action.action_type === "geofence.disable" ||
    action.action_type === "uas.disable_detect_and_avoid" ||
    action.action_type === "daa.disable" ||
    action.action_type === "uas.disable_remote_id" ||
    action.action_type === "remote_id.disable" ||
    action.action_type === "uas.override_airspace_authorization" ||
    action.action_type === "airspace.override" ||
    action.action_type === "uas.disable_return_to_home" ||
    action.action_type === "rtl.disable" ||
    action.action_type === "failsafe.disable" ||
    action.action_type === "uas.override_c2_link_loss_failsafe" ||
    action.action_type === "uas.enter_active_tfr" ||
    action.action_type === "tfr.override" ||
    action.action_type === "evtol.disable_flight_envelope_protection"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard aviation safety interlock violation` };
  }
  if (
    action.action_type === "robot.disable_estop" ||
    action.action_type === "estop.disable" ||
    action.action_type === "emergency_stop.disable" ||
    action.action_type === "robot.disable_protective_stop" ||
    action.action_type === "protective_stop.disable" ||
    action.action_type === "robot.override_speed_separation_monitoring" ||
    action.action_type === "ssm.override" ||
    action.action_type === "robot.override_power_force_limiting" ||
    action.action_type === "pfl.override" ||
    action.action_type === "robot.disable_collision_detection" ||
    action.action_type === "collision_detection.disable" ||
    action.action_type === "robot.disable_safety_scanner" ||
    action.action_type === "safety_scanner.disable" ||
    action.action_type === "robot.override_safety_zone" ||
    action.action_type === "safety_zone.override" ||
    action.action_type === "humanoid.disable_balance_controller" ||
    action.action_type === "balance.override" ||
    action.action_type === "humanoid.disable_fall_protection"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard robotics safety interlock violation` };
  }
  if (
    action.action_type === "logistics.dispatch_over_hos" ||
    action.action_type === "eld.disable" ||
    action.action_type === "carrier.vetting.override" ||
    action.action_type === "driver.qualification.override" ||
    action.action_type === "hazmat.route.override" ||
    action.action_type === "coldchain.temp_alarm.override" ||
    action.action_type === "pod.force_accept" ||
    action.action_type === "payment.force_release" ||
    action.action_type === "fuel.unbounded_advance" ||
    action.action_type === "yard.force_gate_open" ||
    action.action_type === "load.double_broker.override" ||
    action.action_type === "telematics.spoof_override"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard logistics safety and fraud interlock violation` };
  }
  if (
    action.action_type === "swarm.disable_mesh" ||
    action.action_type === "mesh.disable" ||
    action.action_type === "swarm.disable_revocation_propagation" ||
    action.action_type === "mesh.revocation.disable" ||
    action.action_type === "swarm.override_lost_link_failsafe" ||
    action.action_type === "lost_link_failsafe.override" ||
    action.action_type === "swarm.bypass_launch_readiness" ||
    action.action_type === "launch_readiness.bypass" ||
    action.action_type === "swarm.override_fluidity_token" ||
    action.action_type === "fluidity_token.override" ||
    action.action_type === "swarm.disable_evidence_ledger" ||
    action.action_type === "swarm.force_payload_release_without_authorization" ||
    action.action_type === "balloon.disable_position_monitor" ||
    action.action_type === "balloon.override_envelope_protection"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard swarm safety interlock violation` };
  }
  if (
    action.action_type === "medication.override_allergy" ||
    action.action_type === "pharmacy.force_dispense_controlled_substance" ||
    action.action_type === "device.disable_alarm" ||
    action.action_type === "device.disable_safety_limit" ||
    action.action_type === "ehr.delete_patient_record" ||
    action.action_type === "phi.export_without_consent" ||
    action.action_type === "claims.force_submit_without_attestation" ||
    action.action_type === "research.export_identified_dataset" ||
    action.action_type === "order.force_without_clinician_authority" ||
    action.action_type === "ehr.modify_record_without_patient_context"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${action.action_type} is a hard healthcare clinical safety and privacy interlock violation` };
  }
  const altitude = numericParam(action, "altitude_m");
  if (bounds.max_altitude_m !== undefined && altitude !== undefined && altitude > bounds.max_altitude_m) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `altitude_m ${altitude} exceeds max_altitude_m ${bounds.max_altitude_m}` };
  }
  const boundary = stringParam(action, "boundary_id");
  if (bounds.permitted_boundary_id && boundary && boundary !== bounds.permitted_boundary_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `boundary_id ${boundary} does not match ${bounds.permitted_boundary_id}` };
  }
  const battery = numericParam(action, "battery_pct");
  if (bounds.battery_minimum_pct !== undefined && battery !== undefined && battery < bounds.battery_minimum_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `battery_pct ${battery} below minimum ${bounds.battery_minimum_pct}` };
  }
  const speed = numericParam(action, "speed_mps");
  if (bounds.max_speed_mps !== undefined && speed !== undefined && speed > bounds.max_speed_mps) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `speed_mps ${speed} exceeds max_speed_mps ${bounds.max_speed_mps}` };
  }
  const odd = stringParam(action, "odd_id");
  if (bounds.permitted_odd_id && odd && odd !== bounds.permitted_odd_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `odd_id ${odd} does not match ${bounds.permitted_odd_id}` };
  }
  const roadClass = stringParam(action, "road_class");
  if (bounds.permitted_road_classes?.length && roadClass && !bounds.permitted_road_classes.includes(roadClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `road_class ${roadClass} is outside permitted road classes` };
  }
  const mapConfidence = numericParam(action, "map_confidence");
  if (bounds.min_map_confidence !== undefined && mapConfidence !== undefined && mapConfidence < bounds.min_map_confidence) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `map_confidence ${mapConfidence} below minimum ${bounds.min_map_confidence}` };
  }
  const localizationConfidence = numericParam(action, "localization_confidence");
  if (bounds.min_localization_confidence !== undefined && localizationConfidence !== undefined && localizationConfidence < bounds.min_localization_confidence) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `localization_confidence ${localizationConfidence} below minimum ${bounds.min_localization_confidence}` };
  }
  const perceptionConfidence = numericParam(action, "perception_confidence");
  if (bounds.min_perception_confidence !== undefined && perceptionConfidence !== undefined && perceptionConfidence < bounds.min_perception_confidence) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `perception_confidence ${perceptionConfidence} below minimum ${bounds.min_perception_confidence}` };
  }
  const mrcAvailable = booleanParam(action, "mrc_available");
  if (bounds.require_mrc_available && mrcAvailable !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "minimum-risk-condition capability is required but unavailable" };
  }
  const driveState = stringParam(action, "drive_state");
  if (bounds.permitted_drive_states?.length && driveState && !bounds.permitted_drive_states.includes(driveState)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `drive_state ${driveState} is outside permitted drive states` };
  }
  const voltage = numericParam(action, "voltage_kv");
  if (bounds.min_voltage_kv !== undefined && voltage !== undefined && voltage < bounds.min_voltage_kv) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `voltage_kv ${voltage} below min_voltage_kv ${bounds.min_voltage_kv}` };
  }
  if (bounds.max_voltage_kv !== undefined && voltage !== undefined && voltage > bounds.max_voltage_kv) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `voltage_kv ${voltage} exceeds max_voltage_kv ${bounds.max_voltage_kv}` };
  }
  const frequency = numericParam(action, "frequency_hz");
  if (bounds.min_frequency_hz !== undefined && frequency !== undefined && frequency < bounds.min_frequency_hz) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `frequency_hz ${frequency} below min_frequency_hz ${bounds.min_frequency_hz}` };
  }
  if (bounds.max_frequency_hz !== undefined && frequency !== undefined && frequency > bounds.max_frequency_hz) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `frequency_hz ${frequency} exceeds max_frequency_hz ${bounds.max_frequency_hz}` };
  }
  const feederLoad = numericParam(action, "feeder_load_pct");
  if (bounds.max_feeder_load_pct !== undefined && feederLoad !== undefined && feederLoad > bounds.max_feeder_load_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `feeder_load_pct ${feederLoad} exceeds max_feeder_load_pct ${bounds.max_feeder_load_pct}` };
  }
  const transformerLoad = numericParam(action, "transformer_load_pct");
  if (bounds.max_transformer_load_pct !== undefined && transformerLoad !== undefined && transformerLoad > bounds.max_transformer_load_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `transformer_load_pct ${transformerLoad} exceeds max_transformer_load_pct ${bounds.max_transformer_load_pct}` };
  }
  const derExport = numericParam(action, "der_export_mw");
  if (bounds.max_der_export_mw !== undefined && derExport !== undefined && derExport > bounds.max_der_export_mw) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `der_export_mw ${derExport} exceeds max_der_export_mw ${bounds.max_der_export_mw}` };
  }
  const telemetryAge = numericParam(action, "telemetry_age_ms");
  if (bounds.max_telemetry_age_ms !== undefined && telemetryAge !== undefined && telemetryAge > bounds.max_telemetry_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `telemetry_age_ms ${telemetryAge} exceeds max_telemetry_age_ms ${bounds.max_telemetry_age_ms}` };
  }
  const topologyModel = stringParam(action, "topology_model_id");
  if (bounds.permitted_topology_model_id && topologyModel && topologyModel !== bounds.permitted_topology_model_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `topology_model_id ${topologyModel} does not match ${bounds.permitted_topology_model_id}` };
  }
  const voltageClass = stringParam(action, "voltage_class");
  if (bounds.permitted_voltage_classes?.length && voltageClass && !bounds.permitted_voltage_classes.includes(voltageClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `voltage_class ${voltageClass} is outside permitted voltage classes` };
  }
  const assetType = stringParam(action, "asset_type");
  if (bounds.permitted_asset_types?.length && assetType && !bounds.permitted_asset_types.includes(assetType)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `asset_type ${assetType} is outside permitted asset types` };
  }
  const gridState = stringParam(action, "grid_state");
  if (bounds.permitted_grid_states?.length && gridState && !bounds.permitted_grid_states.includes(gridState)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `grid_state ${gridState} is outside permitted grid states` };
  }
  if (bounds.require_switching_order && !stringParam(action, "switching_order_id")) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "switching_order_id is required for this grid Ward" };
  }
  if (bounds.require_clearance_released && booleanParam(action, "crew_clearance_released") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "crew clearance must be released before this grid action" };
  }
  if (bounds.require_protection_known && booleanParam(action, "protection_state_known") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "protection state must be known before this grid action" };
  }
  if (bounds.require_scada_fresh && booleanParam(action, "scada_fresh") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "fresh SCADA telemetry is required before this grid action" };
  }
  if (bounds.require_manual_fallback_ready && booleanParam(action, "manual_fallback_ready") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "manual fallback readiness is required before this grid action" };
  }
  const territory = stringParam(action, "territory_id");
  if (bounds.permitted_territory_id && territory && territory !== bounds.permitted_territory_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `territory_id ${territory} does not match ${bounds.permitted_territory_id}` };
  }
  const routeClass = stringParam(action, "route_class");
  if (bounds.permitted_route_classes?.length && routeClass && !bounds.permitted_route_classes.includes(routeClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `route_class ${routeClass} is outside permitted route classes` };
  }
  const trackClass = stringParam(action, "track_class");
  if (bounds.permitted_track_classes?.length && trackClass && !bounds.permitted_track_classes.includes(trackClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `track_class ${trackClass} is outside permitted track classes` };
  }
  const signalAspect = stringParam(action, "signal_aspect");
  if (bounds.permitted_signal_aspects?.length && signalAspect && !bounds.permitted_signal_aspects.includes(signalAspect)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `signal_aspect ${signalAspect} is outside permitted signal aspects` };
  }
  const trainType = stringParam(action, "train_type");
  if (bounds.permitted_train_types?.length && trainType && !bounds.permitted_train_types.includes(trainType)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `train_type ${trainType} is outside permitted train types` };
  }
  const operatingState = stringParam(action, "operating_state");
  if (bounds.permitted_operating_states?.length && operatingState && !bounds.permitted_operating_states.includes(operatingState)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `operating_state ${operatingState} is outside permitted operating states` };
  }
  const railSpeed = numericParam(action, "authority_speed_mph") ?? numericParam(action, "speed_mph") ?? numericParam(action, "max_speed_mph");
  if (bounds.max_authority_speed_mph !== undefined && railSpeed !== undefined && railSpeed > bounds.max_authority_speed_mph) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `authority speed ${railSpeed} mph exceeds max_authority_speed_mph ${bounds.max_authority_speed_mph}` };
  }
  const separation = numericParam(action, "train_separation_m");
  if (bounds.min_train_separation_m !== undefined && separation !== undefined && separation < bounds.min_train_separation_m) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `train_separation_m ${separation} below min_train_separation_m ${bounds.min_train_separation_m}` };
  }
  const trainLength = numericParam(action, "train_length_ft");
  if (bounds.max_train_length_ft !== undefined && trainLength !== undefined && trainLength > bounds.max_train_length_ft) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `train_length_ft ${trainLength} exceeds max_train_length_ft ${bounds.max_train_length_ft}` };
  }
  const trainTonnage = numericParam(action, "train_tonnage");
  if (bounds.max_train_tonnage !== undefined && trainTonnage !== undefined && trainTonnage > bounds.max_train_tonnage) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `train_tonnage ${trainTonnage} exceeds max_train_tonnage ${bounds.max_train_tonnage}` };
  }
  const ptcAge = numericParam(action, "ptc_telemetry_age_ms");
  if (bounds.max_ptc_telemetry_age_ms !== undefined && ptcAge !== undefined && ptcAge > bounds.max_ptc_telemetry_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `ptc_telemetry_age_ms ${ptcAge} exceeds max_ptc_telemetry_age_ms ${bounds.max_ptc_telemetry_age_ms}` };
  }
  if (bounds.require_ptc_active && booleanParam(action, "ptc_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "PTC must be active before this rail action" };
  }
  if (bounds.require_switch_proven && booleanParam(action, "switch_position_proven") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "switch position must be proven before this rail action" };
  }
  if (bounds.require_signal_not_stop && signalAspect === "stop") {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "signal aspect stop cannot admit this rail action" };
  }
  if (bounds.require_work_zone_released && booleanParam(action, "work_zone_released") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "work zone must be released before this rail action" };
  }
  if (bounds.require_track_bulletin_ack && booleanParam(action, "track_bulletin_ack") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "track bulletin must be acknowledged before this rail action" };
  }
  if (bounds.require_dispatcher_identity && !stringParam(action, "dispatcher_id")) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "dispatcher identity is required before this rail action" };
  }
  if (bounds.require_brake_test_current && booleanParam(action, "brake_test_current") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "brake test must be current before this rail action" };
  }
  if (bounds.require_consist_verified && !stringParam(action, "consist_hash")) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "verified consist hash is required before this rail action" };
  }
  if (bounds.require_grade_crossing_protected && booleanParam(action, "grade_crossing_protected") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "grade crossing protection must be proven before this rail action" };
  }
  if (bounds.require_crew_acknowledged && booleanParam(action, "crew_acknowledged") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "crew acknowledgement is required before this rail action" };
  }
  if (bounds.require_no_conflicting_authority && booleanParam(action, "conflicting_authority_present") === true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "conflicting movement authority is present" };
  }
  // -- pipeline (oil & gas / energy) invariants --------------------------------
  const segmentId = stringParam(action, "segment_id");
  if (bounds.permitted_segment_id && segmentId && segmentId !== bounds.permitted_segment_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `segment_id ${segmentId} does not match ${bounds.permitted_segment_id}` };
  }
  const systemModelId = stringParam(action, "system_model_id");
  if (bounds.permitted_system_model_id && systemModelId && systemModelId !== bounds.permitted_system_model_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `system_model_id ${systemModelId} does not match ${bounds.permitted_system_model_id}` };
  }
  const pipelineState = stringParam(action, "pipeline_state");
  if (bounds.permitted_pipeline_states?.length && pipelineState && !bounds.permitted_pipeline_states.includes(pipelineState)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `pipeline_state ${pipelineState} is outside permitted pipeline states` };
  }
  const pressurePsig = numericParam(action, "pressure_psig");
  const setpointPsig = numericParam(action, "setpoint_psig");
  const effectivePressure = setpointPsig ?? pressurePsig;
  if (bounds.max_pressure_psig !== undefined && effectivePressure !== undefined && effectivePressure > bounds.max_pressure_psig) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `pressure ${effectivePressure} psig exceeds max_pressure_psig ${bounds.max_pressure_psig} (MAOP)` };
  }
  if (bounds.min_pressure_psig !== undefined && pressurePsig !== undefined && pressurePsig < bounds.min_pressure_psig) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `pressure ${pressurePsig} psig below min_pressure_psig ${bounds.min_pressure_psig}` };
  }
  const pressurePctMaop = numericParam(action, "pressure_pct_maop");
  if (bounds.max_pressure_pct_maop !== undefined && pressurePctMaop !== undefined && pressurePctMaop > bounds.max_pressure_pct_maop) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `pressure ${pressurePctMaop}% of MAOP exceeds max_pressure_pct_maop ${bounds.max_pressure_pct_maop}` };
  }
  const flowBpd = numericParam(action, "flow_bbl_per_day");
  if (bounds.max_flow_bbl_per_day !== undefined && flowBpd !== undefined && flowBpd > bounds.max_flow_bbl_per_day) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `flow_bbl_per_day ${flowBpd} exceeds max_flow_bbl_per_day ${bounds.max_flow_bbl_per_day}` };
  }
  const flowMmscfd = numericParam(action, "flow_mmscfd");
  if (bounds.max_flow_mmscfd !== undefined && flowMmscfd !== undefined && flowMmscfd > bounds.max_flow_mmscfd) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `flow_mmscfd ${flowMmscfd} exceeds max_flow_mmscfd ${bounds.max_flow_mmscfd}` };
  }
  if (bounds.require_leak_detection_armed && booleanParam(action, "leak_detection_armed") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "leak detection (CPM) must be armed before this pipeline action" };
  }
  if (bounds.require_overpressure_protection && booleanParam(action, "overpressure_protection_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "overpressure protection must be active before this pipeline action" };
  }
  if (bounds.require_esd_ready && booleanParam(action, "esd_ready") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "emergency shutdown (ESD) readiness is required before this pipeline action" };
  }
  if (bounds.require_segment_isolation_ready && booleanParam(action, "segment_isolation_ready") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "segment isolation readiness is required before this pipeline action" };
  }
  if (bounds.require_pump_primed && booleanParam(action, "pump_primed") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "pump priming is required before this pipeline action" };
  }
  if (bounds.require_pipeline_scada_fresh && booleanParam(action, "pipeline_scada_fresh") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "fresh SCADA telemetry (control room management) is required before this pipeline action" };
  }
  if (bounds.require_operator_qualified && booleanParam(action, "operator_qualified") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "operator qualification is required before this action" };
  }
  // -- mining (surface / underground / tailings) invariants --------------------
  const mineSiteId = stringParam(action, "site_id");
  if (bounds.permitted_mine_site_id && mineSiteId && mineSiteId !== bounds.permitted_mine_site_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `site_id ${mineSiteId} does not match ${bounds.permitted_mine_site_id}` };
  }
  const mineZoneId = stringParam(action, "zone_id");
  if (bounds.permitted_mine_zones?.length && mineZoneId && !bounds.permitted_mine_zones.includes(mineZoneId)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `zone_id ${mineZoneId} is outside permitted mine zones` };
  }
  const mineState = stringParam(action, "mine_state");
  if (bounds.permitted_mine_states?.length && mineState && !bounds.permitted_mine_states.includes(mineState)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `mine_state ${mineState} is outside permitted mine states` };
  }
  const methane = numericParam(action, "methane_pct");
  if (bounds.max_methane_pct !== undefined && methane !== undefined && methane > bounds.max_methane_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `methane_pct ${methane} exceeds max_methane_pct ${bounds.max_methane_pct}` };
  }
  const co = numericParam(action, "co_ppm");
  if (bounds.max_co_ppm !== undefined && co !== undefined && co > bounds.max_co_ppm) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `co_ppm ${co} exceeds max_co_ppm ${bounds.max_co_ppm}` };
  }
  const oxygen = numericParam(action, "oxygen_pct");
  if (bounds.min_oxygen_pct !== undefined && oxygen !== undefined && oxygen < bounds.min_oxygen_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `oxygen_pct ${oxygen} below min_oxygen_pct ${bounds.min_oxygen_pct}` };
  }
  const airflow = numericParam(action, "airflow_cfm");
  if (bounds.min_airflow_cfm !== undefined && airflow !== undefined && airflow < bounds.min_airflow_cfm) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `airflow_cfm ${airflow} below min_airflow_cfm ${bounds.min_airflow_cfm}` };
  }
  const haulSpeed = numericParam(action, "speed_kph");
  if (bounds.max_haulage_speed_kph !== undefined && haulSpeed !== undefined && haulSpeed > bounds.max_haulage_speed_kph) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `speed_kph ${haulSpeed} exceeds max_haulage_speed_kph ${bounds.max_haulage_speed_kph}` };
  }
  const pondLevel = numericParam(action, "tailings_pond_level_m");
  if (bounds.max_tailings_pond_level_m !== undefined && pondLevel !== undefined && pondLevel > bounds.max_tailings_pond_level_m) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `tailings_pond_level_m ${pondLevel} exceeds max_tailings_pond_level_m ${bounds.max_tailings_pond_level_m}` };
  }
  const freeboard = numericParam(action, "tailings_freeboard_m");
  if (bounds.min_tailings_freeboard_m !== undefined && freeboard !== undefined && freeboard < bounds.min_tailings_freeboard_m) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `tailings_freeboard_m ${freeboard} below min_tailings_freeboard_m ${bounds.min_tailings_freeboard_m}` };
  }
  const hoistLoad = numericParam(action, "hoist_load_kg");
  if (bounds.max_hoist_load_kg !== undefined && hoistLoad !== undefined && hoistLoad > bounds.max_hoist_load_kg) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `hoist_load_kg ${hoistLoad} exceeds max_hoist_load_kg ${bounds.max_hoist_load_kg}` };
  }
  if (bounds.require_proximity_detection && booleanParam(action, "proximity_detection_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "proximity detection must be active before this mining action" };
  }
  if (bounds.require_exclusion_zone_clear && booleanParam(action, "exclusion_zone_clear") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "exclusion zone must be clear before this mining action" };
  }
  if (bounds.require_personnel_cleared && booleanParam(action, "personnel_cleared") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "personnel must be cleared before this mining action" };
  }
  if (bounds.require_ground_control_stable && booleanParam(action, "ground_control_stable") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "ground control must be stable before this mining action" };
  }
  if (bounds.require_gas_monitoring && booleanParam(action, "gas_monitoring_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "gas monitoring must be active before this mining action" };
  }
  if (bounds.require_ventilation_on && booleanParam(action, "ventilation_on") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "ventilation must be on before this mining action" };
  }
  if (bounds.require_piezometer_monitoring && booleanParam(action, "piezometer_monitoring_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "tailings piezometer monitoring must be active before this mining action" };
  }
  if (bounds.require_overspeed_protection && booleanParam(action, "overspeed_protection_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "hoist overspeed protection must be active before this mining action" };
  }
  if (bounds.require_mining_scada_fresh && booleanParam(action, "mining_scada_fresh") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "fresh SCADA telemetry is required before this mining action" };
  }
  const portId = stringParam(action, "port_id");
  if (bounds.permitted_port_id && portId && portId !== bounds.permitted_port_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `port_id ${portId} does not match ${bounds.permitted_port_id}` };
  }
  const terminalId = stringParam(action, "terminal_id");
  if (bounds.permitted_terminal_id && terminalId && terminalId !== bounds.permitted_terminal_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `terminal_id ${terminalId} does not match ${bounds.permitted_terminal_id}` };
  }
  const berthId = stringParam(action, "berth_id");
  if (bounds.permitted_berth_ids?.length && berthId && !bounds.permitted_berth_ids.includes(berthId)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `berth_id ${berthId} is outside permitted berths` };
  }
  const yardBlock = stringParam(action, "yard_block_id") ?? stringParam(action, "to_block") ?? stringParam(action, "from_block");
  if (bounds.permitted_yard_blocks?.length && yardBlock && !bounds.permitted_yard_blocks.includes(yardBlock)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `yard block ${yardBlock} is outside permitted yard blocks` };
  }
  const gateId = stringParam(action, "gate_id");
  if (bounds.permitted_gate_ids?.length && gateId && !bounds.permitted_gate_ids.includes(gateId)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `gate_id ${gateId} is outside permitted gates` };
  }
  const cargoType = stringParam(action, "cargo_type");
  if (bounds.permitted_cargo_types?.length && cargoType && !bounds.permitted_cargo_types.includes(cargoType)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `cargo_type ${cargoType} is outside permitted cargo types` };
  }
  const hazmatClass = stringParam(action, "hazmat_class");
  if (bounds.permitted_hazmat_classes?.length && hazmatClass && !bounds.permitted_hazmat_classes.includes(hazmatClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `hazmat_class ${hazmatClass} is outside permitted hazmat classes` };
  }
  const terminalZone = stringParam(action, "terminal_network_zone");
  if (bounds.permitted_terminal_zones?.length && terminalZone && !bounds.permitted_terminal_zones.includes(terminalZone)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `terminal_network_zone ${terminalZone} is outside permitted zones` };
  }
  const containerWeight = numericParam(action, "container_weight_kg");
  if (bounds.max_container_weight_kg !== undefined && containerWeight !== undefined && containerWeight > bounds.max_container_weight_kg) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `container_weight_kg ${containerWeight} exceeds max_container_weight_kg ${bounds.max_container_weight_kg}` };
  }
  const pntConfidence = numericParam(action, "pnt_confidence");
  if (bounds.min_pnt_confidence !== undefined && pntConfidence !== undefined && pntConfidence < bounds.min_pnt_confidence) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `pnt_confidence ${pntConfidence} below minimum ${bounds.min_pnt_confidence}` };
  }
  const aisAge = numericParam(action, "ais_track_age_ms");
  if (bounds.max_ais_track_age_ms !== undefined && aisAge !== undefined && aisAge > bounds.max_ais_track_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `ais_track_age_ms ${aisAge} exceeds max_ais_track_age_ms ${bounds.max_ais_track_age_ms}` };
  }
  const portTelemetryAge = numericParam(action, "ot_telemetry_age_ms");
  if (bounds.max_port_telemetry_age_ms !== undefined && portTelemetryAge !== undefined && portTelemetryAge > bounds.max_port_telemetry_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `ot_telemetry_age_ms ${portTelemetryAge} exceeds max_port_telemetry_age_ms ${bounds.max_port_telemetry_age_ms}` };
  }
  const windSpeed = numericParam(action, "wind_speed_kn");
  if (bounds.max_wind_speed_kn !== undefined && windSpeed !== undefined && windSpeed > bounds.max_wind_speed_kn) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `wind_speed_kn ${windSpeed} exceeds max_wind_speed_kn ${bounds.max_wind_speed_kn}` };
  }
  const reeferTemp = numericParam(action, "reefer_temperature_c") ?? numericParam(action, "reefer_setpoint_c");
  if (bounds.min_reefer_temp_c !== undefined && reeferTemp !== undefined && reeferTemp < bounds.min_reefer_temp_c) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `reefer temperature ${reeferTemp} below min_reefer_temp_c ${bounds.min_reefer_temp_c}` };
  }
  if (bounds.max_reefer_temp_c !== undefined && reeferTemp !== undefined && reeferTemp > bounds.max_reefer_temp_c) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `reefer temperature ${reeferTemp} exceeds max_reefer_temp_c ${bounds.max_reefer_temp_c}` };
  }
  if (bounds.require_customs_release && booleanParam(action, "customs_hold") === true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "customs hold must be released before this port action" };
  }
  if (bounds.require_no_security_hold && booleanParam(action, "security_hold") === true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "security hold must be released before this port action" };
  }
  if (bounds.require_no_inspection_hold && booleanParam(action, "inspection_hold") === true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "inspection hold must be released before this port action" };
  }
  if (bounds.require_vgm_verified && booleanParam(action, "vgm_verified") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "verified gross mass is required before this port action" };
  }
  if (bounds.require_crane_exclusion_clear && booleanParam(action, "crane_exclusion_zone_clear") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "crane exclusion zone must be clear before this port action" };
  }
  if (bounds.require_spreader_safe && booleanParam(action, "spreader_locked") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "spreader/twistlock state must be safe before this port action" };
  }
  if (bounds.require_berth_clear && booleanParam(action, "berth_conflict_present") === true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "berth conflict is present" };
  }
  if (bounds.require_tide_window_open && booleanParam(action, "tide_window_open") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "tide/weather window must be open before this port action" };
  }
  if (bounds.require_vessel_clearance && booleanParam(action, "vessel_clearance_granted") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "vessel clearance is required before this port action" };
  }
  if (bounds.require_truck_appointment && booleanParam(action, "truck_appointment_valid") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "valid truck appointment is required before this port action" };
  }
  if (bounds.require_driver_identity && booleanParam(action, "driver_identity_verified") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "driver identity must be verified before this port action" };
  }
  if (bounds.require_cold_chain_valid && booleanParam(action, "cold_chain_valid") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "cold-chain validity is required before this port action" };
  }
  if (bounds.require_shore_power_lockout && booleanParam(action, "shore_power_lockout_released") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "shore-power lockout release is required before this port action" };
  }
  if (bounds.require_shore_power_isolated && booleanParam(action, "shore_power_isolated") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "shore-power isolation state must be proven before this port action" };
  }
  if (bounds.require_fire_watch_ready && booleanParam(action, "fire_watch_ready") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "fire watch readiness is required before this port action" };
  }
  if (bounds.require_hazmat_route_approved && booleanParam(action, "hazmat_route_approved") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "hazmat route approval is required before this port action" };
  }
  if (bounds.require_gate_access_granted && booleanParam(action, "gate_access_granted") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "gate access must be granted before this port action" };
  }
  if (bounds.require_operator_identity && !stringParam(action, "operator_id")) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "operator identity is required before this port action" };
  }
  if (bounds.require_no_vendor_remote_session && booleanParam(action, "vendor_remote_session") === true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "vendor remote session must not be active during this port action" };
  }
  const waterSystemId = stringParam(action, "water_system_id");
  if (bounds.permitted_water_system_id && waterSystemId && waterSystemId !== bounds.permitted_water_system_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `water_system_id ${waterSystemId} does not match ${bounds.permitted_water_system_id}` };
  }
  const facilityId = stringParam(action, "facility_id");
  if (bounds.permitted_facility_id && facilityId && facilityId !== bounds.permitted_facility_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `facility_id ${facilityId} does not match ${bounds.permitted_facility_id}` };
  }
  const pressureZone = stringParam(action, "pressure_zone_id");
  if (bounds.permitted_pressure_zones?.length && pressureZone && !bounds.permitted_pressure_zones.includes(pressureZone)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `pressure_zone_id ${pressureZone} is outside permitted pressure zones` };
  }
  const processArea = stringParam(action, "process_area");
  if (bounds.permitted_process_areas?.length && processArea && !bounds.permitted_process_areas.includes(processArea)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `process_area ${processArea} is outside permitted process areas` };
  }
  const waterAssetType = stringParam(action, "asset_type");
  if (bounds.permitted_water_asset_types?.length && waterAssetType && !bounds.permitted_water_asset_types.includes(waterAssetType)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `asset_type ${waterAssetType} is outside permitted water asset types` };
  }
  const dischargePermitId = stringParam(action, "discharge_permit_id");
  if (bounds.permitted_discharge_permit_ids?.length && dischargePermitId && !bounds.permitted_discharge_permit_ids.includes(dischargePermitId)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `discharge_permit_id ${dischargePermitId} is outside permitted discharge permits` };
  }
  const chlorineDose = numericParam(action, "chlorine_dose_mg_l") ?? numericParam(action, "dose_mg_l");
  if (bounds.max_chlorine_dose_mg_l !== undefined && chlorineDose !== undefined && chlorineDose > bounds.max_chlorine_dose_mg_l) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `chlorine dose ${chlorineDose} exceeds max_chlorine_dose_mg_l ${bounds.max_chlorine_dose_mg_l}` };
  }
  const chlorineResidual = numericParam(action, "chlorine_residual_mg_l");
  if (bounds.min_chlorine_residual_mg_l !== undefined && chlorineResidual !== undefined && chlorineResidual < bounds.min_chlorine_residual_mg_l) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `chlorine_residual_mg_l ${chlorineResidual} below minimum ${bounds.min_chlorine_residual_mg_l}` };
  }
  const waterPressure = numericParam(action, "pressure_psi");
  if (bounds.min_pressure_psi !== undefined && waterPressure !== undefined && waterPressure < bounds.min_pressure_psi) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `pressure_psi ${waterPressure} below min_pressure_psi ${bounds.min_pressure_psi}` };
  }
  if (bounds.max_pressure_psi !== undefined && waterPressure !== undefined && waterPressure > bounds.max_pressure_psi) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `pressure_psi ${waterPressure} exceeds max_pressure_psi ${bounds.max_pressure_psi}` };
  }
  const tankLevel = numericParam(action, "tank_level_pct");
  if (bounds.min_tank_level_pct !== undefined && tankLevel !== undefined && tankLevel < bounds.min_tank_level_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `tank_level_pct ${tankLevel} below min_tank_level_pct ${bounds.min_tank_level_pct}` };
  }
  if (bounds.max_tank_level_pct !== undefined && tankLevel !== undefined && tankLevel > bounds.max_tank_level_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `tank_level_pct ${tankLevel} exceeds max_tank_level_pct ${bounds.max_tank_level_pct}` };
  }
  const wetwellLevel = numericParam(action, "wetwell_level_pct");
  if (bounds.max_wetwell_level_pct !== undefined && wetwellLevel !== undefined && wetwellLevel > bounds.max_wetwell_level_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `wetwell_level_pct ${wetwellLevel} exceeds max_wetwell_level_pct ${bounds.max_wetwell_level_pct}` };
  }
  const turbidity = numericParam(action, "turbidity_ntu");
  if (bounds.max_turbidity_ntu !== undefined && turbidity !== undefined && turbidity > bounds.max_turbidity_ntu) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `turbidity_ntu ${turbidity} exceeds max_turbidity_ntu ${bounds.max_turbidity_ntu}` };
  }
  const waterPh = numericParam(action, "ph");
  if (bounds.min_ph !== undefined && waterPh !== undefined && waterPh < bounds.min_ph) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `ph ${waterPh} below min_ph ${bounds.min_ph}` };
  }
  if (bounds.max_ph !== undefined && waterPh !== undefined && waterPh > bounds.max_ph) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `ph ${waterPh} exceeds max_ph ${bounds.max_ph}` };
  }
  const sensorAge = numericParam(action, "sensor_age_ms");
  if (bounds.max_sensor_age_ms !== undefined && sensorAge !== undefined && sensorAge > bounds.max_sensor_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `sensor_age_ms ${sensorAge} exceeds max_sensor_age_ms ${bounds.max_sensor_age_ms}` };
  }
  const labSampleAge = numericParam(action, "lab_sample_age_min");
  if (bounds.max_lab_sample_age_min !== undefined && labSampleAge !== undefined && labSampleAge > bounds.max_lab_sample_age_min) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `lab_sample_age_min ${labSampleAge} exceeds max_lab_sample_age_min ${bounds.max_lab_sample_age_min}` };
  }
  const waterFlow = numericParam(action, "flow_mgd");
  if (bounds.max_flow_mgd !== undefined && waterFlow !== undefined && waterFlow > bounds.max_flow_mgd) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `flow_mgd ${waterFlow} exceeds max_flow_mgd ${bounds.max_flow_mgd}` };
  }
  const uvIntensity = numericParam(action, "uv_intensity_pct");
  if (bounds.min_uv_intensity_pct !== undefined && uvIntensity !== undefined && uvIntensity < bounds.min_uv_intensity_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `uv_intensity_pct ${uvIntensity} below min_uv_intensity_pct ${bounds.min_uv_intensity_pct}` };
  }
  if (bounds.require_water_scada_fresh && booleanParam(action, "scada_fresh") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "fresh SCADA telemetry is required before this water action" };
  }
  if (bounds.require_backflow_clear && booleanParam(action, "backflow_risk_clear") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "backflow risk must be clear before this water action" };
  }
  if (bounds.require_disinfection_active && booleanParam(action, "disinfection_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "disinfection must be active before this water action" };
  }
  if (bounds.require_chemical_inventory_ok && booleanParam(action, "chemical_inventory_ok") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "chemical inventory must be verified before this water action" };
  }
  if (bounds.require_pump_available && booleanParam(action, "pump_available") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "pump availability is required before this water action" };
  }
  if (bounds.require_valve_interlock_clear && booleanParam(action, "valve_interlock_clear") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "valve interlock must be clear before this water action" };
  }
  if (bounds.require_discharge_permit_window && booleanParam(action, "discharge_permit_window_open") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "discharge permit window must be open before this water action" };
  }
  if (bounds.require_no_bypass_active && booleanParam(action, "bypass_active") === true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "active bypass prevents this water action" };
  }
  // -- aviation / UAV / eVTOL invariants ---------------------------------------
  const airspaceId = stringParam(action, "airspace_id");
  if (bounds.permitted_airspace_id && airspaceId && airspaceId !== bounds.permitted_airspace_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `airspace_id ${airspaceId} does not match ${bounds.permitted_airspace_id}` };
  }
  const airspaceClass = stringParam(action, "airspace_class");
  if (bounds.permitted_airspace_classes?.length && airspaceClass && !bounds.permitted_airspace_classes.includes(airspaceClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `airspace_class ${airspaceClass} is outside permitted airspace classes` };
  }
  const operationVolume = stringParam(action, "operation_volume_id");
  if (bounds.permitted_operation_volumes?.length && operationVolume && !bounds.permitted_operation_volumes.includes(operationVolume)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `operation_volume_id ${operationVolume} is outside permitted operation volumes` };
  }
  const flightState = stringParam(action, "flight_state");
  if (bounds.permitted_flight_states?.length && flightState && !bounds.permitted_flight_states.includes(flightState)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `flight_state ${flightState} is outside permitted flight states` };
  }
  const altitudeAgl = numericParam(action, "altitude_agl_ft");
  if (bounds.max_altitude_agl_ft !== undefined && altitudeAgl !== undefined && altitudeAgl > bounds.max_altitude_agl_ft) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `altitude_agl_ft ${altitudeAgl} exceeds max_altitude_agl_ft ${bounds.max_altitude_agl_ft}` };
  }
  const groundspeed = numericParam(action, "groundspeed_kts");
  if (bounds.max_groundspeed_kts !== undefined && groundspeed !== undefined && groundspeed > bounds.max_groundspeed_kts) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `groundspeed_kts ${groundspeed} exceeds max_groundspeed_kts ${bounds.max_groundspeed_kts}` };
  }
  const batterySoc = numericParam(action, "battery_soc_pct");
  if (bounds.min_battery_soc_pct !== undefined && batterySoc !== undefined && batterySoc < bounds.min_battery_soc_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `battery_soc_pct ${batterySoc} below min_battery_soc_pct ${bounds.min_battery_soc_pct} (RTL reserve)` };
  }
  const windSpeedKts = numericParam(action, "wind_speed_kts");
  if (bounds.max_wind_speed_kts !== undefined && windSpeedKts !== undefined && windSpeedKts > bounds.max_wind_speed_kts) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `wind_speed_kts ${windSpeedKts} exceeds max_wind_speed_kts ${bounds.max_wind_speed_kts}` };
  }
  const visibility = numericParam(action, "visibility_sm");
  if (bounds.min_visibility_sm !== undefined && visibility !== undefined && visibility < bounds.min_visibility_sm) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `visibility_sm ${visibility} below min_visibility_sm ${bounds.min_visibility_sm}` };
  }
  const ceiling = numericParam(action, "ceiling_ft");
  if (bounds.min_ceiling_ft !== undefined && ceiling !== undefined && ceiling < bounds.min_ceiling_ft) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `ceiling_ft ${ceiling} below min_ceiling_ft ${bounds.min_ceiling_ft}` };
  }
  const payloadKg = numericParam(action, "payload_kg");
  if (bounds.max_payload_kg !== undefined && payloadKg !== undefined && payloadKg > bounds.max_payload_kg) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `payload_kg ${payloadKg} exceeds max_payload_kg ${bounds.max_payload_kg}` };
  }
  if (bounds.require_geofence_active && booleanParam(action, "geofence_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "geofence must be active before this flight action" };
  }
  if (bounds.require_remote_id_broadcasting && booleanParam(action, "remote_id_broadcasting") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "Remote ID must be broadcasting before this flight action" };
  }
  if (bounds.require_daa_active && booleanParam(action, "daa_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "detect-and-avoid must be active before this flight action" };
  }
  if (bounds.require_c2_link_healthy && booleanParam(action, "c2_link_healthy") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "C2 link must be healthy before this flight action" };
  }
  if (bounds.require_airspace_authorization && booleanParam(action, "airspace_authorization_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "airspace authorization (LAANC/ATC) is required before this flight action" };
  }
  if (bounds.require_no_active_tfr && booleanParam(action, "no_active_tfr") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "an active TFR prohibits this flight action" };
  }
  if (bounds.require_vlos_or_waiver && booleanParam(action, "vlos_or_waiver") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "visual line of sight or a BVLOS waiver is required before this flight action" };
  }
  if (bounds.require_rtl_available && booleanParam(action, "rtl_available") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "return-to-launch failsafe must be available before this flight action" };
  }
  if (bounds.require_vertiport_clearance && booleanParam(action, "vertiport_clearance") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "vertiport clearance is required before this eVTOL action" };
  }
  if (bounds.require_weather_within_limits && booleanParam(action, "weather_within_limits") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "weather must be within limits before this flight action" };
  }
  if (bounds.require_ops_over_people_authorized && booleanParam(action, "ops_over_people_authorized") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "operations over people authorization is required for this action" };
  }
  // -- robotics / humanoid invariants ------------------------------------------
  const workcellId = stringParam(action, "workcell_id");
  if (bounds.permitted_workcell_id && workcellId && workcellId !== bounds.permitted_workcell_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `workcell_id ${workcellId} does not match ${bounds.permitted_workcell_id}` };
  }
  const robotZone = stringParam(action, "robot_zone");
  if (bounds.permitted_robot_zones?.length && robotZone && !bounds.permitted_robot_zones.includes(robotZone)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `robot_zone ${robotZone} is outside permitted robot zones` };
  }
  const operatingMode = stringParam(action, "operating_mode");
  if (bounds.permitted_operating_modes?.length && operatingMode && !bounds.permitted_operating_modes.includes(operatingMode)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `operating_mode ${operatingMode} is outside permitted operating modes` };
  }
  const robotState = stringParam(action, "robot_state");
  if (bounds.permitted_robot_states?.length && robotState && !bounds.permitted_robot_states.includes(robotState)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `robot_state ${robotState} is outside permitted robot states` };
  }
  const tcpSpeed = numericParam(action, "tcp_speed_mm_s");
  if (bounds.max_tcp_speed_mm_s !== undefined && tcpSpeed !== undefined && tcpSpeed > bounds.max_tcp_speed_mm_s) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `tcp_speed_mm_s ${tcpSpeed} exceeds max_tcp_speed_mm_s ${bounds.max_tcp_speed_mm_s}` };
  }
  const appliedForce = numericParam(action, "force_n");
  if (bounds.max_force_n !== undefined && appliedForce !== undefined && appliedForce > bounds.max_force_n) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `force_n ${appliedForce} exceeds max_force_n ${bounds.max_force_n} (ISO/TS 15066 biomechanical limit)` };
  }
  const appliedTorque = numericParam(action, "torque_nm");
  if (bounds.max_torque_nm !== undefined && appliedTorque !== undefined && appliedTorque > bounds.max_torque_nm) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `torque_nm ${appliedTorque} exceeds max_torque_nm ${bounds.max_torque_nm}` };
  }
  const appliedPower = numericParam(action, "power_w");
  if (bounds.max_power_w !== undefined && appliedPower !== undefined && appliedPower > bounds.max_power_w) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `power_w ${appliedPower} exceeds max_power_w ${bounds.max_power_w}` };
  }
  const robotSeparation = numericParam(action, "separation_distance_mm");
  if (bounds.min_separation_distance_mm !== undefined && robotSeparation !== undefined && robotSeparation < bounds.min_separation_distance_mm) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `separation_distance_mm ${robotSeparation} below min_separation_distance_mm ${bounds.min_separation_distance_mm} (SSM)` };
  }
  const comDeviation = numericParam(action, "com_deviation_mm");
  if (bounds.max_com_deviation_mm !== undefined && comDeviation !== undefined && comDeviation > bounds.max_com_deviation_mm) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `com_deviation_mm ${comDeviation} exceeds max_com_deviation_mm ${bounds.max_com_deviation_mm} (humanoid balance)` };
  }
  const stepHeight = numericParam(action, "step_height_mm");
  if (bounds.max_step_height_mm !== undefined && stepHeight !== undefined && stepHeight > bounds.max_step_height_mm) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `step_height_mm ${stepHeight} exceeds max_step_height_mm ${bounds.max_step_height_mm}` };
  }
  if (bounds.require_estop_functional && booleanParam(action, "estop_functional") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "a functional emergency stop is required before this robot action" };
  }
  if (bounds.require_protective_stop_armed && booleanParam(action, "protective_stop_armed") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "the protective stop must be armed before this robot action" };
  }
  if (bounds.require_ssm_active && booleanParam(action, "ssm_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "speed-and-separation monitoring must be active before this robot action" };
  }
  if (bounds.require_pfl_active && booleanParam(action, "pfl_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "power-and-force limiting must be active before this robot action" };
  }
  if (bounds.require_collision_detection_active && booleanParam(action, "collision_detection_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "collision detection must be active before this robot action" };
  }
  if (bounds.require_safety_scanner_active && booleanParam(action, "safety_scanner_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "the safety scanner must be active before this robot action" };
  }
  if (bounds.require_balance_controller_active && booleanParam(action, "balance_controller_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "the humanoid balance controller must be active before this action" };
  }
  if (bounds.require_fall_protection_armed && booleanParam(action, "fall_protection_armed") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "humanoid fall protection must be armed before this action" };
  }
  if (bounds.require_teleop_link_healthy && booleanParam(action, "teleop_link_healthy") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "the teleoperation link must be healthy before this action" };
  }
  if (
    bounds.require_collaborative_mode_when_human_present &&
    booleanParam(action, "human_present") === true &&
    stringParam(action, "operating_mode") !== "collaborative"
  ) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "a human is present but the robot is not in collaborative mode (ISO/TS 15066)" };
  }
  // -- trucking / logistics invariants -----------------------------------------
  const logisticsNetworkId = stringParam(action, "logistics_network_id");
  if (bounds.permitted_logistics_network_id && logisticsNetworkId && logisticsNetworkId !== bounds.permitted_logistics_network_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `logistics_network_id ${logisticsNetworkId} does not match ${bounds.permitted_logistics_network_id}` };
  }
  const originFacilityId = stringParam(action, "origin_facility_id");
  const destinationFacilityId = stringParam(action, "destination_facility_id");
  const currentFacilityId = stringParam(action, "current_facility_id");
  if (bounds.permitted_logistics_facility_ids?.length) {
    for (const [label, value] of [["origin_facility_id", originFacilityId], ["destination_facility_id", destinationFacilityId], ["current_facility_id", currentFacilityId]] as const) {
      if (value && !bounds.permitted_logistics_facility_ids.includes(value)) {
        return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `${label} ${value} is outside permitted logistics facilities` };
      }
    }
  }
  const routeId = stringParam(action, "route_id");
  if (bounds.permitted_route_ids?.length && routeId && !bounds.permitted_route_ids.includes(routeId)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `route_id ${routeId} is outside permitted routes` };
  }
  const geofenceId = stringParam(action, "geofence_id");
  if (bounds.permitted_geofence_ids?.length && geofenceId && !bounds.permitted_geofence_ids.includes(geofenceId)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `geofence_id ${geofenceId} is outside permitted geofences` };
  }
  const carrierId = stringParam(action, "carrier_id");
  if (bounds.permitted_carrier_ids?.length && carrierId && !bounds.permitted_carrier_ids.includes(carrierId)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `carrier_id ${carrierId} is outside permitted carriers` };
  }
  const driverId = stringParam(action, "driver_id");
  if (bounds.permitted_driver_ids?.length && driverId && !bounds.permitted_driver_ids.includes(driverId)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `driver_id ${driverId} is outside permitted drivers` };
  }
  const cargoClass = stringParam(action, "cargo_class") ?? stringParam(action, "cargo_type");
  if (bounds.permitted_cargo_classes?.length && cargoClass && !bounds.permitted_cargo_classes.includes(cargoClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `cargo_class ${cargoClass} is outside permitted cargo classes` };
  }
  const logisticsHazmatClass = stringParam(action, "hazmat_class");
  if (bounds.permitted_logistics_hazmat_classes?.length && logisticsHazmatClass && !bounds.permitted_logistics_hazmat_classes.includes(logisticsHazmatClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `hazmat_class ${logisticsHazmatClass} is outside permitted logistics hazmat classes` };
  }
  const trailerType = stringParam(action, "trailer_type");
  if (bounds.permitted_trailer_types?.length && trailerType && !bounds.permitted_trailer_types.includes(trailerType)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `trailer_type ${trailerType} is outside permitted trailer types` };
  }
  const cdlClass = stringParam(action, "cdl_class");
  if (bounds.permitted_cdl_classes?.length && cdlClass && !bounds.permitted_cdl_classes.includes(cdlClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `cdl_class ${cdlClass} is outside permitted CDL classes` };
  }
  const grossWeight = numericParam(action, "gross_weight_lbs");
  if (bounds.max_gross_weight_lbs !== undefined && grossWeight !== undefined && grossWeight > bounds.max_gross_weight_lbs) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `gross_weight_lbs ${grossWeight} exceeds max_gross_weight_lbs ${bounds.max_gross_weight_lbs}` };
  }
  const cargoValue = numericParam(action, "cargo_value_usd");
  if (bounds.max_cargo_value_usd !== undefined && cargoValue !== undefined && cargoValue > bounds.max_cargo_value_usd) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `cargo_value_usd ${cargoValue} exceeds max_cargo_value_usd ${bounds.max_cargo_value_usd}` };
  }
  const fuelAdvance = numericParam(action, "fuel_advance_usd");
  if (bounds.max_fuel_advance_usd !== undefined && fuelAdvance !== undefined && fuelAdvance > bounds.max_fuel_advance_usd) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `fuel_advance_usd ${fuelAdvance} exceeds max_fuel_advance_usd ${bounds.max_fuel_advance_usd}` };
  }
  const accessorialAmount = numericParam(action, "accessorial_amount_usd");
  if (bounds.max_accessorial_amount_usd !== undefined && accessorialAmount !== undefined && accessorialAmount > bounds.max_accessorial_amount_usd) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `accessorial_amount_usd ${accessorialAmount} exceeds max_accessorial_amount_usd ${bounds.max_accessorial_amount_usd}` };
  }
  const fraudScore = numericParam(action, "fraud_score");
  if (bounds.max_fraud_score !== undefined && fraudScore !== undefined && fraudScore > bounds.max_fraud_score) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `fraud_score ${fraudScore} exceeds max_fraud_score ${bounds.max_fraud_score}` };
  }
  const doubleBrokerRisk = numericParam(action, "double_broker_risk_score");
  if (bounds.max_double_broker_risk_score !== undefined && doubleBrokerRisk !== undefined && doubleBrokerRisk > bounds.max_double_broker_risk_score) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `double_broker_risk_score ${doubleBrokerRisk} exceeds max_double_broker_risk_score ${bounds.max_double_broker_risk_score}` };
  }
  const eldAge = numericParam(action, "eld_event_age_ms");
  if (bounds.max_eld_event_age_ms !== undefined && eldAge !== undefined && eldAge > bounds.max_eld_event_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `eld_event_age_ms ${eldAge} exceeds max_eld_event_age_ms ${bounds.max_eld_event_age_ms}` };
  }
  const telematicsAge = numericParam(action, "telematics_age_ms");
  if (bounds.max_telematics_age_ms !== undefined && telematicsAge !== undefined && telematicsAge > bounds.max_telematics_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `telematics_age_ms ${telematicsAge} exceeds max_telematics_age_ms ${bounds.max_telematics_age_ms}` };
  }
  const routeDeviation = numericParam(action, "route_deviation_km");
  if (bounds.max_route_deviation_km !== undefined && routeDeviation !== undefined && routeDeviation > bounds.max_route_deviation_km) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `route_deviation_km ${routeDeviation} exceeds max_route_deviation_km ${bounds.max_route_deviation_km}` };
  }
  const remainingDrive = numericParam(action, "remaining_drive_minutes");
  const requiredDrive = numericParam(action, "required_drive_minutes");
  if (bounds.min_remaining_drive_minutes !== undefined && remainingDrive !== undefined && remainingDrive < bounds.min_remaining_drive_minutes) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `remaining_drive_minutes ${remainingDrive} below minimum ${bounds.min_remaining_drive_minutes}` };
  }
  if (requiredDrive !== undefined && remainingDrive !== undefined && requiredDrive > remainingDrive) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `required_drive_minutes ${requiredDrive} exceeds remaining_drive_minutes ${remainingDrive}` };
  }
  const remainingDuty = numericParam(action, "remaining_duty_minutes");
  if (bounds.min_remaining_duty_minutes !== undefined && remainingDuty !== undefined && remainingDuty < bounds.min_remaining_duty_minutes) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `remaining_duty_minutes ${remainingDuty} below minimum ${bounds.min_remaining_duty_minutes}` };
  }
  const logisticsTemp = numericParam(action, "cargo_temperature_c") ?? numericParam(action, "reefer_temperature_c");
  if (bounds.min_reefer_temp_c !== undefined && logisticsTemp !== undefined && logisticsTemp < bounds.min_reefer_temp_c) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `cargo temperature ${logisticsTemp} below min_reefer_temp_c ${bounds.min_reefer_temp_c}` };
  }
  if (bounds.max_reefer_temp_c !== undefined && logisticsTemp !== undefined && logisticsTemp > bounds.max_reefer_temp_c) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `cargo temperature ${logisticsTemp} exceeds max_reefer_temp_c ${bounds.max_reefer_temp_c}` };
  }
  if (bounds.require_driver_qualified && booleanParam(action, "driver_qualified") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "driver qualification is required before this logistics action" };
  }
  if (bounds.require_medical_card_valid && booleanParam(action, "medical_card_valid") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "driver medical card must be valid before this logistics action" };
  }
  if (bounds.require_carrier_authority_active && booleanParam(action, "carrier_authority_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "carrier authority must be active before this logistics action" };
  }
  if (bounds.require_carrier_insurance_valid && booleanParam(action, "carrier_insurance_valid") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "carrier insurance must be valid before this logistics action" };
  }
  if (bounds.require_broker_authority_active && booleanParam(action, "broker_authority_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "broker authority must be active before this logistics action" };
  }
  if (bounds.require_hos_available && booleanParam(action, "hos_available") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "HOS availability must be proven before dispatch" };
  }
  if (bounds.require_eld_fresh && booleanParam(action, "eld_fresh") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "fresh ELD state is required before this logistics action" };
  }
  if (bounds.require_route_permitted && booleanParam(action, "route_permitted") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "route must be permitted before this logistics action" };
  }
  if (bounds.require_restricted_area_clear && booleanParam(action, "restricted_area_clear") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "restricted area clearance is required before this logistics action" };
  }
  if (bounds.require_vehicle_maintenance_clear && booleanParam(action, "vehicle_maintenance_clear") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "vehicle maintenance clearance is required before this logistics action" };
  }
  if (bounds.require_dvir_clear && booleanParam(action, "dvir_clear") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "DVIR must be clear before this logistics action" };
  }
  if (bounds.require_trailer_seal_intact && booleanParam(action, "trailer_seal_intact") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "trailer seal must be intact before this logistics action" };
  }
  if (bounds.require_cargo_secured && booleanParam(action, "cargo_secured") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "cargo securement must be proven before this logistics action" };
  }
  if (bounds.require_temperature_in_range && booleanParam(action, "temperature_in_range") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "temperature must be in range before this logistics action" };
  }
  if (bounds.require_logistics_hazmat_endorsement && logisticsHazmatClass && logisticsHazmatClass !== "none" && booleanParam(action, "hazmat_endorsement_valid") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "hazmat endorsement is required before this logistics action" };
  }
  if (bounds.require_customs_clearance && booleanParam(action, "customs_clearance_present") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "customs clearance is required before this logistics action" };
  }
  if (bounds.require_logistics_appointment_valid && booleanParam(action, "appointment_valid") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "valid appointment is required before this logistics action" };
  }
  if (bounds.require_dock_available && booleanParam(action, "dock_available") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "dock availability is required before this logistics action" };
  }
  if (bounds.require_yard_gate_access && booleanParam(action, "yard_gate_access_granted") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "yard gate access must be granted before this logistics action" };
  }
  if (bounds.require_fuel_card_active && booleanParam(action, "fuel_card_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "fuel card must be active before this logistics action" };
  }
  if (bounds.require_logistics_dispatcher_identity && !stringParam(action, "dispatcher_id")) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "dispatcher identity is required before this logistics action" };
  }
  if (bounds.require_no_double_broker_risk && booleanParam(action, "double_broker_flag") === true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "double-broker risk flag prevents this logistics action" };
  }
  // -- swarm / disconnected-operation invariants -------------------------------
  const swarmId = stringParam(action, "swarm_id");
  if (bounds.permitted_swarm_id && swarmId && swarmId !== bounds.permitted_swarm_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `swarm_id ${swarmId} does not match ${bounds.permitted_swarm_id}` };
  }
  const missionClass = stringParam(action, "mission_class");
  if (bounds.permitted_mission_classes?.length && missionClass && !bounds.permitted_mission_classes.includes(missionClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `mission_class ${missionClass} is outside permitted mission classes` };
  }
  const swarmSize = numericParam(action, "swarm_size");
  if (bounds.min_swarm_size !== undefined && swarmSize !== undefined && swarmSize < bounds.min_swarm_size) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `swarm_size ${swarmSize} below min_swarm_size ${bounds.min_swarm_size}` };
  }
  if (bounds.max_swarm_size !== undefined && swarmSize !== undefined && swarmSize > bounds.max_swarm_size) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `swarm_size ${swarmSize} exceeds max_swarm_size ${bounds.max_swarm_size}` };
  }
  const swarmRadius = numericParam(action, "swarm_radius_m");
  if (bounds.max_swarm_radius_m !== undefined && swarmRadius !== undefined && swarmRadius > bounds.max_swarm_radius_m) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `swarm_radius_m ${swarmRadius} exceeds max_swarm_radius_m ${bounds.max_swarm_radius_m}` };
  }
  const unitSeparation = numericParam(action, "unit_separation_m");
  if (bounds.min_unit_separation_m !== undefined && unitSeparation !== undefined && unitSeparation < bounds.min_unit_separation_m) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `unit_separation_m ${unitSeparation} below min_unit_separation_m ${bounds.min_unit_separation_m}` };
  }
  if (bounds.max_unit_separation_m !== undefined && unitSeparation !== undefined && unitSeparation > bounds.max_unit_separation_m) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `unit_separation_m ${unitSeparation} exceeds max_unit_separation_m ${bounds.max_unit_separation_m} (mesh degraded)` };
  }
  const swarmBatteryMin = numericParam(action, "swarm_battery_soc_min_pct");
  if (bounds.min_swarm_battery_soc_pct !== undefined && swarmBatteryMin !== undefined && swarmBatteryMin < bounds.min_swarm_battery_soc_pct) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `swarm_battery_soc_min_pct ${swarmBatteryMin} below min_swarm_battery_soc_pct ${bounds.min_swarm_battery_soc_pct}` };
  }
  const meshLinkQuality = numericParam(action, "mesh_link_quality");
  if (bounds.min_mesh_link_quality !== undefined && meshLinkQuality !== undefined && meshLinkQuality < bounds.min_mesh_link_quality) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `mesh_link_quality ${meshLinkQuality} below min_mesh_link_quality ${bounds.min_mesh_link_quality}` };
  }
  const meshHops = numericParam(action, "mesh_hops");
  if (bounds.max_mesh_hops !== undefined && meshHops !== undefined && meshHops > bounds.max_mesh_hops) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `mesh_hops ${meshHops} exceeds max_mesh_hops ${bounds.max_mesh_hops}` };
  }
  const lostLinkSeconds = numericParam(action, "lost_link_seconds");
  if (bounds.max_lost_link_seconds !== undefined && lostLinkSeconds !== undefined && lostLinkSeconds > bounds.max_lost_link_seconds) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `lost_link_seconds ${lostLinkSeconds} exceeds max_lost_link_seconds ${bounds.max_lost_link_seconds} — swarm must enter hold-safe` };
  }
  const authoritySyncAge = numericParam(action, "authority_sync_age_ms");
  if (bounds.max_authority_sync_age_ms !== undefined && authoritySyncAge !== undefined && authoritySyncAge > bounds.max_authority_sync_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `authority_sync_age_ms ${authoritySyncAge} exceeds max_authority_sync_age_ms ${bounds.max_authority_sync_age_ms}` };
  }
  if (bounds.require_mesh_relay_healthy && booleanParam(action, "mesh_relay_healthy") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "mesh relay must be healthy before this swarm action" };
  }
  if (bounds.require_fluidity_token_valid && booleanParam(action, "fluidity_token_valid") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "fluidity token must be valid (degraded-comms authority expired)" };
  }
  if (bounds.require_launch_readiness_approved && booleanParam(action, "launch_readiness_approved") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "launch readiness must be approved before this swarm action" };
  }
  if (bounds.require_recovery_plan_active && booleanParam(action, "recovery_plan_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "an active recovery plan is required before this swarm action" };
  }
  if (bounds.require_balloon_position_monitor_active && booleanParam(action, "balloon_position_monitor_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "balloon position-monitor must be active (14 CFR Part 101)" };
  }
  if (bounds.require_balloon_within_envelope && booleanParam(action, "balloon_within_envelope") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "balloon is outside its authorized flight envelope" };
  }
  // -- healthcare clinical-operations invariants -------------------------------
  const healthcareSystemId = stringParam(action, "healthcare_system_id");
  if (bounds.permitted_healthcare_system_id && healthcareSystemId && healthcareSystemId !== bounds.permitted_healthcare_system_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `healthcare_system_id ${healthcareSystemId} does not match ${bounds.permitted_healthcare_system_id}` };
  }
  const healthcareFacilityId = stringParam(action, "facility_id");
  if (bounds.permitted_healthcare_facility_id && healthcareFacilityId && healthcareFacilityId !== bounds.permitted_healthcare_facility_id) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `facility_id ${healthcareFacilityId} does not match ${bounds.permitted_healthcare_facility_id}` };
  }
  const clinicalUnit = stringParam(action, "clinical_unit");
  if (bounds.permitted_clinical_units?.length && clinicalUnit && !bounds.permitted_clinical_units.includes(clinicalUnit)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `clinical_unit ${clinicalUnit} is outside permitted clinical units` };
  }
  const fhirResourceType = stringParam(action, "fhir_resource_type");
  if (bounds.permitted_fhir_resource_types?.length && fhirResourceType && !bounds.permitted_fhir_resource_types.includes(fhirResourceType)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `fhir_resource_type ${fhirResourceType} is outside permitted FHIR resource types` };
  }
  const orderType = stringParam(action, "order_type");
  if (bounds.permitted_order_types?.length && orderType && !bounds.permitted_order_types.includes(orderType)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `order_type ${orderType} is outside permitted order types` };
  }
  const medicationClass = stringParam(action, "medication_class");
  if (bounds.permitted_medication_classes?.length && medicationClass && !bounds.permitted_medication_classes.includes(medicationClass)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `medication_class ${medicationClass} is outside permitted medication classes` };
  }
  const healthcareDeviceId = stringParam(action, "device_id");
  if (bounds.permitted_healthcare_device_ids?.length && healthcareDeviceId && !bounds.permitted_healthcare_device_ids.includes(healthcareDeviceId)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `device_id ${healthcareDeviceId} is outside permitted healthcare device ids` };
  }
  const phiPurpose = stringParam(action, "phi_purpose") ?? stringParam(action, "tpo_basis");
  if (bounds.permitted_phi_purposes?.length && phiPurpose && !bounds.permitted_phi_purposes.includes(phiPurpose)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `PHI purpose ${phiPurpose} is outside permitted purposes` };
  }
  const phiRecordCount = numericParam(action, "phi_record_count");
  if (bounds.max_phi_record_count !== undefined && phiRecordCount !== undefined && phiRecordCount > bounds.max_phi_record_count) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `phi_record_count ${phiRecordCount} exceeds max_phi_record_count ${bounds.max_phi_record_count}` };
  }
  const claimAmount = numericParam(action, "claim_amount_usd");
  if (bounds.max_claim_amount_usd !== undefined && claimAmount !== undefined && claimAmount > bounds.max_claim_amount_usd) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `claim_amount_usd ${claimAmount} exceeds max_claim_amount_usd ${bounds.max_claim_amount_usd}` };
  }
  const patientMessageRisk = numericParam(action, "patient_message_risk_score");
  if (bounds.max_patient_message_risk_score !== undefined && patientMessageRisk !== undefined && patientMessageRisk > bounds.max_patient_message_risk_score) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `patient_message_risk_score ${patientMessageRisk} exceeds max_patient_message_risk_score ${bounds.max_patient_message_risk_score}` };
  }
  const clinicalContextAge = numericParam(action, "clinical_context_age_ms");
  if (bounds.max_clinical_context_age_ms !== undefined && clinicalContextAge !== undefined && clinicalContextAge > bounds.max_clinical_context_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `clinical_context_age_ms ${clinicalContextAge} exceeds max_clinical_context_age_ms ${bounds.max_clinical_context_age_ms}` };
  }
  const medRecAge = numericParam(action, "medication_reconciliation_age_ms");
  if (bounds.max_medication_reconciliation_age_ms !== undefined && medRecAge !== undefined && medRecAge > bounds.max_medication_reconciliation_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `medication_reconciliation_age_ms ${medRecAge} exceeds max_medication_reconciliation_age_ms ${bounds.max_medication_reconciliation_age_ms}` };
  }
  const deviceTelemetryAge = numericParam(action, "device_telemetry_age_ms");
  if (bounds.max_device_telemetry_age_ms !== undefined && deviceTelemetryAge !== undefined && deviceTelemetryAge > bounds.max_device_telemetry_age_ms) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: `device_telemetry_age_ms ${deviceTelemetryAge} exceeds max_device_telemetry_age_ms ${bounds.max_device_telemetry_age_ms}` };
  }
  if (bounds.require_patient_context && (!stringParam(action, "patient_context_hash") || booleanParam(action, "patient_context_present") !== true)) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "patient context hash and presence proof are required before this healthcare action" };
  }
  if (bounds.require_patient_identity_verified && booleanParam(action, "patient_identity_verified") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "patient identity must be verified before this healthcare action" };
  }
  if (bounds.require_tpo_basis_or_consent && booleanParam(action, "patient_consent_valid") !== true && !["treatment", "payment", "operations", "prior-authorization", "emergency"].includes(String(phiPurpose ?? ""))) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "valid consent or treatment/payment/operations basis is required before this healthcare action" };
  }
  if (bounds.require_clinician_privilege_active && booleanParam(action, "clinician_privilege_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "active clinician privilege is required before this healthcare action" };
  }
  if (bounds.require_pharmacist_authority && booleanParam(action, "pharmacist_authority_present") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "pharmacist authority is required before this pharmacy action" };
  }
  if (bounds.require_allergy_checked && booleanParam(action, "allergy_checked") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "allergy check is required before this medication action" };
  }
  if (bounds.require_no_allergy_conflict && booleanParam(action, "allergy_conflict") === true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "active allergy conflict prevents this healthcare action" };
  }
  if (bounds.require_medication_interaction_clear && booleanParam(action, "medication_interaction_clear") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "medication interaction check must be clear before this healthcare action" };
  }
  if (bounds.require_order_signing_authority && booleanParam(action, "order_signing_authority") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "order signing authority is required before this order action" };
  }
  if (bounds.require_diagnosis_context && booleanParam(action, "diagnosis_context_present") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "diagnosis context is required before this healthcare action" };
  }
  if (bounds.require_device_safety_limits && booleanParam(action, "device_safety_limits_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "device safety limits must remain active before this device action" };
  }
  if (bounds.require_device_alarm_active && booleanParam(action, "alarm_active") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "device alarm must remain active before this device action" };
  }
  if (bounds.require_privacy_officer_approval && booleanParam(action, "privacy_officer_approval") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "privacy officer approval is required before this PHI or research action" };
  }
  if (bounds.require_deidentification_valid && booleanParam(action, "deidentification_valid") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "valid de-identification is required before this research export" };
  }
  if (bounds.require_break_glass_attestation && stringParam(action, "tpo_basis") === "emergency" && booleanParam(action, "break_glass_attested") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "emergency break-glass actions require attestation" };
  }
  if (bounds.require_chart_lock_clear && booleanParam(action, "chart_lock_clear") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "chart lock must be clear before this EHR mutation" };
  }
  if (bounds.require_human_review_for_patient_message && booleanParam(action, "human_review_present") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "human review is required before this patient-facing message" };
  }
  if (bounds.require_claim_attestation && booleanParam(action, "claim_attestation_present") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "claim attestation is required before this revenue-cycle action" };
  }
  if (bounds.require_healthcare_audit_context && booleanParam(action, "audit_context_present") !== true) {
    return { ok: false, reason_codes: ["PHYSICAL_INVARIANT_FAILED"], detail: "audit context is required before this healthcare action" };
  }
  return { ok: true, reason_codes: [], detail: "physical invariants satisfied" };
}

export function evaluateCommitGate(input: CommitGateInput): CommitGateDecision {
  const runtime_register_snapshot = stableNormalize(input.runtimeRegister ?? {}) as RuntimeRegister;
  const canonical = canonicalizeAction(input.action);
  const ward = input.ward;
  const envelope = input.authorityEnvelope;
  const nowMs = Date.parse(input.now ?? new Date().toISOString());

  if (!ward) return refuse("REFUSE", ["WARD_NOT_FOUND"], canonical, runtime_register_snapshot);
  if (!ward.permitted_subjects.includes(input.action.subject)) return refuse("REFUSE", ["SUBJECT_NOT_IN_WARD"], canonical, runtime_register_snapshot, ward);
  // Degraded-mode fail policy: when the boundary signals infrastructure degradation
  // (ledger unavailable, control-plane stale, quorum lost, dependency timeout), the
  // Ward's criticality decides the fail action. Safety-critical fails closed; lower
  // criticalities may escalate or proceed degraded (allow_degraded falls through).
  if (input.degradedConditions?.length) {
    const failMode = resolveFailMode(ward.criticality, input.degradedConditions);
    if (failMode.action === "refuse") return refuse("REFUSE", ["DEGRADED_MODE"], canonical, runtime_register_snapshot, ward, envelope ?? undefined);
    if (failMode.action === "escalate") return refuse("ESCALATE", ["DEGRADED_MODE"], canonical, runtime_register_snapshot, ward, envelope ?? undefined);
  }
  if (!envelope) return refuse("REFUSE", ["ACTION_NOT_ALLOWED"], canonical, runtime_register_snapshot, ward);
  if (envelope.ward_id !== ward.ward_id || envelope.subject !== input.action.subject) {
    return refuse("REFUSE", ["ACTION_NOT_ALLOWED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (runtime_register_snapshot.policy_version && runtime_register_snapshot.policy_version !== ward.policy_version) {
    return refuse("ESCALATE", ["POLICY_VERSION_MISMATCH"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (Date.parse(envelope.expires_at) <= nowMs) {
    return refuse("REFUSE", ["ENVELOPE_EXPIRED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  const missingRuntime = missingRuntimeRegisters(envelope, input.action, runtime_register_snapshot);
  if (missingRuntime.length) {
    return refuse("ESCALATE", ["RUNTIME_STATE_MISSING"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (envelope.denied_actions.includes(input.action.action_type)) {
    return refuse("REFUSE", ["ACTION_DENIED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (!envelope.allowed_actions.includes(input.action.action_type)) {
    return refuse("REFUSE", ["ACTION_NOT_ALLOWED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  if (!constraintsPass(envelope, input.action)) {
    return refuse("REFUSE", ["CONSTRAINT_FAILED"], canonical, runtime_register_snapshot, ward, envelope);
  }
  const physical = evaluatePhysicalInvariants(input.action, ward.physical_bounds);
  if (!physical.ok) {
    return {
      ...refuse("REFUSE", ["PHYSICAL_INVARIANT_FAILED"], canonical, runtime_register_snapshot, ward, envelope),
      physical_invariant_result: physical
    };
  }
  // MLS: the action's data label must be dominated by the Ward and Envelope clearances
  // (no read up). No-op when no classification labels are present (unclassified default).
  if (!enforceClassification([ward.classification, envelope.classification], input.action.classification).ok) {
    return refuse("REFUSE", ["CLASSIFICATION_VIOLATION"], canonical, runtime_register_snapshot, ward, envelope);
  }
  return {
    decision: "ALLOW",
    reason_codes: ["ALLOWED"],
    canonical_action_hash: canonical.canonical_action_hash,
    policy_version: ward.policy_version,
    authority_envelope_id: envelope.envelope_id,
    runtime_register_snapshot,
    physical_invariant_result: physical
  };
}

function refuse(
  decision: ExecutionControlDecision,
  reason_codes: ExecutionControlReasonCode[],
  canonical: CanonicalAction,
  runtime_register_snapshot: RuntimeRegister,
  ward?: WardManifest,
  envelope?: AuthorityEnvelope
): CommitGateDecision {
  return {
    decision,
    reason_codes,
    canonical_action_hash: canonical.canonical_action_hash,
    policy_version: ward?.policy_version,
    authority_envelope_id: envelope?.envelope_id,
    runtime_register_snapshot
  };
}

/** Canonical, deterministic message that an Ed25519 Warrant signature binds. */
function warrantMaterial(fields: {
  action_type: string;
  authority_envelope_id: string;
  canonical_action_hash: string;
  expires_at: string;
  issued_at: string;
  issuer: string;
  subject: string;
  ward_id: string;
  /** Optional: dropped from the canonical material when undefined, so Warrants minted
   *  before nonces existed still verify byte-identically. */
  nonce?: string;
}): string {
  return stableStringify({ ...fields, decision: "ALLOW", single_use: true });
}

export const DEFAULT_WARRANT_TTL_SECONDS = 60;

export function issueWarrant(
  decision: CommitGateDecision,
  action: CanonicalActionInput,
  envelope: AuthorityEnvelope,
  now = new Date().toISOString(),
  signer: AristotleSigner = getDefaultDevSigner(),
  ttlSeconds: number = DEFAULT_WARRANT_TTL_SECONDS
): Warrant | undefined {
  if (decision.decision !== "ALLOW") return undefined;
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_WARRANT_TTL_SECONDS;
  const expires_at = new Date(Date.parse(now) + ttl * 1000).toISOString();
  const nonce = randomUUID();
  const material = warrantMaterial({
    action_type: action.action_type,
    authority_envelope_id: envelope.envelope_id,
    canonical_action_hash: decision.canonical_action_hash,
    expires_at,
    issued_at: now,
    issuer: envelope.issuer,
    subject: action.subject,
    ward_id: action.ward_id,
    nonce
  });
  const signature = signer.sign(material);
  return {
    warrant_id: `wrn-${sha256(stableStringify({ material, signature, signing_key_id: signer.key_id })).slice(0, 24)}`,
    ward_id: action.ward_id,
    authority_envelope_id: envelope.envelope_id,
    canonical_action_hash: decision.canonical_action_hash,
    subject: action.subject,
    action_type: action.action_type,
    decision: "ALLOW",
    issued_at: now,
    expires_at,
    single_use: true,
    consumed: false,
    nonce,
    issuer: envelope.issuer,
    signature,
    signature_algorithm: signer.algorithm,
    signing_key_id: signer.key_id,
    signing_public_key: signer.public_key_pem
  };
}

export class AristotleWarrant {
  constructor(public readonly warrant: Warrant) {}

  verify(canonicalActionHash: string, now = new Date().toISOString(), options: WarrantVerifyOptions = {}): WarrantVerification {
    return verifyWarrant(this.warrant, canonicalActionHash, now, options);
  }

  consume(canonicalActionHash: string, now = new Date().toISOString(), options: WarrantVerifyOptions = {}): Warrant {
    const verification = this.verify(canonicalActionHash, now, options);
    if (!verification.ok) throw new Error(verification.reason ?? "WARRANT_VERIFICATION_FAILED");
    this.warrant.consumed = true;
    return this.warrant;
  }
}

export function verifyWarrant(warrant: Warrant, canonicalActionHash: string, now = new Date().toISOString(), options: WarrantVerifyOptions = {}): WarrantVerification {
  if (warrant.decision !== "ALLOW") return { ok: false, reason: "DECISION_NOT_ALLOWED" };
  if (warrant.consumed) return { ok: false, reason: "WARRANT_CONSUMED" };
  const nowMs = Date.parse(now);
  const issuedMs = Date.parse(warrant.issued_at);
  // Trusted-time hardening. expires_at/issued_at are signed, so they cannot be
  // tampered without the key — but a verifier with a skewed clock, or a forward-
  // skewed issuer, still needs guarding, and a verifier should enforce its own
  // lifetime ceiling regardless of what the issuer signed.
  if (Date.parse(warrant.expires_at) <= nowMs) return { ok: false, reason: "WARRANT_EXPIRED" };
  const skew = options.maxClockSkewMs ?? 60_000;
  if (Number.isFinite(issuedMs) && issuedMs - nowMs > skew) return { ok: false, reason: "WARRANT_NOT_YET_VALID" };
  if (options.maxLifetimeMs !== undefined && Number.isFinite(issuedMs) && Date.parse(warrant.expires_at) - issuedMs > options.maxLifetimeMs) {
    return { ok: false, reason: "WARRANT_LIFETIME_EXCEEDED" };
  }
  if (options.seenNonces && warrant.nonce && options.seenNonces.has(warrant.nonce)) return { ok: false, reason: "WARRANT_REPLAYED" };
  if (warrant.canonical_action_hash !== canonicalActionHash) return { ok: false, reason: "ACTION_HASH_MISMATCH" };
  if (options.trustedKeyIds && !options.trustedKeyIds.includes(warrant.signing_key_id)) {
    return { ok: false, reason: "UNTRUSTED_SIGNING_KEY" };
  }
  if (options.revocations && revocationReason(options.revocations, {
    signing_key_id: warrant.signing_key_id,
    authority_envelope_id: warrant.authority_envelope_id,
    warrant_id: warrant.warrant_id
  })) {
    return { ok: false, reason: "REVOKED" };
  }
  const material = warrantMaterial({
    action_type: warrant.action_type,
    authority_envelope_id: warrant.authority_envelope_id,
    canonical_action_hash: warrant.canonical_action_hash,
    expires_at: warrant.expires_at,
    issued_at: warrant.issued_at,
    issuer: warrant.issuer,
    subject: warrant.subject,
    ward_id: warrant.ward_id,
    nonce: warrant.nonce
  });
  if (warrant.signature_algorithm !== "ed25519" || !verifyEd25519(warrant.signing_public_key, material, warrant.signature)) {
    return { ok: false, reason: "SIGNATURE_MISMATCH" };
  }
  return { ok: true };
}

export function consumeWarrant(warrant: Warrant, canonicalActionHash: string, now = new Date().toISOString(), options: WarrantVerifyOptions = {}): Warrant {
  return new AristotleWarrant(warrant).consume(canonicalActionHash, now, options);
}

interface BuildGelRecordInput {
  previous_hash: string;
  ward: WardManifest;
  action: CanonicalActionInput;
  decision: CommitGateDecision;
  warrant?: Warrant;
  now?: string;
  signer?: AristotleSigner;
  /** Authenticated operator attributed to this record. */
  actor?: GelActor;
  /** W3C trace context to stamp into the record. */
  trace_context?: TraceContext;
}

/** Pure: build a (optionally signed) GEL record linked to a given previous hash. */
function buildGelRecord(input: BuildGelRecordInput): GelRecord {
  const { previous_hash } = input;
  const timestamp = input.now ?? new Date().toISOString();
  const base = {
    record_id: `gel-${sha256(stableStringify({ previous_hash, timestamp, action: input.decision.canonical_action_hash })).slice(0, 24)}`,
    previous_hash,
    timestamp,
    ward_id: input.ward.ward_id,
    subject: input.action.subject,
    canonical_action_hash: input.decision.canonical_action_hash,
    decision: input.decision.decision,
    reason_codes: input.decision.reason_codes,
    authority_envelope_id: input.decision.authority_envelope_id,
    warrant_id: input.warrant?.warrant_id,
    policy_version: input.decision.policy_version,
    request_id: input.action.request_id,
    trace_context: input.trace_context,
    actor: input.actor,
    runtime_register_snapshot: input.decision.runtime_register_snapshot,
    physical_invariant_result: input.decision.physical_invariant_result
  };
  // `actor` is undefined when no operator is attributed; stableStringify drops
  // undefined keys, so records without an actor hash identically to before
  // (backward-compatible with existing ledgers and evidence bundles).
  const record_hash = sha256(stableStringify(base));
  const signer = input.signer;
  return {
    ...base,
    record_hash,
    ...(signer
      ? {
          signature: signer.sign(record_hash),
          signature_algorithm: signer.algorithm,
          signing_key_id: signer.key_id,
          signing_public_key: signer.public_key_pem
        }
      : {})
  };
}

function writeGelRecord(ledgerPath: string, record: GelRecord): void {
  mkdirSync(path.dirname(path.resolve(ledgerPath)), { recursive: true });
  appendFileSync(ledgerPath, `${stableStringify(record)}\n`, "utf8");
}

export function appendGelRecord(input: {
  ledgerPath: string;
  ward: WardManifest;
  action: CanonicalActionInput;
  decision: CommitGateDecision;
  warrant?: Warrant;
  now?: string;
  signer?: AristotleSigner;
  actor?: GelActor;
  trace_context?: TraceContext;
}): GelRecord {
  const previous_hash = loadGelChain(input.ledgerPath).at(-1)?.record_hash ?? GENESIS_HASH;
  const record = buildGelRecord({ previous_hash, ...input });
  writeGelRecord(input.ledgerPath, record);
  return record;
}

/**
 * Pluggable persistence + index for the Governance Evidence Ledger. The hot-path
 * state (tip hash, count, admitted action hashes) is maintained incrementally so
 * append/replay checks are O(1). A durable backend (e.g. Postgres/SQLite) only has
 * to implement this contract; see FileLedgerBackend for the reference design.
 */
export interface LedgerBackend {
  tipHash: string;
  count: number;
  hasAdmitted(canonicalActionHash: string): boolean;
  verification(): { ok: boolean; count: number; failure?: string };
  persist(record: GelRecord): void;
  records(): GelRecord[];
  tail(limit: number): GelRecord[];
  /** Release any held resources (e.g. a database handle). Optional. */
  close?(): void;
}

/** Shared in-memory index used by every backend to keep the hot path O(1). */
class LedgerIndex {
  tip = GENESIS_HASH;
  count = 0;
  readonly admitted = new Set<string>();
  ok = true;
  failure?: string;

  seed(chain: GelRecord[]): void {
    const verification = verifyGelRecords(chain);
    this.ok = verification.ok;
    this.failure = verification.failure;
    this.count = chain.length;
    this.tip = chain.at(-1)?.record_hash ?? GENESIS_HASH;
    for (const record of chain) if (record.decision === "ALLOW") this.admitted.add(record.canonical_action_hash);
  }

  record(record: GelRecord): void {
    this.tip = record.record_hash;
    this.count += 1;
    if (record.decision === "ALLOW") this.admitted.add(record.canonical_action_hash);
  }

  verification(): { ok: boolean; count: number; failure?: string } {
    return this.ok ? { ok: true, count: this.count } : { ok: false, count: this.count, failure: this.failure };
  }
}

/** Default backend: append-only JSONL file, rebuilt into the index at startup. */
export class FileLedgerBackend implements LedgerBackend {
  private readonly index = new LedgerIndex();

  constructor(public readonly ledgerPath: string) {
    this.index.seed(loadGelChain(ledgerPath));
  }

  get tipHash(): string { return this.index.tip; }
  get count(): number { return this.index.count; }
  hasAdmitted(hash: string): boolean { return this.index.admitted.has(hash); }
  verification(): { ok: boolean; count: number; failure?: string } { return this.index.verification(); }
  records(): GelRecord[] { return loadGelChain(this.ledgerPath); }
  tail(limit: number): GelRecord[] { return this.records().slice(-limit); }

  persist(record: GelRecord): void {
    writeGelRecord(this.ledgerPath, record);
    this.index.record(record);
  }
}

/** Ephemeral backend: holds the chain in memory only (e.g. when shipping evidence elsewhere). */
export class InMemoryLedgerBackend implements LedgerBackend {
  private readonly index = new LedgerIndex();
  private readonly chain: GelRecord[];

  constructor(seed: GelRecord[] = []) {
    this.chain = [...seed];
    this.index.seed(this.chain);
  }

  get tipHash(): string { return this.index.tip; }
  get count(): number { return this.index.count; }
  hasAdmitted(hash: string): boolean { return this.index.admitted.has(hash); }
  verification(): { ok: boolean; count: number; failure?: string } { return this.index.verification(); }
  records(): GelRecord[] { return [...this.chain]; }
  tail(limit: number): GelRecord[] { return this.chain.slice(-limit); }

  persist(record: GelRecord): void {
    this.chain.push(record);
    this.index.record(record);
  }
}

/**
 * Stateful ledger facade over a pluggable backend. Builds the next (signed) record
 * linked to the backend's current tip and persists it. `new LedgerStore(path)`
 * keeps the JSONL-file behavior; pass a backend for other stores.
 */
export class LedgerStore {
  private readonly backend: LedgerBackend;

  constructor(source: string | LedgerBackend) {
    this.backend = typeof source === "string" ? new FileLedgerBackend(source) : source;
  }

  static file(ledgerPath: string): LedgerStore {
    return new LedgerStore(new FileLedgerBackend(ledgerPath));
  }

  static memory(seed: GelRecord[] = []): LedgerStore {
    return new LedgerStore(new InMemoryLedgerBackend(seed));
  }

  get count(): number { return this.backend.count; }
  get tipHash(): string { return this.backend.tipHash; }
  hasPriorAdmission(canonicalActionHash: string): boolean { return this.backend.hasAdmitted(canonicalActionHash); }
  verification(): { ok: boolean; count: number; failure?: string } { return this.backend.verification(); }
  records(): GelRecord[] { return this.backend.records(); }
  tail(limit: number): GelRecord[] { return this.backend.tail(limit); }

  append(input: Omit<BuildGelRecordInput, "previous_hash">): GelRecord {
    const record = buildGelRecord({ previous_hash: this.backend.tipHash, ...input });
    this.backend.persist(record);
    return record;
  }

  /** Release backend resources (e.g. a SQLite handle). Safe to call on any backend. */
  close(): void {
    this.backend.close?.();
  }
}

/**
 * Async ledger backend for durable, network-backed stores (e.g. Postgres). Reads
 * that gate decisions (tip, count, verification) are kept cheap, while replay
 * lookups and writes are async and hit the shared store — so replay state is
 * shared across boundary instances (the basis for horizontal availability).
 */
export interface AsyncLedgerBackend {
  tipHash: string;
  count: number;
  hasAdmitted(canonicalActionHash: string): Promise<boolean>;
  verification(): { ok: boolean; count: number; failure?: string };
  /**
   * Append the next record. The backend supplies the authoritative previous hash
   * to `build` (under a serializing lock for multi-writer backends), so the chain
   * stays correct even with concurrent appenders. Returns the persisted record.
   */
  appendChained(build: (previousHash: string) => GelRecord): Promise<GelRecord>;
  records(): Promise<GelRecord[]>;
  tail(limit: number): Promise<GelRecord[]>;
  close?(): Promise<void>;
}

/** Async facade over an AsyncLedgerBackend, mirroring LedgerStore for the async path. */
export class AsyncLedgerStore {
  constructor(private readonly backend: AsyncLedgerBackend) {}

  get count(): number { return this.backend.count; }
  get tipHash(): string { return this.backend.tipHash; }
  hasPriorAdmission(canonicalActionHash: string): Promise<boolean> { return this.backend.hasAdmitted(canonicalActionHash); }
  verification(): { ok: boolean; count: number; failure?: string } { return this.backend.verification(); }
  records(): Promise<GelRecord[]> { return this.backend.records(); }
  tail(limit: number): Promise<GelRecord[]> { return this.backend.tail(limit); }

  async append(input: Omit<BuildGelRecordInput, "previous_hash">): Promise<GelRecord> {
    return this.backend.appendChained((previousHash) => buildGelRecord({ previous_hash: previousHash, ...input }));
  }

  async close(): Promise<void> {
    await this.backend.close?.();
  }
}

/** Token-bucket rate limiter keyed by subject. capacity = burst, refillPerSec = sustained rate. */
export class SubjectRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(private readonly capacity: number, private readonly refillPerSec: number) {}

  static perMinute(perMinute: number, burst?: number): SubjectRateLimiter {
    return new SubjectRateLimiter(Math.max(1, burst ?? perMinute), perMinute / 60);
  }

  allow(subject: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(subject) ?? { tokens: this.capacity, updated: now };
    const elapsedSec = Math.max(0, (now - bucket.updated) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.updated = now;
    const ok = bucket.tokens >= 1;
    if (ok) bucket.tokens -= 1;
    this.buckets.set(subject, bucket);
    return ok;
  }
}

export function loadGelChain(ledgerPath: string): GelRecord[] {
  if (!existsSync(ledgerPath)) return [];
  const text = readFileSync(ledgerPath, "utf8").trim();
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => JSON.parse(line) as GelRecord);
}

export function verifyGelChain(ledgerPath: string): { ok: boolean; count: number; failure?: string } {
  return verifyGelRecords(loadGelChain(ledgerPath));
}

export function verifyGelRecords(chain: GelRecord[]): { ok: boolean; count: number; failure?: string } {
  let previous = GENESIS_HASH;
  for (const [index, record] of chain.entries()) {
    if (record.previous_hash !== previous) return { ok: false, count: chain.length, failure: `record ${index} previous_hash mismatch` };
    const material = Object.fromEntries(
      Object.entries(record).filter(([key]) => !GEL_NON_MATERIAL_FIELDS.includes(key as (typeof GEL_NON_MATERIAL_FIELDS)[number]))
    );
    const expected = sha256(stableStringify(material));
    if (record.record_hash !== expected) return { ok: false, count: chain.length, failure: `record ${index} hash mismatch` };
    if (record.signature) {
      if (record.signature_algorithm !== "ed25519" || !record.signing_public_key || !verifyEd25519(record.signing_public_key, record.record_hash, record.signature)) {
        return { ok: false, count: chain.length, failure: `record ${index} signature invalid` };
      }
    }
    previous = record.record_hash;
  }
  return { ok: true, count: chain.length };
}

export function exportEvidenceBundle(input: ExportEvidenceBundleInput): EvidenceBundle {
  const ledger_chain = loadGelChain(input.ledgerPath);
  const selected_record = input.recordId
    ? ledger_chain.find((record) => record.record_id === input.recordId)
    : ledger_chain.at(-1);
  if (!selected_record) throw new Error(input.recordId ? `GEL record not found: ${input.recordId}` : "GEL ledger has no records to export");

  const partial = {
    bundle_version: "aristotle.execution-evidence.v1" as const,
    exported_at: input.exportedAt ?? new Date().toISOString(),
    ward: stableNormalize(input.ward) as WardManifest,
    authority_envelope: input.authorityEnvelope ? stableNormalize(input.authorityEnvelope) as AuthorityEnvelope : undefined,
    selected_record,
    ledger_chain,
    warrant: input.warrant
  };
  const hashes = {
    ward_manifest_hash: sha256(stableStringify(partial.ward)),
    authority_envelope_hash: partial.authority_envelope ? sha256(stableStringify(partial.authority_envelope)) : undefined,
    selected_record_hash: selected_record.record_hash,
    ledger_tip_hash: ledger_chain.at(-1)?.record_hash ?? GENESIS_HASH,
    bundle_hash: ""
  };
  hashes.bundle_hash = evidenceBundleHash({ ...partial, hashes } as EvidenceBundle);
  const bundle_signature: EvidenceBundleSignature | undefined = input.signer
    ? {
        algorithm: input.signer.algorithm,
        key_id: input.signer.key_id,
        public_key: input.signer.public_key_pem,
        value: input.signer.sign(hashes.bundle_hash)
      }
    : undefined;
  const draft: EvidenceBundle = { ...partial, hashes, bundle_signature, verification: emptyEvidenceVerification() };
  return { ...draft, verification: verifyEvidenceBundle(draft) };
}

export function loadEvidenceBundle(file: string): EvidenceBundle {
  return JSON.parse(readFileSync(file, "utf8")) as EvidenceBundle;
}

export function verifyEvidenceBundle(bundle: EvidenceBundle, options: VerifyEvidenceBundleOptions = {}): EvidenceBundleVerification {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.execution-evidence.v1") failures.push("unsupported evidence bundle version");

  const ledger = verifyGelRecords(bundle.ledger_chain);
  if (!ledger.ok) failures.push(`ledger verification failed: ${ledger.failure}`);

  const selected = bundle.ledger_chain.find((record) => record.record_id === bundle.selected_record.record_id);
  if (!selected) failures.push("selected GEL record is not present in ledger chain");
  if (selected && stableStringify(selected) !== stableStringify(bundle.selected_record)) failures.push("selected GEL record does not match ledger chain material");
  if (bundle.selected_record.record_hash !== bundle.hashes.selected_record_hash) failures.push("selected record hash does not match bundle hash declaration");

  const expectedWardHash = sha256(stableStringify(bundle.ward));
  if (bundle.hashes.ward_manifest_hash !== expectedWardHash) failures.push("Ward Manifest hash mismatch");
  if (bundle.selected_record.ward_id !== bundle.ward.ward_id) failures.push("selected record Ward does not match bundled Ward Manifest");

  if (bundle.authority_envelope) {
    const expectedEnvelopeHash = sha256(stableStringify(bundle.authority_envelope));
    if (bundle.hashes.authority_envelope_hash !== expectedEnvelopeHash) failures.push("Authority Envelope hash mismatch");
    if (bundle.selected_record.authority_envelope_id && bundle.selected_record.authority_envelope_id !== bundle.authority_envelope.envelope_id) {
      failures.push("selected record Authority Envelope does not match bundled Authority Envelope");
    }
  }

  const ledgerTip = bundle.ledger_chain.at(-1)?.record_hash ?? GENESIS_HASH;
  if (bundle.hashes.ledger_tip_hash !== ledgerTip) failures.push("ledger tip hash mismatch");

  let warrant: WarrantVerification | undefined;
  if (bundle.warrant) {
    warrant = verifyWarrant(bundle.warrant, bundle.selected_record.canonical_action_hash, bundle.warrant.issued_at, { trustedKeyIds: options.trustedKeyIds, revocations: options.revocations });
    if (!warrant.ok) failures.push(`warrant verification failed: ${warrant.reason}`);
    if (bundle.selected_record.warrant_id && bundle.selected_record.warrant_id !== bundle.warrant.warrant_id) failures.push("selected record Warrant id does not match bundled Warrant");
  } else if (bundle.selected_record.warrant_id) {
    failures.push("selected record references a Warrant but no Warrant material is bundled");
  }

  const expectedBundleHash = evidenceBundleHash(bundle);
  if (bundle.hashes.bundle_hash && bundle.hashes.bundle_hash !== expectedBundleHash) failures.push("evidence bundle hash mismatch");

  let bundle_signature_ok: boolean | undefined;
  if (bundle.bundle_signature) {
    const sig = bundle.bundle_signature;
    if (options.trustedKeyIds && !options.trustedKeyIds.includes(sig.key_id)) {
      bundle_signature_ok = false;
      failures.push("bundle signature uses an untrusted signing key");
    } else if (sig.algorithm !== "ed25519" || !verifyEd25519(sig.public_key, bundle.hashes.bundle_hash, sig.value)) {
      bundle_signature_ok = false;
      failures.push("bundle signature verification failed");
    } else {
      bundle_signature_ok = true;
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    ledger,
    warrant,
    bundle_hash: expectedBundleHash,
    bundle_signature_ok
  };
}

function evidenceBundleHash(bundle: EvidenceBundle): string {
  return sha256(stableStringify({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    ward: bundle.ward,
    authority_envelope: bundle.authority_envelope,
    selected_record: bundle.selected_record,
    ledger_chain: bundle.ledger_chain,
    warrant: bundle.warrant,
    hashes: {
      ward_manifest_hash: bundle.hashes.ward_manifest_hash,
      authority_envelope_hash: bundle.hashes.authority_envelope_hash,
      selected_record_hash: bundle.hashes.selected_record_hash,
      ledger_tip_hash: bundle.hashes.ledger_tip_hash
    }
  }));
}

function emptyEvidenceVerification(): EvidenceBundleVerification {
  return { ok: false, failures: [], ledger: { ok: false, count: 0 } };
}

/** True when the same canonical action was already admitted (ALLOW) in this ledger. */
export function hasPriorAdmission(ledgerPath: string, canonicalActionHash: string): boolean {
  return loadGelChain(ledgerPath).some(
    (record) => record.canonical_action_hash === canonicalActionHash && record.decision === "ALLOW"
  );
}

/**
 * Shared, pure decision core for both the sync and async evaluate paths. Applies
 * sovereign halt, revocation, replay, and the Commit Gate, then issues a Warrant
 * on ALLOW. I/O (replay lookup, ledger append) is performed by the caller.
 */
function decideAndWarrant(
  input: Omit<EvaluateExecutionControlInput, "ledger">,
  signer: AristotleSigner,
  canonical: CanonicalAction,
  runtimeSnapshot: RuntimeRegister,
  replaySeen: boolean,
  budgetExceeded: { reason: string } | null = null,
  dualControlPending = false,
  dualControlStoreMissing = false
): { decision: CommitGateDecision; warrant?: Warrant } {
  const ward = input.ward ?? undefined;
  const revocations = input.revocationListPath ? loadRevocationList(input.revocationListPath) : undefined;
  const revoked = revocations && revocationReason(revocations, {
    signing_key_id: signer.key_id,
    authority_envelope_id: input.authorityEnvelope?.envelope_id
  });
  let decision: CommitGateDecision;
  if (input.killSwitchPath && existsSync(input.killSwitchPath)) {
    decision = refuse("REFUSE", ["KILL_SWITCH_ENGAGED"], canonical, runtimeSnapshot, ward, input.authorityEnvelope ?? undefined);
  } else if (revoked) {
    decision = refuse("REFUSE", ["AUTHORITY_REVOKED"], canonical, runtimeSnapshot, ward, input.authorityEnvelope ?? undefined);
  } else if (replaySeen) {
    decision = refuse("REFUSE", ["REPLAY_DETECTED"], canonical, runtimeSnapshot, ward, input.authorityEnvelope ?? undefined);
  } else if (budgetExceeded) {
    decision = refuse("REFUSE", ["BUDGET_EXCEEDED"], canonical, runtimeSnapshot, ward, input.authorityEnvelope ?? undefined);
  } else {
    decision = evaluateCommitGate(input);
  }
  // Dual control gates the ALLOW→Warrant transition: an otherwise-permitted action
  // under M-of-N control escalates for plural approval instead of issuing a Warrant.
  if ((dualControlPending || dualControlStoreMissing) && decision.decision === "ALLOW") {
    decision = refuse("ESCALATE", [dualControlStoreMissing ? "DUAL_CONTROL_STORE_MISSING" : "DUAL_CONTROL_REQUIRED"], canonical, runtimeSnapshot, ward, input.authorityEnvelope ?? undefined);
  }
  const warrant = decision.decision === "ALLOW" && input.authorityEnvelope
    ? issueWarrant(decision, input.action, input.authorityEnvelope, input.now, signer, input.warrantTtlSeconds)
    : undefined;
  return { decision, warrant };
}

/** Resolve the per-subject budget verdict for this action (no state mutation). */
function evaluateBudget(input: Omit<EvaluateExecutionControlInput, "ledger">): { policy?: BudgetPolicy; nowMs: number; cost: number; exceeded: { reason: string } | null } {
  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  const cost = typeof input.action.params.cost === "number" ? input.action.params.cost : 0;
  const policy = input.budgetGovernor ? budgetPolicyFrom((input.authorityEnvelope?.constraints as Record<string, unknown> | undefined)?.budget) : undefined;
  if (!policy || !input.budgetGovernor) return { nowMs, cost, exceeded: null };
  const check = input.budgetGovernor.check(input.action.subject, policy, nowMs, cost);
  return { policy, nowMs, cost, exceeded: check.ok ? null : { reason: check.reason } };
}

/** Record an admitted action's spend against the budget window (called only on ALLOW). */
function recordBudget(input: Omit<EvaluateExecutionControlInput, "ledger">, budget: ReturnType<typeof evaluateBudget>, decision: ExecutionControlDecision): void {
  if (decision === "ALLOW" && budget.policy && input.budgetGovernor) {
    input.budgetGovernor.record(input.action.subject, budget.cost, budget.nowMs, budget.policy.windowMs);
  }
}

/** Resolve whether this action is under M-of-N dual control and already approved. */
function evaluateDualControl(input: Omit<EvaluateExecutionControlInput, "ledger">, canonical: CanonicalAction): { required: number; ttlMs?: number; satisfied: boolean; now: string; storeAvailable: boolean } | null {
  const policy = dualControlPolicyFrom((input.authorityEnvelope?.constraints as Record<string, unknown> | undefined)?.dual_control);
  if (!policy || !policy.actions.includes(input.action.action_type)) return null;
  const now = input.now ?? new Date().toISOString();
  if (!input.approvalStore) return { required: policy.required, ttlMs: policy.ttlMs, satisfied: false, now, storeAvailable: false };
  const existing = input.approvalStore.getByHash(canonical.canonical_action_hash, now);
  return { required: policy.required, ttlMs: policy.ttlMs, satisfied: existing?.status === "approved", now, storeAvailable: true };
}

/** When an action escalated for dual control, ensure a pending approval request exists. */
function openDualControlRequest(input: Omit<EvaluateExecutionControlInput, "ledger">, canonical: CanonicalAction, dual: NonNullable<ReturnType<typeof evaluateDualControl>>, decision: CommitGateDecision): void {
  if (input.approvalStore && input.ward && decision.reason_codes.includes("DUAL_CONTROL_REQUIRED")) {
    input.approvalStore.request({
      canonicalHash: canonical.canonical_action_hash,
      wardId: input.ward.ward_id,
      subject: input.action.subject,
      actionType: input.action.action_type,
      required: dual.required,
      ttlMs: dual.ttlMs,
      now: dual.now
    });
  }
}

export function evaluateExecutionControl(input: EvaluateExecutionControlInput): EvaluateExecutionControlResult {
  if (!input.ward) throw new Error("ward manifest is required for GEL recording");
  const tracer = input.tracer;
  const traceAttrs = input.trace_context ? { "aristotle.trace_id": input.trace_context.trace_id } : undefined;
  return traceSpan(tracer, "aristotle.execution_control.evaluate", { ...traceAttrs, "aristotle.ward_id": input.ward.ward_id, "aristotle.action_type": input.action.action_type }, (span) => {
    const signer = input.signer ?? getDefaultDevSigner();
    const canonical = traceSpan(tracer, "aristotle.canonicalize", undefined, () => canonicalizeAction(input.action));
    const runtimeSnapshot = stableNormalize(input.runtimeRegister ?? {}) as RuntimeRegister;
    const replaySeen = input.replayProtection
      ? (input.ledger ? input.ledger.hasPriorAdmission(canonical.canonical_action_hash) : hasPriorAdmission(input.ledgerPath, canonical.canonical_action_hash))
      : false;
    const budget = evaluateBudget(input);
    const dual = evaluateDualControl(input, canonical);
    const { decision, warrant } = traceSpan(tracer, "aristotle.commit_gate.decide", undefined, () => decideAndWarrant(input, signer, canonical, runtimeSnapshot, replaySeen, budget.exceeded, !!dual && !dual.satisfied, !!dual && !dual.storeAvailable));
    recordBudget(input, budget, decision.decision);
    if (dual) openDualControlRequest(input, canonical, dual, decision);
    const gel_record = traceSpan(tracer, "aristotle.gel.append", undefined, () => (input.ledger
      ? input.ledger.append({ ward: input.ward!, action: input.action, decision, warrant, now: input.now, signer, actor: input.actor, trace_context: input.trace_context })
      : appendGelRecord({ ledgerPath: input.ledgerPath, ward: input.ward!, action: input.action, decision, warrant, now: input.now, signer, actor: input.actor, trace_context: input.trace_context })));
    span.setAttribute("aristotle.decision", decision.decision);
    return {
      decision: decision.decision,
      reason_codes: decision.reason_codes,
      canonical_action_hash: decision.canonical_action_hash,
      warrant,
      gel_record,
      ledger_verification: input.ledger ? input.ledger.verification() : verifyGelChain(input.ledgerPath)
    };
  });
}

/**
 * Async evaluate path for durable, network-backed ledgers (e.g. Postgres). Shares
 * the exact decision logic with the sync path; only the replay lookup and the
 * ledger append are awaited. Replay state lives in the backing store, so it is
 * shared across boundary instances.
 */
export interface EvaluateExecutionControlAsyncInput extends Omit<EvaluateExecutionControlInput, "ledger"> {
  ledger: AsyncLedgerStore;
}

export async function evaluateExecutionControlAsync(input: EvaluateExecutionControlAsyncInput): Promise<EvaluateExecutionControlResult> {
  if (!input.ward) throw new Error("ward manifest is required for GEL recording");
  const signer = input.signer ?? getDefaultDevSigner();
  const canonical = canonicalizeAction(input.action);
  const runtimeSnapshot = stableNormalize(input.runtimeRegister ?? {}) as RuntimeRegister;
  const replaySeen = input.replayProtection ? await input.ledger.hasPriorAdmission(canonical.canonical_action_hash) : false;
  const budget = evaluateBudget(input);
  const dual = evaluateDualControl(input, canonical);
  const { decision, warrant } = decideAndWarrant(input, signer, canonical, runtimeSnapshot, replaySeen, budget.exceeded, !!dual && !dual.satisfied, !!dual && !dual.storeAvailable);
  recordBudget(input, budget, decision.decision);
  if (dual) openDualControlRequest(input, canonical, dual, decision);
  const gel_record = await input.ledger.append({ ward: input.ward, action: input.action, decision, warrant, now: input.now, signer, actor: input.actor, trace_context: input.trace_context });
  return {
    decision: decision.decision,
    reason_codes: decision.reason_codes,
    canonical_action_hash: decision.canonical_action_hash,
    warrant,
    gel_record,
    ledger_verification: input.ledger.verification()
  };
}

export function loadWardManifest(file: string): WardManifest {
  const parsed = loadStructuredFile(file);
  assertValidWardManifest(parsed);
  return parsed as unknown as WardManifest;
}

export function loadAuthorityEnvelope(file: string): AuthorityEnvelope {
  const parsed = loadStructuredFile(file);
  assertValidAuthorityEnvelope(parsed);
  return parsed as unknown as AuthorityEnvelope;
}

export function loadCanonicalAction(file: string): CanonicalActionInput {
  return loadStructuredFile(file) as unknown as CanonicalActionInput;
}

export function loadStructuredFile(file: string): Record<string, JsonValue> {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".json")) return JSON.parse(text) as Record<string, JsonValue>;
  if (file.endsWith(".yaml") || file.endsWith(".yml")) return parseSimpleYaml(text);
  throw new Error(`unsupported structured file extension: ${file}`);
}

function parseSimpleYaml(text: string): Record<string, JsonValue> {
  const lines = text
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\s+#.*$/, ""))
    .filter((raw) => raw.trim())
    .map((raw) => ({ indent: raw.match(/^ */)?.[0].length ?? 0, content: raw.trim() }));

  const parseBlock = (index: number, indent: number): [JsonValue, number] => {
    if (index >= lines.length) return [{}, index];
    if (lines[index].content.startsWith("- ")) {
      const items: JsonValue[] = [];
      while (index < lines.length && lines[index].indent === indent && lines[index].content.startsWith("- ")) {
        items.push(parseScalar(lines[index].content.slice(2).trim()));
        index++;
      }
      return [items, index];
    }

    const object: Record<string, JsonValue> = {};
    while (index < lines.length && lines[index].indent === indent && !lines[index].content.startsWith("- ")) {
      const line = lines[index].content;
      const separator = line.indexOf(":");
      if (separator < 0) throw new Error(`unsupported YAML line: ${line}`);
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      index++;
      if (value) {
        object[key] = parseScalar(value);
      } else if (index < lines.length && lines[index].indent > indent) {
        [object[key], index] = parseBlock(index, lines[index].indent);
      } else {
        object[key] = {};
      }
    }
    return [object, index];
  };

  const [result] = parseBlock(0, lines[0]?.indent ?? 0);
  if (!result || Array.isArray(result) || typeof result !== "object") throw new Error("YAML root must be an object");
  return result as Record<string, JsonValue>;
}

function parseScalar(value: string): JsonValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => parseScalar(item));
  }
  return value.replace(/^["']|["']$/g, "");
}

export function missingRuntimeRegisters(envelope: AuthorityEnvelope, action: CanonicalActionInput, runtimeRegister: RuntimeRegister): string[] {
  const required = envelope.constraints.required_runtime_registers;
  if (!Array.isArray(required)) return [];
  const runtimeTelemetry = runtimeRegister.telemetry && typeof runtimeRegister.telemetry === "object" && !Array.isArray(runtimeRegister.telemetry)
    ? runtimeRegister.telemetry as Record<string, JsonValue>
    : {};
  const combined = { ...runtimeRegister, telemetry: { ...runtimeTelemetry, ...(action.telemetry ?? {}) }, registers: runtimeRegister.registers ?? {} };
  return required.filter((item) => typeof item === "string" && getPath(combined, item) === undefined) as string[];
}

function getPath(source: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function constraintsPass(envelope: AuthorityEnvelope, action: CanonicalActionInput): boolean {
  const maxAmount = numericConstraint(envelope, "max_amount");
  const amount = numericParam(action, "amount");
  if (maxAmount !== undefined && amount !== undefined && amount > maxAmount) return false;

  const allowedTargets = envelope.constraints.allowed_targets;
  if (Array.isArray(allowedTargets) && !allowedTargets.includes(action.target)) return false;
  return true;
}

function numericConstraint(envelope: AuthorityEnvelope, key: string): number | undefined {
  const value = envelope.constraints[key];
  return typeof value === "number" ? value : undefined;
}

function numericParam(action: CanonicalActionInput, key: string): number | undefined {
  const value = action.params[key];
  return typeof value === "number" ? value : undefined;
}

function stringParam(action: CanonicalActionInput, key: string): string | undefined {
  const value = action.params[key];
  return typeof value === "string" ? value : undefined;
}

function booleanParam(action: CanonicalActionInput, key: string): boolean | undefined {
  const value = action.params[key];
  return typeof value === "boolean" ? value : undefined;
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function submitGovernedAction(options: ExecutionControlClientOptions): Promise<EvaluateExecutionControlResult> {
  const endpoint = options.endpoint ?? "http://127.0.0.1:8181/v1/execution-control/evaluate";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: options.action,
      runtime_register: options.runtimeRegister,
      now: options.now
    })
  });
  const result = await response.json() as EvaluateExecutionControlResult | { error: string; message?: string };
  if (!response.ok && response.status !== 202 && response.status !== 409) {
    throw new Error("message" in result ? result.message : "execution-control runtime request failed");
  }
  return result as EvaluateExecutionControlResult;
}

export function requireAllowedWarrant(result: EvaluateExecutionControlResult): Warrant {
  if (result.decision !== "ALLOW" || !result.warrant) {
    throw new Error(`execution refused by AristotleOS: ${result.decision} ${result.reason_codes.join(",")}`);
  }
  const verification = verifyWarrant(result.warrant, result.canonical_action_hash, result.warrant.issued_at);
  if (!verification.ok) throw new Error(`warrant verification failed: ${verification.reason}`);
  return result.warrant;
}

export function executionControlOpenApiSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "AristotleOS Ward/Warrant Execution-Control Path",
      version: "0.1.1",
      description: "AristotleOS-native execution-control boundary: Canonical Governed Action -> Commit Gate -> Warrant -> GEL."
    },
    // When any operator auth method is configured, /v1 routes require a credential
    // (viewer < operator < admin). Open routes override this with `security: []`.
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    paths: {
      "/health": {
        get: {
          summary: "Runtime health and active governance context",
          security: [],
          responses: { "200": { description: "Runtime is healthy" } }
        }
      },
      "/v1/execution-control/evaluate": {
        post: {
          summary: "Evaluate a proposed governed action before execution",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/CanonicalGovernedAction" },
                    { $ref: "#/components/schemas/EvaluateRequest" }
                  ]
                }
              }
            }
          },
          responses: {
            "200": { description: "ALLOW with Warrant" },
            "202": { description: "ESCALATE for missing state or policy ambiguity" },
            "409": { description: "REFUSE before execution" }
          }
        }
      },
      "/v1/execution-control/proxy": {
        post: {
          summary: "Evaluate a governed action and forward it downstream only on ALLOW (credentials brokered server-side)",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/EvaluateRequest" } } }
          },
          responses: {
            "200": { description: "ALLOW and forwarded; downstream response included" },
            "202": { description: "ESCALATE; not forwarded" },
            "409": { description: "REFUSE; not forwarded" },
            "502": { description: "ALLOW but downstream forwarding failed" }
          }
        }
      },
      "/v1/execution-control/audit/tail": {
        get: {
          summary: "Return recent Governance Evidence Ledger records",
          responses: { "200": { description: "Recent GEL records" } }
        }
      },
      "/v1/execution-control/metrics": {
        get: {
          summary: "Decision counts, reason-code histogram, ledger size and integrity",
          responses: { "200": { description: "Runtime metrics" } }
        }
      },
      "/v1/execution-control/degradation": {
        get: {
          summary: "Live degradation health: detected conditions + the fail action they imply for this Ward (viewer role)",
          responses: { "200": { description: "Degradation status with conditions and projected fail action" } }
        }
      },
      "/v1/execution-control/audit/verify": {
        get: {
          summary: "Verify GEL hash-chain integrity",
          responses: { "200": { description: "Ledger verification result" } }
        }
      },
      "/v1/execution-control/admin/kill": {
        post: {
          summary: "Engage/disengage the sovereign-halt kill switch (admin role; requires auth configured)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { engaged: { type: "boolean" }, reason: { type: "string" } }, required: ["engaged"] } } } },
          responses: { "200": { description: "Kill-switch state updated" }, "401": { description: "Unauthenticated" }, "403": { description: "Requires admin role / auth not configured" }, "409": { description: "Kill switch path not configured" } }
        }
      },
      "/v1/execution-control/admin/revoke": {
        post: {
          summary: "Add a revocation (key/envelope/warrant) to the revocation list (admin role; requires auth configured)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { kind: { type: "string", enum: ["key", "envelope", "warrant"] }, id: { type: "string" }, reason: { type: "string" } }, required: ["kind", "id"] } } } },
          responses: { "200": { description: "Revocation recorded" }, "400": { description: "Invalid revocation" }, "401": { description: "Unauthenticated" }, "403": { description: "Requires admin role / auth not configured" }, "409": { description: "Revocation list not configured" } }
        }
      },
      "/v1/execution-control/governance/compile": {
        post: {
          summary: "Compile a Ward + Authority Envelope into a content-addressed governance manifest (operator role)",
          responses: { "200": { description: "Compiled manifest with hash" }, "403": { description: "Requires operator role" } }
        }
      },
      "/v1/execution-control/governance/diff": {
        post: {
          summary: "Diff two governance manifests and flag weakening changes that require review (operator role)",
          responses: { "200": { description: "Structured diff" }, "403": { description: "Requires operator role" } }
        }
      },
      "/v1/execution-control/governance/explain": {
        post: {
          summary: "Explain how sample actions resolve against a policy through the real Commit Gate (operator role)",
          responses: { "200": { description: "Per-sample decisions" }, "403": { description: "Requires operator role" } }
        }
      },
      "/v1/execution-control/shadow": {
        post: {
          summary: "Observe-only profiling of proposed actions; never mutates the live system (operator role)",
          responses: { "200": { description: "Shadow report with would-decisions and rollout readiness" }, "403": { description: "Requires operator role" } }
        }
      },
      "/v1/execution-control/reconcile": {
        post: {
          summary: "Reconcile offline edge decisions against current and execution-time policy (operator role)",
          responses: { "200": { description: "Reconciliation report with conflicts and resolution state" }, "403": { description: "Requires operator role" } }
        }
      },
      "/v1/execution-control/conflicts/ingest": {
        post: {
          summary: "Ingest edge records into the durable Conflict Inbox; idempotent re-ingest (operator role)",
          responses: { "200": { description: "Reconciliation report + inbox summary" }, "403": { description: "Requires operator role" } }
        }
      },
      "/v1/execution-control/conflicts": {
        get: {
          summary: "List current Conflict Inbox items and summary (viewer role)",
          responses: { "200": { description: "Inbox items + summary" } }
        }
      },
      "/v1/execution-control/conflicts/resolve": {
        post: {
          summary: "Apply an attributed operator resolution to a conflict (operator role)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { action_id: { type: "string" }, action: { type: "string", enum: ["accept", "reject", "escalate", "reconcile"] }, reason: { type: "string" } }, required: ["action_id", "action"] } } } },
          responses: { "200": { description: "Updated item + summary" }, "400": { description: "Invalid resolution" }, "403": { description: "Requires operator role" }, "409": { description: "Item unknown or already resolved" } }
        }
      },
      "/v1/execution-control/approvals": {
        get: {
          summary: "List dual-control (M-of-N) approval requests and their status (viewer role)",
          responses: { "200": { description: "Approval requests + pending count" } }
        }
      },
      "/v1/execution-control/approvals/decide": {
        post: {
          summary: "Cast an attributed approve/reject vote on a dual-control request (operator role)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { request_id: { type: "string" }, decision: { type: "string", enum: ["approve", "reject"] }, reason: { type: "string" } }, required: ["request_id", "decision"] } } } },
          responses: { "200": { description: "Updated approval request" }, "400": { description: "Invalid vote" }, "403": { description: "Requires operator role" }, "409": { description: "Already resolved / self-approval / duplicate vote" } }
        }
      },
      "/v1/execution-control/marshal/census": {
        post: {
          summary: "Ward Marshal census: risk-score observed agents against the approved registry (operator role)",
          responses: { "200": { description: "Census report with rogue/governed findings" }, "403": { description: "Requires operator role" } }
        }
      },
      "/v1/execution-control/marshal/behavior": {
        post: {
          summary: "Ward Marshal behavioral analysis over a governance event stream (operator role)",
          responses: { "200": { description: "Behavior report with detector findings" }, "403": { description: "Requires operator role" } }
        }
      },
      "/openapi.json": {
        get: {
          summary: "OpenAPI contract for the Ward/Warrant execution-control runtime",
          security: [],
          responses: { "200": { description: "OpenAPI 3 specification" } }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Operator credential: a role-scoped static token, the admin API key, or an OIDC JWT. When any auth method is configured, /v1 routes require it (viewer < operator < admin)." },
        apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key", description: "Alternative header for the same operator credential." }
      },
      schemas: {
        EvaluateRequest: {
          type: "object",
          required: ["action"],
          properties: {
            action: { $ref: "#/components/schemas/CanonicalGovernedAction" },
            runtime_register: { type: "object", additionalProperties: true },
            now: { type: "string", format: "date-time" }
          }
        },
        CanonicalGovernedAction: {
          type: "object",
          required: ["action_id", "ward_id", "subject", "action_type", "target", "params", "requested_at"],
          properties: {
            action_id: { type: "string" },
            ward_id: { type: "string" },
            subject: { type: "string" },
            action_type: { type: "string" },
            target: { type: "string" },
            params: { type: "object", additionalProperties: true },
            requested_at: { type: "string", format: "date-time" },
            nonce: { type: "string" },
            request_id: { type: "string" },
            telemetry: { type: "object", additionalProperties: true }
          }
        }
      }
    }
  };
}

export function createExecutionControlRuntimeServer(options: ExecutionControlRuntimeServerOptions): ExecutionControlRuntimeServer {
  const replayProtection = options.replayProtection !== false;
  // One ledger store for the whole server lifetime keeps append and replay checks
  // off the per-request full-scan path. A durable store (SQLite via options.ledger,
  // or Postgres via options.asyncLedger) can be supplied; otherwise a file store
  // is created from ledgerPath.
  const asyncLedger = options.asyncLedger;
  const ledger = asyncLedger ? undefined : (options.ledger ?? new LedgerStore(options.ledgerPath));
  const readRecords = (): Promise<GelRecord[]> => asyncLedger ? asyncLedger.records() : Promise.resolve(ledger!.records());
  const readTail = (limit: number): Promise<GelRecord[]> => asyncLedger ? asyncLedger.tail(limit) : Promise.resolve(ledger!.tail(limit));
  const readVerification = (): { ok: boolean; count: number; failure?: string } => asyncLedger ? asyncLedger.verification() : ledger!.verification();
  const rateLimiter = options.rateLimitPerMinute && options.rateLimitPerMinute > 0
    ? SubjectRateLimiter.perMinute(options.rateLimitPerMinute)
    : undefined;
  const logDecision = (entry: Record<string, unknown>): void => {
    if (options.logFormat === "json") process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  };
  const requestId = (req: IncomingMessage): string => (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : randomUUID());
  const metrics = new RuntimeMetrics();
  // Resolve W3C trace context from (in priority) the request body, the traceparent
  // header, or explicit trace_id; stamped into the GEL record for correlation.
  const traceContextFor = (req: IncomingMessage, body: Record<string, unknown>): TraceContext | undefined => {
    if (body.trace_context && typeof body.trace_context === "object") {
      const normalized = normalizeTraceContext(body.trace_context as TraceContext);
      if (normalized) return normalized;
    }
    const traceparentHeader = typeof req.headers["traceparent"] === "string" ? req.headers["traceparent"] : undefined;
    return parseTraceparent(typeof body.traceparent === "string" ? body.traceparent : traceparentHeader);
  };
  const forwardAudit = (
    event: "evaluate" | "proxy",
    action: CanonicalActionInput,
    result: { decision: ExecutionControlDecision; reason_codes: ExecutionControlReasonCode[]; warrant?: Warrant; gel_record: GelRecord },
    principal?: Principal
  ): void => {
    if (!options.auditSink) return;
    const payload: AuditEvent = {
      event,
      ts: new Date().toISOString(),
      ward_id: options.ward.ward_id,
      subject: action.subject,
      action_type: action.action_type,
      decision: result.decision,
      reason_codes: result.reason_codes,
      warrant_id: result.warrant?.warrant_id,
      signing_key_id: result.warrant?.signing_key_id,
      actor: principal,
      record: result.gel_record
    };
    void deliverAuditEvent(options.auditSink, payload).then((delivery) => {
      if (!delivery.ok) logDecision({ event: "audit_sink_error", sink: options.auditSink, status: delivery.status, error: delivery.error });
    });
  };
  const authConfig: AuthConfig = { apiKey: options.apiKey, operators: options.operators, oidc: options.oidc };
  const requireAuth = authEnabled(authConfig) && !options.servePlayground;

  // Stateful Edge Conflict Inbox: durable when a path is configured, else per-process.
  const conflictInbox = new ConflictInboxStore(options.conflictInboxPath ?? null);

  // Budget governor: enforces per-subject Authority-Envelope budgets. Durable when a
  // state path is configured, else an in-memory window. Disable with budgetDisabled.
  const budgetGovernor = options.budgetDisabled ? undefined : new BudgetGovernor(options.budgetStatePath ?? null);

  // Dual-control approval store: M-of-N approval for the gravest actions. Durable
  // when a path is configured, else per-process. Disable with dualControlDisabled.
  const approvalStore = options.dualControlDisabled ? undefined : new ApprovalStore(options.approvalStatePath ?? null);

  // Degradation detectors: default to a ledger-writability probe for file ledgers,
  // so the boundary self-detects "no evidence ⇒ no irreversible action" out of the
  // box. Operators can disable ([]) or add control-plane/quorum/timeout probes.
  const degradationProbes: DegradationProbe[] = options.degradationProbes
    ?? (options.ledgerPath && !options.ledger && !options.asyncLedger ? [ledgerUnavailableProbe(options.ledgerPath)] : []);

  // Minimum role per route: read paths need viewer, decisions need operator,
  // operator actions (kill switch, revocation) need admin. Unknown /v1 paths
  // default to admin (fail-closed).
  const requiredRoleFor = (method: string, pathname: string): OperatorRole => {
    if (method === "GET" && (
      pathname === "/v1/execution-control/context" ||
      pathname === "/v1/execution-control/audit/tail" ||
      pathname === "/v1/execution-control/audit/verify" ||
      pathname === "/v1/execution-control/metrics" ||
      pathname === "/v1/execution-control/conflicts" ||
      pathname === "/v1/execution-control/degradation" ||
      pathname === "/v1/execution-control/approvals"
    )) return "viewer";
    if (method === "POST" && (
      pathname === "/v1/execution-control/evaluate" ||
      pathname === "/v1/execution-control/proxy" ||
      pathname === "/v1/execution-control/governance/compile" ||
      pathname === "/v1/execution-control/governance/diff" ||
      pathname === "/v1/execution-control/governance/explain" ||
      pathname === "/v1/execution-control/shadow" ||
      pathname === "/v1/execution-control/reconcile" ||
      pathname === "/v1/execution-control/conflicts/ingest" ||
      pathname === "/v1/execution-control/conflicts/resolve" ||
      pathname === "/v1/execution-control/approvals/decide" ||
      pathname === "/v1/execution-control/marshal/census" ||
      pathname === "/v1/execution-control/marshal/behavior"
    )) return "operator";
    return "admin";
  };

  const forwardOperatorAudit = (action_type: string, principal: Principal | undefined, detail: Record<string, unknown>): void => {
    logDecision({ event: "operator_action", action_type, actor: principal ?? null, ...detail });
    if (!options.auditSink) return;
    const payload: AuditEvent = {
      event: "operator_action",
      ts: new Date().toISOString(),
      ward_id: options.ward.ward_id,
      subject: principal?.subject ?? "anonymous",
      action_type,
      decision: "ALLOW",
      reason_codes: [],
      actor: principal
    };
    void deliverAuditEvent(options.auditSink, payload).then((delivery) => {
      if (!delivery.ok) logDecision({ event: "audit_sink_error", sink: options.auditSink, status: delivery.status, error: delivery.error });
    });
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      // Health, OpenAPI, and Prometheus /metrics stay open for liveness/discovery.
      // /v1 routes are role-gated when any credential method is configured (and the
      // demo playground is not being served).
      let principal: Principal | undefined;
      if (requireAuth && url.pathname.startsWith("/v1/execution-control/")) {
        const outcome = resolvePrincipal(presentedCredential(req.headers), authConfig);
        if (outcome.status === "anonymous") { sendJson(res, 401, { error: "unauthorized" }); return; }
        if (outcome.status === "rejected") { sendJson(res, 401, { error: "unauthorized", detail: outcome.reason }); return; }
        if (outcome.status === "forbidden") {
          logDecision({ event: "rbac_denied", reason: outcome.reason, subject: outcome.subject, path: url.pathname });
          sendJson(res, 403, { error: "forbidden", detail: outcome.reason });
          return;
        }
        principal = outcome.principal;
        const needed = requiredRoleFor(req.method ?? "GET", url.pathname);
        if (!roleSatisfies(principal.role, needed)) {
          logDecision({ event: "rbac_denied", subject: principal.subject, role: principal.role, required: needed, path: url.pathname });
          sendJson(res, 403, { error: "forbidden", detail: `requires role ${needed}`, role: principal.role, required: needed });
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          ok: true,
          runtime: "aristotle-ward-warrant-execution-control",
          doctrine: "Governance must bind at the execution boundary before irreversible state mutation or external action occurs.",
          ward_id: options.ward.ward_id,
          authority_envelope_id: options.authorityEnvelope.envelope_id,
          kill_switch_engaged: !!(options.killSwitchPath && existsSync(options.killSwitchPath)),
          replay_protection: replayProtection,
          auth_required: requireAuth,
          auth_methods: {
            api_key: !!options.apiKey,
            operator_tokens: (options.operators?.length ?? 0) > 0,
            oidc: !!options.oidc
          }
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/openapi.json") {
        sendJson(res, 200, executionControlOpenApiSpec());
        return;
      }

      if (req.method === "GET" && url.pathname === "/metrics") {
        const chain = await readRecords();
        // Live in-process counters/histogram (decisions, reason codes, latency,
        // warrant/append failures, replay refusals) plus cumulative ledger gauges.
        const lines = [
          ...metrics.prometheus(),
          "# HELP aristotle_ledger_records Total Governance Evidence Ledger records",
          "# TYPE aristotle_ledger_records gauge",
          `aristotle_ledger_records ${chain.length}`,
          "# HELP aristotle_ledger_ok GEL chain integrity (1 ok, 0 broken)",
          "# TYPE aristotle_ledger_ok gauge",
          `aristotle_ledger_ok ${readVerification().ok ? 1 : 0}`
        ];
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(`${lines.join("\n")}\n`);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/context") {
        sendJson(res, 200, {
          ward_id: options.ward.ward_id,
          subject: options.authorityEnvelope.subject,
          allowed_actions: options.authorityEnvelope.allowed_actions,
          denied_actions: options.authorityEnvelope.denied_actions,
          boundary_id: options.ward.physical_bounds?.permitted_boundary_id ?? "",
          signing_key_id: options.signer?.key_id ?? "ephemeral-dev"
        });
        return;
      }

      // Live degradation health: what the boundary's own detectors see right now, and
      // the fail action that condition set would produce for this Ward's criticality.
      if (req.method === "GET" && url.pathname === "/v1/execution-control/degradation") {
        const conditions = collectDegradation(degradationProbes);
        const resolution = resolveFailMode(options.ward.criticality, conditions);
        sendJson(res, 200, {
          ward_id: options.ward.ward_id,
          criticality: resolution.criticality,
          healthy: conditions.length === 0,
          conditions,
          fail_action: resolution.action,
          binding_condition: resolution.condition ?? null,
          probes: degradationProbes.length
        });
        return;
      }

      if (options.servePlayground && req.method === "GET" && (url.pathname === "/" || url.pathname === "/playground")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PLAYGROUND_HTML);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/evaluate") {
        const startedAt = Date.now();
        const body = await readJsonBody(req);
        const action = (body.action ?? body) as CanonicalActionInput;
        if (rateLimiter && !rateLimiter.allow(action.subject ?? "")) {
          sendJson(res, 429, { error: "rate_limited", subject: action.subject });
          return;
        }
        // Merge self-detected degradation with any caller-supplied conditions.
        const conditions = [
          ...(Array.isArray(body.degraded_conditions) ? (body.degraded_conditions as DegradationCondition[]) : []),
          ...collectDegradation(degradationProbes)
        ];
        // The ledger is the one dependency that can't record its own failure: if it
        // is unavailable, resolve the fail-mode and answer WITHOUT an append — a
        // governed degraded decision instead of an ungoverned 500.
        if (conditions.includes("ledger_unavailable")) {
          const fm = resolveFailMode(options.ward.criticality, conditions);
          const decision: ExecutionControlDecision = fm.action === "refuse" ? "REFUSE" : fm.action === "escalate" ? "ESCALATE" : "ALLOW";
          const anchored = false; // no evidence could be written
          const latencyMs = Date.now() - startedAt;
          metrics.recordDecision(decision, ["DEGRADED_MODE"], latencyMs, false);
          logDecision({ event: "evaluate_degraded", request_id: requestId(req), actor: principal ?? null, decision, condition: fm.condition, criticality: fm.criticality });
          sendJson(res, 200, { decision, reason_codes: ["DEGRADED_MODE"], degraded: true, anchored, condition: fm.condition, detail: "ledger unavailable — decision returned without an evidence record; reconcile when restored" });
          return;
        }
        const evaluateParams = {
          ward: options.ward,
          authorityEnvelope: options.authorityEnvelope,
          action,
          runtimeRegister: body.runtime_register as RuntimeRegister | undefined,
          degradedConditions: conditions.length ? conditions : undefined,
          ledgerPath: options.ledgerPath,
          now: typeof body.now === "string" ? body.now : options.now,
          signer: options.signer,
          killSwitchPath: options.killSwitchPath,
          replayProtection,
          revocationListPath: options.revocationListPath,
          warrantTtlSeconds: options.warrantTtlSeconds,
          actor: principal,
          trace_context: traceContextFor(req, body),
          tracer: options.tracer,
          budgetGovernor,
          approvalStore
        };
        let result: EvaluateExecutionControlResult;
        try {
          result = asyncLedger
            ? await evaluateExecutionControlAsync({ ...evaluateParams, ledger: asyncLedger })
            : evaluateExecutionControl({ ...evaluateParams, ledger });
        } catch (error) {
          metrics.recordLedgerAppendFailure();
          throw error;
        }
        const latencyMs = Date.now() - startedAt;
        metrics.recordDecision(result.decision, result.reason_codes, latencyMs, !!result.warrant);
        logDecision({
          event: "evaluate",
          request_id: requestId(req),
          trace_id: result.gel_record.trace_context?.trace_id ?? null,
          subject: action.subject,
          action_type: action.action_type,
          decision: result.decision,
          reason_codes: result.reason_codes,
          warrant_id: result.warrant?.warrant_id ?? null,
          signing_key_id: result.warrant?.signing_key_id ?? null,
          actor: principal ?? null,
          latency_ms: latencyMs
        });
        forwardAudit("evaluate", action, result, principal);
        sendJson(res, result.decision === "ALLOW" ? 200 : result.decision === "ESCALATE" ? 202 : 409, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/proxy") {
        const startedAt = Date.now();
        const body = await readJsonBody(req);
        const action = (body.action ?? body) as CanonicalActionInput;
        if (rateLimiter && !rateLimiter.allow(action.subject ?? "")) {
          sendJson(res, 429, { error: "rate_limited", subject: action.subject });
          return;
        }
        const result = await proxyGovernedAction({
          ward: options.ward,
          authorityEnvelope: options.authorityEnvelope,
          action,
          ledgerPath: options.ledgerPath,
          signer: options.signer,
          broker: options.broker,
          now: typeof body.now === "string" ? body.now : options.now,
          killSwitchPath: options.killSwitchPath,
          replayProtection,
          revocationListPath: options.revocationListPath,
          warrantTtlSeconds: options.warrantTtlSeconds,
          ledger,
          asyncLedger,
          actor: principal,
          trace_context: traceContextFor(req, body),
          tracer: options.tracer
        });
        const status = result.decision === "ALLOW" ? (result.forwarded ? 200 : 502) : result.decision === "ESCALATE" ? 202 : 409;
        const latencyMs = Date.now() - startedAt;
        metrics.recordDecision(result.decision, result.reason_codes, latencyMs, !!result.warrant);
        if (result.decision === "ALLOW" && !result.forwarded && /warrant verification failed/.test(result.error ?? "")) metrics.recordWarrantFailure();
        logDecision({
          event: "proxy",
          request_id: requestId(req),
          trace_id: result.gel_record.trace_context?.trace_id ?? null,
          subject: action.subject,
          action_type: action.action_type,
          decision: result.decision,
          reason_codes: result.reason_codes,
          forwarded: result.forwarded,
          warrant_id: result.warrant?.warrant_id ?? null,
          actor: principal ?? null,
          status,
          latency_ms: latencyMs
        });
        forwardAudit("proxy", action, result, principal);
        sendJson(res, status, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/audit/tail") {
        const limit = Number(url.searchParams.get("limit") ?? "20");
        sendJson(res, 200, { items: await readTail(limit) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/audit/verify") {
        sendJson(res, 200, verifyGelRecords(await readRecords()));
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/execution-control/metrics") {
        const chain = await readRecords();
        const decisions: Record<string, number> = { ALLOW: 0, REFUSE: 0, ESCALATE: 0 };
        const reasonCodes: Record<string, number> = {};
        for (const record of chain) {
          decisions[record.decision] = (decisions[record.decision] ?? 0) + 1;
          for (const code of record.reason_codes) reasonCodes[code] = (reasonCodes[code] ?? 0) + 1;
        }
        sendJson(res, 200, {
          total_records: chain.length,
          decisions,
          reason_codes: reasonCodes,
          ledger_ok: readVerification().ok,
          signing_key_id: options.signer?.key_id ?? "ephemeral-dev",
          kill_switch_engaged: !!(options.killSwitchPath && existsSync(options.killSwitchPath)),
          replay_protection: replayProtection,
          // Live in-process counters since this process started (latency histogram,
          // warrant/append failures, replay refusals) — complements the cumulative
          // ledger-derived totals above.
          runtime: metrics.snapshot()
        });
        return;
      }

      // Visual Governance Builder backend — pure analysis over provided artifacts
      // (no ledger mutation): compile/hash a draft, diff two drafts (flagging
      // authority-weakening changes), and explain what a draft permits/refuses by
      // running sample actions through the real Commit Gate.
      if (req.method === "POST" && url.pathname === "/v1/execution-control/governance/compile") {
        const body = await readJsonBody(req);
        const ward = (body.ward ?? options.ward) as WardManifest;
        const authorityEnvelope = (body.authority_envelope ?? body.authorityEnvelope ?? options.authorityEnvelope) as AuthorityEnvelope;
        const manifest = compileGovernanceManifest({ ward, authorityEnvelope, now: typeof body.now === "string" ? body.now : options.now });
        logDecision({ event: "governance_compile", request_id: requestId(req), actor: principal ?? null, manifest_hash: manifest.hashes.manifest_hash, validation_ok: manifest.validation.ok });
        sendJson(res, manifest.validation.ok ? 200 : 422, manifest);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/governance/diff") {
        const body = await readJsonBody(req);
        const toDraft = (raw: unknown): GovernanceDraft => {
          const d = (raw ?? {}) as Record<string, unknown>;
          return { ward: (d.ward ?? options.ward) as WardManifest, authorityEnvelope: (d.authority_envelope ?? d.authorityEnvelope ?? options.authorityEnvelope) as AuthorityEnvelope };
        };
        const before = toDraft(body.before);
        const after = toDraft(body.after);
        const entries = diffGovernanceManifests(before, after);
        const weakening = entries.filter((e) => e.weakening);
        logDecision({ event: "governance_diff", request_id: requestId(req), actor: principal ?? null, changes: entries.length, weakening: weakening.length });
        sendJson(res, 200, { entries, summary: { total: entries.length, weakening: weakening.length, requires_review: weakening.length > 0 } });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/governance/explain") {
        const body = await readJsonBody(req);
        const ward = (body.ward ?? options.ward) as WardManifest;
        const authorityEnvelope = (body.authority_envelope ?? body.authorityEnvelope ?? options.authorityEnvelope) as AuthorityEnvelope;
        const sampleActions = Array.isArray(body.sample_actions) ? (body.sample_actions as CanonicalActionInput[]) : undefined;
        const explanation = explainPolicy({ ward, authorityEnvelope, sampleActions, runtimeRegister: body.runtime_register as RuntimeRegister | undefined, now: typeof body.now === "string" ? body.now : options.now });
        logDecision({ event: "governance_explain", request_id: requestId(req), actor: principal ?? null, samples: explanation.samples.length });
        sendJson(res, 200, explanation);
        return;
      }

      // Shadow Mode: observe-only profiling of a batch of proposed actions against the
      // configured (or supplied) Ward/Authority. The live system is untouched.
      if (req.method === "POST" && url.pathname === "/v1/execution-control/shadow") {
        const body = await readJsonBody(req);
        const report = profileShadowMode({
          ward: (body.ward ?? options.ward) as WardManifest,
          authorityEnvelope: (body.authority_envelope ?? body.authorityEnvelope ?? options.authorityEnvelope) as AuthorityEnvelope,
          actions: Array.isArray(body.actions) ? (body.actions as ShadowAction[]) : [],
          signer: options.signer,
          now: typeof body.now === "string" ? body.now : options.now,
          revocationListPath: options.revocationListPath
        });
        logDecision({ event: "shadow_profile", request_id: requestId(req), actor: principal ?? null, evaluated: report.count, rollout_ready: report.rollout.ready });
        sendJson(res, 200, report);
        return;
      }

      // Edge reconciliation: classify offline edge decisions vs current + execution-time policy.
      if (req.method === "POST" && url.pathname === "/v1/execution-control/reconcile") {
        const body = await readJsonBody(req);
        const report = reconcileEdgeRecords({
          records: Array.isArray(body.records) ? (body.records as EdgeRecord[]) : [],
          ward: (body.ward ?? options.ward) as WardManifest,
          authorityEnvelope: (body.authority_envelope ?? body.authorityEnvelope ?? options.authorityEnvelope) as AuthorityEnvelope,
          now: typeof body.now === "string" ? body.now : options.now
        });
        logDecision({ event: "reconcile", request_id: requestId(req), actor: principal ?? null, items: report.count, conflicts: report.conflicts });
        sendJson(res, 200, report);
        return;
      }

      // Conflict Inbox: ingest edge records into the durable inbox (re-evaluated
      // through the real gate). Idempotent: re-ingest refreshes evidence but never
      // reopens an operator's resolution.
      if (req.method === "POST" && url.pathname === "/v1/execution-control/conflicts/ingest") {
        const body = await readJsonBody(req);
        const report = conflictInbox.ingest({
          records: Array.isArray(body.records) ? (body.records as EdgeRecord[]) : [],
          ward: (body.ward ?? options.ward) as WardManifest,
          authorityEnvelope: (body.authority_envelope ?? body.authorityEnvelope ?? options.authorityEnvelope) as AuthorityEnvelope,
          now: typeof body.now === "string" ? body.now : options.now
        });
        logDecision({ event: "conflicts_ingest", request_id: requestId(req), actor: principal ?? null, items: report.count, conflicts: report.conflicts });
        sendJson(res, 200, { report, summary: conflictInbox.summary() });
        return;
      }

      // Conflict Inbox: list current items (viewer).
      if (req.method === "GET" && url.pathname === "/v1/execution-control/conflicts") {
        sendJson(res, 200, { items: conflictInbox.list(), summary: conflictInbox.summary() });
        return;
      }

      // Dual control: list approval requests (viewer).
      if (req.method === "GET" && url.pathname === "/v1/execution-control/approvals") {
        if (!approvalStore) { sendJson(res, 200, { items: [], pending: 0 }); return; }
        const items = approvalStore.list();
        sendJson(res, 200, { items, pending: items.filter((i) => i.status === "pending").length });
        return;
      }

      // Dual control: cast an attributed approve/reject vote (operator).
      if (req.method === "POST" && url.pathname === "/v1/execution-control/approvals/decide") {
        if (!approvalStore) { sendJson(res, 409, { error: "dual_control_disabled" }); return; }
        const body = await readJsonBody(req);
        const requestId = typeof body.request_id === "string" ? body.request_id : undefined;
        const decision = typeof body.decision === "string" ? body.decision : undefined;
        const reason = typeof body.reason === "string" ? body.reason : undefined;
        if (!requestId || (decision !== "approve" && decision !== "reject")) {
          sendJson(res, 400, { error: "invalid_vote", detail: "request_id and a decision of approve|reject are required" });
          return;
        }
        try {
          const item = approvalStore.vote(requestId, principal?.subject ?? "anonymous", decision, reason, typeof body.now === "string" ? body.now : options.now);
          forwardOperatorAudit("approval.vote", principal, { request_id: requestId, decision, status: item.status, reason: reason ?? null });
          sendJson(res, 200, { item });
        } catch (error) {
          sendJson(res, 409, { error: "vote_rejected", detail: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      // Conflict Inbox: apply an attributed operator resolution (operator).
      if (req.method === "POST" && url.pathname === "/v1/execution-control/conflicts/resolve") {
        const body = await readJsonBody(req);
        const actionId = typeof body.action_id === "string" ? body.action_id : undefined;
        const resolution = typeof body.action === "string" ? (body.action as ResolutionAction) : undefined;
        const reason = typeof body.reason === "string" ? body.reason : undefined;
        if (!actionId || !resolution || !["accept", "reject", "escalate", "reconcile"].includes(resolution)) {
          sendJson(res, 400, { error: "invalid_resolution", detail: "action_id and a valid action (accept|reject|escalate|reconcile) are required" });
          return;
        }
        try {
          const item = conflictInbox.resolve(actionId, resolution, principal?.subject ?? "anonymous", reason, typeof body.now === "string" ? body.now : options.now);
          forwardOperatorAudit("conflict.resolve", principal, { action_id: actionId, resolution, status: item.status, reason: reason ?? null });
          sendJson(res, 200, { item, summary: conflictInbox.summary() });
        } catch (error) {
          sendJson(res, 409, { error: "resolution_rejected", detail: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      // Ward Marshal census: risk-score observed agents against the approved registry.
      if (req.method === "POST" && url.pathname === "/v1/execution-control/marshal/census") {
        const body = await readJsonBody(req);
        const report = runWardMarshalCensus({
          observations: Array.isArray(body.observations) ? (body.observations as AgentObservation[]) : [],
          registry: body.registry as AgentRegistry | undefined,
          generatedAt: typeof body.now === "string" ? body.now : options.now
        });
        logDecision({ event: "marshal_census", request_id: requestId(req), actor: principal ?? null, observed: report.summary.observed, rogue: report.summary.rogue });
        sendJson(res, 200, report);
        return;
      }

      // Ward Marshal behavioral analysis over a governance event stream.
      if (req.method === "POST" && url.pathname === "/v1/execution-control/marshal/behavior") {
        const body = await readJsonBody(req);
        const events = Array.isArray(body.events) ? (body.events as BehaviorEvent[]) : [];
        const report = analyzeAgentBehavior(events, { ...(body.config as BehaviorAnalysisConfig | undefined), now: typeof body.now === "string" ? body.now : options.now });
        logDecision({ event: "marshal_behavior", request_id: requestId(req), actor: principal ?? null, findings: report.summary.findings, high_or_critical: report.summary.high_or_critical });
        sendJson(res, 200, report);
        return;
      }

      // Admin-only operator actions. The top-of-handler gate already requires the
      // `admin` role; these are additionally disabled unless authentication is
      // configured, so an open/dev boundary never exposes a network kill switch.
      if (req.method === "POST" && url.pathname === "/v1/execution-control/admin/kill") {
        if (!requireAuth) { sendJson(res, 403, { error: "forbidden", detail: "operator actions require authentication to be configured" }); return; }
        if (!options.killSwitchPath) { sendJson(res, 409, { error: "kill_switch_not_configured" }); return; }
        const body = await readJsonBody(req);
        const engage = body.engaged === true || body.engaged === "true";
        const reason = typeof body.reason === "string" ? body.reason : undefined;
        if (engage) {
          mkdirSync(path.dirname(path.resolve(options.killSwitchPath)), { recursive: true });
          writeFileSync(options.killSwitchPath, `${JSON.stringify({ engaged_at: new Date().toISOString(), by: principal?.subject, role: principal?.role, reason }, null, 2)}\n`, "utf8");
        } else if (existsSync(options.killSwitchPath)) {
          rmSync(options.killSwitchPath);
        }
        forwardOperatorAudit(engage ? "kill_switch.engage" : "kill_switch.disengage", principal, { reason: reason ?? null });
        sendJson(res, 200, { kill_switch_engaged: engage, by: principal?.subject, reason });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/execution-control/admin/revoke") {
        if (!requireAuth) { sendJson(res, 403, { error: "forbidden", detail: "operator actions require authentication to be configured" }); return; }
        if (!options.revocationListPath) { sendJson(res, 409, { error: "revocation_list_not_configured" }); return; }
        const body = await readJsonBody(req);
        const kind = body.kind;
        const id = body.id;
        if ((kind !== "key" && kind !== "envelope" && kind !== "warrant") || typeof id !== "string" || id.length === 0) {
          sendJson(res, 400, { error: "invalid_revocation", detail: "kind must be key|envelope|warrant and id is required" });
          return;
        }
        const list = addRevocation(options.revocationListPath, kind as RevocationKind, id);
        forwardOperatorAudit("revocation.add", principal, { kind, id, reason: typeof body.reason === "string" ? body.reason : null });
        sendJson(res, 200, { revoked: { kind, id }, list });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const statusCode = (error as { statusCode?: unknown })?.statusCode;
      const status = typeof statusCode === "number" ? statusCode : 400;
      sendJson(res, status, { error: "execution_control_runtime_error", message: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server };
}

const MAX_REQUEST_BODY_BYTES = 1_000_000;

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw Object.assign(new Error(`request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}
