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
 * Autonomous vehicle readiness primitives.
 *
 * These adapters do not drive vehicles directly. They turn vehicle, fleet, OTA,
 * remote-assist, and simulation requests into Canonical Governed Actions. The
 * action still must pass the Ward, Authority Envelope, Commit Gate, Vehicle
 * Safety Invariants, Warrant issuance, and GEL evidence path before execution.
 */

export type AutomotiveDomain =
  | "fleet-operations"
  | "ota"
  | "remote-assist"
  | "mapping"
  | "simulation"
  | "test-track";

export type AutomotiveAdapterKind =
  | "ros2-dds"
  | "autosar-adaptive"
  | "ota-campaign"
  | "map-update"
  | "remote-assist"
  | "fleet-management"
  | "simulation";

export interface AutomotiveAdapterDescriptor {
  kind: AutomotiveAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
}

export const AUTOMOTIVE_ADAPTER_CATALOG: AutomotiveAdapterDescriptor[] = [
  {
    kind: "ros2-dds",
    label: "ROS 2 / DDS Command Bridge",
    consequenceBoundary: "Robot command topics, vehicle behaviors, and autonomy stack control surfaces",
    actionExamples: ["ros2.command.publish", "vehicle.behavior.request", "vehicle.low_speed_move"],
    requiredRuntimeRegisters: ["telemetry.vehicle_id", "telemetry.odd_id", "telemetry.mrc_available"]
  },
  {
    kind: "autosar-adaptive",
    label: "AUTOSAR Adaptive Service Boundary",
    consequenceBoundary: "Service method calls that can affect vehicle behavior, diagnostics, and platform state",
    actionExamples: ["autosar.service.invoke", "vehicle.diagnostics.request"],
    requiredRuntimeRegisters: ["telemetry.vehicle_id", "telemetry.drive_state", "telemetry.safety_case_id"]
  },
  {
    kind: "ota-campaign",
    label: "OTA Campaign Gate",
    consequenceBoundary: "Software image staging, rollout waves, rollback, and activation",
    actionExamples: ["ota.campaign.stage", "ota.campaign.activate", "ota.campaign.rollback"],
    requiredRuntimeRegisters: ["telemetry.vehicle_id", "telemetry.drive_state", "telemetry.ota_image_digest"]
  },
  {
    kind: "map-update",
    label: "Map Update Gate",
    consequenceBoundary: "HD map activation and ODD-bound map material changes",
    actionExamples: ["map.update.activate", "map.update.rollback"],
    requiredRuntimeRegisters: ["telemetry.vehicle_id", "telemetry.map_version", "telemetry.map_confidence"]
  },
  {
    kind: "remote-assist",
    label: "Remote Assist Command Gate",
    consequenceBoundary: "Human-assisted route, pull-over, recovery, and mission-direction commands",
    actionExamples: ["remote_assist.command", "fleet.vehicle.hold"],
    requiredRuntimeRegisters: ["telemetry.remote_assist_session_id", "telemetry.mrc_available", "telemetry.operator_id"]
  },
  {
    kind: "fleet-management",
    label: "Fleet Management Boundary",
    consequenceBoundary: "Dispatch, hold, return-to-base, depot routing, and service eligibility",
    actionExamples: ["fleet.vehicle.dispatch", "fleet.vehicle.hold", "fleet.vehicle.return_to_base"],
    requiredRuntimeRegisters: ["telemetry.vehicle_id", "telemetry.fleet_region", "telemetry.odd_id"]
  },
  {
    kind: "simulation",
    label: "Simulation and Replay Harness",
    consequenceBoundary: "Scenario admission, counterfactual replay, and regression evidence generation",
    actionExamples: ["simulation.scenario.run", "simulation.replay.verify"],
    requiredRuntimeRegisters: ["telemetry.scenario_id", "telemetry.safety_case_id"]
  }
];

