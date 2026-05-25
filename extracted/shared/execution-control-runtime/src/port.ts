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
 * Port readiness primitives.
 *
 * Port adapters do not replace terminal operating systems, vessel traffic
 * services, customs systems, PLC safety logic, or equipment interlocks. They
 * translate proposed port actions into Canonical Governed Actions so
 * AristotleOS can bind authority before cargo, equipment, vessel, gate, or
 * shore-power consequence.
 */

export type PortDomain =
  | "container-terminal"
  | "bulk-terminal"
  | "ro-ro-terminal"
  | "cruise-terminal"
  | "inland-port"
  | "harbor-operations"
  | "cold-chain"
  | "hazmat-terminal"
  | "intermodal-gateway";

export type PortAdapterKind =
  | "terminal-operating-system"
  | "port-community-system"
  | "customs-hold"
  | "vts-ais-pnt"
  | "crane-automation"
  | "gate-ocr-access"
  | "yard-tractor-automation"
  | "reefer-monitoring"
  | "weighbridge-vgm"
  | "shore-power"
  | "bunkering-hazmat";

export interface PortAdapterDescriptor {
  kind: PortAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
}

export const PORT_ADAPTER_CATALOG: PortAdapterDescriptor[] = [
  {
    kind: "terminal-operating-system",
    label: "Terminal Operating System Boundary",
    consequenceBoundary: "Container release, yard move, stowage, appointment, and terminal workflow mutations",
    actionExamples: ["tos.container.release", "tos.yard-move.authorize"],
    requiredRuntimeRegisters: ["telemetry.terminal_id", "telemetry.tos_transaction_id", "telemetry.customs_hold", "telemetry.security_hold"]
  },
  {
    kind: "port-community-system",
    label: "Port Community / EDI Boundary",
    consequenceBoundary: "Manifest, bill-of-lading, booking, carrier, and multi-stakeholder data exchanges",
    actionExamples: ["edi.manifest.submit", "pcs.release-notice.publish"],
    requiredRuntimeRegisters: ["telemetry.booking_id", "telemetry.bill_of_lading", "telemetry.operator_id"]
  },
  {
    kind: "customs-hold",
    label: "Customs / Hold Release Boundary",
    consequenceBoundary: "Customs release, security hold, inspection hold, and high-value cargo release decisions",
    actionExamples: ["customs.hold.release", "security.hold.release"],
    requiredRuntimeRegisters: ["telemetry.customs_hold", "telemetry.security_hold", "telemetry.release_order_id"]
  },
  {
    kind: "vts-ais-pnt",
    label: "VTS / AIS / PNT Boundary",
    consequenceBoundary: "Berth clearance, vessel movement coordination, pilotage context, and navigation timing confidence",
    actionExamples: ["vts.berth.clearance", "ais.track.attest"],
    requiredRuntimeRegisters: ["telemetry.vessel_imo", "telemetry.pnt_confidence", "telemetry.ais_track_age_ms", "telemetry.berth_conflict_present"]
  },
  {
    kind: "crane-automation",
    label: "Crane Automation Boundary",
    consequenceBoundary: "Quay crane, RTG/RMG, ASC, spreader, twistlock, and heavy-equipment movement commands",
    actionExamples: ["crane.move.request", "crane.job.assign"],
    requiredRuntimeRegisters: ["telemetry.equipment_id", "telemetry.crane_exclusion_zone_clear", "telemetry.spreader_locked"]
  },
  {
    kind: "gate-ocr-access",
    label: "Gate OCR / Access Boundary",
    consequenceBoundary: "Truck appointment, OCR identity, driver access, gate release, and perimeter-control actions",
    actionExamples: ["gate.access.grant", "gate.appointment.update"],
    requiredRuntimeRegisters: ["telemetry.gate_id", "telemetry.truck_appointment_valid", "telemetry.driver_identity_verified"]
  },
  {
    kind: "yard-tractor-automation",
    label: "Yard Tractor / AGV Boundary",
    consequenceBoundary: "Autonomous yard moves, lane occupation, block routing, and equipment dispatch",
    actionExamples: ["yard.move.authorize", "yard.route.assign"],
    requiredRuntimeRegisters: ["telemetry.yard_block_id", "telemetry.manual_fallback_ready", "telemetry.terminal_network_zone"]
  },
  {
    kind: "reefer-monitoring",
    label: "Reefer / Cold Chain Boundary",
    consequenceBoundary: "Reefer setpoint changes, alarm acknowledgement, power handoff, and cold-chain integrity decisions",
    actionExamples: ["reefer.setpoint.update", "reefer.alarm.ack"],
    requiredRuntimeRegisters: ["telemetry.container_id", "telemetry.reefer_temperature_c", "telemetry.cold_chain_valid"]
  },
  {
    kind: "weighbridge-vgm",
    label: "Weighbridge / VGM Boundary",
    consequenceBoundary: "Verified gross mass, scale readings, overweight holds, and carrier acceptance material",
    actionExamples: ["weighbridge.vgm.verify", "weight.hold.apply"],
    requiredRuntimeRegisters: ["telemetry.container_weight_kg", "telemetry.vgm_verified", "telemetry.tos_transaction_id"]
  },
  {
    kind: "shore-power",
    label: "Shore Power Boundary",
    consequenceBoundary: "Shore-power energization, lockout release, vessel connection, and high-energy berth operations",
    actionExamples: ["shore-power.energize.request", "shore-power.isolate.request"],
    requiredRuntimeRegisters: ["telemetry.shore_power_lockout_released", "telemetry.shore_power_isolated", "telemetry.fire_watch_ready"]
  },
  {
    kind: "bunkering-hazmat",
    label: "Bunkering / Hazmat Boundary",
    consequenceBoundary: "Hazardous cargo routing, bunkering authorization, dangerous goods segregation, and environmental exposure",
    actionExamples: ["hazmat.route.authorize", "bunkering.operation.authorize"],
    requiredRuntimeRegisters: ["telemetry.hazmat_class", "telemetry.hazmat_route_approved", "telemetry.fire_watch_ready"]
  }
];

