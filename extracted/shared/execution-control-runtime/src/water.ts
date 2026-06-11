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
 * Water infrastructure readiness primitives.
 *
 * Water adapters do not replace SCADA, PLC/RTU, treatment-process controls,
 * lab systems, or operator procedures. They translate proposed water/wastewater
 * operations into Canonical Governed Actions so AristotleOS can bind authority
 * before pump, valve, dosing, discharge, or treatment consequence.
 */

export type WaterDomain =
  | "drinking-water-treatment"
  | "wastewater-treatment"
  | "distribution"
  | "collection"
  | "stormwater"
  | "reservoir"
  | "lift-station"
  | "reuse"
  | "desalination";

export type WaterAdapterKind =
  | "scada-plant"
  | "plc-rtu"
  | "pump-station"
  | "valve-control"
  | "chemical-dosing"
  | "lab-lims"
  | "historian"
  | "ami-metering"
  | "tank-reservoir"
  | "lift-station"
  | "uv-disinfection"
  | "wastewater-discharge";

export interface WaterAdapterDescriptor {
  kind: WaterAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
}

export const WATER_ADAPTER_CATALOG: WaterAdapterDescriptor[] = [
  {
    kind: "scada-plant",
    label: "SCADA / Plant Control Boundary",
    consequenceBoundary: "Treatment plant commands, process setpoints, and operator-control mutations",
    actionExamples: ["scada.process.setpoint", "scada.alarm.ack"],
    requiredRuntimeRegisters: ["telemetry.facility_id", "telemetry.scada_fresh", "telemetry.operator_id"]
  },
  {
    kind: "plc-rtu",
    label: "PLC / RTU Boundary",
    consequenceBoundary: "PLC/RTU writes, remote IO state changes, and field-controller commands",
    actionExamples: ["plc.register.write", "rtu.output.operate"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.sensor_age_ms", "telemetry.manual_fallback_ready"]
  },
  {
    kind: "pump-station",
    label: "Pump Station Boundary",
    consequenceBoundary: "Pump start/stop, speed, duty rotation, booster station, and well-field operations",
    actionExamples: ["pump.speed.set", "pump.start.request"],
    requiredRuntimeRegisters: ["telemetry.pump_available", "telemetry.pressure_psi", "telemetry.tank_level_pct"]
  },
  {
    kind: "valve-control",
    label: "Valve / Pressure Zone Boundary",
    consequenceBoundary: "Valve opening, isolation, backflow-sensitive operations, and pressure-zone transitions",
    actionExamples: ["valve.position.set", "zone.pressure.adjust"],
    requiredRuntimeRegisters: ["telemetry.backflow_risk_clear", "telemetry.valve_interlock_clear", "telemetry.pressure_zone_id"]
  },
  {
    kind: "chemical-dosing",
    label: "Chemical Dosing Boundary",
    consequenceBoundary: "Chlorine, caustic, coagulant, fluoride, polymer, and chemical feed changes",
    actionExamples: ["chemical.dose.adjust", "chlorine.feed.set"],
    requiredRuntimeRegisters: ["telemetry.chlorine_residual_mg_l", "telemetry.ph", "telemetry.turbidity_ntu", "telemetry.chemical_inventory_ok"]
  },
  {
    kind: "lab-lims",
    label: "Lab / LIMS Boundary",
    consequenceBoundary: "Lab sample acceptance, process release, compliance result annotation, and hold decisions",
    actionExamples: ["lims.sample.accept", "compliance.result.publish"],
    requiredRuntimeRegisters: ["telemetry.lab_sample_age_min", "telemetry.operator_id"]
  },
  {
    kind: "historian",
    label: "Historian / Compliance Record Boundary",
    consequenceBoundary: "Historian tags, compliance annotations, incident markers, and replay material",
    actionExamples: ["historian.record.write", "compliance.marker.append"],
    requiredRuntimeRegisters: ["telemetry.asset_id", "telemetry.operator_id"]
  },
  {
    kind: "ami-metering",
    label: "AMI / Metering Boundary",
    consequenceBoundary: "Meter disconnect/reconnect, demand alarms, service events, and billing-relevant writes",
    actionExamples: ["ami.service.disconnect", "meter.event.write"],
    requiredRuntimeRegisters: ["telemetry.customer_id", "telemetry.operator_id"]
  },
  {
    kind: "tank-reservoir",
    label: "Tank / Reservoir Boundary",
    consequenceBoundary: "Tank fill/drain setpoints, reservoir transfers, overflow-sensitive and pressure-sensitive controls",
    actionExamples: ["tank.level.setpoint", "reservoir.transfer.authorize"],
    requiredRuntimeRegisters: ["telemetry.tank_level_pct", "telemetry.pressure_psi", "telemetry.disinfection_active"]
  },
  {
    kind: "lift-station",
    label: "Lift Station Boundary",
    consequenceBoundary: "Wastewater lift station pump control, wet-well level, overflow, and bypass-sensitive operations",
    actionExamples: ["lift.pump.start", "wetwell.level.setpoint"],
    requiredRuntimeRegisters: ["telemetry.wetwell_level_pct", "telemetry.bypass_active", "telemetry.pump_available"]
  },
  {
    kind: "uv-disinfection",
    label: "UV / Disinfection Boundary",
    consequenceBoundary: "UV intensity, disinfection status, and treatment release decisions",
    actionExamples: ["uv.intensity.set", "disinfection.release.authorize"],
    requiredRuntimeRegisters: ["telemetry.uv_intensity_pct", "telemetry.disinfection_active", "telemetry.flow_mgd"]
  },
  {
    kind: "wastewater-discharge",
    label: "Wastewater Discharge Boundary",
    consequenceBoundary: "NPDES/outfall discharge, bypass authorization, storm event release, and compliance-impacting actions",
    actionExamples: ["discharge.release.authorize", "wastewater.bypass.authorize"],
    requiredRuntimeRegisters: ["telemetry.discharge_permit_id", "telemetry.discharge_permit_window_open", "telemetry.bypass_active"]
  }
];

export interface WaterRuntimeSnapshot {
  utility_id: string;
  water_system_id: string;
  facility_id: string;
  facility_type: "treatment-plant" | "pump-station" | "tank" | "reservoir" | "lift-station" | "well-field" | "outfall" | string;
  asset_id: string;
  asset_type: "pump" | "valve" | "chemical-feed" | "tank" | "reservoir" | "uv-reactor" | "plc" | "rtu" | "meter" | "outfall" | string;
  process_area: "intake" | "coagulation" | "filtration" | "disinfection" | "distribution" | "collection" | "secondary-treatment" | "discharge" | string;
  pressure_zone_id?: string;
  pump_station_id?: string;
  tank_id?: string;
  reservoir_id?: string;
  lift_station_id?: string;
  outfall_id?: string;
  customer_id?: string;
  chlorine_residual_mg_l: number;
  chlorine_dose_mg_l?: number;
  ph: number;
  turbidity_ntu: number;
  pressure_psi: number;
  tank_level_pct?: number;
  wetwell_level_pct?: number;
  flow_mgd: number;
  uv_intensity_pct?: number;
  pump_available: boolean;
  pump_running: boolean;
  valve_position: "open" | "closed" | "throttled" | "unknown" | string;
  valve_interlock_clear: boolean;
  backflow_risk_clear: boolean;
  disinfection_active: boolean;
  chemical_inventory_ok: boolean;
  lab_sample_age_min: number;
  sensor_age_ms: number;
  scada_fresh: boolean;
  manual_fallback_ready: boolean;
  operator_id?: string;
  work_order_id?: string;
  discharge_permit_id?: string;
  discharge_permit_window_open: boolean;
  bypass_active: boolean;
  vendor_remote_session: boolean;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface WaterActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: WaterRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface ScadaProcessSetpointRequest {
  system: "SCADA" | "HMI" | "control-room" | string;
  setpoint: string;
  value: JsonValue;
  action_type?: string;
}

export interface PlcRtuWriteRequest {
  controller_id: string;
  register: string;
  value: JsonValue;
  action_type?: string;
}

export interface PumpStationRequest {
  pump_id: string;
  operation: "start" | "stop" | "set-speed" | "rotate-duty" | string;
  speed_pct?: number;
  action_type?: string;
}

export interface ValveControlRequest {
  valve_id: string;
  requested_position: "open" | "closed" | "throttled" | string;
  action_type?: string;
}

export interface ChemicalDosingRequest {
  chemical: "chlorine" | "caustic" | "coagulant" | "fluoride" | "polymer" | string;
  dose_mg_l: number;
  action_type?: string;
}

export interface LabSampleRequest {
  sample_id: string;
  operation: "accept" | "reject" | "publish" | string;
  action_type?: string;
}

export interface HistorianRecordRequest {
  tag: string;
  operation: "write" | "append-marker" | string;
  value?: JsonValue;
  action_type?: string;
}

export interface AmiMeterRequest {
  meter_id: string;
  operation: "disconnect" | "reconnect" | "write-event" | string;
  action_type?: string;
}

export interface TankReservoirRequest {
  asset_id: string;
  operation: "set-level" | "transfer" | "hold" | string;
  target_level_pct?: number;
  action_type?: string;
}

export interface LiftStationRequest {
  lift_station_id: string;
  operation: "start-pump" | "stop-pump" | "set-wetwell-level" | string;
  action_type?: string;
}

export interface UvDisinfectionRequest {
  reactor_id: string;
  operation: "set-intensity" | "authorize-release" | string;
  intensity_pct?: number;
  action_type?: string;
}

export interface WastewaterDischargeRequest {
  outfall_id: string;
  operation: "authorize-release" | "authorize-bypass" | "hold" | string;
  action_type?: string;
}

export type WaterAdapterRequest =
  | { kind: "scada-plant"; request: ScadaProcessSetpointRequest }
  | { kind: "plc-rtu"; request: PlcRtuWriteRequest }
  | { kind: "pump-station"; request: PumpStationRequest }
  | { kind: "valve-control"; request: ValveControlRequest }
  | { kind: "chemical-dosing"; request: ChemicalDosingRequest }
  | { kind: "lab-lims"; request: LabSampleRequest }
  | { kind: "historian"; request: HistorianRecordRequest }
  | { kind: "ami-metering"; request: AmiMeterRequest }
  | { kind: "tank-reservoir"; request: TankReservoirRequest }
  | { kind: "lift-station"; request: LiftStationRequest }
  | { kind: "uv-disinfection"; request: UvDisinfectionRequest }
  | { kind: "wastewater-discharge"; request: WastewaterDischargeRequest };

export interface WaterEvidenceContext {
  utility_id: string;
  water_system_id: string;
  facility_id: string;
  water_domain: WaterDomain;
  operations_center: string;
  asset_id: string;
  asset_type: string;
  process_area: string;
  pressure_zone_id?: string;
  tank_id?: string;
  reservoir_id?: string;
  lift_station_id?: string;
  outfall_id?: string;
  work_order_id?: string;
  discharge_permit_id?: string;
  process_snapshot: {
    chlorine_residual_mg_l?: number;
    ph?: number;
    turbidity_ntu?: number;
    pressure_psi?: number;
    tank_level_pct?: number;
    flow_mgd?: number;
  };
  standards_profile: Array<"EPA_WATER_CYBER" | "CISA_WWS_CPG" | "AWWA_CYBER" | "AWIA_RRA" | "NIST_CSF" | "LOCAL_OPERATING_PROCEDURE" | "NPDES">;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface WaterEvidenceBundle {
  bundle_version: "aristotle.water-evidence.v1";
  exported_at: string;
  water: WaterEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    water_context_hash: string;
    execution_bundle_hash: string;
    water_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: WaterRuntimeSnapshot): Record<string, JsonValue> {
  return {
    utility_id: snapshot.utility_id,
    water_system_id: snapshot.water_system_id,
    boundary_id: snapshot.water_system_id,
    facility_id: snapshot.facility_id,
    facility_type: snapshot.facility_type,
    asset_id: snapshot.asset_id,
    asset_type: snapshot.asset_type,
    process_area: snapshot.process_area,
    ...(snapshot.pressure_zone_id ? { pressure_zone_id: snapshot.pressure_zone_id } : {}),
    ...(snapshot.pump_station_id ? { pump_station_id: snapshot.pump_station_id } : {}),
    ...(snapshot.tank_id ? { tank_id: snapshot.tank_id } : {}),
    ...(snapshot.reservoir_id ? { reservoir_id: snapshot.reservoir_id } : {}),
    ...(snapshot.lift_station_id ? { lift_station_id: snapshot.lift_station_id } : {}),
    ...(snapshot.outfall_id ? { outfall_id: snapshot.outfall_id } : {}),
    ...(snapshot.customer_id ? { customer_id: snapshot.customer_id } : {}),
    chlorine_residual_mg_l: snapshot.chlorine_residual_mg_l,
    ...(snapshot.chlorine_dose_mg_l !== undefined ? { chlorine_dose_mg_l: snapshot.chlorine_dose_mg_l } : {}),
    ph: snapshot.ph,
    turbidity_ntu: snapshot.turbidity_ntu,
    pressure_psi: snapshot.pressure_psi,
    ...(snapshot.tank_level_pct !== undefined ? { tank_level_pct: snapshot.tank_level_pct } : {}),
    ...(snapshot.wetwell_level_pct !== undefined ? { wetwell_level_pct: snapshot.wetwell_level_pct } : {}),
    flow_mgd: snapshot.flow_mgd,
    ...(snapshot.uv_intensity_pct !== undefined ? { uv_intensity_pct: snapshot.uv_intensity_pct } : {}),
    pump_available: snapshot.pump_available,
    pump_running: snapshot.pump_running,
    valve_position: snapshot.valve_position,
    valve_interlock_clear: snapshot.valve_interlock_clear,
    backflow_risk_clear: snapshot.backflow_risk_clear,
    disinfection_active: snapshot.disinfection_active,
    chemical_inventory_ok: snapshot.chemical_inventory_ok,
    lab_sample_age_min: snapshot.lab_sample_age_min,
    sensor_age_ms: snapshot.sensor_age_ms,
    scada_fresh: snapshot.scada_fresh,
    manual_fallback_ready: snapshot.manual_fallback_ready,
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {}),
    ...(snapshot.work_order_id ? { work_order_id: snapshot.work_order_id } : {}),
    ...(snapshot.discharge_permit_id ? { discharge_permit_id: snapshot.discharge_permit_id } : {}),
    discharge_permit_window_open: snapshot.discharge_permit_window_open,
    bypass_active: snapshot.bypass_active,
    vendor_remote_session: snapshot.vendor_remote_session
  };
}

function waterAction(
  ctx: WaterActionContext,
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

export function scadaProcessSetpointToAction(input: ScadaProcessSetpointRequest, ctx: WaterActionContext): CanonicalActionInput {
  return waterAction(ctx, input.action_type ?? "scada.process.setpoint", `${input.system}:${input.setpoint}`, {
    adapter: "scada-plant",
    system: input.system,
    setpoint: input.setpoint,
    value: input.value
  });
}

export function plcRtuWriteToAction(input: PlcRtuWriteRequest, ctx: WaterActionContext): CanonicalActionInput {
  return waterAction(ctx, input.action_type ?? "plc.register.write", `${input.controller_id}:${input.register}`, {
    adapter: "plc-rtu",
    controller_id: input.controller_id,
    register: input.register,
    value: input.value
  });
}

export function pumpStationToAction(input: PumpStationRequest, ctx: WaterActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "set-speed" ? "pump.speed.set" : `pump.${slug(input.operation)}.request`);
  return waterAction(ctx, actionType, `${input.pump_id}:${input.operation}`, {
    adapter: "pump-station",
    pump_id: input.pump_id,
    operation: input.operation,
    ...(input.speed_pct !== undefined ? { speed_pct: input.speed_pct } : {})
  });
}

export function valveControlToAction(input: ValveControlRequest, ctx: WaterActionContext): CanonicalActionInput {
  return waterAction(ctx, input.action_type ?? "valve.position.set", `${input.valve_id}:${input.requested_position}`, {
    adapter: "valve-control",
    valve_id: input.valve_id,
    requested_position: input.requested_position,
    valve_position: input.requested_position
  });
}

export function chemicalDosingToAction(input: ChemicalDosingRequest, ctx: WaterActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.chemical === "chlorine" ? "chlorine.feed.set" : "chemical.dose.adjust");
  return waterAction(ctx, actionType, `${input.chemical}:${input.dose_mg_l}`, {
    adapter: "chemical-dosing",
    chemical: input.chemical,
    ...(input.chemical === "chlorine"
      ? { chlorine_dose_mg_l: input.dose_mg_l }
      : ctx.snapshot.chlorine_dose_mg_l !== undefined
        ? { chlorine_dose_mg_l: ctx.snapshot.chlorine_dose_mg_l }
        : {}),
    dose_mg_l: input.dose_mg_l
  });
}

export function labSampleToAction(input: LabSampleRequest, ctx: WaterActionContext): CanonicalActionInput {
  return waterAction(ctx, input.action_type ?? `lims.sample.${slug(input.operation)}`, `${input.sample_id}:${input.operation}`, {
    adapter: "lab-lims",
    sample_id: input.sample_id,
    operation: input.operation
  });
}

export function historianRecordToAction(input: HistorianRecordRequest, ctx: WaterActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "append-marker" ? "compliance.marker.append" : "historian.record.write");
  return waterAction(ctx, actionType, `${input.tag}:${input.operation}`, {
    adapter: "historian",
    tag: input.tag,
    operation: input.operation,
    ...(input.value !== undefined ? { value: input.value } : {})
  });
}

