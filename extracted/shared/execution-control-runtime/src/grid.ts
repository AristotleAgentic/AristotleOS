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
 * Electric utility readiness primitives.
 *
 * Utility adapters do not operate grid equipment directly. They translate SCADA,
 * relay, DERMS, and OT protocol requests into Canonical Governed Actions. A real
 * adapter must verify the resulting Warrant before it sends any field command.
 */

export type GridDomain =
  | "transmission"
  | "distribution"
  | "substation-edge"
  | "derms"
  | "microgrid"
  | "storm-restoration"
  | "relay-engineering"
  | "blackstart";

export type GridAdapterKind =
  | "iec61850"
  | "dnp3"
  | "modbus"
  | "opc-ua"
  | "scada-ems-adms"
  | "derms"
  | "relay-settings"
  | "firmware-campaign"
  | "historian-write";

export interface GridAdapterDescriptor {
  kind: GridAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
}

export const GRID_ADAPTER_CATALOG: GridAdapterDescriptor[] = [
  {
    kind: "iec61850",
    label: "IEC 61850 Control Boundary",
    consequenceBoundary: "MMS control operations, GOOSE-sensitive device commands, and substation automation changes",
    actionExamples: ["iec61850.control.operate", "iec61850.dataset.update"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.switching_order_id", "telemetry.protection_state_known"]
  },
  {
    kind: "dnp3",
    label: "DNP3 Control Boundary",
    consequenceBoundary: "Binary output, analog output, and remote terminal unit operations",
    actionExamples: ["dnp3.control.operate", "dnp3.analog-output.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.scada_fresh", "telemetry.switching_order_id"]
  },
  {
    kind: "modbus",
    label: "Modbus Register Boundary",
    consequenceBoundary: "Register writes that can mutate field device or DER behavior",
    actionExamples: ["modbus.register.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.manual_fallback_ready"]
  },
  {
    kind: "opc-ua",
    label: "OPC UA Method/Write Boundary",
    consequenceBoundary: "OPC UA node writes, methods, and industrial gateway actions",
    actionExamples: ["opcua.node.write", "opcua.method.call"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"]
  },
  {
    kind: "scada-ems-adms",
    label: "SCADA / EMS / ADMS Command Boundary",
    consequenceBoundary: "Breaker, switch, switching order, outage, and restoration workflow mutations",
    actionExamples: ["scada.breaker.open", "scada.breaker.close", "adms.switching-order.execute"],
    requiredRuntimeRegisters: ["telemetry.switching_order_id", "telemetry.crew_clearance_released", "telemetry.scada_fresh"]
  },
  {
    kind: "derms",
    label: "DERMS Dispatch Boundary",
    consequenceBoundary: "Distributed energy resource export caps, curtailment, islanding, and dispatch commands",
    actionExamples: ["derms.dispatch.set", "derms.export-cap.set"],
    requiredRuntimeRegisters: ["telemetry.der_export_mw", "telemetry.grid_state", "telemetry.topology_model_id"]
  },
  {
    kind: "relay-settings",
    label: "Relay Settings Boundary",
    consequenceBoundary: "Protection setting changes, relay group activation, and protection package deployment",
    actionExamples: ["relay.setting.update", "relay.group.activate"],
    requiredRuntimeRegisters: ["telemetry.relay_setting_version", "telemetry.protection_state_known", "telemetry.switching_order_id"]
  },
  {
    kind: "firmware-campaign",
    label: "Field Firmware Campaign Boundary",
    consequenceBoundary: "IED, RTU, relay, gateway, and substation device firmware staging and activation",
    actionExamples: ["firmware.campaign.stage", "firmware.campaign.activate"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.firmware_digest", "telemetry.manual_fallback_ready"]
  },
  {
    kind: "historian-write",
    label: "Historian Write Boundary",
    consequenceBoundary: "Operational records, restoration markers, and compliance-relevant telemetry annotations",
    actionExamples: ["historian.record.write"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"]
  }
];

export interface GridRuntimeSnapshot {
  asset_id: string;
  asset_type: "breaker" | "switch" | "feeder" | "transformer" | "relay" | "derms-resource" | "rtu" | "substation-gateway" | string;
  grid_boundary_id: string;
  topology_model_id: string;
  voltage_class: string;
  voltage_kv: number;
  frequency_hz: number;
  feeder_load_pct?: number;
  transformer_load_pct?: number;
  der_export_mw?: number;
  grid_state: "normal" | "storm-restoration" | "islanded" | "blackstart" | "maintenance" | string;
  switching_order_id?: string;
  crew_clearance_released: boolean;
  protection_state_known: boolean;
  scada_fresh: boolean;
  telemetry_age_ms: number;
  manual_fallback_ready: boolean;
  operator_id?: string;
  work_order_id?: string;
  outage_id?: string;
  relay_setting_version?: string;
  firmware_digest?: string;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface GridActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: GridRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface Iec61850ControlRequest {
  ied_id: string;
  logical_node: string;
  control_object: string;
  operation: "select" | "operate" | "cancel" | "dataset-update" | string;
  value?: JsonValue;
  action_type?: string;
}

export interface Dnp3ControlRequest {
  outstation_id: string;
  point_index: number;
  point_type: "binary-output" | "analog-output" | string;
  operation: "operate" | "write";
  value: JsonValue;
  action_type?: string;
}

export interface ModbusRegisterWriteRequest {
  device_id: string;
  register: number;
  function_code: 5 | 6 | 15 | 16 | number;
  value: JsonValue;
  action_type?: string;
}

export interface OpcUaRequest {
  server_id: string;
  node_id: string;
  operation: "write" | "method-call";
  value?: JsonValue;
  method?: string;
  action_type?: string;
}

export interface ScadaCommandRequest {
  system: "SCADA" | "EMS" | "ADMS" | string;
  command: "open_breaker" | "close_breaker" | "execute_switching_order" | "restore_feeder" | string;
  asset_id: string;
  action_type?: string;
}

export interface DermsDispatchRequest {
  resource_id: string;
  operation: "set_export_cap" | "curtail" | "dispatch" | "island";
  export_mw?: number;
  target_mw?: number;
  action_type?: string;
}

export interface RelaySettingRequest {
  relay_id: string;
  setting_group: string;
  setting_version: string;
  operation: "stage" | "update" | "activate" | "rollback";
  action_type?: string;
}

export interface FirmwareCampaignRequest {
  campaign_id: string;
  firmware_digest: string;
  operation: "stage" | "activate" | "rollback";
  target_assets?: string[];
  action_type?: string;
}

export interface HistorianWriteRequest {
  historian_id: string;
  stream: string;
  record_type: "operator-note" | "restoration-marker" | "compliance-marker" | string;
  payload: Record<string, JsonValue>;
  action_type?: string;
}

export type GridAdapterRequest =
  | { kind: "iec61850"; request: Iec61850ControlRequest }
  | { kind: "dnp3"; request: Dnp3ControlRequest }
  | { kind: "modbus"; request: ModbusRegisterWriteRequest }
  | { kind: "opc-ua"; request: OpcUaRequest }
  | { kind: "scada-ems-adms"; request: ScadaCommandRequest }
  | { kind: "derms"; request: DermsDispatchRequest }
  | { kind: "relay-settings"; request: RelaySettingRequest }
  | { kind: "firmware-campaign"; request: FirmwareCampaignRequest }
  | { kind: "historian-write"; request: HistorianWriteRequest };

export interface GridEvidenceContext {
  utility_id: string;
  control_center: string;
  grid_domain: GridDomain;
  operational_scope: string;
  asset_id: string;
  switching_order_id?: string;
  work_order_id?: string;
  outage_id?: string;
  operator_id: string;
  topology_model_id: string;
  voltage_class: string;
  bes_impact?: "low" | "medium" | "high" | "not_applicable";
  cip_evidence_profile: Array<"CIP_002" | "CIP_003" | "CIP_005" | "CIP_007" | "CIP_010" | "CIP_011" | "CIP_013" | "CIP_014" | "NERC_OPS" | "LOCAL_SWITCHING_ORDER">;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface GridEvidenceBundle {
  bundle_version: "aristotle.grid-evidence.v1";
  exported_at: string;
  grid: GridEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    grid_context_hash: string;
    execution_bundle_hash: string;
    grid_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: GridRuntimeSnapshot): Record<string, JsonValue> {
  return {
    asset_id: snapshot.asset_id,
    asset_type: snapshot.asset_type,
    boundary_id: snapshot.grid_boundary_id,
    grid_boundary_id: snapshot.grid_boundary_id,
    topology_model_id: snapshot.topology_model_id,
    voltage_class: snapshot.voltage_class,
    voltage_kv: snapshot.voltage_kv,
    frequency_hz: snapshot.frequency_hz,
    ...(snapshot.feeder_load_pct !== undefined ? { feeder_load_pct: snapshot.feeder_load_pct } : {}),
    ...(snapshot.transformer_load_pct !== undefined ? { transformer_load_pct: snapshot.transformer_load_pct } : {}),
    ...(snapshot.der_export_mw !== undefined ? { der_export_mw: snapshot.der_export_mw } : {}),
    grid_state: snapshot.grid_state,
    ...(snapshot.switching_order_id ? { switching_order_id: snapshot.switching_order_id } : {}),
    crew_clearance_released: snapshot.crew_clearance_released,
    protection_state_known: snapshot.protection_state_known,
    scada_fresh: snapshot.scada_fresh,
    telemetry_age_ms: snapshot.telemetry_age_ms,
    manual_fallback_ready: snapshot.manual_fallback_ready,
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {}),
    ...(snapshot.work_order_id ? { work_order_id: snapshot.work_order_id } : {}),
    ...(snapshot.outage_id ? { outage_id: snapshot.outage_id } : {}),
    ...(snapshot.relay_setting_version ? { relay_setting_version: snapshot.relay_setting_version } : {}),
    ...(snapshot.firmware_digest ? { firmware_digest: snapshot.firmware_digest } : {})
  };
}

function gridAction(
  ctx: GridActionContext,
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

export function iec61850ControlToAction(input: Iec61850ControlRequest, ctx: GridActionContext): CanonicalActionInput {
  return gridAction(ctx, input.action_type ?? "iec61850.control.operate", `${input.ied_id}:${input.logical_node}:${input.control_object}`, {
    adapter: "iec61850",
    ied_id: input.ied_id,
    logical_node: input.logical_node,
    control_object: input.control_object,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function dnp3ControlToAction(input: Dnp3ControlRequest, ctx: GridActionContext): CanonicalActionInput {
  return gridAction(ctx, input.action_type ?? "dnp3.control.operate", `${input.outstation_id}:${input.point_type}:${input.point_index}`, {
    adapter: "dnp3",
    outstation_id: input.outstation_id,
    point_index: input.point_index,
    point_type: input.point_type,
    operation: input.operation,
    value: input.value
  });
}

export function modbusRegisterWriteToAction(input: ModbusRegisterWriteRequest, ctx: GridActionContext): CanonicalActionInput {
  return gridAction(ctx, input.action_type ?? "modbus.register.write", `${input.device_id}:register:${input.register}`, {
    adapter: "modbus",
    device_id: input.device_id,
    register: input.register,
    function_code: input.function_code,
    value: input.value
  });
}

export function opcUaToAction(input: OpcUaRequest, ctx: GridActionContext): CanonicalActionInput {
  return gridAction(ctx, input.action_type ?? (input.operation === "method-call" ? "opcua.method.call" : "opcua.node.write"), `${input.server_id}:${input.node_id}`, {
    adapter: "opc-ua",
    server_id: input.server_id,
    node_id: input.node_id,
    operation: input.operation,
    ...(input.method ? { method: input.method } : {}),
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function scadaCommandToAction(input: ScadaCommandRequest, ctx: GridActionContext): CanonicalActionInput {
  const fallback = input.command === "open_breaker" ? "scada.breaker.open" : input.command === "close_breaker" ? "scada.breaker.close" : `scada.${slug(input.command)}`;
  return gridAction(ctx, input.action_type ?? fallback, `${input.system}:${input.asset_id}:${input.command}`, {
    adapter: "scada-ems-adms",
    system: input.system,
    command: input.command,
    asset_id: input.asset_id
  });
}

export function dermsDispatchToAction(input: DermsDispatchRequest, ctx: GridActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "set_export_cap" ? "derms.export-cap.set" : "derms.dispatch.set");
  return gridAction(ctx, actionType, `derms:${input.resource_id}:${input.operation}`, {
    adapter: "derms",
    resource_id: input.resource_id,
    operation: input.operation,
    ...(input.export_mw !== undefined ? { export_mw: input.export_mw, der_export_mw: input.export_mw } : {}),
    ...(input.target_mw !== undefined ? { target_mw: input.target_mw } : {})
  });
}

export function relaySettingToAction(input: RelaySettingRequest, ctx: GridActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? `relay.setting.${slug(input.operation)}`;
  return gridAction(ctx, actionType, `${input.relay_id}:${input.setting_group}:${input.setting_version}`, {
    adapter: "relay-settings",
    relay_id: input.relay_id,
    setting_group: input.setting_group,
    setting_version: input.setting_version,
    relay_setting_version: input.setting_version,
    operation: input.operation
  });
}

export function firmwareCampaignToAction(input: FirmwareCampaignRequest, ctx: GridActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? `firmware.campaign.${slug(input.operation)}`;
  return gridAction(ctx, actionType, `${input.campaign_id}:${input.operation}`, {
    adapter: "firmware-campaign",
    campaign_id: input.campaign_id,
    firmware_digest: input.firmware_digest,
    operation: input.operation,
    ...(input.target_assets ? { target_assets: input.target_assets } : {})
  });
}

export function historianWriteToAction(input: HistorianWriteRequest, ctx: GridActionContext): CanonicalActionInput {
  return gridAction(ctx, input.action_type ?? "historian.record.write", `${input.historian_id}:${input.stream}:${input.record_type}`, {
    adapter: "historian-write",
    historian_id: input.historian_id,
    stream: input.stream,
    record_type: input.record_type,
    payload: input.payload
  });
}

export function gridAdapterToAction(input: GridAdapterRequest, ctx: GridActionContext): CanonicalActionInput {
  if (input.kind === "iec61850") return iec61850ControlToAction(input.request, ctx);
  if (input.kind === "dnp3") return dnp3ControlToAction(input.request, ctx);
  if (input.kind === "modbus") return modbusRegisterWriteToAction(input.request, ctx);
  if (input.kind === "opc-ua") return opcUaToAction(input.request, ctx);
  if (input.kind === "scada-ems-adms") return scadaCommandToAction(input.request, ctx);
  if (input.kind === "derms") return dermsDispatchToAction(input.request, ctx);
  if (input.kind === "relay-settings") return relaySettingToAction(input.request, ctx);
  if (input.kind === "firmware-campaign") return firmwareCampaignToAction(input.request, ctx);
  return historianWriteToAction(input.request, ctx);
}

export function gridSnapshotToRuntimeRegister(snapshot: GridRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateGridSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function gridBundleHash(input: Omit<GridEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<GridEvidenceBundle["hashes"], "grid_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportGridEvidenceBundle(input: ExportEvidenceBundleInput & { grid: GridEvidenceContext }): GridEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.grid-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    grid: JSON.parse(stableStringify(input.grid)) as GridEvidenceContext,
    execution_bundle
  };
  const hashes = {
    grid_context_hash: sha256(stableStringify(partial.grid)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    grid_bundle_hash: ""
  };
  hashes.grid_bundle_hash = gridBundleHash({
    ...partial,
    hashes: {
      grid_context_hash: hashes.grid_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: GridEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyGridEvidenceBundle(draft) };
}

export function verifyGridEvidenceBundle(bundle: GridEvidenceBundle): GridEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.grid-evidence.v1") failures.push("unsupported grid evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.grid));
  if (contextHash !== bundle.hashes.grid_context_hash) failures.push("grid context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = gridBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    grid: bundle.grid,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      grid_context_hash: bundle.hashes.grid_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.grid_bundle_hash) failures.push("grid bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
