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
 * Robotics readiness primitives (industrial arms, collaborative cobots, AMRs, and
 * humanoids).
 *
 * Robotics adapters do not drive actuators directly. They translate motion, manipulation,
 * mobile-base, humanoid-locomotion, teleoperation, human-robot-interaction, safety-config,
 * and fleet requests into Canonical Governed Actions. A real adapter must verify the
 * resulting Warrant before commanding any joint, gripper, base, or limb.
 *
 * The safety invariants enforced here are designed to MEET AND EXCEED the governing regimes:
 *   - ISO 10218-1/-2 and ANSI/RIA R15.06 (industrial robot safety).
 *   - ISO/TS 15066 (collaborative robots): power-and-force limiting (PFL) to biomechanical
 *     limits and speed-and-separation monitoring (SSM).
 *   - ANSI/RIA R15.08 and ISO 3691-4 (industrial mobile robots / AMRs).
 *   - ISO 13482 (personal-care / service robots — applicable to humanoids around people).
 *   - ISO 13849 / IEC 61508 functional safety (PLd/PLe, e-stop and protective stop).
 * Exceeding the minimums: every command is admitted only with the e-stop functional, the
 * protective stop armed, SSM and PFL active, collision detection and the safety scanner on,
 * within TCP-speed / force / torque / power / separation limits, in a permitted operating
 * mode (collaborative whenever a human is present), and — for humanoids — with the balance
 * controller active and fall protection armed within center-of-mass and step-height bounds.
 * High-consequence acts (force application, teleop takeover, humanoid locomotion near people)
 * require dual control. All of it is bound into a tamper-evident, signed Evidence Bundle.
 */

export type RoboticsDomain =
  | "industrial-arm"
  | "collaborative-cobot"
  | "amr-mobile"
  | "humanoid"
  | "service-robot"
  | "warehouse-automation"
  | "inspection"
  | "teleoperated";

export type RoboticsAdapterKind =
  | "motion-control"
  | "manipulation"
  | "mobile-base"
  | "humanoid-locomotion"
  | "teleoperation"
  | "human-robot-interaction"
  | "safety-config"
  | "fleet"
  | "historian-write";

export interface RoboticsAdapterDescriptor {
  kind: RoboticsAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
  /** Regulatory clauses this boundary is built to satisfy. */
  regulatoryBasis: string[];
}

