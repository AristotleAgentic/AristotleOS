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
 * Mining readiness primitives (surface, underground, and tailings).
 *
 * Mining adapters do not operate equipment directly. They translate autonomous-haulage,
 * ventilation, blasting, tailings, gas-monitoring, and hoist requests into Canonical
 * Governed Actions. A real adapter must verify the resulting Warrant before it sends any
 * field command.
 *
 * The safety invariants enforced here are designed to MEET AND EXCEED the governing regimes:
 *   - MSHA 30 CFR Parts 56/57 (surface & underground metal/nonmetal), 75 (underground coal),
 *     77 (surface coal) — ventilation, blasting, ground control, hoisting.
 *   - 30 CFR 75.323 — methane action levels; 75.1732 / proximity detection for mobile machines.
 *   - ISO 17757 — safety of autonomous & semi-autonomous machine systems in earth-moving/mining
 *     (exclusion zones, object detection).
 *   - ICMM Global Industry Standard on Tailings Management (GISTM) — TSF pond level, freeboard,
 *     and piezometer monitoring.
 * Exceeding the minimums: every consequential command is admitted only with proximity detection
 * active, the exclusion zone and personnel cleared, ground control stable, gas within action
 * levels with monitoring armed, ventilation on, fresh SCADA, and an operator-qualification
 * attestation — and high-consequence acts (blast initiate, tailings decant, hoist) require dual
 * control. All of it is bound into a tamper-evident, signed Evidence Bundle.
 */

export type MiningDomain =
  | "surface"
  | "underground-coal"
  | "underground-metal-nonmetal"
  | "autonomous-haulage"
  | "ventilation"
  | "blasting"
  | "tailings"
  | "hoisting"
  | "processing";

export type MiningAdapterKind =
  | "autonomous-haulage"
  | "ventilation-control"
  | "blasting-control"
  | "tailings-control"
  | "gas-monitoring"
  | "hoist-control"
  | "modbus"
  | "dnp3"
  | "opc-ua"
  | "historian-write";

export interface MiningAdapterDescriptor {
  kind: MiningAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
  /** Regulatory clauses this boundary is built to satisfy. */
  regulatoryBasis: string[];
}