export function amiMeterToAction(input: AmiMeterRequest, ctx: WaterActionContext): CanonicalActionInput {
  return waterAction(ctx, input.action_type ?? `ami.service.${slug(input.operation)}`, `${input.meter_id}:${input.operation}`, {
    adapter: "ami-metering",
    meter_id: input.meter_id,
    operation: input.operation
  });
}

export function tankReservoirToAction(input: TankReservoirRequest, ctx: WaterActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "transfer" ? "reservoir.transfer.authorize" : "tank.level.setpoint");
  return waterAction(ctx, actionType, `${input.asset_id}:${input.operation}`, {
    adapter: "tank-reservoir",
    asset_id: input.asset_id,
    operation: input.operation,
    ...(input.target_level_pct !== undefined ? { tank_level_pct: input.target_level_pct, target_level_pct: input.target_level_pct } : {})
  });
}

export function liftStationToAction(input: LiftStationRequest, ctx: WaterActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "set-wetwell-level" ? "wetwell.level.setpoint" : `lift.pump.${slug(input.operation)}`);
  return waterAction(ctx, actionType, `${input.lift_station_id}:${input.operation}`, {
    adapter: "lift-station",
    lift_station_id: input.lift_station_id,
    operation: input.operation
  });
}

export function uvDisinfectionToAction(input: UvDisinfectionRequest, ctx: WaterActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "authorize-release" ? "disinfection.release.authorize" : "uv.intensity.set");
  return waterAction(ctx, actionType, `${input.reactor_id}:${input.operation}`, {
    adapter: "uv-disinfection",
    reactor_id: input.reactor_id,
    operation: input.operation,
    ...(input.intensity_pct !== undefined ? { uv_intensity_pct: input.intensity_pct } : {})
  });
}

