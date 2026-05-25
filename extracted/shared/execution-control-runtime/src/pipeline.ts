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
 * Oil & gas / energy pipeline readiness primitives.
 *
 * Pipeline adapters do not operate field equipment directly. They translate SCADA,
 * pump/compressor control, valve, pressure, and leak-detection requests into Canonical
 * Governed Actions. A real adapter must verify the resulting Warrant before it sends any
 * field command.
 *
 * The safety invariants enforced here are designed to MEET AND EXCEED the governing
 * regimes for hazardous-liquid and gas transmission/distribution pipelines:
 *   - 49 CFR Part 192 (gas) & Part 195 (hazardous liquid) — MAOP/MOP, overpressure
 *     protection, emergency shutdown, valve operation, integrity management.
 *   - 49 CFR 192.631 / 195.446 — Control Room Management (fresh SCADA, alarm integrity).
 *   - 49 CFR 192.801 / 195.501 — Operator Qualification.
 *   - API 1164 (pipeline SCADA security), API 1173 (Pipeline Safety Management System),
 *     API RP 1175 (leak detection program), API 1162 (public awareness).
 * Exceeding the minimums: every consequential command is admitted only with fresh SCADA,
 * armed leak detection (CPM), active overpressure protection, ESD readiness, an operator
 * qualification attestation, and a pressure margin BELOW MAOP — and high-consequence acts
 * require dual control. All of it is bound into a tamper-evident, signed Evidence Bundle.
 */

export type PipelineDomain =
  | "gas-transmission"
  | "gas-distribution"
  | "gas-gathering"
  | "hazardous-liquid-transmission"
  | "hazardous-liquid-gathering"
  | "compressor-station"
  | "pump-station"
  | "storage"
  | "integrity-management";

export type PipelineAdapterKind =
  | "scada-pump-control"
  | "scada-compressor"
  | "valve-control"
  | "pressure-control"
  | "leak-detection"
  | "pig-launcher"
  | "modbus"
  | "dnp3"
  | "opc-ua"
  | "historian-write";

export interface PipelineAdapterDescriptor {
  kind: PipelineAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
  /** Regulatory clauses this boundary is built to satisfy. */
  regulatoryBasis: string[];
}