export interface VehicleSafetySnapshot {
  vehicle_id: string;
  fleet_region?: string;
  odd_id: string;
  road_class: string;
  drive_state: "parked" | "manual" | "remote_assist" | "low_speed_autonomy" | "autonomy" | "mrc" | string;
  speed_mps: number;
  map_confidence: number;
  localization_confidence: number;
  perception_confidence: number;
  mrc_available: boolean;
  battery_pct?: number;
  parked?: boolean;
  passenger_present?: boolean;
  remote_assist_session_id?: string;
  operator_id?: string;
  ota_image_digest?: string;
  map_version?: string;
  safety_case_id?: string;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface AutomotiveActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  safety: VehicleSafetySnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface Ros2DdsCommandRequest {
  topic: string;
  message_type: string;
  command: string;
  payload?: Record<string, JsonValue>;
  action_type?: string;
}

export interface AutosarAdaptiveRequest {
  service: string;
  method: string;
  instance_id: string;
  payload?: Record<string, JsonValue>;
  action_type?: string;
}

export interface OtaCampaignRequest {
  campaign_id: string;
  image_digest: string;
  rollout_wave: "canary" | "regional" | "fleet" | string;
  operation: "stage" | "activate" | "rollback";
  target_vehicle_ids?: string[];
  action_type?: string;
}

export interface MapUpdateRequest {
  map_id: string;
  map_version: string;
  operation: "activate" | "rollback" | "validate";
  odd_id: string;
  action_type?: string;
}

export interface RemoteAssistRequest {
  session_id: string;
  operator_id: string;
  command: "pull_over" | "resume_route" | "hold_position" | "return_to_depot" | string;
  reason: string;
  action_type?: string;
}

export interface FleetManagementRequest {
  fleet_id: string;
  vehicle_id: string;
  operation: "dispatch" | "hold" | "return_to_base" | "remove_from_service" | string;
  target?: string;
  action_type?: string;
}

export interface SimulationScenarioRequest {
  scenario_id: string;
  simulator: "carla" | "autoware" | "apollo" | "custom" | string;
  operation: "run" | "replay" | "verify";
  seed?: string;
  action_type?: string;
}

export type AutomotiveAdapterRequest =
  | { kind: "ros2-dds"; request: Ros2DdsCommandRequest }
  | { kind: "autosar-adaptive"; request: AutosarAdaptiveRequest }
  | { kind: "ota-campaign"; request: OtaCampaignRequest }
  | { kind: "map-update"; request: MapUpdateRequest }
  | { kind: "remote-assist"; request: RemoteAssistRequest }
  | { kind: "fleet-management"; request: FleetManagementRequest }
  | { kind: "simulation"; request: SimulationScenarioRequest };

export interface AutomotiveEvidenceContext {
  fleet_id: string;
  vehicle_id: string;
  safety_operator: string;
  automotive_domain: AutomotiveDomain;
  operational_scope: string;
  odd_id: string;
  software_version?: string;
  map_version?: string;
  remote_assist_session_id?: string;
  scenario_id?: string;
  safety_case_id: string;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  standards_profile: Array<"ISO_26262" | "ISO_21448" | "ISO_21434" | "UNECE_R155" | "UNECE_R156" | "UL_4600" | "SAE_J3016">;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface AutomotiveEvidenceBundle {
  bundle_version: "aristotle.automotive-evidence.v1";
  exported_at: string;
  automotive: AutomotiveEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    automotive_context_hash: string;
    execution_bundle_hash: string;
    automotive_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function safetyParams(safety: VehicleSafetySnapshot): Record<string, JsonValue> {
  return {
    vehicle_id: safety.vehicle_id,
    ...(safety.fleet_region ? { fleet_region: safety.fleet_region } : {}),
    odd_id: safety.odd_id,
    road_class: safety.road_class,
    drive_state: safety.drive_state,
    speed_mps: safety.speed_mps,
    map_confidence: safety.map_confidence,
    localization_confidence: safety.localization_confidence,
    perception_confidence: safety.perception_confidence,
    mrc_available: safety.mrc_available,
    ...(safety.battery_pct !== undefined ? { battery_pct: safety.battery_pct } : {}),
    ...(safety.parked !== undefined ? { parked: safety.parked } : {}),
    ...(safety.passenger_present !== undefined ? { passenger_present: safety.passenger_present } : {}),
    ...(safety.remote_assist_session_id ? { remote_assist_session_id: safety.remote_assist_session_id } : {}),
    ...(safety.operator_id ? { operator_id: safety.operator_id } : {}),
    ...(safety.ota_image_digest ? { ota_image_digest: safety.ota_image_digest } : {}),
    ...(safety.map_version ? { map_version: safety.map_version } : {}),
    ...(safety.safety_case_id ? { safety_case_id: safety.safety_case_id } : {})
  };
}

function automotiveAction(
  ctx: AutomotiveActionContext,
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
    params: { ...safetyParams(ctx.safety), ...params },
    requested_at: ctx.requested_at,
    ...(ctx.request_id ? { request_id: ctx.request_id } : {}),
    telemetry: {
      ...safetyParams(ctx.safety),
      ...(ctx.safety.metadata ?? {}),
      ...(ctx.telemetry ?? {})
    },
    ...(ctx.classification ? { classification: ctx.classification } : {})
  };
}

export function ros2DdsCommandToAction(input: Ros2DdsCommandRequest, ctx: AutomotiveActionContext): CanonicalActionInput {
  return automotiveAction(ctx, input.action_type ?? "ros2.command.publish", input.topic, {
    adapter: "ros2-dds",
    topic: input.topic,
    message_type: input.message_type,
    command: input.command,
    ...(input.payload ? { payload: input.payload } : {})
  });
}

export function autosarAdaptiveToAction(input: AutosarAdaptiveRequest, ctx: AutomotiveActionContext): CanonicalActionInput {
  return automotiveAction(ctx, input.action_type ?? "autosar.service.invoke", `${input.service}:${input.instance_id}:${input.method}`, {
    adapter: "autosar-adaptive",
    service: input.service,
    instance_id: input.instance_id,
    method: input.method,
    ...(input.payload ? { payload: input.payload } : {})
  });
}

export function otaCampaignToAction(input: OtaCampaignRequest, ctx: AutomotiveActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? `ota.campaign.${slug(input.operation)}`;
  return automotiveAction(ctx, actionType, `${input.campaign_id}:${input.rollout_wave}`, {
    adapter: "ota-campaign",
    campaign_id: input.campaign_id,
    image_digest: input.image_digest,
    ota_image_digest: input.image_digest,
    rollout_wave: input.rollout_wave,
    operation: input.operation,
    ...(input.target_vehicle_ids ? { target_vehicle_ids: input.target_vehicle_ids } : {})
  });
}

export function mapUpdateToAction(input: MapUpdateRequest, ctx: AutomotiveActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? `map.update.${slug(input.operation)}`;
  return automotiveAction(ctx, actionType, `${input.map_id}:${input.map_version}:${input.odd_id}`, {
    adapter: "map-update",
    map_id: input.map_id,
    map_version: input.map_version,
    operation: input.operation,
    odd_id: input.odd_id
  });
}

export function remoteAssistToAction(input: RemoteAssistRequest, ctx: AutomotiveActionContext): CanonicalActionInput {
  return automotiveAction(ctx, input.action_type ?? "remote_assist.command", `${input.session_id}:${input.command}`, {
    adapter: "remote-assist",
    session_id: input.session_id,
    remote_assist_session_id: input.session_id,
    operator_id: input.operator_id,
    command: input.command,
    reason: input.reason
  });
}

export function fleetManagementToAction(input: FleetManagementRequest, ctx: AutomotiveActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? `fleet.vehicle.${slug(input.operation)}`;
  return automotiveAction(ctx, actionType, `${input.fleet_id}:${input.vehicle_id}:${input.operation}`, {
    adapter: "fleet-management",
    fleet_id: input.fleet_id,
    vehicle_id: input.vehicle_id,
    operation: input.operation,
    ...(input.target ? { target: input.target } : {})
  });
}

export function simulationScenarioToAction(input: SimulationScenarioRequest, ctx: AutomotiveActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? `simulation.scenario.${slug(input.operation)}`;
  return automotiveAction(ctx, actionType, `${input.simulator}:${input.scenario_id}`, {
    adapter: "simulation",
    scenario_id: input.scenario_id,
    simulator: input.simulator,
    operation: input.operation,
    ...(input.seed ? { seed: input.seed } : {})
  });
}

export function automotiveAdapterToAction(input: AutomotiveAdapterRequest, ctx: AutomotiveActionContext): CanonicalActionInput {
  if (input.kind === "ros2-dds") return ros2DdsCommandToAction(input.request, ctx);
  if (input.kind === "autosar-adaptive") return autosarAdaptiveToAction(input.request, ctx);
  if (input.kind === "ota-campaign") return otaCampaignToAction(input.request, ctx);
  if (input.kind === "map-update") return mapUpdateToAction(input.request, ctx);
  if (input.kind === "remote-assist") return remoteAssistToAction(input.request, ctx);
  if (input.kind === "fleet-management") return fleetManagementToAction(input.request, ctx);
  return simulationScenarioToAction(input.request, ctx);
}

export function vehicleSafetySnapshotToRuntimeRegister(snapshot: VehicleSafetySnapshot): RuntimeRegister {
  const telemetry = safetyParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateVehicleSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function automotiveBundleHash(input: Omit<AutomotiveEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<AutomotiveEvidenceBundle["hashes"], "automotive_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportAutomotiveEvidenceBundle(input: ExportEvidenceBundleInput & { automotive: AutomotiveEvidenceContext }): AutomotiveEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.automotive-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    automotive: JSON.parse(stableStringify(input.automotive)) as AutomotiveEvidenceContext,
    execution_bundle
  };
  const hashes = {
    automotive_context_hash: sha256(stableStringify(partial.automotive)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    automotive_bundle_hash: ""
  };
  hashes.automotive_bundle_hash = automotiveBundleHash({
    ...partial,
    hashes: {
      automotive_context_hash: hashes.automotive_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: AutomotiveEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyAutomotiveEvidenceBundle(draft) };
}

export function verifyAutomotiveEvidenceBundle(bundle: AutomotiveEvidenceBundle): AutomotiveEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.automotive-evidence.v1") failures.push("unsupported automotive evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.automotive));
  if (contextHash !== bundle.hashes.automotive_context_hash) failures.push("automotive context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = automotiveBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    automotive: bundle.automotive,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      automotive_context_hash: bundle.hashes.automotive_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.automotive_bundle_hash) failures.push("automotive bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