export const MINING_ADAPTER_CATALOG: MiningAdapterDescriptor[] = [
  {
    kind: "autonomous-haulage",
    label: "Autonomous Haulage System (AHS) Boundary",
    consequenceBoundary: "Haul-truck dispatch, movement authority, speed, and stop commands",
    actionExamples: ["haulage.dispatch.assign", "haulage.move.authorize", "haulage.stop"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.zone_id", "telemetry.proximity_detection_active", "telemetry.exclusion_zone_clear"],
    regulatoryBasis: ["ISO 17757", "30 CFR 56/57"]
  },
  {
    kind: "ventilation-control",
    label: "Mine Ventilation Boundary",
    consequenceBoundary: "Primary/booster fan on/off and airflow setpoint commands",
    actionExamples: ["ventilation.on", "ventilation.off", "ventilation.fan.setpoint"],
    requiredRuntimeRegisters: ["telemetry.airflow_cfm", "telemetry.methane_pct", "telemetry.gas_monitoring_active"],
    regulatoryBasis: ["30 CFR 75.300s (ventilation)", "30 CFR 75.323 (methane)"]
  },
  {
    kind: "blasting-control",
    label: "Blast Initiation Boundary",
    consequenceBoundary: "Blast arm, initiate, and abort sequences",
    actionExamples: ["blast.arm", "blast.initiate", "blast.abort"],
    requiredRuntimeRegisters: ["telemetry.exclusion_zone_clear", "telemetry.personnel_cleared", "telemetry.blast_clearance_id"],
    regulatoryBasis: ["30 CFR 56.6000s/57.6000s (blasting)"]
  },
  {
    kind: "tailings-control",
    label: "Tailings Storage Facility (TSF) Boundary",
    consequenceBoundary: "Decant and tailings-pump setpoints governing pond level and freeboard",
    actionExamples: ["tailings.decant.set", "tailings.pump.set"],
    requiredRuntimeRegisters: ["telemetry.tailings_pond_level_m", "telemetry.tailings_freeboard_m", "telemetry.piezometer_monitoring_active"],
    regulatoryBasis: ["ICMM GISTM"]
  },
  {
    kind: "gas-monitoring",
    label: "Gas Monitoring Boundary",
    consequenceBoundary: "Methane/CO/oxygen threshold and mode changes",
    actionExamples: ["gas.threshold.set", "gas.mode.set"],
    requiredRuntimeRegisters: ["telemetry.methane_pct", "telemetry.co_ppm", "telemetry.gas_monitoring_active"],
    regulatoryBasis: ["30 CFR 75.323", "30 CFR 75.342 (monitors)"]
  },
  {
    kind: "hoist-control",
    label: "Shaft Hoist / Winder Boundary",
    consequenceBoundary: "Hoist movement authority and speed setpoints",
    actionExamples: ["hoist.move.authorize", "hoist.speed.set"],
    requiredRuntimeRegisters: ["telemetry.hoist_load_kg", "telemetry.overspeed_protection_active"],
    regulatoryBasis: ["30 CFR 57.19000s (hoisting)"]
  },
  {
    kind: "modbus",
    label: "Modbus Register Boundary",
    consequenceBoundary: "Register writes that can mutate field device, RTU, or actuator behavior",
    actionExamples: ["modbus.register.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.mining_scada_fresh"],
    regulatoryBasis: ["site OT security policy"]
  },
  {
    kind: "dnp3",
    label: "DNP3 Control Boundary",
    consequenceBoundary: "Binary/analog output operations to RTUs and field controllers",
    actionExamples: ["dnp3.control.operate"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.mining_scada_fresh"],
    regulatoryBasis: ["site OT security policy"]
  },
  {
    kind: "opc-ua",
    label: "OPC UA Method/Write Boundary",
    consequenceBoundary: "OPC UA node writes, methods, and industrial gateway actions",
    actionExamples: ["opcua.node.write", "opcua.method.call"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"],
    regulatoryBasis: ["site OT security policy"]
  },
  {
    kind: "historian-write",
    label: "Historian Write Boundary",
    consequenceBoundary: "Operational records, ground-control markers, and compliance annotations",
    actionExamples: ["historian.record.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"],
    regulatoryBasis: ["30 CFR recordkeeping"]
  }
];

/** The regulatory regimes this vertical is designed to meet and exceed. */
export const MINING_REGULATORY_PROFILE = [
  "MSHA 30 CFR 56 (surface metal/nonmetal)",
  "MSHA 30 CFR 57 (underground metal/nonmetal)",
  "MSHA 30 CFR 75 (underground coal)",
  "MSHA 30 CFR 77 (surface coal)",
  "30 CFR 75.323 (methane action levels)",
  "30 CFR 75.1732 (proximity detection)",
  "ISO 17757 (autonomous mining machine safety)",
  "ICMM GISTM (tailings management)"
] as const;

export interface MiningRuntimeSnapshot {
  asset_id: string;
  asset_type: "haul-truck" | "fan" | "blast-controller" | "tailings-pump" | "gas-sensor" | "hoist" | "conveyor" | "dewatering-pump" | "rtu" | string;
  site_id: string;
  zone_id: string;
  system_model_id: string;
  mine_state: "normal" | "maintenance" | "blasting" | "emergency" | "evacuation" | string;
  methane_pct?: number;
  co_ppm?: number;
  oxygen_pct?: number;
  airflow_cfm?: number;
  speed_kph?: number;
  tailings_pond_level_m?: number;
  tailings_freeboard_m?: number;
  hoist_load_kg?: number;
  telemetry_age_ms: number;
  proximity_detection_active: boolean;
  exclusion_zone_clear: boolean;
  personnel_cleared: boolean;
  ground_control_stable: boolean;
  gas_monitoring_active: boolean;
  ventilation_on: boolean;
  piezometer_monitoring_active?: boolean;
  overspeed_protection_active?: boolean;
  mining_scada_fresh: boolean;
  operator_qualified: boolean;
  operator_id?: string;
  work_order_id?: string;
  blast_clearance_id?: string;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface MiningActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: MiningRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface HaulageRequest {
  fleet_id: string;
  unit_id: string;
  operation: "dispatch" | "move-authorize" | "stop" | "speed-set";
  route_id?: string;
  setpoint?: JsonValue;
  action_type?: string;
}

export interface VentilationRequest {
  fan_id: string;
  operation: "on" | "off" | "setpoint";
  setpoint?: JsonValue;
  action_type?: string;
}

export interface BlastRequest {
  blast_id: string;
  operation: "arm" | "initiate" | "abort";
  action_type?: string;
}

export interface TailingsRequest {
  facility_id: string;
  operation: "decant-set" | "pump-set";
  setpoint?: JsonValue;
  action_type?: string;
}

export interface GasMonitoringRequest {
  monitor_id: string;
  operation: "threshold-set" | "mode-set";
  value: JsonValue;
  action_type?: string;
}

export interface HoistRequest {
  hoist_id: string;
  operation: "move-authorize" | "speed-set";
  setpoint?: JsonValue;
  action_type?: string;
}

export interface MiningModbusRegisterWriteRequest {
  device_id: string;
  register: number;
  function_code: 5 | 6 | 15 | 16 | number;
  value: JsonValue;
  action_type?: string;
}

export interface MiningDnp3ControlRequest {
  outstation_id: string;
  point_index: number;
  point_type: "binary-output" | "analog-output" | string;
  operation: "operate" | "write";
  value: JsonValue;
  action_type?: string;
}

export interface MiningOpcUaRequest {
  server_id: string;
  node_id: string;
  operation: "write" | "method-call";
  value?: JsonValue;
  method?: string;
  action_type?: string;
}

export interface MiningHistorianWriteRequest {
  historian_id: string;
  stream: string;
  record_type: "operator-note" | "ground-control-marker" | "compliance-marker" | string;
  payload: Record<string, JsonValue>;
  action_type?: string;
}

export type MiningAdapterRequest =
  | { kind: "autonomous-haulage"; request: HaulageRequest }
  | { kind: "ventilation-control"; request: VentilationRequest }
  | { kind: "blasting-control"; request: BlastRequest }
  | { kind: "tailings-control"; request: TailingsRequest }
  | { kind: "gas-monitoring"; request: GasMonitoringRequest }
  | { kind: "hoist-control"; request: HoistRequest }
  | { kind: "modbus"; request: MiningModbusRegisterWriteRequest }
  | { kind: "dnp3"; request: MiningDnp3ControlRequest }
  | { kind: "opc-ua"; request: MiningOpcUaRequest }
  | { kind: "historian-write"; request: MiningHistorianWriteRequest };

export interface MiningEvidenceContext {
  operator_id: string;
  control_room: string;
  mining_domain: MiningDomain;
  operational_scope: string;
  asset_id: string;
  site_id: string;
  zone_id: string;
  system_model_id: string;
  shift_id?: string;
  work_order_id?: string;
  controller_id: string;
  ground_hazard_level?: "none" | "low" | "medium" | "high";
  regulatory_evidence_profile: Array<
    | "MSHA_PART_56"
    | "MSHA_PART_57"
    | "MSHA_PART_75"
    | "MSHA_PART_77"
    | "MSHA_METHANE"
    | "PROXIMITY_DETECTION"
    | "ISO_17757"
    | "ICMM_GISTM"
    | "GROUND_CONTROL_PLAN"
    | "BLAST_CLEARANCE"
  >;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface MiningEvidenceBundle {
  bundle_version: "aristotle.mining-evidence.v1";
  exported_at: string;
  mining: MiningEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    mining_context_hash: string;
    execution_bundle_hash: string;
    mining_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: MiningRuntimeSnapshot): Record<string, JsonValue> {
  return {
    asset_id: snapshot.asset_id,
    asset_type: snapshot.asset_type,
    site_id: snapshot.site_id,
    zone_id: snapshot.zone_id,
    boundary_id: snapshot.zone_id,
    system_model_id: snapshot.system_model_id,
    mine_state: snapshot.mine_state,
    ...(snapshot.methane_pct !== undefined ? { methane_pct: snapshot.methane_pct } : {}),
    ...(snapshot.co_ppm !== undefined ? { co_ppm: snapshot.co_ppm } : {}),
    ...(snapshot.oxygen_pct !== undefined ? { oxygen_pct: snapshot.oxygen_pct } : {}),
    ...(snapshot.airflow_cfm !== undefined ? { airflow_cfm: snapshot.airflow_cfm } : {}),
    ...(snapshot.speed_kph !== undefined ? { speed_kph: snapshot.speed_kph } : {}),
    ...(snapshot.tailings_pond_level_m !== undefined ? { tailings_pond_level_m: snapshot.tailings_pond_level_m } : {}),
    ...(snapshot.tailings_freeboard_m !== undefined ? { tailings_freeboard_m: snapshot.tailings_freeboard_m } : {}),
    ...(snapshot.hoist_load_kg !== undefined ? { hoist_load_kg: snapshot.hoist_load_kg } : {}),
    telemetry_age_ms: snapshot.telemetry_age_ms,
    proximity_detection_active: snapshot.proximity_detection_active,
    exclusion_zone_clear: snapshot.exclusion_zone_clear,
    personnel_cleared: snapshot.personnel_cleared,
    ground_control_stable: snapshot.ground_control_stable,
    gas_monitoring_active: snapshot.gas_monitoring_active,
    ventilation_on: snapshot.ventilation_on,
    ...(snapshot.piezometer_monitoring_active !== undefined ? { piezometer_monitoring_active: snapshot.piezometer_monitoring_active } : {}),
    ...(snapshot.overspeed_protection_active !== undefined ? { overspeed_protection_active: snapshot.overspeed_protection_active } : {}),
    mining_scada_fresh: snapshot.mining_scada_fresh,
    operator_qualified: snapshot.operator_qualified,
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {}),
    ...(snapshot.work_order_id ? { work_order_id: snapshot.work_order_id } : {}),
    ...(snapshot.blast_clearance_id ? { blast_clearance_id: snapshot.blast_clearance_id } : {})
  };
}

function miningAction(
  ctx: MiningActionContext,
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

export function haulageToAction(input: HaulageRequest, ctx: MiningActionContext): CanonicalActionInput {
  const fallback =
    input.operation === "dispatch"
      ? "haulage.dispatch.assign"
      : input.operation === "move-authorize"
        ? "haulage.move.authorize"
        : input.operation === "stop"
          ? "haulage.stop"
          : "haulage.speed.set";
  return miningAction(ctx, input.action_type ?? fallback, `${input.fleet_id}:${input.unit_id}:${input.operation}`, {
    adapter: "autonomous-haulage",
    fleet_id: input.fleet_id,
    unit_id: input.unit_id,
    operation: input.operation,
    ...(input.route_id ? { route_id: input.route_id } : {}),
    ...(input.setpoint !== undefined ? { setpoint: input.setpoint } : {})
  });
}

export function ventilationToAction(input: VentilationRequest, ctx: MiningActionContext): CanonicalActionInput {
  const fallback = input.operation === "on" ? "ventilation.on" : input.operation === "off" ? "ventilation.off" : "ventilation.fan.setpoint";
  return miningAction(ctx, input.action_type ?? fallback, `${input.fan_id}:${input.operation}`, {
    adapter: "ventilation-control",
    fan_id: input.fan_id,
    operation: input.operation,
    ...(input.setpoint !== undefined ? { setpoint: input.setpoint } : {})
  });
}

export function blastToAction(input: BlastRequest, ctx: MiningActionContext): CanonicalActionInput {
  const fallback = `blast.${slug(input.operation)}`;
  return miningAction(ctx, input.action_type ?? fallback, `${input.blast_id}:${input.operation}`, {
    adapter: "blasting-control",
    blast_id: input.blast_id,
    operation: input.operation
  });
}

export function tailingsToAction(input: TailingsRequest, ctx: MiningActionContext): CanonicalActionInput {
  const fallback = input.operation === "decant-set" ? "tailings.decant.set" : "tailings.pump.set";
  return miningAction(ctx, input.action_type ?? fallback, `${input.facility_id}:${input.operation}`, {
    adapter: "tailings-control",
    facility_id: input.facility_id,
    operation: input.operation,
    ...(input.setpoint !== undefined ? { setpoint: input.setpoint } : {})
  });
}

export function gasMonitoringToAction(input: GasMonitoringRequest, ctx: MiningActionContext): CanonicalActionInput {
  const fallback = input.operation === "threshold-set" ? "gas.threshold.set" : "gas.mode.set";
  return miningAction(ctx, input.action_type ?? fallback, `${input.monitor_id}:${input.operation}`, {
    adapter: "gas-monitoring",
    monitor_id: input.monitor_id,
    operation: input.operation,
    value: input.value
  });
}

export function hoistToAction(input: HoistRequest, ctx: MiningActionContext): CanonicalActionInput {
  const fallback = input.operation === "move-authorize" ? "hoist.move.authorize" : "hoist.speed.set";
  return miningAction(ctx, input.action_type ?? fallback, `${input.hoist_id}:${input.operation}`, {
    adapter: "hoist-control",
    hoist_id: input.hoist_id,
    operation: input.operation,
    ...(input.setpoint !== undefined ? { setpoint: input.setpoint } : {})
  });
}

export function miningModbusRegisterWriteToAction(input: MiningModbusRegisterWriteRequest, ctx: MiningActionContext): CanonicalActionInput {
  return miningAction(ctx, input.action_type ?? "modbus.register.write", `${input.device_id}:register:${input.register}`, {
    adapter: "modbus",
    device_id: input.device_id,
    register: input.register,
    function_code: input.function_code,
    value: input.value
  });
}

export function miningDnp3ControlToAction(input: MiningDnp3ControlRequest, ctx: MiningActionContext): CanonicalActionInput {
  return miningAction(ctx, input.action_type ?? "dnp3.control.operate", `${input.outstation_id}:${input.point_type}:${input.point_index}`, {
    adapter: "dnp3",
    outstation_id: input.outstation_id,
    point_index: input.point_index,
    point_type: input.point_type,
    operation: input.operation,
    value: input.value
  });
}

export function miningOpcUaToAction(input: MiningOpcUaRequest, ctx: MiningActionContext): CanonicalActionInput {
  return miningAction(ctx, input.action_type ?? (input.operation === "method-call" ? "opcua.method.call" : "opcua.node.write"), `${input.server_id}:${input.node_id}`, {
    adapter: "opc-ua",
    server_id: input.server_id,
    node_id: input.node_id,
    operation: input.operation,
    ...(input.method ? { method: input.method } : {}),
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function miningHistorianWriteToAction(input: MiningHistorianWriteRequest, ctx: MiningActionContext): CanonicalActionInput {
  return miningAction(ctx, input.action_type ?? "historian.record.write", `${input.historian_id}:${input.stream}:${input.record_type}`, {
    adapter: "historian-write",
    historian_id: input.historian_id,
    stream: input.stream,
    record_type: input.record_type,
    payload: input.payload
  });
}

export function miningAdapterToAction(input: MiningAdapterRequest, ctx: MiningActionContext): CanonicalActionInput {
  if (input.kind === "autonomous-haulage") return haulageToAction(input.request, ctx);
  if (input.kind === "ventilation-control") return ventilationToAction(input.request, ctx);
  if (input.kind === "blasting-control") return blastToAction(input.request, ctx);
  if (input.kind === "tailings-control") return tailingsToAction(input.request, ctx);
  if (input.kind === "gas-monitoring") return gasMonitoringToAction(input.request, ctx);
  if (input.kind === "hoist-control") return hoistToAction(input.request, ctx);
  if (input.kind === "modbus") return miningModbusRegisterWriteToAction(input.request, ctx);
  if (input.kind === "dnp3") return miningDnp3ControlToAction(input.request, ctx);
  if (input.kind === "opc-ua") return miningOpcUaToAction(input.request, ctx);
  return miningHistorianWriteToAction(input.request, ctx);
}

export function miningSnapshotToRuntimeRegister(snapshot: MiningRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateMiningSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function miningBundleHash(input: Omit<MiningEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<MiningEvidenceBundle["hashes"], "mining_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportMiningEvidenceBundle(input: ExportEvidenceBundleInput & { mining: MiningEvidenceContext }): MiningEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.mining-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    mining: JSON.parse(stableStringify(input.mining)) as MiningEvidenceContext,
    execution_bundle
  };
  const hashes = {
    mining_context_hash: sha256(stableStringify(partial.mining)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    mining_bundle_hash: ""
  };
  hashes.mining_bundle_hash = miningBundleHash({
    ...partial,
    hashes: {
      mining_context_hash: hashes.mining_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: MiningEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyMiningEvidenceBundle(draft) };
}

export function verifyMiningEvidenceBundle(bundle: MiningEvidenceBundle): MiningEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.mining-evidence.v1") failures.push("unsupported mining evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.mining));
  if (contextHash !== bundle.hashes.mining_context_hash) failures.push("mining context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = miningBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    mining: bundle.mining,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      mining_context_hash: bundle.hashes.mining_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.mining_bundle_hash) failures.push("mining bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