export interface PortRuntimeSnapshot {
  port_id: string;
  facility_id: string;
  terminal_id: string;
  berth_id?: string;
  yard_block_id?: string;
  gate_id?: string;
  container_id?: string;
  equipment_id?: string;
  vessel_imo?: string;
  vessel_name?: string;
  voyage_id?: string;
  truck_id?: string;
  railcar_id?: string;
  cargo_type: "container" | "bulk" | "ro-ro" | "reefer" | "hazmat" | "breakbulk" | string;
  hazmat_class?: string;
  container_weight_kg?: number;
  vgm_verified: boolean;
  customs_hold: boolean;
  security_hold: boolean;
  inspection_hold: boolean;
  release_order_id?: string;
  booking_id?: string;
  bill_of_lading?: string;
  pnt_confidence: number;
  ais_track_age_ms?: number;
  vessel_clearance_granted: boolean;
  berth_conflict_present: boolean;
  wind_speed_kn?: number;
  tide_window_open: boolean;
  crane_exclusion_zone_clear: boolean;
  twistlock_state?: "locked" | "unlocked" | "unknown" | string;
  spreader_locked: boolean;
  reefer_temperature_c?: number;
  reefer_setpoint_c?: number;
  cold_chain_valid: boolean;
  shore_power_lockout_released: boolean;
  shore_power_isolated: boolean;
  fire_watch_ready: boolean;
  hazmat_route_approved: boolean;
  truck_appointment_valid: boolean;
  driver_identity_verified: boolean;
  gate_access_granted: boolean;
  terminal_network_zone: "tos" | "ot" | "gate" | "vessel-interface" | "corporate" | string;
  vendor_remote_session: boolean;
  ot_telemetry_age_ms: number;
  tos_transaction_id?: string;
  operator_id?: string;
  manual_fallback_ready: boolean;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface PortActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: PortRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface TosContainerReleaseRequest {
  container_id: string;
  release_order_id: string;
  consignee_id?: string;
  action_type?: string;
}

export interface EdiManifestRequest {
  manifest_id: string;
  carrier_id: string;
  operation: "submit" | "amend" | "publish-release-notice" | string;
  action_type?: string;
}

export interface CustomsHoldRequest {
  hold_id: string;
  container_id: string;
  operation: "release" | "apply" | "escalate" | string;
  authority_reference?: string;
  action_type?: string;
}

export interface VtsBerthClearanceRequest {
  clearance_id: string;
  vessel_imo: string;
  berth_id: string;
  operation: "clear-berth" | "hold" | "attest-track" | string;
  action_type?: string;
}

export interface CraneMoveRequest {
  crane_id: string;
  move_id: string;
  container_id: string;
  from_slot: string;
  to_slot: string;
  action_type?: string;
}

export interface GateAccessRequest {
  gate_id: string;
  truck_id: string;
  appointment_id: string;
  operation: "grant" | "deny" | "update" | string;
  action_type?: string;
}

export interface YardMoveRequest {
  move_id: string;
  equipment_id: string;
  container_id: string;
  from_block: string;
  to_block: string;
  action_type?: string;
}

export interface ReeferSetpointRequest {
  container_id: string;
  setpoint_c: number;
  operation?: "update-setpoint" | "ack-alarm" | string;
  action_type?: string;
}

export interface WeighbridgeVgmRequest {
  weigh_ticket_id: string;
  container_id: string;
  weight_kg: number;
  action_type?: string;
}

export interface ShorePowerRequest {
  berth_id: string;
  vessel_imo: string;
  operation: "energize" | "isolate" | "test" | string;
  action_type?: string;
}

export interface BunkeringHazmatRequest {
  operation_id: string;
  operation: "authorize-route" | "authorize-bunkering" | "hold" | string;
  hazmat_class?: string;
  action_type?: string;
}

export type PortAdapterRequest =
  | { kind: "terminal-operating-system"; request: TosContainerReleaseRequest }
  | { kind: "port-community-system"; request: EdiManifestRequest }
  | { kind: "customs-hold"; request: CustomsHoldRequest }
  | { kind: "vts-ais-pnt"; request: VtsBerthClearanceRequest }
  | { kind: "crane-automation"; request: CraneMoveRequest }
  | { kind: "gate-ocr-access"; request: GateAccessRequest }
  | { kind: "yard-tractor-automation"; request: YardMoveRequest }
  | { kind: "reefer-monitoring"; request: ReeferSetpointRequest }
  | { kind: "weighbridge-vgm"; request: WeighbridgeVgmRequest }
  | { kind: "shore-power"; request: ShorePowerRequest }
  | { kind: "bunkering-hazmat"; request: BunkeringHazmatRequest };

export interface PortEvidenceContext {
  port_id: string;
  facility_id: string;
  terminal_id: string;
  port_domain: PortDomain;
  operations_center: string;
  berth_id?: string;
  yard_block_id?: string;
  gate_id?: string;
  container_id?: string;
  vessel_imo?: string;
  voyage_id?: string;
  booking_id?: string;
  bill_of_lading?: string;
  release_order_id?: string;
  equipment_id?: string;
  cargo_profile: {
    cargo_type: string;
    hazmat_class?: string;
    reefer?: boolean;
    container_weight_kg?: number;
  };
  standards_profile: Array<"USCG_MTSA_CYBER" | "IMO_MSC_FAL" | "IAPH_PORT_CYBER" | "CISA_MTS_RESILIENCE" | "ISPS" | "NIST_CSF" | "LOCAL_TERMINAL_RULE">;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface PortEvidenceBundle {
  bundle_version: "aristotle.port-evidence.v1";
  exported_at: string;
  port: PortEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    port_context_hash: string;
    execution_bundle_hash: string;
    port_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: PortRuntimeSnapshot): Record<string, JsonValue> {
  return {
    port_id: snapshot.port_id,
    boundary_id: snapshot.terminal_id,
    facility_id: snapshot.facility_id,
    terminal_id: snapshot.terminal_id,
    ...(snapshot.berth_id ? { berth_id: snapshot.berth_id } : {}),
    ...(snapshot.yard_block_id ? { yard_block_id: snapshot.yard_block_id } : {}),
    ...(snapshot.gate_id ? { gate_id: snapshot.gate_id } : {}),
    ...(snapshot.container_id ? { container_id: snapshot.container_id } : {}),
    ...(snapshot.equipment_id ? { equipment_id: snapshot.equipment_id } : {}),
    ...(snapshot.vessel_imo ? { vessel_imo: snapshot.vessel_imo } : {}),
    ...(snapshot.vessel_name ? { vessel_name: snapshot.vessel_name } : {}),
    ...(snapshot.voyage_id ? { voyage_id: snapshot.voyage_id } : {}),
    ...(snapshot.truck_id ? { truck_id: snapshot.truck_id } : {}),
    ...(snapshot.railcar_id ? { railcar_id: snapshot.railcar_id } : {}),
    cargo_type: snapshot.cargo_type,
    ...(snapshot.hazmat_class ? { hazmat_class: snapshot.hazmat_class } : {}),
    ...(snapshot.container_weight_kg !== undefined ? { container_weight_kg: snapshot.container_weight_kg } : {}),
    vgm_verified: snapshot.vgm_verified,
    customs_hold: snapshot.customs_hold,
    security_hold: snapshot.security_hold,
    inspection_hold: snapshot.inspection_hold,
    ...(snapshot.release_order_id ? { release_order_id: snapshot.release_order_id } : {}),
    ...(snapshot.booking_id ? { booking_id: snapshot.booking_id } : {}),
    ...(snapshot.bill_of_lading ? { bill_of_lading: snapshot.bill_of_lading } : {}),
    pnt_confidence: snapshot.pnt_confidence,
    ...(snapshot.ais_track_age_ms !== undefined ? { ais_track_age_ms: snapshot.ais_track_age_ms } : {}),
    vessel_clearance_granted: snapshot.vessel_clearance_granted,
    berth_conflict_present: snapshot.berth_conflict_present,
    ...(snapshot.wind_speed_kn !== undefined ? { wind_speed_kn: snapshot.wind_speed_kn } : {}),
    tide_window_open: snapshot.tide_window_open,
    crane_exclusion_zone_clear: snapshot.crane_exclusion_zone_clear,
    ...(snapshot.twistlock_state ? { twistlock_state: snapshot.twistlock_state } : {}),
    spreader_locked: snapshot.spreader_locked,
    ...(snapshot.reefer_temperature_c !== undefined ? { reefer_temperature_c: snapshot.reefer_temperature_c } : {}),
    ...(snapshot.reefer_setpoint_c !== undefined ? { reefer_setpoint_c: snapshot.reefer_setpoint_c } : {}),
    cold_chain_valid: snapshot.cold_chain_valid,
    shore_power_lockout_released: snapshot.shore_power_lockout_released,
    shore_power_isolated: snapshot.shore_power_isolated,
    fire_watch_ready: snapshot.fire_watch_ready,
    hazmat_route_approved: snapshot.hazmat_route_approved,
    truck_appointment_valid: snapshot.truck_appointment_valid,
    driver_identity_verified: snapshot.driver_identity_verified,
    gate_access_granted: snapshot.gate_access_granted,
    terminal_network_zone: snapshot.terminal_network_zone,
    vendor_remote_session: snapshot.vendor_remote_session,
    ot_telemetry_age_ms: snapshot.ot_telemetry_age_ms,
    ...(snapshot.tos_transaction_id ? { tos_transaction_id: snapshot.tos_transaction_id } : {}),
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {}),
    manual_fallback_ready: snapshot.manual_fallback_ready
  };
}

function portAction(
  ctx: PortActionContext,
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

export function tosContainerReleaseToAction(input: TosContainerReleaseRequest, ctx: PortActionContext): CanonicalActionInput {
  return portAction(ctx, input.action_type ?? "tos.container.release", `${input.container_id}:${input.release_order_id}`, {
    adapter: "terminal-operating-system",
    container_id: input.container_id,
    release_order_id: input.release_order_id,
    ...(input.consignee_id ? { consignee_id: input.consignee_id } : {})
  });
}

export function ediManifestToAction(input: EdiManifestRequest, ctx: PortActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "publish-release-notice" ? "pcs.release-notice.publish" : "edi.manifest.submit");
  return portAction(ctx, actionType, `${input.carrier_id}:${input.manifest_id}:${input.operation}`, {
    adapter: "port-community-system",
    manifest_id: input.manifest_id,
    carrier_id: input.carrier_id,
    operation: input.operation
  });
}

export function customsHoldToAction(input: CustomsHoldRequest, ctx: PortActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "release" ? "customs.hold.release" : `customs.hold.${slug(input.operation)}`);
  return portAction(ctx, actionType, `${input.container_id}:${input.hold_id}:${input.operation}`, {
    adapter: "customs-hold",
    hold_id: input.hold_id,
    container_id: input.container_id,
    operation: input.operation,
    ...(input.authority_reference ? { authority_reference: input.authority_reference } : {})
  });
}

