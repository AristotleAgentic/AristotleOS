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
 * Space launch and orbital mission readiness primitives.
 *
 * Space adapters do not fire engines or release vehicles directly. They translate
 * range-safety, telemetry, propellant load, ignition, flight termination, payload
 * deploy, and downrange-asset requests into Canonical Governed Actions. A real
 * adapter must verify the resulting Warrant before it commands any countdown step,
 * any flight-termination state change, any igniter arm, or any payload separation.
 *
 * The safety invariants enforced here are designed to ALIGN WITH (but do NOT
 * substitute for) the governing regimes:
 *
 *   - 14 CFR Part 450 — Launch and Reentry Vehicle Operator Licensing (flight-
 *     termination criteria, debris analysis, public-risk thresholds Ec/Pc,
 *     hazard areas, flight safety system independence).
 *   - 14 CFR Part 415 / 417 — legacy launch licensing where still applicable.
 *   - FAA Office of Commercial Space Transportation (AST) license & permit
 *     conditions.
 *   - U.S. Space Force / Space Launch Delta (SLD-30 Vandenberg, SLD-45 CCSFS)
 *     range safety; range commander authority over flight termination.
 *   - NASA NPR 8715.5 range safety (Wallops, federal launch ranges).
 *   - ITAR (22 CFR 120-130) USML Category IV (launch vehicles) and Category XV
 *     (spacecraft, satellites, ground control) — export-control gating of
 *     payload / vehicle data.
 *   - EAR (15 CFR 730-774) where ITAR does not apply.
 *   - 47 CFR Part 25 / Part 87 — ITU radio licensing for launch and on-orbit
 *     communications.
 *   - UN Outer Space Treaty + Registration Convention + Liability Convention
 *     at the international layer.
 *
 * Exceeding the minimums: every countdown-advancing or commit-class action is
 * admitted only with the range CLEAR, weather + winds within site rules, flight
 * termination system ARMED and healthy, autonomous-flight-termination state
 * machine nominal, propellant temperature in spec, comms-licensing acknowledged,
 * ITAR / EAR posture declared, and the launch window OPEN — and high-consequence
 * acts (ignite, flight-termination trigger, payload deploy outside primary
 * insertion, anomaly-mode autonomous response) require dual control. All of it
 * is bound into a tamper-evident, signed Evidence Bundle.
 *
 * IMPORTANT: All shipped JURISDICTION_RULE_PRESETS (Cape Canaveral, Vandenberg,
 * Wallops, Starbase, Kodiak, Mojave) are DEMONSTRATION ONLY. They illustrate the
 * shape of a deployable launch-site rule pack; they have NOT been reviewed by
 * the FAA AST, the relevant Space Launch Delta, NASA range safety, or counsel.
 * No real launch may rely on these presets. Real deployments require per-range
 * coordination + AST licensee approval + signed Letter of Agreement before any
 * preset can be promoted past `rule_validation_state: "demonstration"`.
 */

// ---------------------------------------------------------------------------
// Domain enums
// ---------------------------------------------------------------------------

export type SpaceVehicleClass =
  | "orbital-launch-vehicle"
  | "suborbital-launch-vehicle"
  | "reentry-vehicle"
  | "hybrid"
  | "balloon-class-101"
  | "test-article";

export type SpaceLaunchSite =
  | "ccsfs"        // Cape Canaveral Space Force Station, FL (SLD-45)
  | "ksc"          // NASA Kennedy Space Center, FL
  | "vandenberg"   // Vandenberg SFB, CA (SLD-30)
  | "wallops"      // NASA Wallops Flight Facility, VA
  | "starbase"     // SpaceX Boca Chica, TX (FAA licensed)
  | "kodiak"       // Pacific Spaceport Complex, AK
  | "mojave"       // Mojave Air & Space Port, CA
  | "spaceport-america"
  | "rocket-lab-lc1" // New Zealand
  | "edwards"      // Edwards AFB / NASA Armstrong
  | "white-sands"
  | "other";

export type SpaceAdapterKind =
  | "range-safety"
  | "telemetry"
  | "propellant"
  | "ignition"
  | "flight-termination"
  | "guidance"
  | "payload"
  | "comms-licensing"
  | "weather-winds"
  | "fts-health"
  | "ground-systems"
  | "tracking-radar"
  | "mission-ops"
  | "ttc-command"
  | "orbit-maneuver"
  | "rf-spectrum"
  | "payload-tasking"
  | "ground-station"
  | "conjunction-screening"
  | "rendezvous-proximity"
  | "deorbit-reentry"
  | "historian";

export type SpaceCountdownPhase =
  | "pre-flow"
  | "tanking"
  | "terminal-count"
  | "hold"
  | "scrub"
  | "lifting"
  | "powered-flight"
  | "stage-sep"
  | "second-burn"
  | "deploy"
  | "post-flight";

export type SpaceMissionClass =
  | "earth-observation"
  | "communications"
  | "navigation"
  | "space-domain-awareness"
  | "in-orbit-servicing"
  | "rendezvous-proximity-ops"
  | "deorbit"
  | "defense";

export type OrbitRegime = "LEO" | "MEO" | "GEO" | "HEO" | "cislunar" | "suborbital" | string;

