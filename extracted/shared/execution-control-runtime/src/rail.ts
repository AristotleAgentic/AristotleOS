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
 * Railroad readiness primitives.
 *
 * Rail adapters do not replace PTC, dispatch, wayside signal, or other vital
 * railroad systems. They translate proposed rail operations into Canonical
 * Governed Actions so AristotleOS can bind authority before a command reaches
 * consequential rail infrastructure.
 */

export type RailDomain =
  | "freight-mainline"
  | "passenger-corridor"
  | "commuter-rail"
  | "terminal"
  | "yard"
  | "maintenance-of-way"
  | "hazmat-corridor"
  | "dark-territory"
  | "ptc-mainline";

export type RailAdapterKind =
  | "dispatch-cad"
  | "ptc-back-office"
  | "wayside-signal"
  | "switch-machine"
  | "grade-crossing"
  | "locomotive-telemetry"
  | "crew-management"
  | "consist-hazmat"
  | "maintenance-of-way"
  | "yard-automation";

export interface RailAdapterDescriptor {
  kind: RailAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
}

export const RAIL_ADAPTER_CATALOG: RailAdapterDescriptor[] = [
  {
    kind: "dispatch-cad",
    label: "Dispatch / CAD Authority Boundary",
    consequenceBoundary: "Movement authority, route lineup, dispatcher release, train order, and meet/pass planning",
    actionExamples: ["rail.movement.authority.issue", "rail.route.lineup.authorize"],
    requiredRuntimeRegisters: ["telemetry.territory_id", "telemetry.dispatcher_id", "telemetry.movement_authority_id", "telemetry.ptc_active"]
  },
  {
    kind: "ptc-back-office",
    label: "PTC Back Office Boundary",
    consequenceBoundary: "PTC restriction updates, enforcement state, route authority material, and interoperability handoff",
    actionExamples: ["ptc.restriction.update", "ptc.authority.sync"],
    requiredRuntimeRegisters: ["telemetry.ptc_active", "telemetry.ptc_telemetry_age_ms", "telemetry.host_railroad_id"]
  },
  {
    kind: "wayside-signal",
    label: "Wayside Signal Boundary",
    consequenceBoundary: "Signal aspect commands, route clearing, and wayside state transitions",
    actionExamples: ["signal.aspect.request", "signal.route.clear"],
    requiredRuntimeRegisters: ["telemetry.signal_aspect", "telemetry.switch_position_proven", "telemetry.conflicting_authority_present"]
  },
  {
    kind: "switch-machine",
    label: "Switch Machine Boundary",
    consequenceBoundary: "Remote switch alignment, lock/unlock, and switch state verification",
    actionExamples: ["switch.align.request", "switch.lock.release"],
    requiredRuntimeRegisters: ["telemetry.switch_id", "telemetry.switch_position_proven", "telemetry.route_id"]
  },
  {
    kind: "grade-crossing",
    label: "Grade Crossing Boundary",
    consequenceBoundary: "Crossing protection, temporary restrictions, and roadway interface operations",
    actionExamples: ["crossing.protection.request", "crossing.override.request"],
    requiredRuntimeRegisters: ["telemetry.grade_crossing_protected", "telemetry.milepost_from", "telemetry.milepost_to"]
  },
  {
    kind: "locomotive-telemetry",
    label: "Locomotive / Onboard Boundary",
    consequenceBoundary: "Locomotive command surfaces, onboard state, speed enforcement context, and event recorder pointers",
    actionExamples: ["locomotive.command.request", "locomotive.telemetry.attest"],
    requiredRuntimeRegisters: ["telemetry.train_id", "telemetry.locomotive_id", "telemetry.speed_mph", "telemetry.brake_test_current"]
  },
  {
    kind: "crew-management",
    label: "Crew Management Boundary",
    consequenceBoundary: "Crew acknowledgement, track bulletin acceptance, and authority handoff",
    actionExamples: ["crew.bulletin.ack", "crew.authority.accept"],
    requiredRuntimeRegisters: ["telemetry.crew_id", "telemetry.crew_acknowledged", "telemetry.track_bulletin_ack"]
  },
  {
    kind: "consist-hazmat",
    label: "Consist / Hazmat Boundary",
    consequenceBoundary: "Consist validation, hazmat routing, train make-up, and restricted commodity movement",
    actionExamples: ["consist.route.validate", "hazmat.routing.authorize"],
    requiredRuntimeRegisters: ["telemetry.consist_hash", "telemetry.hazmat_classes", "telemetry.route_class"]
  },
  {
    kind: "maintenance-of-way",
    label: "Maintenance-of-Way Boundary",
    consequenceBoundary: "Work zone protection, track occupancy, release, and speed restriction changes",
    actionExamples: ["mow.work-zone.release", "track.speed-restriction.update"],
    requiredRuntimeRegisters: ["telemetry.work_zone_id", "telemetry.work_zone_released", "telemetry.track_bulletin_ack"]
  },
  {
    kind: "yard-automation",
    label: "Yard Automation Boundary",
    consequenceBoundary: "Yard route lining, remote shove, hump/classification automation, and terminal movement",
    actionExamples: ["yard.route.line", "yard.remote-shove.authorize"],
    requiredRuntimeRegisters: ["telemetry.yard_id", "telemetry.switch_position_proven", "telemetry.train_separation_m"]
  }
];