export const PIPELINE_ADAPTER_CATALOG: PipelineAdapterDescriptor[] = [
  {
    kind: "scada-pump-control",
    label: "SCADA Pump-Station Control Boundary",
    consequenceBoundary: "Mainline pump start/stop, speed, and station throughput commands",
    actionExamples: ["scada.pump.start", "scada.pump.stop", "scada.pump.setpoint"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.pressure_psig", "telemetry.pump_primed", "telemetry.pipeline_scada_fresh"],
    regulatoryBasis: ["49 CFR 195.406 (MOP)", "49 CFR 195.446 (CRM)", "API 1173"]
  },
  {
    kind: "scada-compressor",
    label: "SCADA Compressor-Station Control Boundary",
    consequenceBoundary: "Compressor unit start/stop, recycle, and discharge-pressure commands",
    actionExamples: ["scada.compressor.start", "scada.compressor.stop", "scada.compressor.setpoint"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.pressure_psig", "telemetry.esd_ready", "telemetry.pipeline_scada_fresh"],
    regulatoryBasis: ["49 CFR 192.619 (MAOP)", "49 CFR 192.631 (CRM)", "API 1173"]
  },
  {
    kind: "valve-control",
    label: "Mainline / Block Valve Boundary",
    consequenceBoundary: "Block, check, control, and ESD valve open/close/isolate operations",
    actionExamples: ["valve.isolate.close", "valve.isolation.open", "valve.control.setpoint"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.segment_id", "telemetry.pressure_psig", "telemetry.segment_isolation_ready"],
    regulatoryBasis: ["49 CFR 192.179/192.745", "49 CFR 195.260/195.420", "API 1173"]
  },
  {
    kind: "pressure-control",
    label: "Pressure / Overpressure-Protection Boundary",
    consequenceBoundary: "Regulator, control-valve, and relief setpoint changes governing line pressure",
    actionExamples: ["pressure.setpoint.set", "pressure.relief.set"],
    requiredRuntimeRegisters: ["telemetry.pressure_psig", "telemetry.maop_psig", "telemetry.overpressure_protection_active"],
    regulatoryBasis: ["49 CFR 192.195/192.201", "49 CFR 195.406", "API 1173"]
  },
  {
    kind: "leak-detection",
    label: "Leak Detection (CPM) Boundary",
    consequenceBoundary: "Computational pipeline monitoring tuning, mode, and threshold changes",
    actionExamples: ["leak_detection.threshold.set", "leak_detection.mode.set"],
    requiredRuntimeRegisters: ["telemetry.leak_detection_armed", "telemetry.pipeline_scada_fresh"],
    regulatoryBasis: ["49 CFR 195.134/195.444", "API RP 1175"]
  },
  {
    kind: "pig-launcher",
    label: "Pig Launch / Receive Boundary",
    consequenceBoundary: "In-line inspection and cleaning pig launch and receipt sequences",
    actionExamples: ["pig.launch.execute", "pig.receive.execute"],
    requiredRuntimeRegisters: ["telemetry.segment_id", "telemetry.segment_isolation_ready", "telemetry.pressure_psig"],
    regulatoryBasis: ["49 CFR 192.150", "49 CFR 195.120", "API 1173"]
  },
  {
    kind: "modbus",
    label: "Modbus Register Boundary",
    consequenceBoundary: "Register writes that can mutate field device, RTU, or actuator behavior",
    actionExamples: ["modbus.register.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.pipeline_scada_fresh"],
    regulatoryBasis: ["API 1164"]
  },
  {
    kind: "dnp3",
    label: "DNP3 Control Boundary",
    consequenceBoundary: "Binary/analog output operations to RTUs and field controllers",
    actionExamples: ["dnp3.control.operate", "dnp3.analog-output.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.pipeline_scada_fresh"],
    regulatoryBasis: ["API 1164"]
  },
  {
    kind: "opc-ua",
    label: "OPC UA Method/Write Boundary",
    consequenceBoundary: "OPC UA node writes, methods, and industrial gateway actions",
    actionExamples: ["opcua.node.write", "opcua.method.call"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"],
    regulatoryBasis: ["API 1164"]
  },
  {
    kind: "historian-write",
    label: "Historian Write Boundary",
    consequenceBoundary: "Operational records, integrity markers, and compliance-relevant annotations",
    actionExamples: ["historian.record.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"],
    regulatoryBasis: ["49 CFR 192.709/195.404 (records)", "API 1173"]
  }
];

/** The regulatory regimes this vertical is designed to meet and exceed. */
export const PIPELINE_REGULATORY_PROFILE = [
  "49 CFR 192 (gas pipeline safety)",
  "49 CFR 195 (hazardous liquid pipeline safety)",
  "49 CFR 192.631 / 195.446 (Control Room Management)",
  "49 CFR 192.801 / 195.501 (Operator Qualification)",
  "API 1164 (pipeline SCADA security)",
  "API 1173 (Pipeline Safety Management System)",
  "API RP 1175 (leak detection program management)",
  "API 1162 (public awareness)"
] as const;

export interface PipelineRuntimeSnapshot {
  asset_id: string;
  asset_type: "pump" | "compressor" | "valve" | "pressure-monitor" | "regulator" | "rtu" | "leak-detector" | "pig-trap" | string;
  segment_id: string;
  system_model_id: string;
  pipeline_state: "normal" | "maintenance" | "emergency-shutdown" | "startup" | "shutdown" | "integrity-dig" | string;
  pressure_psig: number;
  maop_psig: number;
  /** Convenience field: pressure as a percent of MAOP. Derived if omitted. */
  pressure_pct_maop?: number;
  flow_bbl_per_day?: number;
  flow_mmscfd?: number;
  telemetry_age_ms: number;
  leak_detection_armed: boolean;
  overpressure_protection_active: boolean;
  esd_ready: boolean;
  segment_isolation_ready: boolean;
  pump_primed: boolean;
  pipeline_scada_fresh: boolean;
  operator_qualified: boolean;
  hca_segment?: boolean;
  operator_id?: string;
  work_order_id?: string;
  pig_id?: string;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface PipelineActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: PipelineRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface ScadaPumpRequest {
  station_id: string;
  unit_id: string;
  operation: "start" | "stop" | "setpoint";
  setpoint?: JsonValue;
  action_type?: string;
}

export interface ScadaCompressorRequest {
  station_id: string;
  unit_id: string;
  operation: "start" | "stop" | "recycle" | "setpoint";
  setpoint?: JsonValue;
  action_type?: string;
}

export interface ValveRequest {
  valve_id: string;
  valve_kind: "block" | "control" | "check" | "esd" | string;
  operation: "open" | "close" | "isolate" | "setpoint";
  setpoint?: JsonValue;
  action_type?: string;
}

export interface PressureRequest {
  device_id: string;
  device_kind: "regulator" | "control-valve" | "relief" | string;
  operation: "set" | "rollback";
  setpoint_psig?: number;
  action_type?: string;
}

export interface LeakDetectionRequest {
  monitor_id: string;
  operation: "threshold-set" | "mode-set";
  value: JsonValue;
  action_type?: string;
}

export interface PigRequest {
  trap_id: string;
  operation: "launch" | "receive";
  pig_id: string;
  action_type?: string;
}

export interface PipelineModbusRegisterWriteRequest {
  device_id: string;
  register: number;
  function_code: 5 | 6 | 15 | 16 | number;
  value: JsonValue;
  action_type?: string;
}

export interface PipelineDnp3ControlRequest {
  outstation_id: string;
  point_index: number;
  point_type: "binary-output" | "analog-output" | string;
  operation: "operate" | "write";
  value: JsonValue;
  action_type?: string;
}

export interface PipelineOpcUaRequest {
  server_id: string;
  node_id: string;
  operation: "write" | "method-call";
  value?: JsonValue;
  method?: string;
  action_type?: string;
}

export interface PipelineHistorianWriteRequest {
  historian_id: string;
  stream: string;
  record_type: "operator-note" | "integrity-marker" | "compliance-marker" | string;
  payload: Record<string, JsonValue>;
  action_type?: string;
}

export type PipelineAdapterRequest =
  | { kind: "scada-pump-control"; request: ScadaPumpRequest }
  | { kind: "scada-compressor"; request: ScadaCompressorRequest }
  | { kind: "valve-control"; request: ValveRequest }
  | { kind: "pressure-control"; request: PressureRequest }
  | { kind: "leak-detection"; request: LeakDetectionRequest }
  | { kind: "pig-launcher"; request: PigRequest }
  | { kind: "modbus"; request: PipelineModbusRegisterWriteRequest }
  | { kind: "dnp3"; request: PipelineDnp3ControlRequest }
  | { kind: "opc-ua"; request: PipelineOpcUaRequest }
  | { kind: "historian-write"; request: PipelineHistorianWriteRequest };

export interface PipelineEvidenceContext {
  operator_id: string;
  control_room: string;
  pipeline_domain: PipelineDomain;
  operational_scope: string;
  asset_id: string;
  segment_id: string;
  system_model_id: string;
  work_order_id?: string;
  controller_id: string;
  hca_impact?: "none" | "low" | "medium" | "high";
  regulatory_evidence_profile: Array<
    | "PHMSA_192"
    | "PHMSA_195"
    | "CONTROL_ROOM_MANAGEMENT"
    | "OPERATOR_QUALIFICATION"
    | "INTEGRITY_MANAGEMENT"
    | "API_1164"
    | "API_1173"
    | "API_RP_1175"
    | "API_1162"
    | "LOCAL_ISOLATION_PROCEDURE"
  >;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface PipelineEvidenceBundle {
  bundle_version: "aristotle.pipeline-evidence.v1";
  exported_at: string;
  pipeline: PipelineEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    pipeline_context_hash: string;
    execution_bundle_hash: string;
    pipeline_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: PipelineRuntimeSnapshot): Record<string, JsonValue> {
  const pct =
    snapshot.pressure_pct_maop ??
    (snapshot.maop_psig > 0 ? Math.round((snapshot.pressure_psig / snapshot.maop_psig) * 1000) / 10 : undefined);
  return {
    asset_id: snapshot.asset_id,
    asset_type: snapshot.asset_type,
    segment_id: snapshot.segment_id,
    boundary_id: snapshot.segment_id,
    system_model_id: snapshot.system_model_id,
    pipeline_state: snapshot.pipeline_state,
    pressure_psig: snapshot.pressure_psig,
    maop_psig: snapshot.maop_psig,
    ...(pct !== undefined ? { pressure_pct_maop: pct } : {}),
    ...(snapshot.flow_bbl_per_day !== undefined ? { flow_bbl_per_day: snapshot.flow_bbl_per_day } : {}),
    ...(snapshot.flow_mmscfd !== undefined ? { flow_mmscfd: snapshot.flow_mmscfd } : {}),
    telemetry_age_ms: snapshot.telemetry_age_ms,
    leak_detection_armed: snapshot.leak_detection_armed,
    overpressure_protection_active: snapshot.overpressure_protection_active,
    esd_ready: snapshot.esd_ready,
    segment_isolation_ready: snapshot.segment_isolation_ready,
    pump_primed: snapshot.pump_primed,
    pipeline_scada_fresh: snapshot.pipeline_scada_fresh,
    operator_qualified: snapshot.operator_qualified,
    ...(snapshot.hca_segment !== undefined ? { hca_segment: snapshot.hca_segment } : {}),
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {}),
    ...(snapshot.work_order_id ? { work_order_id: snapshot.work_order_id } : {}),
    ...(snapshot.pig_id ? { pig_id: snapshot.pig_id } : {})
  };
}

function pipelineAction(
  ctx: PipelineActionContext,
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

export function scadaPumpToAction(input: ScadaPumpRequest, ctx: PipelineActionContext): CanonicalActionInput {
  const fallback = input.operation === "start" ? "scada.pump.start" : input.operation === "stop" ? "scada.pump.stop" : "scada.pump.setpoint";
  return pipelineAction(ctx, input.action_type ?? fallback, `${input.station_id}:${input.unit_id}:${input.operation}`, {
    adapter: "scada-pump-control",
    station_id: input.station_id,
    unit_id: input.unit_id,
    operation: input.operation,
    ...(input.setpoint !== undefined ? { setpoint: input.setpoint } : {})
  });
}

export function scadaCompressorToAction(input: ScadaCompressorRequest, ctx: PipelineActionContext): CanonicalActionInput {
  const fallback = `scada.compressor.${slug(input.operation)}`;
  return pipelineAction(ctx, input.action_type ?? fallback, `${input.station_id}:${input.unit_id}:${input.operation}`, {
    adapter: "scada-compressor",
    station_id: input.station_id,
    unit_id: input.unit_id,
    operation: input.operation,
    ...(input.setpoint !== undefined ? { setpoint: input.setpoint } : {})
  });
}

export function valveToAction(input: ValveRequest, ctx: PipelineActionContext): CanonicalActionInput {
  const fallback = input.operation === "isolate" ? "valve.isolate.close" : input.operation === "open" ? "valve.isolation.open" : `valve.control.${slug(input.operation)}`;
  return pipelineAction(ctx, input.action_type ?? fallback, `${input.valve_id}:${input.valve_kind}:${input.operation}`, {
    adapter: "valve-control",
    valve_id: input.valve_id,
    valve_kind: input.valve_kind,
    operation: input.operation,
    ...(input.setpoint !== undefined ? { setpoint: input.setpoint } : {})
  });
}

export function pressureToAction(input: PressureRequest, ctx: PipelineActionContext): CanonicalActionInput {
  const fallback = input.device_kind === "relief" ? "pressure.relief.set" : "pressure.setpoint.set";
  return pipelineAction(ctx, input.action_type ?? fallback, `${input.device_id}:${input.device_kind}:${input.operation}`, {
    adapter: "pressure-control",
    device_id: input.device_id,
    device_kind: input.device_kind,
    operation: input.operation,
    ...(input.setpoint_psig !== undefined ? { setpoint_psig: input.setpoint_psig } : {})
  });
}

export function leakDetectionToAction(input: LeakDetectionRequest, ctx: PipelineActionContext): CanonicalActionInput {
  const fallback = input.operation === "threshold-set" ? "leak_detection.threshold.set" : "leak_detection.mode.set";
  return pipelineAction(ctx, input.action_type ?? fallback, `${input.monitor_id}:${input.operation}`, {
    adapter: "leak-detection",
    monitor_id: input.monitor_id,
    operation: input.operation,
    value: input.value
  });
}

export function pigToAction(input: PigRequest, ctx: PipelineActionContext): CanonicalActionInput {
  const fallback = input.operation === "launch" ? "pig.launch.execute" : "pig.receive.execute";
  return pipelineAction(ctx, input.action_type ?? fallback, `${input.trap_id}:${input.operation}:${input.pig_id}`, {
    adapter: "pig-launcher",
    trap_id: input.trap_id,
    operation: input.operation,
    pig_id: input.pig_id
  });
}

export function pipelineModbusRegisterWriteToAction(input: PipelineModbusRegisterWriteRequest, ctx: PipelineActionContext): CanonicalActionInput {
  return pipelineAction(ctx, input.action_type ?? "modbus.register.write", `${input.device_id}:register:${input.register}`, {
    adapter: "modbus",
    device_id: input.device_id,
    register: input.register,
    function_code: input.function_code,
    value: input.value
  });
}

export function pipelineDnp3ControlToAction(input: PipelineDnp3ControlRequest, ctx: PipelineActionContext): CanonicalActionInput {
  return pipelineAction(ctx, input.action_type ?? "dnp3.control.operate", `${input.outstation_id}:${input.point_type}:${input.point_index}`, {
    adapter: "dnp3",
    outstation_id: input.outstation_id,
    point_index: input.point_index,
    point_type: input.point_type,
    operation: input.operation,
    value: input.value
  });
}

export function pipelineOpcUaToAction(input: PipelineOpcUaRequest, ctx: PipelineActionContext): CanonicalActionInput {
  return pipelineAction(ctx, input.action_type ?? (input.operation === "method-call" ? "opcua.method.call" : "opcua.node.write"), `${input.server_id}:${input.node_id}`, {
    adapter: "opc-ua",
    server_id: input.server_id,
    node_id: input.node_id,
    operation: input.operation,
    ...(input.method ? { method: input.method } : {}),
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function pipelineHistorianWriteToAction(input: PipelineHistorianWriteRequest, ctx: PipelineActionContext): CanonicalActionInput {
  return pipelineAction(ctx, input.action_type ?? "historian.record.write", `${input.historian_id}:${input.stream}:${input.record_type}`, {
    adapter: "historian-write",
    historian_id: input.historian_id,
    stream: input.stream,
    record_type: input.record_type,
    payload: input.payload
  });
}

export function pipelineAdapterToAction(input: PipelineAdapterRequest, ctx: PipelineActionContext): CanonicalActionInput {
  if (input.kind === "scada-pump-control") return scadaPumpToAction(input.request, ctx);
  if (input.kind === "scada-compressor") return scadaCompressorToAction(input.request, ctx);
  if (input.kind === "valve-control") return valveToAction(input.request, ctx);
  if (input.kind === "pressure-control") return pressureToAction(input.request, ctx);
  if (input.kind === "leak-detection") return leakDetectionToAction(input.request, ctx);
  if (input.kind === "pig-launcher") return pigToAction(input.request, ctx);
  if (input.kind === "modbus") return pipelineModbusRegisterWriteToAction(input.request, ctx);
  if (input.kind === "dnp3") return pipelineDnp3ControlToAction(input.request, ctx);
  if (input.kind === "opc-ua") return pipelineOpcUaToAction(input.request, ctx);
  return pipelineHistorianWriteToAction(input.request, ctx);
}

export function pipelineSnapshotToRuntimeRegister(snapshot: PipelineRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluatePipelineSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function pipelineBundleHash(input: Omit<PipelineEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<PipelineEvidenceBundle["hashes"], "pipeline_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportPipelineEvidenceBundle(input: ExportEvidenceBundleInput & { pipeline: PipelineEvidenceContext }): PipelineEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.pipeline-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    pipeline: JSON.parse(stableStringify(input.pipeline)) as PipelineEvidenceContext,
    execution_bundle
  };
  const hashes = {
    pipeline_context_hash: sha256(stableStringify(partial.pipeline)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    pipeline_bundle_hash: ""
  };
  hashes.pipeline_bundle_hash = pipelineBundleHash({
    ...partial,
    hashes: {
      pipeline_context_hash: hashes.pipeline_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: PipelineEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyPipelineEvidenceBundle(draft) };
}

export function verifyPipelineEvidenceBundle(bundle: PipelineEvidenceBundle): PipelineEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.pipeline-evidence.v1") failures.push("unsupported pipeline evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.pipeline));
  if (contextHash !== bundle.hashes.pipeline_context_hash) failures.push("pipeline context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = pipelineBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    pipeline: bundle.pipeline,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      pipeline_context_hash: bundle.hashes.pipeline_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.pipeline_bundle_hash) failures.push("pipeline bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