export interface SpaceAdapterDescriptor {
  id: SpaceAdapterKind;
  label: string;
  /** True when adapter operations must be admitted only with a verified Warrant. */
  warrant_required: boolean;
  /** True when the adapter touches consequential physical state. */
  consequential: boolean;
}

// 13 typed boundaries the operator UI / docs / tests reason about.
export const SPACE_ADAPTER_CATALOG: SpaceAdapterDescriptor[] = [
  { id: "range-safety", label: "Range Safety / Range Commander authority", warrant_required: true, consequential: true },
  { id: "telemetry", label: "Vehicle telemetry ingest (TDRSS / S-band / C-band)", warrant_required: false, consequential: false },
  { id: "propellant", label: "Propellant load, chill, drain, top-off", warrant_required: true, consequential: true },
  { id: "ignition", label: "Igniter arm, main-engine start, abort", warrant_required: true, consequential: true },
  { id: "flight-termination", label: "Flight Termination System (FTS) arm / disarm / trigger", warrant_required: true, consequential: true },
  { id: "guidance", label: "Guidance, navigation, control updates", warrant_required: true, consequential: true },
  { id: "payload", label: "Payload deploy, separation, despin, sat checkout", warrant_required: true, consequential: true },
  { id: "comms-licensing", label: "ITU / FCC Part 25 / Part 87 radio licensing", warrant_required: false, consequential: false },
  { id: "weather-winds", label: "Weather / winds-aloft / lightning detection", warrant_required: false, consequential: false },
  { id: "fts-health", label: "FTS health-check, battery, RF link to range", warrant_required: false, consequential: false },
  { id: "ground-systems", label: "Pad systems, water deluge, hold-down release", warrant_required: true, consequential: true },
  { id: "tracking-radar", label: "Tracking radar handover / acquisition", warrant_required: false, consequential: false },
  { id: "mission-ops", label: "On-orbit mission operations and mode control", warrant_required: true, consequential: true },
  { id: "ttc-command", label: "TT&C uplink and spacecraft command stack", warrant_required: true, consequential: true },
  { id: "orbit-maneuver", label: "Stationkeeping, collision-avoidance, phasing, disposal burns", warrant_required: true, consequential: true },
  { id: "rf-spectrum", label: "RF transmitter enable, carrier plan, crosslink activation", warrant_required: true, consequential: true },
  { id: "payload-tasking", label: "Imaging, collection, deployer, and payload-mode tasking", warrant_required: true, consequential: true },
  { id: "ground-station", label: "Ground-station contact scheduling and command-window open", warrant_required: true, consequential: true },
  { id: "conjunction-screening", label: "Conjunction assessment and collision-avoidance plan approval", warrant_required: false, consequential: false },
  { id: "rendezvous-proximity", label: "Rendezvous, proximity operations, hold point, docking/capture", warrant_required: true, consequential: true },
  { id: "deorbit-reentry", label: "Disposal burn, controlled reentry, passivation", warrant_required: true, consequential: true },
  { id: "historian", label: "Historian / range data archival (NPR / DOD retention)", warrant_required: false, consequential: false }
];

export const SPACE_REGULATORY_PROFILE = [
  "FAA Part 450",
  "FAA Part 415",
  "FAA Part 417",
  "FAA AST license",
  "USSF Range Safety",
  "NASA NPR 8715.5",
  "ITAR USML IV+XV",
  "EAR",
  "FCC Part 25",
  "FCC Part 87",
  "UN Outer Space Treaty"
] as const;

// ---------------------------------------------------------------------------
// Jurisdiction rule presets (DEMONSTRATION ONLY)
// ---------------------------------------------------------------------------

export interface SpaceLaunchSiteRuleSet {
  /** Site identifier. */
  site_id: SpaceLaunchSite;
  /** Range authority (e.g. "USSF SLD-45", "NASA Wallops Range", "FAA AST"). */
  range_authority: string;
  /** Maximum surface wind speed permitted at lift-off (knots). */
  max_surface_wind_kts: number;
  /** Maximum upper-level wind shear permitted (knots per 1000 ft). */
  max_upper_wind_shear_kts_per_kft: number;
  /** Whether a Flight Termination System is mandatory for crewed/uncrewed flight. */
  require_fts: boolean;
  /** Whether Autonomous Flight Termination System (AFTS) is required (Part 450). */
  require_afts: boolean;
  /** Whether ITAR pre-clearance is required for the payload class. */
  require_itar_clearance: boolean;
  /** Maximum public Ec (expected casualties) per FAA Part 450 thresholds. */
  max_public_ec: number;
  /** Whether daylight constraint applies to launch (some sites only). */
  daylight_only: boolean;
  /** Permitted vehicle classes at this site. */
  permitted_vehicle_classes: SpaceVehicleClass[];
  /** Rule pack version. */
  rule_version: string;
  /** Demonstration flag — MUST stay true until counsel + range coordination. */
  demonstration_only: true;
}