export function vtsBerthClearanceToAction(input: VtsBerthClearanceRequest, ctx: PortActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "attest-track" ? "ais.track.attest" : "vts.berth.clearance");
  return portAction(ctx, actionType, `${input.vessel_imo}:${input.berth_id}:${input.clearance_id}`, {
    adapter: "vts-ais-pnt",
    clearance_id: input.clearance_id,
    vessel_imo: input.vessel_imo,
    berth_id: input.berth_id,
    operation: input.operation
  });
}

export function craneMoveToAction(input: CraneMoveRequest, ctx: PortActionContext): CanonicalActionInput {
  return portAction(ctx, input.action_type ?? "crane.move.request", `${input.crane_id}:${input.move_id}:${input.container_id}`, {
    adapter: "crane-automation",
    crane_id: input.crane_id,
    equipment_id: input.crane_id,
    move_id: input.move_id,
    container_id: input.container_id,
    from_slot: input.from_slot,
    to_slot: input.to_slot
  });
}

export function gateAccessToAction(input: GateAccessRequest, ctx: PortActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? `gate.access.${slug(input.operation)}`;
  return portAction(ctx, actionType, `${input.gate_id}:${input.truck_id}:${input.appointment_id}`, {
    adapter: "gate-ocr-access",
    gate_id: input.gate_id,
    truck_id: input.truck_id,
    appointment_id: input.appointment_id,
    operation: input.operation
  });
}

