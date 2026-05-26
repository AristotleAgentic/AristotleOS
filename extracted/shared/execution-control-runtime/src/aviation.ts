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
 * Aviation / UAV / eVTOL readiness primitives.
 *
 * Aviation adapters do not fly aircraft directly. They translate UTM/USS, flight-control,
 * geofence, payload, detect-and-avoid, C2-link, remote-ID, and vertiport requests into
 * Canonical Governed Actions. A real adapter must verify the resulting Warrant before it
 * commands any aircraft.
 *
 * The safety invariants enforced here are designed to MEET AND EXCEED the governing regimes:
 *   - 14 CFR Part 107 (small UAS): <=400 ft AGL, <=100 mph, VLOS unless waived, daylight/
 *     civil-twilight unless waived, operations-over-people categories.
 *   - 14 CFR Part 108 (BVLOS, proposed) and Part 91/135 (powered-lift & air carrier ops).
 *   - 14 CFR Part 89 (Remote ID broadcast).
 *   - LAANC / ATC authorization for controlled airspace; TFR/NOTAM compliance.
 *   - ASTM F3548 (UTM), detect-and-avoid standards, and SORA (Specific Operations Risk
 *     Assessment) for higher-risk operations.
 * Exceeding the minimums: every flight command is admitted only with the geofence active,
 * Remote ID broadcasting, detect-and-avoid active, a healthy C2 link, a return-to-launch
 * failsafe armed, airspace authorization present, no active TFR, weather within limits, and
 * a battery state-of-charge above the RTL reserve — and high-consequence acts (BVLOS,
 * payload release, eVTOL passenger ops, flight beyond the geofence) require dual control.
 * All of it is bound into a tamper-evident, signed Evidence Bundle.
 */

export type AviationDomain =
  | "part-107-small-uas"
  | "bvlos"
  | "agriculture"
  | "delivery"
  | "infrastructure-inspection"
  | "public-safety"
  | "evtol-passenger"
  | "evtol-cargo"
  | "utm-coordination";

export type AviationAdapterKind =
  | "utm"
  | "flight-control"
  | "geofence"
  | "payload"
  | "vertiport"
  | "detect-and-avoid"
  | "c2-link"
  | "remote-id"
  | "ground-control-station"
  | "historian-write";

export interface AviationAdapterDescriptor {
  kind: AviationAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
  /** Regulatory clauses this boundary is built to satisfy. */
  regulatoryBasis: string[];
}