// All values below are illustrative; verify with the FAA AST / range authority.
export const SPACE_JURISDICTION_RULE_PRESETS: Record<string, SpaceLaunchSiteRuleSet> = {
  ccsfs: {
    site_id: "ccsfs",
    range_authority: "USSF SLD-45 Cape Canaveral Space Force Station",
    max_surface_wind_kts: 30,
    max_upper_wind_shear_kts_per_kft: 30,
    require_fts: true,
    require_afts: true,
    require_itar_clearance: true,
    max_public_ec: 1e-4,
    daylight_only: false,
    permitted_vehicle_classes: ["orbital-launch-vehicle", "suborbital-launch-vehicle", "reentry-vehicle"],
    rule_version: "ccsfs-demo-2026-05-26",
    demonstration_only: true
  },
  vandenberg: {
    site_id: "vandenberg",
    range_authority: "USSF SLD-30 Vandenberg Space Force Base",
    max_surface_wind_kts: 30,
    max_upper_wind_shear_kts_per_kft: 30,
    require_fts: true,
    require_afts: true,
    require_itar_clearance: true,
    max_public_ec: 1e-4,
    daylight_only: false,
    permitted_vehicle_classes: ["orbital-launch-vehicle", "suborbital-launch-vehicle"],
    rule_version: "vandenberg-demo-2026-05-26",
    demonstration_only: true
  },
  wallops: {
    site_id: "wallops",
    range_authority: "NASA Wallops Flight Facility Range",
    max_surface_wind_kts: 25,
    max_upper_wind_shear_kts_per_kft: 25,
    require_fts: true,
    require_afts: false,
    require_itar_clearance: true,
    max_public_ec: 1e-4,
    daylight_only: false,
    permitted_vehicle_classes: ["orbital-launch-vehicle", "suborbital-launch-vehicle", "test-article"],
    rule_version: "wallops-demo-2026-05-26",
    demonstration_only: true
  },
  starbase: {
    site_id: "starbase",
    range_authority: "FAA AST + USCG Sector Corpus Christi (maritime exclusion)",
    max_surface_wind_kts: 27,
    max_upper_wind_shear_kts_per_kft: 30,
    require_fts: true,
    require_afts: true,
    require_itar_clearance: true,
    max_public_ec: 1e-4,
    daylight_only: false,
    permitted_vehicle_classes: ["orbital-launch-vehicle", "suborbital-launch-vehicle"],
    rule_version: "starbase-demo-2026-05-26",
    demonstration_only: true
  },
  kodiak: {
    site_id: "kodiak",
    range_authority: "Alaska Aerospace Corporation, Pacific Spaceport Complex",
    max_surface_wind_kts: 25,
    max_upper_wind_shear_kts_per_kft: 25,
    require_fts: true,
    require_afts: true,
    require_itar_clearance: true,
    max_public_ec: 1e-4,
    daylight_only: false,
    permitted_vehicle_classes: ["orbital-launch-vehicle", "suborbital-launch-vehicle"],
    rule_version: "kodiak-demo-2026-05-26",
    demonstration_only: true
  },
  mojave: {
    site_id: "mojave",
    range_authority: "FAA AST + Mojave Air & Space Port (suborbital/test only)",
    max_surface_wind_kts: 20,
    max_upper_wind_shear_kts_per_kft: 25,
    require_fts: true,
    require_afts: false,
    require_itar_clearance: true,
    max_public_ec: 1e-4,
    daylight_only: true,
    permitted_vehicle_classes: ["suborbital-launch-vehicle", "test-article"],
    rule_version: "mojave-demo-2026-05-26",
    demonstration_only: true
  }
};

// ---------------------------------------------------------------------------
// Runtime snapshot — what the gate sees about live vehicle / range state
// ---------------------------------------------------------------------------

export interface SpaceRuntimeSnapshot {
  /** Mission / flight identifier. */
  flight_id: string;
  /** Vehicle class. */
  vehicle_class: SpaceVehicleClass;
  /** Vehicle model identifier (e.g. "falcon-9-block-5", "electron", "ship-37"). */
  vehicle_model: string;
  /** Operator / launch provider id (e.g. "operator:spacex", "operator:rocket-lab"). */
  operator_id: string;
  /** Active launch site. */
  launch_site: SpaceLaunchSite;
  /** Site rule pack in effect (matches JURISDICTION_RULE_PRESETS key). */
  site_rule_version: string;

  /** Countdown phase. */
  countdown_phase: SpaceCountdownPhase;
  /** ISO timestamp of launch-window open. */
  window_open_at: string;
  /** ISO timestamp of launch-window close. */
  window_close_at: string;
  /** True iff range is currently clear (ships, aircraft, hazard area). */
  range_clear: boolean;
  /** Surface wind speed (knots). */
  surface_wind_kts: number;
  /** Upper-level wind shear (knots / 1000 ft). */
  upper_wind_shear_kts_per_kft: number;
  /** True iff weather is within site limits. */
  weather_within_limits: boolean;

  /** True iff FTS armed & healthy. */
  fts_armed: boolean;
  /** True iff AFTS state machine nominal (Part 450 systems). */
  afts_nominal: boolean;
  /** True iff FTS battery within voltage envelope. */
  fts_battery_ok: boolean;
  /** True iff range-safety RF link to vehicle is healthy. */
  fts_rf_link_ok: boolean;