export const ROBOTICS_ADAPTER_CATALOG: RoboticsAdapterDescriptor[] = [
  {
    kind: "motion-control",
    label: "Motion / Trajectory Boundary",
    consequenceBoundary: "Joint and Cartesian moves, trajectory execution, and speed setpoints",
    actionExamples: ["motion.move", "motion.trajectory.execute", "motion.speed.set"],
    requiredRuntimeRegisters: ["telemetry.tcp_speed_mm_s", "telemetry.ssm_active", "telemetry.estop_functional"],
    regulatoryBasis: ["ISO 10218-1", "ISO 13849 (PLd/PLe)"]
  },
  {
    kind: "manipulation",
    label: "Manipulation / End-Effector Boundary",
    consequenceBoundary: "Grasp, release, and force/torque application at the end effector",
    actionExamples: ["manipulation.grasp", "manipulation.release", "manipulation.force.apply"],
    requiredRuntimeRegisters: ["telemetry.force_n", "telemetry.torque_nm", "telemetry.pfl_active"],
    regulatoryBasis: ["ISO/TS 15066 (PFL biomechanical limits)"]
  },
  {
    kind: "mobile-base",
    label: "Mobile Base / AMR Boundary",
    consequenceBoundary: "Navigation goals, velocity commands, and docking",
    actionExamples: ["base.navigate", "base.velocity.set", "base.dock"],
    requiredRuntimeRegisters: ["telemetry.separation_distance_mm", "telemetry.safety_scanner_active"],
    regulatoryBasis: ["ANSI/RIA R15.08", "ISO 3691-4"]
  },
  {
    kind: "humanoid-locomotion",
    label: "Humanoid Whole-Body / Locomotion Boundary",
    consequenceBoundary: "Bipedal stepping, posture, and whole-body locomotion commands",
    actionExamples: ["humanoid.step.execute", "humanoid.posture.set", "humanoid.locomotion.start"],
    requiredRuntimeRegisters: ["telemetry.balance_controller_active", "telemetry.fall_protection_armed", "telemetry.com_deviation_mm"],
    regulatoryBasis: ["ISO 13482 (personal-care robots)", "ISO 13849"]
  },
  {
    kind: "teleoperation",
    label: "Teleoperation / Autonomy-Mode Boundary",
    consequenceBoundary: "Operator takeover, autonomy-mode switching, and remote command",
    actionExamples: ["teleop.mode.set", "teleop.takeover"],
    requiredRuntimeRegisters: ["telemetry.teleop_link_healthy", "telemetry.operator_qualified"],
    regulatoryBasis: ["ISO 10218-2 (mode selection)"]
  },
  {
    kind: "human-robot-interaction",
    label: "Human-Robot Interaction Boundary",
    consequenceBoundary: "Handover, collaborative-task start, and shared-workspace operations",
    actionExamples: ["hri.handover", "hri.collaborative.start"],
    requiredRuntimeRegisters: ["telemetry.human_present", "telemetry.pfl_active", "telemetry.ssm_active"],
    regulatoryBasis: ["ISO/TS 15066 (collaborative operation)"]
  },
  {
    kind: "safety-config",
    label: "Safety Configuration Boundary",
    consequenceBoundary: "Safety-zone configuration and safety-rated monitored-stop setup",
    actionExamples: ["safety.zone.configure", "safety.monitored_stop.set"],
    requiredRuntimeRegisters: ["telemetry.estop_functional", "telemetry.protective_stop_armed"],
    regulatoryBasis: ["ISO 13849", "ISO 10218-1"]
  },
  {
    kind: "fleet",
    label: "Fleet Orchestration Boundary",
    consequenceBoundary: "Task assignment and dispatch across a robot fleet",
    actionExamples: ["fleet.task.assign", "fleet.dispatch"],
    requiredRuntimeRegisters: ["telemetry.operator_id", "telemetry.operator_qualified"],
    regulatoryBasis: ["ANSI/RIA R15.08 (fleet)"]
  },
  {
    kind: "historian-write",
    label: "Historian Write Boundary",
    consequenceBoundary: "Operational records, incident markers, and compliance annotations",
    actionExamples: ["historian.record.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"],
    regulatoryBasis: ["ISO 10218 recordkeeping"]
  }
];

/** The regulatory regimes this vertical is designed to meet and exceed. */
export const ROBOTICS_REGULATORY_PROFILE = [
  "ISO 10218-1/-2 (industrial robot safety)",
  "ISO/TS 15066 (collaborative robots: PFL + SSM)",
  "ANSI/RIA R15.06 / R15.08",
  "ISO 3691-4 (AMRs)",
  "ISO 13482 (personal-care / service robots)",
  "ISO 13849 / IEC 61508 (functional safety)"
] as const;