export function yardMoveToAction(input: YardMoveRequest, ctx: PortActionContext): CanonicalActionInput {
  return portAction(ctx, input.action_type ?? "yard.move.authorize", `${input.equipment_id}:${input.container_id}:${input.from_block}-${input.to_block}`, {
    adapter: "yard-tractor-automation",
    move_id: input.move_id,
    equipment_id: input.equipment_id,
    container_id: input.container_id,
    from_block: input.from_block,
    to_block: input.to_block,
    yard_block_id: input.to_block
  });
}

export function reeferSetpointToAction(input: ReeferSetpointRequest, ctx: PortActionContext): CanonicalActionInput {
  return portAction(ctx, input.action_type ?? "reefer.setpoint.update", `${input.container_id}:${input.setpoint_c}`, {
    adapter: "reefer-monitoring",
    container_id: input.container_id,
    operation: input.operation ?? "update-setpoint",
    reefer_setpoint_c: input.setpoint_c
  });
}

export function weighbridgeVgmToAction(input: WeighbridgeVgmRequest, ctx: PortActionContext): CanonicalActionInput {
  return portAction(ctx, input.action_type ?? "weighbridge.vgm.verify", `${input.container_id}:${input.weigh_ticket_id}`, {
    adapter: "weighbridge-vgm",
    weigh_ticket_id: input.weigh_ticket_id,
    container_id: input.container_id,
    container_weight_kg: input.weight_kg,
    vgm_verified: true
  });
}