  /** Propellant temperatures within spec, by stage (kelvin). */
  propellant_temp_k_within_spec: boolean;
  /** Whether ITAR / EAR pre-clearance is on file for this mission's payload. */
  itar_cleared: boolean;
  /** Whether ITU / FCC radio licensing is on file for this mission's comms. */
  comms_licensed: boolean;

  /** Maximum aerodynamic pressure (max-Q) in kPa expected for this trajectory. */
  expected_max_q_kpa: number;
  /** Hazard area cleared (downrange, near-shore, overflight). */
  hazard_area_cleared: boolean;
  /** Tracking radar acquired. */
  tracking_radar_acquired: boolean;

  /** Range commander has issued GO. */
  range_commander_go: boolean;

  /** Authority envelope unrevoked. */
  authority_envelope_unrevoked: boolean;
  /** Signer authorized for this mission. */
  signer_authorized: boolean;

  /** Mission-specific identifiers. */
  actor_id: string;
  /** Action-level callsign / call signature. */
  callsign?: string;
}

export interface SpaceOrbitalRuntimeSnapshot {
  asset_id: string;
  asset_type: "satellite" | "constellation" | "ground-station" | "payload" | string;
  mission_id: string;
  mission_class: SpaceMissionClass | string;
  orbit_regime: OrbitRegime;
  orbital_slot?: string;
  ground_station_id?: string;
  rf_band?: string;
  payload_mode?: string;
  target_region?: string;
  operator_id: string;
  controller_id?: string;
  command_window_active: boolean;
  command_window_age_ms: number;
  ephemeris_age_ms: number;
  telemetry_age_ms: number;
  delta_v_mps?: number;
  burn_duration_s?: number;
  conjunction_probability?: number;
  miss_distance_km?: number;
  power_margin_pct: number;
  thermal_limits_nominal: boolean;
  attitude_control_stable: boolean;
  safe_mode_available: boolean;
  collision_avoidance_enabled: boolean;
  conjunction_screening_clear: boolean;
  debris_mitigation_plan_approved: boolean;
  rf_authorization_active: boolean;
  ground_station_authorized: boolean;
  payload_tasking_authorized: boolean;
  export_control_clearance: boolean;
  deorbit_plan_approved?: boolean;
  casualty_risk_accepted?: boolean;
  relative_navigation_valid?: boolean;
  operator_console_locked: boolean;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

// ---------------------------------------------------------------------------
// Adapter request types
// ---------------------------------------------------------------------------

export interface SpaceActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: SpaceRuntimeSnapshot;
  /** Optional ISO timestamp (alias of requested_at for parity with other verticals). */
  now?: string;
  classification?: { level: "UNCLASSIFIED" | "CUI" | "CONFIDENTIAL" | "SECRET" | "TOP_SECRET"; caveats?: string[] };
  telemetry?: Record<string, JsonValue>;
}

export interface SpaceOrbitalActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: SpaceOrbitalRuntimeSnapshot;
  now?: string;
  classification?: { level: "UNCLASSIFIED" | "CUI" | "CONFIDENTIAL" | "SECRET" | "TOP_SECRET"; caveats?: string[] };
  telemetry?: Record<string, JsonValue>;
}

export interface RangeSafetyRequest {
  action_type:
    | "space.range_clear_declare"
    | "space.range_hold"
    | "space.range_commander_go"
    | "space.override_range_safety"
    | "space.bypass_collision_avoidance";
  reason?: string;
}

export interface PropellantRequest {
  action_type:
    | "space.propellant_load"
    | "space.propellant_drain"
    | "space.propellant_top_off"
    | "space.override_propellant_limits";
  stage: string;
  volume_l?: number;
  reason?: string;
}

export interface IgnitionRequest {
  action_type:
    | "space.igniter_arm"
    | "space.ignite"
    | "space.abort_ignition"
    | "space.ignite_outside_window";
  stage: string;
  reason?: string;
}

export interface FlightTerminationRequest {
  action_type:
    | "space.fts_arm"
    | "space.fts_disarm"
    | "space.fts_trigger"
    | "space.disable_flight_termination";
  reason?: string;
}

export interface SpacePayloadRequest {
  action_type:
    | "space.payload_deploy"
    | "space.payload_despin"
    | "space.payload_separate"
    | "space.payload_deploy_outside_primary";
  payload_id: string;
  reason?: string;
}

export interface GroundSystemsRequest {
  action_type:
    | "space.water_deluge_arm"
    | "space.hold_down_release"
    | "space.pad_emergency_stop"
    | "space.bypass_pad_interlocks";
  reason?: string;
}

export interface CommsLicensingRequest {
  action_type:
    | "space.comms_freq_acknowledge"
    | "space.comms_handover";
  freq_band?: string;
  notes?: string;
}

export interface WeatherWindsRequest {
  action_type:
    | "space.weather_constraint_acknowledge"
    | "space.bypass_wind_limits";
  notes?: string;
}

export interface SpaceHistorianWriteRequest {
  action_type: "space.historian_write";
  records: Array<{ kind: string; value: JsonValue }>;
}