export interface RoboticsRuntimeSnapshot {
  asset_id: string;
  asset_type: "industrial-arm" | "cobot" | "amr" | "humanoid" | "gripper" | "fleet-controller" | string;
  workcell_id: string;
  robot_zone: string;
  system_model_id: string;
  operating_mode: "automatic" | "t1-reduced-speed" | "t2-high-speed" | "collaborative" | string;
  robot_state: "idle" | "running" | "paused" | "protective-stop" | "estop" | "recovery" | string;
  tcp_speed_mm_s?: number;
  force_n?: number;
  torque_nm?: number;
  power_w?: number;
  separation_distance_mm?: number;
  com_deviation_mm?: number;
  step_height_mm?: number;
  payload_kg?: number;
  telemetry_age_ms: number;
  estop_functional: boolean;
  protective_stop_armed: boolean;
  ssm_active: boolean;
  pfl_active: boolean;
  collision_detection_active: boolean;
  safety_scanner_active: boolean;
  human_present: boolean;
  balance_controller_active?: boolean;
  fall_protection_armed?: boolean;
  teleop_link_healthy?: boolean;
  operator_qualified: boolean;
  operator_id?: string;
  task_id?: string;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface RoboticsActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: RoboticsRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface MotionRequest {
  robot_id: string;
  operation: "move" | "trajectory" | "speed-set";
  target?: JsonValue;
  action_type?: string;
}

export interface ManipulationRequest {
  robot_id: string;
  operation: "grasp" | "release" | "force-apply";
  value?: JsonValue;
  action_type?: string;
}

export interface MobileBaseRequest {
  base_id: string;
  operation: "navigate" | "velocity-set" | "dock";
  goal?: JsonValue;
  action_type?: string;
}

export interface HumanoidLocomotionRequest {
  humanoid_id: string;
  operation: "step" | "posture-set" | "locomotion-start" | "locomotion-stop";
  value?: JsonValue;
  action_type?: string;
}

export interface TeleopRequest {
  robot_id: string;
  operation: "mode-set" | "takeover" | "release";
  mode?: string;
  action_type?: string;
}

export interface HriRequest {
  robot_id: string;
  operation: "handover" | "collaborative-start" | "collaborative-stop";
  value?: JsonValue;
  action_type?: string;
}

export interface SafetyConfigRequest {
  robot_id: string;
  operation: "zone-configure" | "monitored-stop-set";
  value?: JsonValue;
  action_type?: string;
}

export interface RoboticsFleetRequest {
  fleet_id: string;
  operation: "task-assign" | "dispatch";
  task_id?: string;
  action_type?: string;
}

export interface RoboticsHistorianWriteRequest {
  historian_id: string;
  stream: string;
  record_type: "operator-note" | "incident-marker" | "compliance-marker" | string;
  payload: Record<string, JsonValue>;
  action_type?: string;
}

export type RoboticsAdapterRequest =
  | { kind: "motion-control"; request: MotionRequest }
  | { kind: "manipulation"; request: ManipulationRequest }
  | { kind: "mobile-base"; request: MobileBaseRequest }
  | { kind: "humanoid-locomotion"; request: HumanoidLocomotionRequest }
  | { kind: "teleoperation"; request: TeleopRequest }
  | { kind: "human-robot-interaction"; request: HriRequest }
  | { kind: "safety-config"; request: SafetyConfigRequest }
  | { kind: "fleet"; request: RoboticsFleetRequest }
  | { kind: "historian-write"; request: RoboticsHistorianWriteRequest };

export interface RoboticsEvidenceContext {
  operator_id: string;
  control_station: string;
  robotics_domain: RoboticsDomain;
  operational_scope: string;
  asset_id: string;
  workcell_id: string;
  robot_zone: string;
  system_model_id: string;
  task_id?: string;
  controller_id: string;
  collaboration_risk_class?: "none" | "low" | "medium" | "high";
  regulatory_evidence_profile: Array<
    | "ISO_10218"
    | "ISO_TS_15066"
    | "ANSI_RIA_R15_06"
    | "ANSI_RIA_R15_08"
    | "ISO_3691_4"
    | "ISO_13482"
    | "ISO_13849"
    | "IEC_61508"
    | "PFL"
    | "SSM"
  >;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface RoboticsEvidenceBundle {
  bundle_version: "aristotle.robotics-evidence.v1";
  exported_at: string;
  robotics: RoboticsEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    robotics_context_hash: string;
    execution_bundle_hash: string;
    robotics_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: RoboticsRuntimeSnapshot): Record<string, JsonValue> {
  return {
    asset_id: snapshot.asset_id,
    asset_type: snapshot.asset_type,
    workcell_id: snapshot.workcell_id,
    robot_zone: snapshot.robot_zone,
    boundary_id: snapshot.robot_zone,
    system_model_id: snapshot.system_model_id,
    operating_mode: snapshot.operating_mode,
    robot_state: snapshot.robot_state,
    ...(snapshot.tcp_speed_mm_s !== undefined ? { tcp_speed_mm_s: snapshot.tcp_speed_mm_s } : {}),
    ...(snapshot.force_n !== undefined ? { force_n: snapshot.force_n } : {}),
    ...(snapshot.torque_nm !== undefined ? { torque_nm: snapshot.torque_nm } : {}),
    ...(snapshot.power_w !== undefined ? { power_w: snapshot.power_w } : {}),
    ...(snapshot.separation_distance_mm !== undefined ? { separation_distance_mm: snapshot.separation_distance_mm } : {}),
    ...(snapshot.com_deviation_mm !== undefined ? { com_deviation_mm: snapshot.com_deviation_mm } : {}),
    ...(snapshot.step_height_mm !== undefined ? { step_height_mm: snapshot.step_height_mm } : {}),
    ...(snapshot.payload_kg !== undefined ? { payload_kg: snapshot.payload_kg } : {}),
    telemetry_age_ms: snapshot.telemetry_age_ms,
    estop_functional: snapshot.estop_functional,
    protective_stop_armed: snapshot.protective_stop_armed,
    ssm_active: snapshot.ssm_active,
    pfl_active: snapshot.pfl_active,
    collision_detection_active: snapshot.collision_detection_active,
    safety_scanner_active: snapshot.safety_scanner_active,
    human_present: snapshot.human_present,
    ...(snapshot.balance_controller_active !== undefined ? { balance_controller_active: snapshot.balance_controller_active } : {}),
    ...(snapshot.fall_protection_armed !== undefined ? { fall_protection_armed: snapshot.fall_protection_armed } : {}),
    ...(snapshot.teleop_link_healthy !== undefined ? { teleop_link_healthy: snapshot.teleop_link_healthy } : {}),
    operator_qualified: snapshot.operator_qualified,
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {}),
    ...(snapshot.task_id ? { task_id: snapshot.task_id } : {})
  };
}

function roboticsAction(
  ctx: RoboticsActionContext,
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

export function motionToAction(input: MotionRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  const fallback = input.operation === "trajectory" ? "motion.trajectory.execute" : input.operation === "speed-set" ? "motion.speed.set" : "motion.move";
  return roboticsAction(ctx, input.action_type ?? fallback, `${input.robot_id}:${input.operation}`, {
    adapter: "motion-control",
    robot_id: input.robot_id,
    operation: input.operation,
    ...(input.target !== undefined ? { target: input.target } : {})
  });
}

export function manipulationToAction(input: ManipulationRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  const fallback = input.operation === "force-apply" ? "manipulation.force.apply" : `manipulation.${slug(input.operation)}`;
  return roboticsAction(ctx, input.action_type ?? fallback, `${input.robot_id}:${input.operation}`, {
    adapter: "manipulation",
    robot_id: input.robot_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function mobileBaseToAction(input: MobileBaseRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  const fallback = input.operation === "velocity-set" ? "base.velocity.set" : `base.${slug(input.operation)}`;
  return roboticsAction(ctx, input.action_type ?? fallback, `${input.base_id}:${input.operation}`, {
    adapter: "mobile-base",
    base_id: input.base_id,
    operation: input.operation,
    ...(input.goal !== undefined ? { goal: input.goal } : {})
  });
}

export function humanoidLocomotionToAction(input: HumanoidLocomotionRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  const fallback =
    input.operation === "step"
      ? "humanoid.step.execute"
      : input.operation === "posture-set"
        ? "humanoid.posture.set"
        : input.operation === "locomotion-start"
          ? "humanoid.locomotion.start"
          : "humanoid.locomotion.stop";
  return roboticsAction(ctx, input.action_type ?? fallback, `${input.humanoid_id}:${input.operation}`, {
    adapter: "humanoid-locomotion",
    humanoid_id: input.humanoid_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function teleopToAction(input: TeleopRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  const fallback = input.operation === "mode-set" ? "teleop.mode.set" : `teleop.${slug(input.operation)}`;
  return roboticsAction(ctx, input.action_type ?? fallback, `${input.robot_id}:teleop:${input.operation}`, {
    adapter: "teleoperation",
    robot_id: input.robot_id,
    operation: input.operation,
    ...(input.mode ? { mode: input.mode } : {})
  });
}

export function hriToAction(input: HriRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  const fallback = input.operation === "handover" ? "hri.handover" : input.operation === "collaborative-start" ? "hri.collaborative.start" : "hri.collaborative.stop";
  return roboticsAction(ctx, input.action_type ?? fallback, `${input.robot_id}:hri:${input.operation}`, {
    adapter: "human-robot-interaction",
    robot_id: input.robot_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function safetyConfigToAction(input: SafetyConfigRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  const fallback = input.operation === "zone-configure" ? "safety.zone.configure" : "safety.monitored_stop.set";
  return roboticsAction(ctx, input.action_type ?? fallback, `${input.robot_id}:safety:${input.operation}`, {
    adapter: "safety-config",
    robot_id: input.robot_id,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function roboticsFleetToAction(input: RoboticsFleetRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  const fallback = input.operation === "task-assign" ? "fleet.task.assign" : "fleet.dispatch";
  return roboticsAction(ctx, input.action_type ?? fallback, `${input.fleet_id}:${input.operation}`, {
    adapter: "fleet",
    fleet_id: input.fleet_id,
    operation: input.operation,
    ...(input.task_id ? { task_id: input.task_id } : {})
  });
}

export function roboticsHistorianWriteToAction(input: RoboticsHistorianWriteRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  return roboticsAction(ctx, input.action_type ?? "historian.record.write", `${input.historian_id}:${input.stream}:${input.record_type}`, {
    adapter: "historian-write",
    historian_id: input.historian_id,
    stream: input.stream,
    record_type: input.record_type,
    payload: input.payload
  });
}

export function roboticsAdapterToAction(input: RoboticsAdapterRequest, ctx: RoboticsActionContext): CanonicalActionInput {
  if (input.kind === "motion-control") return motionToAction(input.request, ctx);
  if (input.kind === "manipulation") return manipulationToAction(input.request, ctx);
  if (input.kind === "mobile-base") return mobileBaseToAction(input.request, ctx);
  if (input.kind === "humanoid-locomotion") return humanoidLocomotionToAction(input.request, ctx);
  if (input.kind === "teleoperation") return teleopToAction(input.request, ctx);
  if (input.kind === "human-robot-interaction") return hriToAction(input.request, ctx);
  if (input.kind === "safety-config") return safetyConfigToAction(input.request, ctx);
  if (input.kind === "fleet") return roboticsFleetToAction(input.request, ctx);
  return roboticsHistorianWriteToAction(input.request, ctx);
}

export function roboticsSnapshotToRuntimeRegister(snapshot: RoboticsRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateRoboticsSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function roboticsBundleHash(input: Omit<RoboticsEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<RoboticsEvidenceBundle["hashes"], "robotics_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportRoboticsEvidenceBundle(input: ExportEvidenceBundleInput & { robotics: RoboticsEvidenceContext }): RoboticsEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.robotics-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    robotics: JSON.parse(stableStringify(input.robotics)) as RoboticsEvidenceContext,
    execution_bundle
  };
  const hashes = {
    robotics_context_hash: sha256(stableStringify(partial.robotics)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    robotics_bundle_hash: ""
  };
  hashes.robotics_bundle_hash = roboticsBundleHash({
    ...partial,
    hashes: {
      robotics_context_hash: hashes.robotics_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: RoboticsEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyRoboticsEvidenceBundle(draft) };
}

export function verifyRoboticsEvidenceBundle(bundle: RoboticsEvidenceBundle): RoboticsEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.robotics-evidence.v1") failures.push("unsupported robotics evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.robotics));
  if (contextHash !== bundle.hashes.robotics_context_hash) failures.push("robotics context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = roboticsBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    robotics: bundle.robotics,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      robotics_context_hash: bundle.hashes.robotics_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.robotics_bundle_hash) failures.push("robotics bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