export const AVIATION_ADAPTER_CATALOG: AviationAdapterDescriptor[] = [
  {
    kind: "utm",
    label: "UTM / USS Authorization Boundary",
    consequenceBoundary: "Flight authorization, strategic deconfliction, and operation-volume activation",
    actionExamples: ["uas.flight.authorize", "uas.deconfliction.submit", "uas.volume.activate"],
    requiredRuntimeRegisters: ["telemetry.airspace_id", "telemetry.airspace_authorization_active", "telemetry.no_active_tfr"],
    regulatoryBasis: ["ASTM F3548 (UTM)", "LAANC", "14 CFR 91.113"]
  },
  {
    kind: "flight-control",
    label: "Flight Control / Autopilot Boundary",
    consequenceBoundary: "Arm, takeoff, waypoint, hold, land, return-to-launch, and mission-upload commands",
    actionExamples: ["flight.arm", "flight.takeoff", "flight.waypoint.set", "flight.land", "flight.rtl"],
    requiredRuntimeRegisters: ["telemetry.altitude_agl_ft", "telemetry.battery_soc_pct", "telemetry.c2_link_healthy", "telemetry.rtl_available"],
    regulatoryBasis: ["14 CFR 107.51 (altitude/speed)", "14 CFR 91"]
  },
  {
    kind: "geofence",
    label: "Geofence Boundary",
    consequenceBoundary: "Geofence definition and operation-volume containment changes",
    actionExamples: ["geofence.set", "geofence.update"],
    requiredRuntimeRegisters: ["telemetry.geofence_active", "telemetry.operation_volume_id"],
    regulatoryBasis: ["14 CFR 107 (containment)", "SORA containment"]
  },
  {
    kind: "payload",
    label: "Payload Boundary",
    consequenceBoundary: "Payload release/drop, dispensing, and gimbal/sensor commands",
    actionExamples: ["payload.release", "payload.gimbal.set"],
    requiredRuntimeRegisters: ["telemetry.payload_kg", "telemetry.ops_over_people_authorized"],
    regulatoryBasis: ["14 CFR 107.23/107 Subpart D (ops over people)"]
  },
  {
    kind: "vertiport",
    label: "Vertiport / Vertipad Boundary (eVTOL)",
    consequenceBoundary: "Vertiport takeoff/landing clearance and vertipad assignment",
    actionExamples: ["vertiport.takeoff.clear", "vertiport.land.clear", "vertiport.pad.assign"],
    requiredRuntimeRegisters: ["telemetry.vertiport_clearance", "telemetry.weather_within_limits"],
    regulatoryBasis: ["14 CFR 135 (powered-lift)", "FAA vertiport EB-105"]
  },
  {
    kind: "detect-and-avoid",
    label: "Detect-and-Avoid (DAA) Boundary",
    consequenceBoundary: "Collision-avoidance maneuver execution and DAA mode changes",
    actionExamples: ["daa.maneuver.execute", "daa.mode.set"],
    requiredRuntimeRegisters: ["telemetry.daa_active"],
    regulatoryBasis: ["14 CFR 91.113 (see-and-avoid)", "DAA standards"]
  },
  {
    kind: "c2-link",
    label: "Command & Control Link Boundary",
    consequenceBoundary: "C2 link switching, handover, and lost-link failsafe configuration",
    actionExamples: ["c2.link.switch", "c2.handover"],
    requiredRuntimeRegisters: ["telemetry.c2_link_healthy", "telemetry.rtl_available"],
    regulatoryBasis: ["14 CFR 108 (BVLOS C2)", "RTCA C2 standards"]
  },
  {
    kind: "remote-id",
    label: "Remote ID Boundary",
    consequenceBoundary: "Remote ID broadcast configuration and session identity",
    actionExamples: ["remote_id.session.set"],
    requiredRuntimeRegisters: ["telemetry.remote_id_broadcasting"],
    regulatoryBasis: ["14 CFR Part 89 (Remote ID)"]
  },
  {
    kind: "ground-control-station",
    label: "Ground Control Station Boundary",
    consequenceBoundary: "Fleet dispatch, mission assignment, and crew handover from the GCS",
    actionExamples: ["gcs.mission.assign", "gcs.fleet.dispatch"],
    requiredRuntimeRegisters: ["telemetry.operator_id", "telemetry.operator_qualified"],
    regulatoryBasis: ["14 CFR 107.12 (remote pilot certificate)"]
  },
  {
    kind: "historian-write",
    label: "Historian Write Boundary",
    consequenceBoundary: "Flight records, incident markers, and compliance annotations",
    actionExamples: ["historian.record.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"],
    regulatoryBasis: ["14 CFR 107/91 recordkeeping"]
  }
];

/** The regulatory regimes this vertical is designed to meet and exceed. */
export const AVIATION_REGULATORY_PROFILE = [
  "14 CFR Part 107 (small UAS)",
  "14 CFR Part 108 (BVLOS, proposed)",
  "14 CFR Part 91 (general operating rules)",
  "14 CFR Part 135 (air carrier / powered-lift)",
  "14 CFR Part 89 (Remote ID)",
  "LAANC (controlled-airspace authorization)",
  "ASTM F3548 (UTM)",
  "SORA (specific operations risk assessment)"
] as const;