export interface OrbitManeuverRequest {
  maneuver_id: string;
  operation: "stationkeeping" | "collision-avoidance" | "phasing" | "orbit-raise" | "disposal";
  delta_v_mps?: number;
  burn_duration_s?: number;
  action_type?: string;
}

export interface RfTransmissionRequest {
  carrier_id: string;
  operation: "enable" | "disable" | "plan" | "crosslink-activate";
  rf_band?: string;
  action_type?: string;
}

export interface OrbitalPayloadTaskingRequest {
  task_id: string;
  operation: "image-collect" | "mode-set" | "deploy";
  payload_mode?: string;
  target_region?: string;
  action_type?: string;
}

export interface GroundStationContactRequest {
  contact_id: string;
  ground_station_id: string;
  operation: "schedule" | "handoff" | "open-command-window";
  action_type?: string;
}

export interface ConjunctionAssessmentRequest {
  assessment_id: string;
  operation: "run" | "approve-plan";
  action_type?: string;
}

export interface RendezvousProximityRequest {
  rpo_id: string;
  operation: "approach" | "hold-point" | "capture";
  action_type?: string;
}

export interface DeorbitReentryRequest {
  disposal_id: string;
  operation: "deorbit-burn" | "reentry-commit" | "passivate";
  action_type?: string;
}

export interface SpaceOrbitalHistorianWriteRequest {
  historian_id: string;
  stream: string;
  record_type: "command-receipt" | "anomaly-marker" | "compliance-marker" | string;
  payload: Record<string, JsonValue>;
  action_type?: string;
}

export type SpaceAdapterRequest =
  | RangeSafetyRequest
  | PropellantRequest
  | IgnitionRequest
  | FlightTerminationRequest
  | SpacePayloadRequest
  | GroundSystemsRequest
  | CommsLicensingRequest
  | WeatherWindsRequest
  | SpaceHistorianWriteRequest;

export type SpaceOrbitalAdapterRequest =
  | { kind: "orbit-maneuver"; request: OrbitManeuverRequest }
  | { kind: "rf-spectrum"; request: RfTransmissionRequest }
  | { kind: "payload-tasking"; request: OrbitalPayloadTaskingRequest }
  | { kind: "ground-station"; request: GroundStationContactRequest }
  | { kind: "conjunction-screening"; request: ConjunctionAssessmentRequest }
  | { kind: "rendezvous-proximity"; request: RendezvousProximityRequest }
  | { kind: "deorbit-reentry"; request: DeorbitReentryRequest }
  | { kind: "historian"; request: SpaceOrbitalHistorianWriteRequest };

// ---------------------------------------------------------------------------
// Evidence context
// ---------------------------------------------------------------------------

export interface SpaceEvidenceContext {
  flight_id: string;
  operator_id: string;
  launch_site: SpaceLaunchSite;
  site_rule_version: string;
  vehicle_class: SpaceVehicleClass;
  vehicle_model: string;
  countdown_phase: SpaceCountdownPhase;
  window_open_at: string;
  window_close_at: string;
  range_commander_id: string;
  itar_posture: "cleared" | "pending" | "not-applicable";
  comms_licensing_posture: "filed" | "pending" | "not-applicable";
  regulatory_evidence_profile: Array<
    | "FAA_PART_450"
    | "FAA_PART_415"
    | "FAA_PART_417"
    | "FAA_AST_LICENSE"
    | "USSF_RANGE_SAFETY"
    | "NASA_NPR_8715_5"
    | "ITAR_USML_IV"
    | "ITAR_USML_XV"
    | "EAR"
    | "FCC_PART_25"
    | "FCC_PART_87"
  >;
  /** Whether the site rule pack in effect has been validated for production use. */
  rule_validation_state: "demonstration" | "operator-validated" | "counsel-reviewed" | "range-coordinated";
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
}

