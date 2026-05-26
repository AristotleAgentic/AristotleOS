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
 * UAV-swarm governance for DISCONNECTED operations.
 *
 * Aristotle's swarm vertical is the runtime expression of the doctrine that intermittent
 * connectivity is not a corner case: delegated authority must remain enforceable locally,
 * safety must degrade predictably, and accountability must be provable after the fact.
 * Single-aircraft aviation primitives (Part 107/108, Remote ID, DAA, C2) live in
 * `aviation.ts`; this module is the swarm layer above them.
 *
 * Core primitives:
 *   - Swarm Authority Envelope          (mission envelope for an orchestrated swarm)
 *   - Disconnected Commit Gate          (decision admissibility under degraded backhaul)
 *   - Mesh Revocation Protocol          (authority withdrawal propagated through the mesh)
 *   - Flight Warrant Service            (per-unit signed authorization to execute an act)
 *   - Fluidity Token                    (time-bounded degraded-comms authority — author-
 *                                        ity that expires unless reconfirmed; the safety
 *                                        story for "the swarm can keep flying for N
 *                                        seconds without backhaul, no longer")
 *   - Airspace Authority Compiler       (compiles COAs, waivers, launch windows, controlled-
 *                                        airspace permissions, lost-link behaviors, weather
 *                                        minima, and recovery plans into machine-readable
 *                                        authority for the gate)
 *   - Launch Readiness Gate             (pre-launch authority + checks)
 *   - GEL Mission Reconstruction        (after-action signed evidence reconstruction)
 *
 * Disconnected flight state machine (carried in the runtime register):
 *   connected -> degraded -> mesh-relay -> hold-safe -> recover/return/land -> evidence-sync
 *
 * Mission classes (most common first; high-altitude is the EXTREME STRESS CASE):
 *   defense-perimeter, reconnaissance, temporary-comms-mesh, disaster-response, wildfire,
 *   agriculture, range-ops, infrastructure-inspection, high-altitude-launch (stress).
 *
 * Built to MEET AND EXCEED:
 *   - 14 CFR Part 107 + waivers (sUAS operating rules, including over-400-ft AGL waivers).
 *   - 14 CFR Part 108 (BVLOS framework, proposed) for separation, security, reporting, and
 *     recordkeeping under disconnected and remote operations.
 *   - 14 CFR Part 101 (unmanned free balloons) for the high-altitude stress case, including
 *     position-monitoring requirements.
 *   - 14 CFR Part 89 (Remote ID), Part 91 (general operating rules), Part 135 (eVTOL/air
 *     carrier where applicable), LAANC, ASTM F3548 (UTM), SORA.
 * Exceeding the minimums: in the degraded and mesh-relay states the gate admits no action
 * without (a) a valid Fluidity Token within its skew, (b) a healthy mesh relay or a
 * compiled airspace authority for the current volume, (c) a launch-readiness approval, and
 * (d) a recovery plan active — and high-consequence acts (launch, payload release,
 * recovery, balloon ops) require dual control. All decisions and state transitions are
 * bound into a tamper-evident, signed Mission Reconstruction Evidence Bundle.
 */

export type SwarmMissionClass =
  | "defense-perimeter"
  | "reconnaissance"
  | "temporary-comms-mesh"
  | "disaster-response"
  | "wildfire"
  | "agriculture"
  | "range-ops"
  | "infrastructure-inspection"
  | "high-altitude-launch";

export type SwarmFlightState =
  | "preflight"
  | "connected"
  | "degraded"
  | "mesh-relay"
  | "hold-safe"
  | "recover"
  | "return-to-launch"
  | "landing"
  | "landed"
  | "evidence-sync";

export type SwarmAdapterKind =
  | "swarm-orchestrator"
  | "mesh-relay"
  | "airspace-authority-compiler"
  | "launch-readiness"
  | "flight-warrant-service"
  | "mission-reconstruction"
  | "fluidity-token-service"
  | "payload-coordination"
  | "balloon-mothership"
  | "historian-write";

export interface SwarmAdapterDescriptor {
  kind: SwarmAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
  /** Regulatory clauses this boundary is built to satisfy. */
  regulatoryBasis: string[];
}

export const SWARM_ADAPTER_CATALOG: SwarmAdapterDescriptor[] = [
  {
    kind: "swarm-orchestrator",
    label: "Swarm Orchestrator Boundary",
    consequenceBoundary: "Mission tick, formation, role assignment, launch, recover, and hold-safe commands across a swarm",
    actionExamples: ["swarm.mission.tick", "swarm.launch.execute", "swarm.recover.execute", "swarm.hold.safe"],
    requiredRuntimeRegisters: ["telemetry.swarm_id", "telemetry.flight_state", "telemetry.swarm_size"],
    regulatoryBasis: ["14 CFR Part 107/108", "ASTM F3548 (UTM)"]
  },
  {
    kind: "mesh-relay",
    label: "Mesh Relay Boundary",
    consequenceBoundary: "Inter-unit relay configuration and authority-sync handoff across the swarm mesh",
    actionExamples: ["mesh.relay.activate", "mesh.relay.handover", "mesh.revocation.propagate"],
    requiredRuntimeRegisters: ["telemetry.mesh_link_quality", "telemetry.mesh_hops", "telemetry.mesh_relay_healthy"],
    regulatoryBasis: ["14 CFR Part 108 (security, separation)"]
  },
  {
    kind: "airspace-authority-compiler",
    label: "Airspace Authority Compiler Boundary",
    consequenceBoundary: "Compile COAs, waivers, launch windows, controlled-airspace permissions, lost-link behaviors, weather minima, and recovery plans into machine-readable authority",
    actionExamples: ["airspace.authority.compile", "airspace.authority.revoke"],
    requiredRuntimeRegisters: ["telemetry.airspace_authorization_active", "telemetry.no_active_tfr"],
    regulatoryBasis: ["14 CFR Part 107 waivers", "Part 108 BVLOS", "LAANC", "Part 91"]
  },
  {
    kind: "launch-readiness",
    label: "Launch Readiness Gate Boundary",
    consequenceBoundary: "Pre-launch authority approval, checklist completion, and recovery-plan activation",
    actionExamples: ["launch.readiness.approve", "launch.readiness.revoke"],
    requiredRuntimeRegisters: ["telemetry.launch_readiness_approved", "telemetry.recovery_plan_active"],
    regulatoryBasis: ["Part 107 preflight", "Part 91.103"]
  },
  {
    kind: "flight-warrant-service",
    label: "Flight Warrant Service Boundary",
    consequenceBoundary: "Issue, refresh, and verify per-unit Flight Warrants scoped to the mission and time-bounded",
    actionExamples: ["flight_warrant.issue", "flight_warrant.refresh", "flight_warrant.verify"],
    requiredRuntimeRegisters: ["telemetry.swarm_id", "telemetry.mission_id"],
    regulatoryBasis: ["Part 108 authorization framework"]
  },
  {
    kind: "mission-reconstruction",
    label: "GEL Mission Reconstruction Boundary",
    consequenceBoundary: "After-action evidence reconstruction, replay, and Evidence Bundle export",
    actionExamples: ["mission.reconstruction.export", "mission.reconstruction.verify"],
    requiredRuntimeRegisters: ["telemetry.mission_id", "telemetry.flight_state"],
    regulatoryBasis: ["Part 108 reporting/recordkeeping"]
  },
  {
    kind: "fluidity-token-service",
    label: "Fluidity Token Service Boundary",
    consequenceBoundary: "Issue, refresh, and revoke time-bounded degraded-comms authority tokens",
    actionExamples: ["fluidity_token.issue", "fluidity_token.refresh", "fluidity_token.revoke"],
    requiredRuntimeRegisters: ["telemetry.fluidity_token_valid", "telemetry.authority_sync_age_ms"],
    regulatoryBasis: ["Part 108 lost-link behavior", "SORA OSO"]
  },
  {
    kind: "payload-coordination",
    label: "Swarm Payload Coordination Boundary",
    consequenceBoundary: "Cross-unit payload release/dispense coordination and gimbal/sensor synchronization",
    actionExamples: ["swarm.payload.release", "swarm.payload.coordinate"],
    requiredRuntimeRegisters: ["telemetry.payload_kg", "telemetry.ops_over_people_authorized"],
    regulatoryBasis: ["Part 107 Subpart D (ops over people)"]
  },
  {
    kind: "balloon-mothership",
    label: "High-Altitude Balloon / Mothership Boundary (stress case)",
    consequenceBoundary: "Unmanned free balloon launch, position-monitor configuration, drop/release of UAV stack, and recovery",
    actionExamples: ["balloon.launch", "balloon.position.report", "balloon.release_stack", "balloon.recover"],
    requiredRuntimeRegisters: ["telemetry.balloon_position_monitor_active", "telemetry.balloon_within_envelope"],
    regulatoryBasis: ["14 CFR Part 101 (unmanned free balloons)"]
  },
  {
    kind: "historian-write",
    label: "Historian Write Boundary",
    consequenceBoundary: "Operational records, mission markers, and compliance annotations",
    actionExamples: ["historian.record.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"],
    regulatoryBasis: ["Part 108/107 recordkeeping"]
  }
];

/** The regulatory regimes this vertical is designed to meet and exceed. */
export const SWARM_REGULATORY_PROFILE = [
  "14 CFR Part 107 + waivers",
  "14 CFR Part 108 (BVLOS, proposed)",
  "14 CFR Part 101 (unmanned free balloons — stress case)",
  "14 CFR Part 89 (Remote ID)",
  "14 CFR Part 91 (general operating rules)",
  "LAANC",
  "ASTM F3548 (UTM)",
  "SORA (specific operations risk assessment)"
] as const;

export interface SwarmRuntimeSnapshot {
  asset_id: string;
  asset_type: "swarm-lead" | "swarm-member" | "balloon-mothership" | "ground-control-station" | string;
  swarm_id: string;
  mission_id: string;
  mission_class: SwarmMissionClass | string;
  operation_volume_id: string;
  system_model_id: string;
  flight_state: SwarmFlightState | string;
  flight_state_since: string;
  swarm_size: number;
  lead_unit_id?: string;
  /** Swarm-wide bounds and geometry. */
  swarm_radius_m?: number;
  unit_separation_m?: number;
  swarm_battery_soc_min_pct?: number;
  /** Mesh / disconnected operation. */
  mesh_link_quality: number; // 0..1
  mesh_hops: number;
  mesh_peers_count: number;
  mesh_relay_healthy: boolean;
  authority_sync_age_ms: number;
  lost_link_seconds: number;
  /** Fluidity Token — time-bounded degraded-comms authority. */
  fluidity_token_id?: string;
  fluidity_token_issued_at?: string;
  fluidity_token_expires_at?: string;
  fluidity_token_valid: boolean;
  /** Pre-launch & recovery posture. */
  launch_readiness_approved: boolean;
  recovery_plan_active: boolean;
  /** Reused aviation flags + readiness. */
  airspace_authorization_active: boolean;
  no_active_tfr: boolean;
  geofence_active: boolean;
  daa_active: boolean;
  c2_link_healthy: boolean;
  remote_id_broadcasting: boolean;
  weather_within_limits: boolean;
  altitude_agl_ft?: number;
  groundspeed_kts?: number;
  wind_speed_kts?: number;
  visibility_sm?: number;
  /** Balloon / mothership stress case (Part 101). */
  balloon_position_monitor_active?: boolean;
  balloon_within_envelope?: boolean;
  /** Payload coordination. */
  payload_kg?: number;
  ops_over_people_authorized?: boolean;
  /** Operator. */
  operator_qualified: boolean;
  operator_id?: string;
  waiver_id?: string;
  coa_ref?: string;
  policy_version?: string;
  telemetry_age_ms: number;
  metadata?: Record<string, JsonValue>;
}

export interface SwarmActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: SwarmRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface SwarmOrchestratorRequest {
  swarm_id: string;
  operation: "mission-tick" | "launch" | "recover" | "hold-safe" | "formation-set" | "role-assign";
  value?: JsonValue;
  action_type?: string;
}

export interface MeshRelayRequest {
  mesh_id: string;
  operation: "activate" | "handover" | "revocation-propagate";
  peer_id?: string;
  action_type?: string;
}

export interface AirspaceAuthorityCompilerRequest {
  authority_id: string;
  operation: "compile" | "revoke" | "publish";
  value?: JsonValue;
  action_type?: string;
}

export interface LaunchReadinessRequest {
  swarm_id: string;
  operation: "approve" | "revoke";
  value?: JsonValue;
  action_type?: string;
}

export interface FlightWarrantServiceRequest {
  warrant_id: string;
  operation: "issue" | "refresh" | "verify" | "revoke";
  unit_id?: string;
  action_type?: string;
}

export interface MissionReconstructionRequest {
  mission_id: string;
  operation: "export" | "verify";
  bundle_ref?: string;
  action_type?: string;
}

export interface FluidityTokenRequest {
  token_id: string;
  operation: "issue" | "refresh" | "revoke";
  ttl_seconds?: number;
  action_type?: string;
}

export interface SwarmPayloadCoordinationRequest {
  swarm_id: string;
  operation: "release" | "coordinate";
  payload_id?: string;
  action_type?: string;
}

export interface BalloonMothershipRequest {
  balloon_id: string;
  operation: "launch" | "position-report" | "release-stack" | "recover";
  value?: JsonValue;
  action_type?: string;
}

export interface SwarmHistorianWriteRequest {
  historian_id: string;
  stream: string;
  record_type: "operator-note" | "mission-marker" | "incident-marker" | "compliance-marker" | string;
  payload: Record<string, JsonValue>;
  action_type?: string;
}

export type SwarmAdapterRequest =
  | { kind: "swarm-orchestrator"; request: SwarmOrchestratorRequest }
  | { kind: "mesh-relay"; request: MeshRelayRequest }
  | { kind: "airspace-authority-compiler"; request: AirspaceAuthorityCompilerRequest }
  | { kind: "launch-readiness"; request: LaunchReadinessRequest }
  | { kind: "flight-warrant-service"; request: FlightWarrantServiceRequest }
  | { kind: "mission-reconstruction"; request: MissionReconstructionRequest }
  | { kind: "fluidity-token-service"; request: FluidityTokenRequest }
  | { kind: "payload-coordination"; request: SwarmPayloadCoordinationRequest }
  | { kind: "balloon-mothership"; request: BalloonMothershipRequest }
  | { kind: "historian-write"; request: SwarmHistorianWriteRequest };

export interface SwarmEvidenceContext {
  operator_id: string;
  control_station: string;
  mission_class: SwarmMissionClass | string;
  operational_scope: string;
  asset_id: string;
  swarm_id: string;
  mission_id: string;
  system_model_id: string;
  coa_ref?: string;
  waiver_id?: string;
  rpic_id: string;
  sora_risk_class?: "low" | "medium" | "high" | "not_applicable";
  regulatory_evidence_profile: Array<
    | "PART_107"
    | "PART_107_WAIVER"
    | "PART_108_BVLOS"
    | "PART_101_BALLOON"
    | "PART_91"
    | "PART_89_REMOTE_ID"
    | "LAANC"
    | "ASTM_F3548_UTM"
    | "SORA"
    | "DISCONNECTED_OPS"
    | "MESH_REVOCATION"
    | "FLUIDITY_TOKEN"
  >;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface SwarmEvidenceBundle {
  bundle_version: "aristotle.swarm-evidence.v1";
  exported_at: string;
  swarm: SwarmEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    swarm_context_hash: string;
    execution_bundle_hash: string;
    swarm_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: SwarmRuntimeSnapshot): Record<string, JsonValue> {
  return {
    asset_id: snapshot.asset_id,
    asset_type: snapshot.asset_type,
    swarm_id: snapshot.swarm_id,
    mission_id: snapshot.mission_id,
    mission_class: snapshot.mission_class,
    operation_volume_id: snapshot.operation_volume_id,
    boundary_id: snapshot.operation_volume_id,
    system_model_id: snapshot.system_model_id,
    flight_state: snapshot.flight_state,
    flight_state_since: snapshot.flight_state_since,
    swarm_size: snapshot.swarm_size,
    ...(snapshot.lead_unit_id ? { lead_unit_id: snapshot.lead_unit_id } : {}),
    ...(snapshot.swarm_radius_m !== undefined ? { swarm_radius_m: snapshot.swarm_radius_m } : {}),
    ...(snapshot.unit_separation_m !== undefined ? { unit_separation_m: snapshot.unit_separation_m } : {}),
    ...(snapshot.swarm_battery_soc_min_pct !== undefined ? { swarm_battery_soc_min_pct: snapshot.swarm_battery_soc_min_pct } : {}),
    mesh_link_quality: snapshot.mesh_link_quality,
    mesh_hops: snapshot.mesh_hops,
    mesh_peers_count: snapshot.mesh_peers_count,
    mesh_relay_healthy: snapshot.mesh_relay_healthy,
    authority_sync_age_ms: snapshot.authority_sync_age_ms,
    lost_link_seconds: snapshot.lost_link_seconds,
    ...(snapshot.fluidity_token_id ? { fluidity_token_id: snapshot.fluidity_token_id } : {}),
    ...(snapshot.fluidity_token_issued_at ? { fluidity_token_issued_at: snapshot.fluidity_token_issued_at } : {}),
    ...(snapshot.fluidity_token_expires_at ? { fluidity_token_expires_at: snapshot.fluidity_token_expires_at } : {}),
    fluidity_token_valid: snapshot.fluidity_token_valid,
    launch_readiness_approved: snapshot.launch_readiness_approved,
    recovery_plan_active: snapshot.recovery_plan_active,
    airspace_authorization_active: snapshot.airspace_authorization_active,
    no_active_tfr: snapshot.no_active_tfr,
    geofence_active: snapshot.geofence_active,
    daa_active: snapshot.daa_active,
    c2_link_healthy: snapshot.c2_link_healthy,
    remote_id_broadcasting: snapshot.remote_id_broadcasting,
    weather_within_limits: snapshot.weather_within_limits,
    ...(snapshot.altitude_agl_ft !== undefined ? { altitude_agl_ft: snapshot.altitude_agl_ft } : {}),
    ...(snapshot.groundspeed_kts !== undefined ? { groundspeed_kts: snapshot.groundspeed_kts } : {}),
    ...(snapshot.wind_speed_kts !== undefined ? { wind_speed_kts: snapshot.wind_speed_kts } : {}),
    ...(snapshot.visibility_sm !== undefined ? { visibility_sm: snapshot.visibility_sm } : {}),
    ...(snapshot.balloon_position_monitor_active !== undefined ? { balloon_position_monitor_active: snapshot.balloon_position_monitor_active } : {}),
    ...(snapshot.balloon_within_envelope !== undefined ? { balloon_within_envelope: snapshot.balloon_within_envelope } : {}),
    ...(snapshot.payload_kg !== undefined ? { payload_kg: snapshot.payload_kg } : {}),
    ...(snapshot.ops_over_people_authorized !== undefined ? { ops_over_people_authorized: snapshot.ops_over_people_authorized } : {}),
    operator_qualified: snapshot.operator_qualified,
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {}),
    ...(snapshot.waiver_id ? { waiver_id: snapshot.waiver_id } : {}),
    ...(snapshot.coa_ref ? { coa_ref: snapshot.coa_ref } : {}),
    telemetry_age_ms: snapshot.telemetry_age_ms
  };
}

function swarmAction(
  ctx: SwarmActionContext,
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

export function swarmOrchestratorToAction(input: SwarmOrchestratorRequest, ctx: SwarmActionContext): CanonicalActionInput {
  const fallback =
    input.operation === "mission-tick"
      ? "swarm.mission.tick"
      : input.operation === "launch"
        ? "swarm.launch.execute"
        : input.operation === "recover"
          ? "swarm.recover.execute"
          : input.operation === "hold-safe"
            ? "swarm.hold.safe"
            : `swarm.${slug(input.operation)}`;
  return swarmAction(ctx, input.action_type ?? fallback, `${input.swarm_id}:${input.operation}`, {
    adapter: "swarm-orchestrator",
    swarm_id: input.swarm_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function meshRelayToAction(input: MeshRelayRequest, ctx: SwarmActionContext): CanonicalActionInput {
  const fallback =
    input.operation === "activate"
      ? "mesh.relay.activate"
      : input.operation === "handover"
        ? "mesh.relay.handover"
        : "mesh.revocation.propagate";
  return swarmAction(ctx, input.action_type ?? fallback, `${input.mesh_id}:${input.operation}`, {
    adapter: "mesh-relay",
    mesh_id: input.mesh_id,
    operation: input.operation,
    ...(input.peer_id ? { peer_id: input.peer_id } : {})
  });
}

export function airspaceAuthorityCompilerToAction(input: AirspaceAuthorityCompilerRequest, ctx: SwarmActionContext): CanonicalActionInput {
  const fallback = `airspace.authority.${slug(input.operation)}`;
  return swarmAction(ctx, input.action_type ?? fallback, `${input.authority_id}:${input.operation}`, {
    adapter: "airspace-authority-compiler",
    authority_id: input.authority_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function launchReadinessToAction(input: LaunchReadinessRequest, ctx: SwarmActionContext): CanonicalActionInput {
  const fallback = input.operation === "approve" ? "launch.readiness.approve" : "launch.readiness.revoke";
  return swarmAction(ctx, input.action_type ?? fallback, `${input.swarm_id}:launch-readiness:${input.operation}`, {
    adapter: "launch-readiness",
    swarm_id: input.swarm_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function flightWarrantServiceToAction(input: FlightWarrantServiceRequest, ctx: SwarmActionContext): CanonicalActionInput {
  const fallback = `flight_warrant.${slug(input.operation)}`;
  return swarmAction(ctx, input.action_type ?? fallback, `${input.warrant_id}:${input.operation}`, {
    adapter: "flight-warrant-service",
    warrant_id: input.warrant_id,
    operation: input.operation,
    ...(input.unit_id ? { unit_id: input.unit_id } : {})
  });
}

export function missionReconstructionToAction(input: MissionReconstructionRequest, ctx: SwarmActionContext): CanonicalActionInput {
  const fallback = input.operation === "export" ? "mission.reconstruction.export" : "mission.reconstruction.verify";
  return swarmAction(ctx, input.action_type ?? fallback, `${input.mission_id}:mission-reconstruction:${input.operation}`, {
    adapter: "mission-reconstruction",
    mission_id: input.mission_id,
    operation: input.operation,
    ...(input.bundle_ref ? { bundle_ref: input.bundle_ref } : {})
  });
}

export function fluidityTokenToAction(input: FluidityTokenRequest, ctx: SwarmActionContext): CanonicalActionInput {
  const fallback = `fluidity_token.${slug(input.operation)}`;
  return swarmAction(ctx, input.action_type ?? fallback, `${input.token_id}:${input.operation}`, {
    adapter: "fluidity-token-service",
    token_id: input.token_id,
    operation: input.operation,
    ...(input.ttl_seconds !== undefined ? { ttl_seconds: input.ttl_seconds } : {})
  });
}

export function swarmPayloadCoordinationToAction(input: SwarmPayloadCoordinationRequest, ctx: SwarmActionContext): CanonicalActionInput {
  const fallback = input.operation === "release" ? "swarm.payload.release" : "swarm.payload.coordinate";
  return swarmAction(ctx, input.action_type ?? fallback, `${input.swarm_id}:payload:${input.operation}`, {
    adapter: "payload-coordination",
    swarm_id: input.swarm_id,
    operation: input.operation,
    ...(input.payload_id ? { payload_id: input.payload_id } : {})
  });
}

export function balloonMothershipToAction(input: BalloonMothershipRequest, ctx: SwarmActionContext): CanonicalActionInput {
  const fallback =
    input.operation === "launch"
      ? "balloon.launch"
      : input.operation === "position-report"
        ? "balloon.position.report"
        : input.operation === "release-stack"
          ? "balloon.release_stack"
          : "balloon.recover";
  return swarmAction(ctx, input.action_type ?? fallback, `${input.balloon_id}:${input.operation}`, {
    adapter: "balloon-mothership",
    balloon_id: input.balloon_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function swarmHistorianWriteToAction(input: SwarmHistorianWriteRequest, ctx: SwarmActionContext): CanonicalActionInput {
  return swarmAction(ctx, input.action_type ?? "historian.record.write", `${input.historian_id}:${input.stream}:${input.record_type}`, {
    adapter: "historian-write",
    historian_id: input.historian_id,
    stream: input.stream,
    record_type: input.record_type,
    payload: input.payload
  });
}

export function swarmAdapterToAction(input: SwarmAdapterRequest, ctx: SwarmActionContext): CanonicalActionInput {
  if (input.kind === "swarm-orchestrator") return swarmOrchestratorToAction(input.request, ctx);
  if (input.kind === "mesh-relay") return meshRelayToAction(input.request, ctx);
  if (input.kind === "airspace-authority-compiler") return airspaceAuthorityCompilerToAction(input.request, ctx);
  if (input.kind === "launch-readiness") return launchReadinessToAction(input.request, ctx);
  if (input.kind === "flight-warrant-service") return flightWarrantServiceToAction(input.request, ctx);
  if (input.kind === "mission-reconstruction") return missionReconstructionToAction(input.request, ctx);
  if (input.kind === "fluidity-token-service") return fluidityTokenToAction(input.request, ctx);
  if (input.kind === "payload-coordination") return swarmPayloadCoordinationToAction(input.request, ctx);
  if (input.kind === "balloon-mothership") return balloonMothershipToAction(input.request, ctx);
  return swarmHistorianWriteToAction(input.request, ctx);
}

export function swarmSnapshotToRuntimeRegister(snapshot: SwarmRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateSwarmSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
  return evaluatePhysicalInvariants(action, ward.physical_bounds);
}

/**
 * Disconnected flight state transition helper. Returns the next safe state for a swarm
 * given current connectivity signals. The gate consults `flight_state` and other
 * registers — this helper is for swarm orchestrators that want a canonical transition
 * function without reimplementing the doctrine.
 *
 * Rules of thumb (intentionally conservative):
 *   - lost_link_seconds > maxLostLinkSeconds  -> "hold-safe"
 *   - fluidity_token_valid === false          -> "hold-safe"
 *   - mesh_relay_healthy === false && c2 unhealthy -> "mesh-relay" if peers, else "hold-safe"
 *   - c2_link_healthy === false but mesh healthy   -> "mesh-relay"
 *   - all healthy                              -> "connected"
 *   - hold-safe duration past recovery window -> "recover"
 */
export function nextSwarmFlightState(
  current: SwarmFlightState | string,
  signals: {
    c2_link_healthy: boolean;
    mesh_relay_healthy: boolean;
    mesh_peers_count: number;
    fluidity_token_valid: boolean;
    lost_link_seconds: number;
    max_lost_link_seconds: number;
    recovery_required: boolean;
  }
): SwarmFlightState {
  if (signals.fluidity_token_valid === false) return "hold-safe";
  if (signals.lost_link_seconds > signals.max_lost_link_seconds) return "hold-safe";
  if (current === "hold-safe" && signals.recovery_required) return "recover";
  if (signals.c2_link_healthy) return "connected";
  if (signals.mesh_relay_healthy && signals.mesh_peers_count > 0) return "mesh-relay";
  if (!signals.c2_link_healthy && !signals.mesh_relay_healthy) return "hold-safe";
  return "degraded";
}

function evidenceBundleMaterialHash(bundle: EvidenceBundle): string {
  return sha256(stableStringify({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    hashes: bundle.hashes,
    selected_record: bundle.selected_record
  }));
}

function swarmBundleHash(input: Omit<SwarmEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<SwarmEvidenceBundle["hashes"], "swarm_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportSwarmEvidenceBundle(input: ExportEvidenceBundleInput & { swarm: SwarmEvidenceContext }): SwarmEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.swarm-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    swarm: JSON.parse(stableStringify(input.swarm)) as SwarmEvidenceContext,
    execution_bundle
  };
  const hashes = {
    swarm_context_hash: sha256(stableStringify(partial.swarm)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    swarm_bundle_hash: ""
  };
  hashes.swarm_bundle_hash = swarmBundleHash({
    ...partial,
    hashes: {
      swarm_context_hash: hashes.swarm_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: SwarmEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifySwarmEvidenceBundle(draft) };
}

export function verifySwarmEvidenceBundle(bundle: SwarmEvidenceBundle): SwarmEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.swarm-evidence.v1") failures.push("unsupported swarm evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.swarm));
  if (contextHash !== bundle.hashes.swarm_context_hash) failures.push("swarm context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = swarmBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    swarm: bundle.swarm,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      swarm_context_hash: bundle.hashes.swarm_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.swarm_bundle_hash) failures.push("swarm bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