export function shorePowerToAction(input: ShorePowerRequest, ctx: PortActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? `shore-power.${slug(input.operation)}.request`;
  return portAction(ctx, actionType, `${input.berth_id}:${input.vessel_imo}:${input.operation}`, {
    adapter: "shore-power",
    berth_id: input.berth_id,
    vessel_imo: input.vessel_imo,
    operation: input.operation
  });
}

export function bunkeringHazmatToAction(input: BunkeringHazmatRequest, ctx: PortActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "authorize-bunkering" ? "bunkering.operation.authorize" : "hazmat.route.authorize");
  return portAction(ctx, actionType, `${input.operation_id}:${input.operation}`, {
    adapter: "bunkering-hazmat",
    operation_id: input.operation_id,
    operation: input.operation,
    ...(input.hazmat_class ? { hazmat_class: input.hazmat_class } : {})
  });
}

export function portAdapterToAction(input: PortAdapterRequest, ctx: PortActionContext): CanonicalActionInput {
  if (input.kind === "terminal-operating-system") return tosContainerReleaseToAction(input.request, ctx);
  if (input.kind === "port-community-system") return ediManifestToAction(input.request, ctx);
  if (input.kind === "customs-hold") return customsHoldToAction(input.request, ctx);
  if (input.kind === "vts-ais-pnt") return vtsBerthClearanceToAction(input.request, ctx);
  if (input.kind === "crane-automation") return craneMoveToAction(input.request, ctx);
  if (input.kind === "gate-ocr-access") return gateAccessToAction(input.request, ctx);
  if (input.kind === "yard-tractor-automation") return yardMoveToAction(input.request, ctx);
  if (input.kind === "reefer-monitoring") return reeferSetpointToAction(input.request, ctx);
  if (input.kind === "weighbridge-vgm") return weighbridgeVgmToAction(input.request, ctx);
  if (input.kind === "shore-power") return shorePowerToAction(input.request, ctx);
  return bunkeringHazmatToAction(input.request, ctx);
}

export function portSnapshotToRuntimeRegister(snapshot: PortRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluatePortSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function portBundleHash(input: Omit<PortEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<PortEvidenceBundle["hashes"], "port_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportPortEvidenceBundle(input: ExportEvidenceBundleInput & { port: PortEvidenceContext }): PortEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.port-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    port: JSON.parse(stableStringify(input.port)) as PortEvidenceContext,
    execution_bundle
  };
  const hashes = {
    port_context_hash: sha256(stableStringify(partial.port)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    port_bundle_hash: ""
  };
  hashes.port_bundle_hash = portBundleHash({
    ...partial,
    hashes: {
      port_context_hash: hashes.port_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: PortEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyPortEvidenceBundle(draft) };
}

export function verifyPortEvidenceBundle(bundle: PortEvidenceBundle): PortEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.port-evidence.v1") failures.push("unsupported port evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.port));
  if (contextHash !== bundle.hashes.port_context_hash) failures.push("port context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = portBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    port: bundle.port,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      port_context_hash: bundle.hashes.port_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.port_bundle_hash) failures.push("port bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