export interface SpaceEvidenceBundle {
  bundle_version: "aristotle.space-evidence.v1";
  exported_at: string;
  space: SpaceEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    space_context_hash: string;
    execution_bundle_hash: string;
    space_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

export interface SpaceOrbitalEvidenceContext {
  mission_id: string;
  asset_id: string;
  asset_type: string;
  mission_class: SpaceMissionClass | string;
  orbit_regime: OrbitRegime;
  operator_id: string;
  ground_station_id?: string;
  rf_band?: string;
  payload_mode?: string;
  maneuver_id?: string;
  conjunction_probability?: number;
  miss_distance_km?: number;
  regulatory_evidence_profile: Array<
    | "FCC_ITU_SPECTRUM"
    | "EARTH_STATION_LICENSE"
    | "NOAA_REMOTE_SENSING"
    | "FAA_AST_LAUNCH_REENTRY"
    | "SSA_CONJUNCTION_SCREENING"
    | "IADC_DEBRIS_MITIGATION"
    | "ITAR_EAR_EXPORT_CONTROL"
    | "MISSION_ASSURANCE"
    | string
  >;
  redaction_manifest?: {
    redacted_fields: string[];
    retained_hashes: string[];
  };
}

export interface SpaceOrbitalEvidenceBundle {
  bundle_version: "aristotle.space-orbital-evidence.v1";
  exported_at: string;
  orbital: SpaceOrbitalEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    orbital_context_hash: string;
    execution_bundle_hash: string;
    orbital_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshotParams(snapshot: SpaceRuntimeSnapshot): Record<string, JsonValue> {
  return {
    flight_id: snapshot.flight_id,
    vehicle_class: snapshot.vehicle_class,
    vehicle_model: snapshot.vehicle_model,
    operator_id: snapshot.operator_id,
    launch_site: snapshot.launch_site,
    site_rule_version: snapshot.site_rule_version,
    boundary_id: snapshot.launch_site,
    countdown_phase: snapshot.countdown_phase,
    window_open_at: snapshot.window_open_at,
    window_close_at: snapshot.window_close_at,
    range_clear: snapshot.range_clear,
    surface_wind_kts: snapshot.surface_wind_kts,
    upper_wind_shear_kts_per_kft: snapshot.upper_wind_shear_kts_per_kft,
    weather_within_limits: snapshot.weather_within_limits,
    fts_armed: snapshot.fts_armed,
    afts_nominal: snapshot.afts_nominal,
    fts_battery_ok: snapshot.fts_battery_ok,
    fts_rf_link_ok: snapshot.fts_rf_link_ok,
    propellant_temp_k_within_spec: snapshot.propellant_temp_k_within_spec,
    itar_cleared: snapshot.itar_cleared,
    comms_licensed: snapshot.comms_licensed,
    expected_max_q_kpa: snapshot.expected_max_q_kpa,
    hazard_area_cleared: snapshot.hazard_area_cleared,
    tracking_radar_acquired: snapshot.tracking_radar_acquired,
    range_commander_go: snapshot.range_commander_go,
    authority_envelope_unrevoked: snapshot.authority_envelope_unrevoked,
    signer_authorized: snapshot.signer_authorized,
    actor_id: snapshot.actor_id,
    ...(snapshot.callsign ? { callsign: snapshot.callsign } : {})
  };
}

function orbitalSnapshotParams(snapshot: SpaceOrbitalRuntimeSnapshot): Record<string, JsonValue> {
  return JSON.parse(stableStringify(snapshot)) as Record<string, JsonValue>;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function makeAction(input: SpaceAdapterRequest, ctx: SpaceActionContext): CanonicalActionInput {
  const base = snapshotParams(ctx.snapshot);
  // Merge request-specific fields (everything except action_type) into params.
  const extras: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(input as unknown as Record<string, unknown>)) {
    if (k === "action_type") continue;
    extras[k] = v as JsonValue;
  }
  const requested_at = ctx.now ?? ctx.requested_at;
  return {
    action_id: ctx.action_id,
    ward_id: ctx.ward_id,
    subject: ctx.subject,
    action_type: input.action_type,
    target: ctx.snapshot.launch_site,
    requested_at,
    ...(ctx.request_id ? { request_id: ctx.request_id } : {}),
    params: { ...base, actor_id: ctx.snapshot.actor_id, ...extras } as Record<string, JsonValue>,
    telemetry: { ...(base as Record<string, JsonValue>), ...(ctx.telemetry ?? {}) },
    ...(ctx.classification ? { classification: ctx.classification } : {})
  };
}

function makeOrbitalAction(
  ctx: SpaceOrbitalActionContext,
  action_type: string,
  targetSuffix: string,
  params: Record<string, JsonValue>
): CanonicalActionInput {
  const telemetry = orbitalSnapshotParams(ctx.snapshot);
  const requested_at = ctx.now ?? ctx.requested_at;
  return {
    action_id: ctx.action_id,
    ward_id: ctx.ward_id,
    subject: ctx.subject,
    action_type,
    target: `space/${ctx.snapshot.asset_id}/${targetSuffix}`,
    requested_at,
    ...(ctx.request_id ? { request_id: ctx.request_id } : {}),
    params: { ...telemetry, ...params },
    telemetry: { ...telemetry, ...(ctx.telemetry ?? {}) },
    ...(ctx.classification ? { classification: ctx.classification } : {})
  };
}

// ---------------------------------------------------------------------------
// Public builders (one per adapter family)
// ---------------------------------------------------------------------------

export function rangeSafetyToAction(input: RangeSafetyRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function propellantToAction(input: PropellantRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function ignitionToAction(input: IgnitionRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function flightTerminationToAction(input: FlightTerminationRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function spacePayloadToAction(input: SpacePayloadRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function groundSystemsToAction(input: GroundSystemsRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function commsLicensingToAction(input: CommsLicensingRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function weatherWindsToAction(input: WeatherWindsRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function spaceHistorianWriteToAction(input: SpaceHistorianWriteRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function spaceAdapterToAction(input: SpaceAdapterRequest, ctx: SpaceActionContext): CanonicalActionInput {
  return makeAction(input, ctx);
}

export function orbitManeuverToAction(input: OrbitManeuverRequest, ctx: SpaceOrbitalActionContext): CanonicalActionInput {
  const fallback = input.operation === "collision-avoidance"
    ? "orbit.collision_avoidance.burn"
    : input.operation === "stationkeeping"
      ? "orbit.stationkeeping.burn"
      : input.operation === "disposal"
        ? "orbit.disposal.burn"
        : `orbit.${slug(input.operation)}.burn`;
  return makeOrbitalAction(ctx, input.action_type ?? fallback, `maneuver/${input.maneuver_id}`, {
    adapter: "orbit-maneuver",
    maneuver_id: input.maneuver_id,
    operation: input.operation,
    ...(input.delta_v_mps !== undefined ? { delta_v_mps: input.delta_v_mps } : {}),
    ...(input.burn_duration_s !== undefined ? { burn_duration_s: input.burn_duration_s } : {})
  });
}

export function rfTransmissionToAction(input: RfTransmissionRequest, ctx: SpaceOrbitalActionContext): CanonicalActionInput {
  const fallback = input.operation === "crosslink-activate"
    ? "crosslink.activate"
    : input.operation === "enable"
      ? "rf.transmit.enable"
      : input.operation === "disable"
        ? "rf.transmit.disable"
        : "rf.carrier.plan";
  return makeOrbitalAction(ctx, input.action_type ?? fallback, `rf/${input.carrier_id}`, {
    adapter: "rf-spectrum",
    carrier_id: input.carrier_id,
    operation: input.operation,
    ...(input.rf_band ? { rf_band: input.rf_band } : {})
  });
}

export function payloadTaskingToAction(input: OrbitalPayloadTaskingRequest, ctx: SpaceOrbitalActionContext): CanonicalActionInput {
  const fallback = input.operation === "image-collect"
    ? "payload.image.collect"
    : input.operation === "mode-set"
      ? "payload.mode.set"
      : "payload.deploy";
  return makeOrbitalAction(ctx, input.action_type ?? fallback, `payload/${input.task_id}`, {
    adapter: "payload-tasking",
    task_id: input.task_id,
    operation: input.operation,
    ...(input.payload_mode ? { payload_mode: input.payload_mode } : {}),
    ...(input.target_region ? { target_region: input.target_region } : {})
  });
}

export function groundStationContactToAction(input: GroundStationContactRequest, ctx: SpaceOrbitalActionContext): CanonicalActionInput {
  const fallback = input.operation === "schedule"
    ? "ground_station.contact.schedule"
    : input.operation === "handoff"
      ? "ground_station.handoff"
      : "ground_station.command_window.open";
  return makeOrbitalAction(ctx, input.action_type ?? fallback, `ground-station/${input.ground_station_id}/${input.contact_id}`, {
    adapter: "ground-station",
    contact_id: input.contact_id,
    ground_station_id: input.ground_station_id,
    operation: input.operation
  });
}

export function conjunctionAssessmentToAction(input: ConjunctionAssessmentRequest, ctx: SpaceOrbitalActionContext): CanonicalActionInput {
  const fallback = input.operation === "run" ? "conjunction.assessment.run" : "conjunction.plan.approve";
  return makeOrbitalAction(ctx, input.action_type ?? fallback, `conjunction/${input.assessment_id}`, {
    adapter: "conjunction-screening",
    assessment_id: input.assessment_id,
    operation: input.operation
  });
}

export function rendezvousProximityToAction(input: RendezvousProximityRequest, ctx: SpaceOrbitalActionContext): CanonicalActionInput {
  const fallback = input.operation === "approach"
    ? "rpo.approach.execute"
    : input.operation === "hold-point"
      ? "rpo.hold_point.enter"
      : "rpo.capture.execute";
  return makeOrbitalAction(ctx, input.action_type ?? fallback, `rpo/${input.rpo_id}`, {
    adapter: "rendezvous-proximity",
    rpo_id: input.rpo_id,
    operation: input.operation
  });
}

export function deorbitReentryToAction(input: DeorbitReentryRequest, ctx: SpaceOrbitalActionContext): CanonicalActionInput {
  const fallback = input.operation === "deorbit-burn"
    ? "deorbit.burn.execute"
    : input.operation === "reentry-commit"
      ? "reentry.commit"
      : "satellite.passivate";
  return makeOrbitalAction(ctx, input.action_type ?? fallback, `deorbit/${input.disposal_id}`, {
    adapter: "deorbit-reentry",
    disposal_id: input.disposal_id,
    operation: input.operation
  });
}

export function spaceOrbitalHistorianWriteToAction(input: SpaceOrbitalHistorianWriteRequest, ctx: SpaceOrbitalActionContext): CanonicalActionInput {
  return makeOrbitalAction(ctx, input.action_type ?? "space.historian_write", `historian/${input.historian_id}/${input.stream}`, {
    adapter: "historian",
    historian_id: input.historian_id,
    stream: input.stream,
    record_type: input.record_type,
    payload: input.payload
  });
}

export function spaceOrbitalAdapterToAction(input: SpaceOrbitalAdapterRequest, ctx: SpaceOrbitalActionContext): CanonicalActionInput {
  if (input.kind === "orbit-maneuver") return orbitManeuverToAction(input.request, ctx);
  if (input.kind === "rf-spectrum") return rfTransmissionToAction(input.request, ctx);
  if (input.kind === "payload-tasking") return payloadTaskingToAction(input.request, ctx);
  if (input.kind === "ground-station") return groundStationContactToAction(input.request, ctx);
  if (input.kind === "conjunction-screening") return conjunctionAssessmentToAction(input.request, ctx);
  if (input.kind === "rendezvous-proximity") return rendezvousProximityToAction(input.request, ctx);
  if (input.kind === "deorbit-reentry") return deorbitReentryToAction(input.request, ctx);
  return spaceOrbitalHistorianWriteToAction(input.request, ctx);
}

// ---------------------------------------------------------------------------
// Runtime register
// ---------------------------------------------------------------------------

export function spaceSnapshotToRuntimeRegister(snapshot: SpaceRuntimeSnapshot): RuntimeRegister {
  return {
    boundary_id: snapshot.launch_site,
    captured_at: new Date().toISOString(),
    values: snapshotParams(snapshot) as RuntimeRegister["values"]
  };
}

export function spaceOrbitalSnapshotToRuntimeRegister(snapshot: SpaceOrbitalRuntimeSnapshot): RuntimeRegister {
  const values = orbitalSnapshotParams(snapshot);
  return {
    boundary_id: snapshot.asset_id,
    captured_at: new Date().toISOString(),
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    values
  };
}

// ---------------------------------------------------------------------------
// Per-vertical safety invariants (light wrapper around the shared bounds)
// ---------------------------------------------------------------------------

export function evaluateSpaceSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
  return evaluatePhysicalInvariants(action, ward.physical_bounds);
}

// ---------------------------------------------------------------------------
// Evidence bundle
// ---------------------------------------------------------------------------

function evidenceBundleMaterialHash(bundle: EvidenceBundle): string {
  return sha256(stableStringify(bundle as unknown as Record<string, unknown>));
}

function spaceBundleHash(input: {
  bundle_version: "aristotle.space-evidence.v1";
  exported_at: string;
  space: SpaceEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: { space_context_hash: string; execution_bundle_hash: string };
}): string {
  return sha256(
    stableStringify({
      bundle_version: input.bundle_version,
      exported_at: input.exported_at,
      space_context_hash: input.hashes.space_context_hash,
      execution_bundle_hash: input.hashes.execution_bundle_hash
    } as Record<string, unknown>)
  );
}

export function exportSpaceEvidenceBundle(
  input: ExportEvidenceBundleInput & { space: SpaceEvidenceContext }
): SpaceEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.space-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    space: JSON.parse(stableStringify(input.space)) as SpaceEvidenceContext,
    execution_bundle
  };
  const hashes = {
    space_context_hash: sha256(stableStringify(partial.space)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    space_bundle_hash: ""
  };
  hashes.space_bundle_hash = spaceBundleHash({
    ...partial,
    hashes: {
      space_context_hash: hashes.space_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: SpaceEvidenceBundle = {
    ...partial,
    hashes,
    verification: { ok: false, failures: [], execution_bundle_ok: false }
  };
  return { ...draft, verification: verifySpaceEvidenceBundle(draft) };
}

export function verifySpaceEvidenceBundle(bundle: SpaceEvidenceBundle): SpaceEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.space-evidence.v1") failures.push("unsupported space evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.space));
  if (contextHash !== bundle.hashes.space_context_hash) failures.push("space context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = spaceBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    space: bundle.space,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      space_context_hash: bundle.hashes.space_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.space_bundle_hash) failures.push("space bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}

function orbitalEvidenceBundleHash(input: {
  bundle_version: "aristotle.space-orbital-evidence.v1";
  exported_at: string;
  orbital: SpaceOrbitalEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: { orbital_context_hash: string; execution_bundle_hash: string };
}): string {
  return sha256(
    stableStringify({
      bundle_version: input.bundle_version,
      exported_at: input.exported_at,
      orbital_context_hash: input.hashes.orbital_context_hash,
      execution_bundle_hash: input.hashes.execution_bundle_hash
    } as Record<string, unknown>)
  );
}

export function exportSpaceOrbitalEvidenceBundle(
  input: ExportEvidenceBundleInput & { orbital: SpaceOrbitalEvidenceContext }
): SpaceOrbitalEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.space-orbital-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    orbital: JSON.parse(stableStringify(input.orbital)) as SpaceOrbitalEvidenceContext,
    execution_bundle
  };
  const hashes = {
    orbital_context_hash: sha256(stableStringify(partial.orbital)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    orbital_bundle_hash: ""
  };
  hashes.orbital_bundle_hash = orbitalEvidenceBundleHash({
    ...partial,
    hashes: {
      orbital_context_hash: hashes.orbital_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: SpaceOrbitalEvidenceBundle = {
    ...partial,
    hashes,
    verification: { ok: false, failures: [], execution_bundle_ok: false }
  };
  return { ...draft, verification: verifySpaceOrbitalEvidenceBundle(draft) };
}

export function verifySpaceOrbitalEvidenceBundle(bundle: SpaceOrbitalEvidenceBundle): SpaceOrbitalEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.space-orbital-evidence.v1") failures.push("unsupported orbital space evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.orbital));
  if (contextHash !== bundle.hashes.orbital_context_hash) failures.push("orbital context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = orbitalEvidenceBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    orbital: bundle.orbital,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      orbital_context_hash: bundle.hashes.orbital_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.orbital_bundle_hash) failures.push("orbital bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