export interface RailRuntimeSnapshot {
  railroad_id: string;
  host_railroad_id: string;
  tenant_railroad_id?: string;
  territory_id: string;
  subdivision: string;
  route_id: string;
  track_id: string;
  milepost_from: number;
  milepost_to: number;
  train_id: string;
  train_symbol: string;
  locomotive_id: string;
  train_type: "freight" | "passenger" | "commuter" | "maintenance" | "yard" | string;
  consist_hash: string;
  hazmat_classes?: string[];
  movement_authority_id?: string;
  dispatcher_id?: string;
  crew_id?: string;
  crew_acknowledged: boolean;
  ptc_active: boolean;
  ptc_mode: "enforcing" | "cut-out" | "restricted" | "unknown" | string;
  ptc_telemetry_age_ms: number;
  signal_aspect: "clear" | "approach" | "stop" | "restricting" | "unknown" | string;
  switch_id?: string;
  switch_position: "normal" | "reverse" | "unknown" | string;
  switch_position_proven: boolean;
  grade_crossing_protected: boolean;
  work_zone_id?: string;
  work_zone_released: boolean;
  track_bulletin_ack: boolean;
  brake_test_current: boolean;
  manual_fallback_ready: boolean;
  conflicting_authority_present: boolean;
  speed_mph: number;
  authority_speed_mph: number;
  train_separation_m: number;
  train_length_ft?: number;
  train_tonnage?: number;
  route_class: string;
  track_class: string;
  operating_state: "normal" | "work-zone" | "restricted" | "yard" | "emergency" | string;
  event_recorder_ref?: string;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface RailActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: RailRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface DispatchMovementAuthorityRequest {
  authority_id: string;
  train_id: string;
  from_milepost: number;
  to_milepost: number;
  max_speed_mph: number;
  track_id: string;
  action_type?: string;
}

export interface PtcRestrictionRequest {
  restriction_id: string;
  operation: "add" | "update" | "remove" | "sync";
  from_milepost: number;
  to_milepost: number;
  max_speed_mph: number;
  action_type?: string;
}

export interface WaysideSignalRequest {
  signal_id: string;
  requested_aspect: "clear" | "approach" | "restricting" | "stop" | string;
  route_id: string;
  action_type?: string;
}

export interface SwitchMachineRequest {
  switch_id: string;
  requested_position: "normal" | "reverse" | string;
  locked?: boolean;
  action_type?: string;
}

export interface GradeCrossingRequest {
  crossing_id: string;
  operation: "protect" | "test" | "release" | "override" | string;
  action_type?: string;
}

export interface LocomotiveCommandRequest {
  locomotive_id: string;
  command: "hold" | "release" | "restrict-speed" | "attest-telemetry" | string;
  value?: JsonValue;
  action_type?: string;
}

export interface CrewBulletinRequest {
  bulletin_id: string;
  crew_id: string;
  operation: "acknowledge" | "reject" | "request-clarification" | string;
  action_type?: string;
}

export interface ConsistHazmatRequest {
  consist_hash: string;
  route_id: string;
  operation: "validate-route" | "authorize-hazmat" | "hold" | string;
  hazmat_classes?: string[];
  action_type?: string;
}

export interface MaintenanceOfWayRequest {
  work_zone_id: string;
  operation: "establish" | "release" | "extend" | "speed-restriction-update" | string;
  action_type?: string;
}

export interface YardAutomationRequest {
  yard_id: string;
  operation: "line-route" | "authorize-remote-shove" | "hold-cut" | string;
  track_id: string;
  action_type?: string;
}

export type RailAdapterRequest =
  | { kind: "dispatch-cad"; request: DispatchMovementAuthorityRequest }
  | { kind: "ptc-back-office"; request: PtcRestrictionRequest }
  | { kind: "wayside-signal"; request: WaysideSignalRequest }
  | { kind: "switch-machine"; request: SwitchMachineRequest }
  | { kind: "grade-crossing"; request: GradeCrossingRequest }
  | { kind: "locomotive-telemetry"; request: LocomotiveCommandRequest }
  | { kind: "crew-management"; request: CrewBulletinRequest }
  | { kind: "consist-hazmat"; request: ConsistHazmatRequest }
  | { kind: "maintenance-of-way"; request: MaintenanceOfWayRequest }
  | { kind: "yard-automation"; request: YardAutomationRequest };

export interface RailEvidenceContext {
  railroad_id: string;
  operations_center: string;
  rail_domain: RailDomain;
  territory_id: string;
  subdivision: string;
  milepost_limits: { from: number; to: number };
  train_id: string;
  train_symbol: string;
  locomotive_id: string;
  movement_authority_id?: string;
  dispatcher_id: string;
  crew_id?: string;
  consist_hash: string;
  ptc_status: "active" | "inactive" | "restricted" | "unknown";
  route_id: string;
  track_id: string;
  signal_system?: string;
  work_zone_id?: string;
  hazmat_profile?: string[];
  standards_profile: Array<"FRA_PTC" | "FRA_SIGNAL_TRAIN_CONTROL" | "TSA_RAIL_CYBER" | "DISPATCH_LOG" | "EVENT_RECORDER" | "LOCAL_OPERATING_RULE" | "HAZMAT_ROUTING">;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface RailEvidenceBundle {
  bundle_version: "aristotle.rail-evidence.v1";
  exported_at: string;
  rail: RailEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    rail_context_hash: string;
    execution_bundle_hash: string;
    rail_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: RailRuntimeSnapshot): Record<string, JsonValue> {
  return {
    railroad_id: snapshot.railroad_id,
    host_railroad_id: snapshot.host_railroad_id,
    ...(snapshot.tenant_railroad_id ? { tenant_railroad_id: snapshot.tenant_railroad_id } : {}),
    territory_id: snapshot.territory_id,
    boundary_id: snapshot.territory_id,
    subdivision: snapshot.subdivision,
    route_id: snapshot.route_id,
    track_id: snapshot.track_id,
    milepost_from: snapshot.milepost_from,
    milepost_to: snapshot.milepost_to,
    train_id: snapshot.train_id,
    train_symbol: snapshot.train_symbol,
    locomotive_id: snapshot.locomotive_id,
    train_type: snapshot.train_type,
    consist_hash: snapshot.consist_hash,
    ...(snapshot.hazmat_classes ? { hazmat_classes: snapshot.hazmat_classes } : {}),
    ...(snapshot.movement_authority_id ? { movement_authority_id: snapshot.movement_authority_id } : {}),
    ...(snapshot.dispatcher_id ? { dispatcher_id: snapshot.dispatcher_id } : {}),
    ...(snapshot.crew_id ? { crew_id: snapshot.crew_id } : {}),
    crew_acknowledged: snapshot.crew_acknowledged,
    ptc_active: snapshot.ptc_active,
    ptc_mode: snapshot.ptc_mode,
    ptc_telemetry_age_ms: snapshot.ptc_telemetry_age_ms,
    signal_aspect: snapshot.signal_aspect,
    ...(snapshot.switch_id ? { switch_id: snapshot.switch_id } : {}),
    switch_position: snapshot.switch_position,
    switch_position_proven: snapshot.switch_position_proven,
    grade_crossing_protected: snapshot.grade_crossing_protected,
    ...(snapshot.work_zone_id ? { work_zone_id: snapshot.work_zone_id } : {}),
    work_zone_released: snapshot.work_zone_released,
    track_bulletin_ack: snapshot.track_bulletin_ack,
    brake_test_current: snapshot.brake_test_current,
    manual_fallback_ready: snapshot.manual_fallback_ready,
    conflicting_authority_present: snapshot.conflicting_authority_present,
    speed_mph: snapshot.speed_mph,
    authority_speed_mph: snapshot.authority_speed_mph,
    train_separation_m: snapshot.train_separation_m,
    ...(snapshot.train_length_ft !== undefined ? { train_length_ft: snapshot.train_length_ft } : {}),
    ...(snapshot.train_tonnage !== undefined ? { train_tonnage: snapshot.train_tonnage } : {}),
    route_class: snapshot.route_class,
    track_class: snapshot.track_class,
    operating_state: snapshot.operating_state,
    ...(snapshot.event_recorder_ref ? { event_recorder_ref: snapshot.event_recorder_ref } : {})
  };
}

function railAction(
  ctx: RailActionContext,
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

export function dispatchMovementAuthorityToAction(input: DispatchMovementAuthorityRequest, ctx: RailActionContext): CanonicalActionInput {
  return railAction(ctx, input.action_type ?? "rail.movement.authority.issue", `${input.train_id}:${input.track_id}:${input.from_milepost}-${input.to_milepost}`, {
    adapter: "dispatch-cad",
    authority_id: input.authority_id,
    movement_authority_id: input.authority_id,
    train_id: input.train_id,
    from_milepost: input.from_milepost,
    to_milepost: input.to_milepost,
    max_speed_mph: input.max_speed_mph,
    authority_speed_mph: input.max_speed_mph,
    track_id: input.track_id
  });
}

export function ptcRestrictionToAction(input: PtcRestrictionRequest, ctx: RailActionContext): CanonicalActionInput {
  return railAction(ctx, input.action_type ?? "ptc.restriction.update", `${input.restriction_id}:${input.from_milepost}-${input.to_milepost}`, {
    adapter: "ptc-back-office",
    restriction_id: input.restriction_id,
    operation: input.operation,
    from_milepost: input.from_milepost,
    to_milepost: input.to_milepost,
    max_speed_mph: input.max_speed_mph,
    authority_speed_mph: input.max_speed_mph
  });
}

export function waysideSignalToAction(input: WaysideSignalRequest, ctx: RailActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.requested_aspect === "clear" ? "signal.route.clear" : "signal.aspect.request");
  return railAction(ctx, actionType, `${input.signal_id}:${input.route_id}:${input.requested_aspect}`, {
    adapter: "wayside-signal",
    signal_id: input.signal_id,
    requested_aspect: input.requested_aspect,
    signal_aspect: input.requested_aspect,
    route_id: input.route_id
  });
}

export function switchMachineToAction(input: SwitchMachineRequest, ctx: RailActionContext): CanonicalActionInput {
  return railAction(ctx, input.action_type ?? "switch.align.request", `${input.switch_id}:${input.requested_position}`, {
    adapter: "switch-machine",
    switch_id: input.switch_id,
    requested_position: input.requested_position,
    switch_position: input.requested_position,
    ...(input.locked !== undefined ? { locked: input.locked } : {})
  });
}

export function gradeCrossingToAction(input: GradeCrossingRequest, ctx: RailActionContext): CanonicalActionInput {
  return railAction(ctx, input.action_type ?? `crossing.${slug(input.operation)}.request`, `${input.crossing_id}:${input.operation}`, {
    adapter: "grade-crossing",
    crossing_id: input.crossing_id,
    operation: input.operation
  });
}

export function locomotiveCommandToAction(input: LocomotiveCommandRequest, ctx: RailActionContext): CanonicalActionInput {
  return railAction(ctx, input.action_type ?? "locomotive.command.request", `${input.locomotive_id}:${input.command}`, {
    adapter: "locomotive-telemetry",
    locomotive_id: input.locomotive_id,
    command: input.command,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function crewBulletinToAction(input: CrewBulletinRequest, ctx: RailActionContext): CanonicalActionInput {
  return railAction(ctx, input.action_type ?? "crew.bulletin.ack", `${input.crew_id}:${input.bulletin_id}:${input.operation}`, {
    adapter: "crew-management",
    bulletin_id: input.bulletin_id,
    crew_id: input.crew_id,
    operation: input.operation
  });
}

export function consistHazmatToAction(input: ConsistHazmatRequest, ctx: RailActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "authorize-hazmat" ? "hazmat.routing.authorize" : "consist.route.validate");
  return railAction(ctx, actionType, `${input.consist_hash}:${input.route_id}:${input.operation}`, {
    adapter: "consist-hazmat",
    consist_hash: input.consist_hash,
    route_id: input.route_id,
    operation: input.operation,
    ...(input.hazmat_classes ? { hazmat_classes: input.hazmat_classes } : {})
  });
}

export function maintenanceOfWayToAction(input: MaintenanceOfWayRequest, ctx: RailActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "speed-restriction-update" ? "track.speed-restriction.update" : `mow.work-zone.${slug(input.operation)}`);
  return railAction(ctx, actionType, `${input.work_zone_id}:${input.operation}`, {
    adapter: "maintenance-of-way",
    work_zone_id: input.work_zone_id,
    operation: input.operation
  });
}

export function yardAutomationToAction(input: YardAutomationRequest, ctx: RailActionContext): CanonicalActionInput {
  return railAction(ctx, input.action_type ?? `yard.${slug(input.operation)}`, `${input.yard_id}:${input.track_id}:${input.operation}`, {
    adapter: "yard-automation",
    yard_id: input.yard_id,
    track_id: input.track_id,
    operation: input.operation
  });
}

export function railAdapterToAction(input: RailAdapterRequest, ctx: RailActionContext): CanonicalActionInput {
  if (input.kind === "dispatch-cad") return dispatchMovementAuthorityToAction(input.request, ctx);
  if (input.kind === "ptc-back-office") return ptcRestrictionToAction(input.request, ctx);
  if (input.kind === "wayside-signal") return waysideSignalToAction(input.request, ctx);
  if (input.kind === "switch-machine") return switchMachineToAction(input.request, ctx);
  if (input.kind === "grade-crossing") return gradeCrossingToAction(input.request, ctx);
  if (input.kind === "locomotive-telemetry") return locomotiveCommandToAction(input.request, ctx);
  if (input.kind === "crew-management") return crewBulletinToAction(input.request, ctx);
  if (input.kind === "consist-hazmat") return consistHazmatToAction(input.request, ctx);
  if (input.kind === "maintenance-of-way") return maintenanceOfWayToAction(input.request, ctx);
  return yardAutomationToAction(input.request, ctx);
}

export function railSnapshotToRuntimeRegister(snapshot: RailRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateRailSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function railBundleHash(input: Omit<RailEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<RailEvidenceBundle["hashes"], "rail_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportRailEvidenceBundle(input: ExportEvidenceBundleInput & { rail: RailEvidenceContext }): RailEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.rail-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    rail: JSON.parse(stableStringify(input.rail)) as RailEvidenceContext,
    execution_bundle
  };
  const hashes = {
    rail_context_hash: sha256(stableStringify(partial.rail)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    rail_bundle_hash: ""
  };
  hashes.rail_bundle_hash = railBundleHash({
    ...partial,
    hashes: {
      rail_context_hash: hashes.rail_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: RailEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyRailEvidenceBundle(draft) };
}

export function verifyRailEvidenceBundle(bundle: RailEvidenceBundle): RailEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.rail-evidence.v1") failures.push("unsupported rail evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.rail));
  if (contextHash !== bundle.hashes.rail_context_hash) failures.push("rail context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = railBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    rail: bundle.rail,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      rail_context_hash: bundle.hashes.rail_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.rail_bundle_hash) failures.push("rail bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