export function wastewaterDischargeToAction(input: WastewaterDischargeRequest, ctx: WaterActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "authorize-bypass" ? "wastewater.bypass.authorize" : "discharge.release.authorize");
  return waterAction(ctx, actionType, `${input.outfall_id}:${input.operation}`, {
    adapter: "wastewater-discharge",
    outfall_id: input.outfall_id,
    operation: input.operation
  });
}

export function waterAdapterToAction(input: WaterAdapterRequest, ctx: WaterActionContext): CanonicalActionInput {
  if (input.kind === "scada-plant") return scadaProcessSetpointToAction(input.request, ctx);
  if (input.kind === "plc-rtu") return plcRtuWriteToAction(input.request, ctx);
  if (input.kind === "pump-station") return pumpStationToAction(input.request, ctx);
  if (input.kind === "valve-control") return valveControlToAction(input.request, ctx);
  if (input.kind === "chemical-dosing") return chemicalDosingToAction(input.request, ctx);
  if (input.kind === "lab-lims") return labSampleToAction(input.request, ctx);
  if (input.kind === "historian") return historianRecordToAction(input.request, ctx);
  if (input.kind === "ami-metering") return amiMeterToAction(input.request, ctx);
  if (input.kind === "tank-reservoir") return tankReservoirToAction(input.request, ctx);
  if (input.kind === "lift-station") return liftStationToAction(input.request, ctx);
  if (input.kind === "uv-disinfection") return uvDisinfectionToAction(input.request, ctx);
  return wastewaterDischargeToAction(input.request, ctx);
}

export function waterSnapshotToRuntimeRegister(snapshot: WaterRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateWaterSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function waterBundleHash(input: Omit<WaterEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<WaterEvidenceBundle["hashes"], "water_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportWaterEvidenceBundle(input: ExportEvidenceBundleInput & { water: WaterEvidenceContext }): WaterEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.water-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    water: JSON.parse(stableStringify(input.water)) as WaterEvidenceContext,
    execution_bundle
  };
  const hashes = {
    water_context_hash: sha256(stableStringify(partial.water)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    water_bundle_hash: ""
  };
  hashes.water_bundle_hash = waterBundleHash({
    ...partial,
    hashes: {
      water_context_hash: hashes.water_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: WaterEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyWaterEvidenceBundle(draft) };
}

export function verifyWaterEvidenceBundle(bundle: WaterEvidenceBundle): WaterEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.water-evidence.v1") failures.push("unsupported water evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.water));
  if (contextHash !== bundle.hashes.water_context_hash) failures.push("water context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = waterBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    water: bundle.water,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      water_context_hash: bundle.hashes.water_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.water_bundle_hash) failures.push("water bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
