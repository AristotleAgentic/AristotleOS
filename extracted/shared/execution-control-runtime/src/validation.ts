/**
 * Fail-fast structural validation for AristotleOS configuration. A malformed Ward
 * Manifest or Authority Envelope should be rejected at load with a clear,
 * actionable message instead of producing a cryptic failure deep in the gate.
 */

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, issues: ValidationIssue[], where: string): void {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({ path: `${where}.${key}`, message: `must be a non-empty string` });
  }
}

function requireStringArray(obj: Record<string, unknown>, key: string, issues: ValidationIssue[], where: string, opts: { nonEmpty?: boolean } = {}): void {
  const value = obj[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    issues.push({ path: `${where}.${key}`, message: `must be an array of strings` });
    return;
  }
  if (opts.nonEmpty && value.length === 0) {
    issues.push({ path: `${where}.${key}`, message: `must not be empty` });
  }
}

export function validateWardManifest(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return { ok: false, issues: [{ path: "ward", message: "must be an object" }] };
  requireString(value, "ward_id", issues, "ward");
  requireString(value, "name", issues, "ward");
  requireString(value, "sovereignty_context", issues, "ward");
  requireString(value, "authority_domain", issues, "ward");
  requireString(value, "policy_version", issues, "ward");
  requireStringArray(value, "permitted_subjects", issues, "ward", { nonEmpty: true });
  if (value.physical_bounds !== undefined) {
    if (!isRecord(value.physical_bounds)) {
      issues.push({ path: "ward.physical_bounds", message: "must be an object when present" });
    } else {
      for (const numKey of [
        "max_altitude_m",
        "battery_minimum_pct",
        "max_speed_mps",
        "min_map_confidence",
        "min_localization_confidence",
        "min_perception_confidence",
        "min_voltage_kv",
        "max_voltage_kv",
        "min_frequency_hz",
        "max_frequency_hz",
        "max_feeder_load_pct",
        "max_transformer_load_pct",
        "max_der_export_mw",
        "max_telemetry_age_ms",
        "max_authority_speed_mph",
        "min_train_separation_m",
        "max_train_length_ft",
        "max_train_tonnage",
        "max_ptc_telemetry_age_ms",
        "max_container_weight_kg",
        "min_pnt_confidence",
        "max_ais_track_age_ms",
        "max_port_telemetry_age_ms",
        "max_wind_speed_kn",
        "min_reefer_temp_c",
        "max_reefer_temp_c",
        "max_chlorine_dose_mg_l",
        "min_chlorine_residual_mg_l",
        "min_pressure_psi",
        "max_pressure_psi",
        "min_tank_level_pct",
        "max_tank_level_pct",
        "max_wetwell_level_pct",
        "max_turbidity_ntu",
        "min_ph",
        "max_ph",
        "max_sensor_age_ms",
        "max_lab_sample_age_min",
        "max_flow_mgd",
        "min_uv_intensity_pct",
        "max_gross_weight_lbs",
        "max_cargo_value_usd",
        "max_fuel_advance_usd",
        "max_accessorial_amount_usd",
        "max_fraud_score",
        "max_double_broker_risk_score",
        "max_eld_event_age_ms",
        "max_telematics_age_ms",
        "max_route_deviation_km",
        "min_remaining_drive_minutes",
        "min_remaining_duty_minutes"
      ]) {
        const v = value.physical_bounds[numKey];
        if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
          issues.push({ path: `ward.physical_bounds.${numKey}`, message: "must be a finite number when present" });
        }
      }
      for (const strKey of ["permitted_boundary_id", "permitted_odd_id", "permitted_topology_model_id", "permitted_territory_id", "permitted_port_id", "permitted_terminal_id", "permitted_water_system_id", "permitted_facility_id", "permitted_logistics_network_id"]) {
        const v = value.physical_bounds[strKey];
        if (v !== undefined && (typeof v !== "string" || v.trim() === "")) {
          issues.push({ path: `ward.physical_bounds.${strKey}`, message: "must be a non-empty string when present" });
        }
      }
      for (const arrKey of [
        "permitted_road_classes",
        "permitted_drive_states",
        "permitted_voltage_classes",
        "permitted_asset_types",
        "permitted_grid_states",
        "permitted_route_classes",
        "permitted_track_classes",
        "permitted_signal_aspects",
        "permitted_train_types",
        "permitted_operating_states",
        "permitted_berth_ids",
        "permitted_yard_blocks",
        "permitted_gate_ids",
        "permitted_cargo_types",
        "permitted_hazmat_classes",
        "permitted_terminal_zones",
        "permitted_pressure_zones",
        "permitted_process_areas",
        "permitted_water_asset_types",
        "permitted_discharge_permit_ids",
        "permitted_logistics_facility_ids",
        "permitted_route_ids",
        "permitted_geofence_ids",
        "permitted_carrier_ids",
        "permitted_driver_ids",
        "permitted_cargo_classes",
        "permitted_logistics_hazmat_classes",
        "permitted_trailer_types",
        "permitted_cdl_classes"
      ]) {
        const v = value.physical_bounds[arrKey];
        if (v !== undefined && (!Array.isArray(v) || !v.every((item) => typeof item === "string" && item.trim() !== ""))) {
          issues.push({ path: `ward.physical_bounds.${arrKey}`, message: "must be an array of non-empty strings when present" });
        }
      }
      for (const boolKey of [
        "require_mrc_available",
        "require_switching_order",
        "require_clearance_released",
        "require_protection_known",
        "require_scada_fresh",
        "require_manual_fallback_ready",
        "require_ptc_active",
        "require_switch_proven",
        "require_signal_not_stop",
        "require_work_zone_released",
        "require_track_bulletin_ack",
        "require_dispatcher_identity",
        "require_brake_test_current",
        "require_consist_verified",
        "require_grade_crossing_protected",
        "require_crew_acknowledged",
        "require_no_conflicting_authority",
        "require_customs_release",
        "require_no_security_hold",
        "require_no_inspection_hold",
        "require_vgm_verified",
        "require_crane_exclusion_clear",
        "require_spreader_safe",
        "require_berth_clear",
        "require_tide_window_open",
        "require_vessel_clearance",
        "require_truck_appointment",
        "require_driver_identity",
        "require_cold_chain_valid",
        "require_shore_power_lockout",
        "require_shore_power_isolated",
        "require_fire_watch_ready",
        "require_hazmat_route_approved",
        "require_gate_access_granted",
        "require_operator_identity",
        "require_no_vendor_remote_session",
        "require_water_scada_fresh",
        "require_backflow_clear",
        "require_disinfection_active",
        "require_chemical_inventory_ok",
        "require_pump_available",
        "require_valve_interlock_clear",
        "require_discharge_permit_window",
        "require_no_bypass_active",
        "require_driver_qualified",
        "require_medical_card_valid",
        "require_carrier_authority_active",
        "require_carrier_insurance_valid",
        "require_broker_authority_active",
        "require_hos_available",
        "require_eld_fresh",
        "require_route_permitted",
        "require_restricted_area_clear",
        "require_vehicle_maintenance_clear",
        "require_dvir_clear",
        "require_trailer_seal_intact",
        "require_cargo_secured",
        "require_temperature_in_range",
        "require_logistics_hazmat_endorsement",
        "require_customs_clearance",
        "require_logistics_appointment_valid",
        "require_dock_available",
        "require_yard_gate_access",
        "require_fuel_card_active",
        "require_logistics_dispatcher_identity",
        "require_no_double_broker_risk"
      ]) {
        const v = value.physical_bounds[boolKey];
        if (v !== undefined && typeof v !== "boolean") {
          issues.push({ path: `ward.physical_bounds.${boolKey}`, message: "must be a boolean when present" });
        }
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function validateAuthorityEnvelope(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) return { ok: false, issues: [{ path: "envelope", message: "must be an object" }] };
  requireString(value, "envelope_id", issues, "envelope");
  requireString(value, "ward_id", issues, "envelope");
  requireString(value, "subject", issues, "envelope");
  requireString(value, "issuer", issues, "envelope");
  requireStringArray(value, "allowed_actions", issues, "envelope");
  requireStringArray(value, "denied_actions", issues, "envelope");
  if (value.constraints !== undefined && !isRecord(value.constraints)) {
    issues.push({ path: "envelope.constraints", message: "must be an object when present" });
  }
  const expires = value.expires_at;
  if (typeof expires !== "string" || Number.isNaN(Date.parse(expires))) {
    issues.push({ path: "envelope.expires_at", message: "must be an ISO-8601 date-time string" });
  }
  return { ok: issues.length === 0, issues };
}

export function formatValidationIssues(kind: string, result: ValidationResult): string {
  return `${kind} is invalid:\n${result.issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n")}`;
}

export function assertValidWardManifest(value: unknown): void {
  const result = validateWardManifest(value);
  if (!result.ok) throw new Error(formatValidationIssues("Ward Manifest", result));
}

export function assertValidAuthorityEnvelope(value: unknown): void {
  const result = validateAuthorityEnvelope(value);
  if (!result.ok) throw new Error(formatValidationIssues("Authority Envelope", result));
}