export interface AviationRuntimeSnapshot {
  asset_id: string;
  asset_type: "multirotor" | "fixed-wing" | "vtol" | "evtol" | "ground-station" | "payload" | string;
  airspace_id: string;
  airspace_class: "G" | "E" | "D" | "C" | "B" | string;
  operation_volume_id: string;
  system_model_id: string;
  flight_state: "preflight" | "armed" | "in-flight" | "rtl" | "landing" | "landed" | string;
  altitude_agl_ft: number;
  groundspeed_kts?: number;
  battery_soc_pct: number;
  wind_speed_kts?: number;
  visibility_sm?: number;
  ceiling_ft?: number;
  payload_kg?: number;
  telemetry_age_ms: number;
  geofence_active: boolean;
  remote_id_broadcasting: boolean;
  daa_active: boolean;
  c2_link_healthy: boolean;
  airspace_authorization_active: boolean;
  no_active_tfr: boolean;
  vlos_or_waiver: boolean;
  rtl_available: boolean;
  weather_within_limits: boolean;
  vertiport_clearance?: boolean;
  ops_over_people_authorized?: boolean;
  night_authorized?: boolean;
  operator_qualified: boolean;
  operator_id?: string;
  mission_id?: string;
  waiver_id?: string;
  payload_id?: string;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface AviationActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: AviationRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface UtmRequest {
  uss_id: string;
  operation: "authorize" | "deconfliction-submit" | "volume-activate" | "volume-deactivate";
  volume_id?: string;
  action_type?: string;
}

export interface FlightControlRequest {
  aircraft_id: string;
  operation: "arm" | "takeoff" | "waypoint" | "hold" | "land" | "rtl" | "mission-upload";
  waypoint?: JsonValue;
  action_type?: string;
}

export interface GeofenceRequest {
  fence_id: string;
  operation: "set" | "update";
  value?: JsonValue;
  action_type?: string;
}

export interface PayloadRequest {
  payload_id: string;
  operation: "release" | "dispense" | "gimbal-set";
  value?: JsonValue;
  action_type?: string;
}

export interface VertiportRequest {
  vertiport_id: string;
  operation: "takeoff-clear" | "land-clear" | "pad-assign";
  pad_id?: string;
  action_type?: string;
}

export interface DaaRequest {
  aircraft_id: string;
  operation: "maneuver" | "mode-set";
  value?: JsonValue;
  action_type?: string;
}

export interface C2LinkRequest {
  aircraft_id: string;
  operation: "switch" | "handover";
  link_id?: string;
  action_type?: string;
}

export interface RemoteIdRequest {
  aircraft_id: string;
  operation: "session-set";
  session_id?: string;
  action_type?: string;
}

export interface AviationHistorianWriteRequest {
  historian_id: string;
  stream: string;
  record_type: "operator-note" | "incident-marker" | "compliance-marker" | string;
  payload: Record<string, JsonValue>;
  action_type?: string;
}

export type AviationAdapterRequest =
  | { kind: "utm"; request: UtmRequest }
  | { kind: "flight-control"; request: FlightControlRequest }
  | { kind: "geofence"; request: GeofenceRequest }
  | { kind: "payload"; request: PayloadRequest }
  | { kind: "vertiport"; request: VertiportRequest }
  | { kind: "detect-and-avoid"; request: DaaRequest }
  | { kind: "c2-link"; request: C2LinkRequest }
  | { kind: "remote-id"; request: RemoteIdRequest }
  | { kind: "historian-write"; request: AviationHistorianWriteRequest };

export interface AviationEvidenceContext {
  operator_id: string;
  control_station: string;
  aviation_domain: AviationDomain;
  operational_scope: string;
  asset_id: string;
  airspace_id: string;
  operation_volume_id: string;
  system_model_id: string;
  mission_id?: string;
  waiver_id?: string;
  rpic_id: string;
  sora_risk_class?: "low" | "medium" | "high" | "not_applicable";
  regulatory_evidence_profile: Array<
    | "PART_107"
    | "PART_108_BVLOS"
    | "PART_91"
    | "PART_135"
    | "PART_89_REMOTE_ID"
    | "LAANC"
    | "ASTM_F3548_UTM"
    | "SORA"
    | "OPS_OVER_PEOPLE"
    | "DETECT_AND_AVOID"
  >;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface AviationEvidenceBundle {
  bundle_version: "aristotle.aviation-evidence.v1";
  exported_at: string;
  aviation: AviationEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    aviation_context_hash: string;
    execution_bundle_hash: string;
    aviation_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: AviationRuntimeSnapshot): Record<string, JsonValue> {
  return {
    asset_id: snapshot.asset_id,
    asset_type: snapshot.asset_type,
    airspace_id: snapshot.airspace_id,
    airspace_class: snapshot.airspace_class,
    operation_volume_id: snapshot.operation_volume_id,
    boundary_id: snapshot.operation_volume_id,
    system_model_id: snapshot.system_model_id,
    flight_state: snapshot.flight_state,
    altitude_agl_ft: snapshot.altitude_agl_ft,
    ...(snapshot.groundspeed_kts !== undefined ? { groundspeed_kts: snapshot.groundspeed_kts } : {}),
    battery_soc_pct: snapshot.battery_soc_pct,
    ...(snapshot.wind_speed_kts !== undefined ? { wind_speed_kts: snapshot.wind_speed_kts } : {}),
    ...(snapshot.visibility_sm !== undefined ? { visibility_sm: snapshot.visibility_sm } : {}),
    ...(snapshot.ceiling_ft !== undefined ? { ceiling_ft: snapshot.ceiling_ft } : {}),
    ...(snapshot.payload_kg !== undefined ? { payload_kg: snapshot.payload_kg } : {}),
    telemetry_age_ms: snapshot.telemetry_age_ms,
    geofence_active: snapshot.geofence_active,
    remote_id_broadcasting: snapshot.remote_id_broadcasting,
    daa_active: snapshot.daa_active,
    c2_link_healthy: snapshot.c2_link_healthy,
    airspace_authorization_active: snapshot.airspace_authorization_active,
    no_active_tfr: snapshot.no_active_tfr,
    vlos_or_waiver: snapshot.vlos_or_waiver,
    rtl_available: snapshot.rtl_available,
    weather_within_limits: snapshot.weather_within_limits,
    ...(snapshot.vertiport_clearance !== undefined ? { vertiport_clearance: snapshot.vertiport_clearance } : {}),
    ...(snapshot.ops_over_people_authorized !== undefined ? { ops_over_people_authorized: snapshot.ops_over_people_authorized } : {}),
    ...(snapshot.night_authorized !== undefined ? { night_authorized: snapshot.night_authorized } : {}),
    operator_qualified: snapshot.operator_qualified,
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {}),
    ...(snapshot.mission_id ? { mission_id: snapshot.mission_id } : {}),
    ...(snapshot.waiver_id ? { waiver_id: snapshot.waiver_id } : {}),
    ...(snapshot.payload_id ? { payload_id: snapshot.payload_id } : {})
  };
}

function aviationAction(
  ctx: AviationActionContext,
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

export function utmToAction(input: UtmRequest, ctx: AviationActionContext): CanonicalActionInput {
  const fallback =
    input.operation === "authorize"
      ? "uas.flight.authorize"
      : input.operation === "deconfliction-submit"
        ? "uas.deconfliction.submit"
        : input.operation === "volume-activate"
          ? "uas.volume.activate"
          : "uas.volume.deactivate";
  return aviationAction(ctx, input.action_type ?? fallback, `${input.uss_id}:${input.operation}`, {
    adapter: "utm",
    uss_id: input.uss_id,
    operation: input.operation,
    ...(input.volume_id ? { volume_id: input.volume_id } : {})
  });
}

export function flightControlToAction(input: FlightControlRequest, ctx: AviationActionContext): CanonicalActionInput {
  const fallback = input.operation === "waypoint" ? "flight.waypoint.set" : input.operation === "mission-upload" ? "flight.mission.upload" : `flight.${slug(input.operation)}`;
  return aviationAction(ctx, input.action_type ?? fallback, `${input.aircraft_id}:${input.operation}`, {
    adapter: "flight-control",
    aircraft_id: input.aircraft_id,
    operation: input.operation,
    ...(input.waypoint !== undefined ? { waypoint: input.waypoint } : {})
  });
}

export function geofenceToAction(input: GeofenceRequest, ctx: AviationActionContext): CanonicalActionInput {
  return aviationAction(ctx, input.action_type ?? `geofence.${slug(input.operation)}`, `${input.fence_id}:${input.operation}`, {
    adapter: "geofence",
    fence_id: input.fence_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function payloadToAction(input: PayloadRequest, ctx: AviationActionContext): CanonicalActionInput {
  const fallback = input.operation === "gimbal-set" ? "payload.gimbal.set" : `payload.${slug(input.operation)}`;
  return aviationAction(ctx, input.action_type ?? fallback, `${input.payload_id}:${input.operation}`, {
    adapter: "payload",
    payload_id: input.payload_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function vertiportToAction(input: VertiportRequest, ctx: AviationActionContext): CanonicalActionInput {
  const fallback =
    input.operation === "takeoff-clear" ? "vertiport.takeoff.clear" : input.operation === "land-clear" ? "vertiport.land.clear" : "vertiport.pad.assign";
  return aviationAction(ctx, input.action_type ?? fallback, `${input.vertiport_id}:${input.operation}`, {
    adapter: "vertiport",
    vertiport_id: input.vertiport_id,
    operation: input.operation,
    ...(input.pad_id ? { pad_id: input.pad_id } : {})
  });
}

export function daaToAction(input: DaaRequest, ctx: AviationActionContext): CanonicalActionInput {
  const fallback = input.operation === "maneuver" ? "daa.maneuver.execute" : "daa.mode.set";
  return aviationAction(ctx, input.action_type ?? fallback, `${input.aircraft_id}:daa:${input.operation}`, {
    adapter: "detect-and-avoid",
    aircraft_id: input.aircraft_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function c2LinkToAction(input: C2LinkRequest, ctx: AviationActionContext): CanonicalActionInput {
  return aviationAction(ctx, input.action_type ?? `c2.${slug(input.operation)}`, `${input.aircraft_id}:c2:${input.operation}`, {
    adapter: "c2-link",
    aircraft_id: input.aircraft_id,
    operation: input.operation,
    ...(input.link_id ? { link_id: input.link_id } : {})
  });
}

export function remoteIdToAction(input: RemoteIdRequest, ctx: AviationActionContext): CanonicalActionInput {
  return aviationAction(ctx, input.action_type ?? "remote_id.session.set", `${input.aircraft_id}:remote-id`, {
    adapter: "remote-id",
    aircraft_id: input.aircraft_id,
    operation: input.operation,
    ...(input.session_id ? { session_id: input.session_id } : {})
  });
}

export function aviationHistorianWriteToAction(input: AviationHistorianWriteRequest, ctx: AviationActionContext): CanonicalActionInput {
  return aviationAction(ctx, input.action_type ?? "historian.record.write", `${input.historian_id}:${input.stream}:${input.record_type}`, {
    adapter: "historian-write",
    historian_id: input.historian_id,
    stream: input.stream,
    record_type: input.record_type,
    payload: input.payload
  });
}

export function aviationAdapterToAction(input: AviationAdapterRequest, ctx: AviationActionContext): CanonicalActionInput {
  if (input.kind === "utm") return utmToAction(input.request, ctx);
  if (input.kind === "flight-control") return flightControlToAction(input.request, ctx);
  if (input.kind === "geofence") return geofenceToAction(input.request, ctx);
  if (input.kind === "payload") return payloadToAction(input.request, ctx);
  if (input.kind === "vertiport") return vertiportToAction(input.request, ctx);
  if (input.kind === "detect-and-avoid") return daaToAction(input.request, ctx);
  if (input.kind === "c2-link") return c2LinkToAction(input.request, ctx);
  if (input.kind === "remote-id") return remoteIdToAction(input.request, ctx);
  return aviationHistorianWriteToAction(input.request, ctx);
}

export function aviationSnapshotToRuntimeRegister(snapshot: AviationRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateAviationSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function aviationBundleHash(input: Omit<AviationEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<AviationEvidenceBundle["hashes"], "aviation_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportAviationEvidenceBundle(input: ExportEvidenceBundleInput & { aviation: AviationEvidenceContext }): AviationEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.aviation-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    aviation: JSON.parse(stableStringify(input.aviation)) as AviationEvidenceContext,
    execution_bundle
  };
  const hashes = {
    aviation_context_hash: sha256(stableStringify(partial.aviation)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    aviation_bundle_hash: ""
  };
  hashes.aviation_bundle_hash = aviationBundleHash({
    ...partial,
    hashes: {
      aviation_context_hash: hashes.aviation_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: AviationEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyAviationEvidenceBundle(draft) };
}

export function verifyAviationEvidenceBundle(bundle: AviationEvidenceBundle): AviationEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.aviation-evidence.v1") failures.push("unsupported aviation evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.aviation));
  if (contextHash !== bundle.hashes.aviation_context_hash) failures.push("aviation context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = aviationBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    aviation: bundle.aviation,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      aviation_context_hash: bundle.hashes.aviation_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.aviation_bundle_hash) failures.push("aviation bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
