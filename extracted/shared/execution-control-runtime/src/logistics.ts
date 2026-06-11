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
 * Trucking and logistics readiness primitives.
 *
 * These adapters do not replace TMS, WMS, YMS, ELD, telematics, broker, carrier,
 * customs, payment, or maintenance systems. They translate proposed freight
 * operations into Canonical Governed Actions so AristotleOS can bind authority
 * before dispatch, route, cargo release, fuel, accessorial, or payment consequence.
 */

export type LogisticsDomain =
  | "truckload-fleet"
  | "less-than-truckload"
  | "freight-brokerage"
  | "private-fleet"
  | "third-party-logistics"
  | "cold-chain"
  | "hazmat-logistics"
  | "drayage"
  | "cross-border"
  | "warehouse-distribution"
  | "final-mile";

export type LogisticsAdapterKind =
  | "tms-dispatch"
  | "load-tender"
  | "carrier-vetting"
  | "eld-hos"
  | "telematics-route"
  | "wms-release"
  | "yms-dock-gate"
  | "fuel-card-advance"
  | "accessorial-payment"
  | "cold-chain-monitoring"
  | "hazmat-routing"
  | "maintenance-dvir"
  | "customs-cross-border";

export interface LogisticsAdapterDescriptor {
  kind: LogisticsAdapterKind;
  label: string;
  consequenceBoundary: string;
  actionExamples: string[];
  requiredRuntimeRegisters: string[];
}

export const LOGISTICS_ADAPTER_CATALOG: LogisticsAdapterDescriptor[] = [
  {
    kind: "tms-dispatch",
    label: "TMS Dispatch Boundary",
    consequenceBoundary: "Load dispatch, driver assignment, tractor/trailer assignment, appointment commitment, and trip start",
    actionExamples: ["tms.load.dispatch", "tms.trip.assign"],
    requiredRuntimeRegisters: ["telemetry.load_id", "telemetry.driver_id", "telemetry.remaining_drive_minutes", "telemetry.eld_event_age_ms"]
  },
  {
    kind: "load-tender",
    label: "Broker / Carrier Tender Boundary",
    consequenceBoundary: "Tender acceptance, carrier handoff, rate confirmation, and double-broker risk decisions",
    actionExamples: ["broker.load.tender", "carrier.load.accept"],
    requiredRuntimeRegisters: ["telemetry.carrier_id", "telemetry.carrier_authority_active", "telemetry.carrier_insurance_valid", "telemetry.double_broker_risk_score"]
  },
  {
    kind: "carrier-vetting",
    label: "Carrier and Driver Qualification Boundary",
    consequenceBoundary: "Carrier onboarding, driver eligibility, CDL/medical-card validation, and equipment eligibility",
    actionExamples: ["carrier.vetting.approve", "driver.qualification.attest"],
    requiredRuntimeRegisters: ["telemetry.carrier_authority_active", "telemetry.driver_qualified", "telemetry.medical_card_valid"]
  },
  {
    kind: "eld-hos",
    label: "ELD / Hours-of-Service Boundary",
    consequenceBoundary: "HOS attestation, duty status, dispatch eligibility, and rest-window protection",
    actionExamples: ["eld.hos.attest", "hos.dispatch.clear"],
    requiredRuntimeRegisters: ["telemetry.hos_available", "telemetry.remaining_drive_minutes", "telemetry.remaining_duty_minutes", "telemetry.eld_fresh"]
  },
  {
    kind: "telematics-route",
    label: "Telematics / Route Boundary",
    consequenceBoundary: "Reroute, geofence exception, route deviation, restricted-area entry, and GPS/telematics attestation",
    actionExamples: ["route.reroute.authorize", "telematics.location.attest"],
    requiredRuntimeRegisters: ["telemetry.route_id", "telemetry.route_permitted", "telemetry.restricted_area_clear", "telemetry.telematics_age_ms"]
  },
  {
    kind: "wms-release",
    label: "WMS Cargo Release Boundary",
    consequenceBoundary: "Warehouse cargo release, pick/pack/ship release, seal assignment, and customer release material",
    actionExamples: ["wms.cargo.release", "warehouse.shipment.release"],
    requiredRuntimeRegisters: ["telemetry.shipment_id", "telemetry.trailer_seal_intact", "telemetry.cargo_secured", "telemetry.appointment_valid"]
  },
  {
    kind: "yms-dock-gate",
    label: "YMS Dock / Gate Boundary",
    consequenceBoundary: "Dock assignment, yard gate access, trailer drop/hook, and facility perimeter movement",
    actionExamples: ["yms.dock.assign", "yard.gate.release"],
    requiredRuntimeRegisters: ["telemetry.origin_facility_id", "telemetry.appointment_valid", "telemetry.dock_available", "telemetry.yard_gate_access_granted"]
  },
  {
    kind: "fuel-card-advance",
    label: "Fuel Card / Advance Boundary",
    consequenceBoundary: "Fuel advance, fuel-card enablement, card-limit mutation, and cash-equivalent carrier support",
    actionExamples: ["fuel.advance.authorize", "fuel.card.limit.set"],
    requiredRuntimeRegisters: ["telemetry.fuel_card_active", "telemetry.fuel_advance_usd", "telemetry.fraud_score"]
  },
  {
    kind: "accessorial-payment",
    label: "Accessorial / Payment Boundary",
    consequenceBoundary: "Detention, lumper, TONU, accessorial approval, POD acceptance, and carrier payment release",
    actionExamples: ["accessorial.approve", "payment.carrier.release"],
    requiredRuntimeRegisters: ["telemetry.pod_verified", "telemetry.accessorial_amount_usd", "telemetry.fraud_score"]
  },
  {
    kind: "cold-chain-monitoring",
    label: "Cold Chain Boundary",
    consequenceBoundary: "Reefer setpoint, temperature alarm acknowledgement, cold-chain exception, and pharma/food integrity decisions",
    actionExamples: ["coldchain.setpoint.update", "coldchain.alarm.ack"],
    requiredRuntimeRegisters: ["telemetry.cargo_temperature_c", "telemetry.temperature_in_range", "telemetry.telematics_age_ms"]
  },
  {
    kind: "hazmat-routing",
    label: "Hazmat Routing Boundary",
    consequenceBoundary: "Hazmat route authorization, placarding, tunnel/bridge exclusion, endorsement, and restricted-area clearance",
    actionExamples: ["hazmat.route.authorize", "hazmat.placard.attest"],
    requiredRuntimeRegisters: ["telemetry.hazmat_class", "telemetry.hazmat_endorsement_valid", "telemetry.route_permitted", "telemetry.restricted_area_clear"]
  },
  {
    kind: "maintenance-dvir",
    label: "Maintenance / DVIR Boundary",
    consequenceBoundary: "Vehicle release, DVIR clearance, maintenance hold release, and out-of-service recovery",
    actionExamples: ["dvir.vehicle.release", "maintenance.hold.release"],
    requiredRuntimeRegisters: ["telemetry.dvir_clear", "telemetry.vehicle_maintenance_clear", "telemetry.tractor_id", "telemetry.trailer_id"]
  },
  {
    kind: "customs-cross-border",
    label: "Customs / Cross-Border Boundary",
    consequenceBoundary: "Cross-border dispatch, customs entry submission, bond handoff, and customs-clearance-dependent movement",
    actionExamples: ["customs.entry.submit", "crossborder.dispatch.authorize"],
    requiredRuntimeRegisters: ["telemetry.customs_clearance_present", "telemetry.route_permitted", "telemetry.carrier_authority_active"]
  }
];

export interface LogisticsRuntimeSnapshot {
  logistics_network_id: string;
  operations_center: string;
  load_id: string;
  shipment_id: string;
  trip_id: string;
  carrier_id: string;
  broker_id?: string;
  shipper_id: string;
  customer_id?: string;
  driver_id: string;
  tractor_id: string;
  trailer_id: string;
  trailer_type: "dry-van" | "reefer" | "flatbed" | "tanker" | "intermodal" | "box-truck" | string;
  cargo_class: "general" | "reefer" | "hazmat" | "high-value" | "pharma" | "food" | string;
  commodity: string;
  hazmat_class?: string;
  cargo_value_usd?: number;
  gross_weight_lbs?: number;
  origin_facility_id: string;
  destination_facility_id: string;
  current_facility_id?: string;
  route_id: string;
  geofence_id?: string;
  route_permitted: boolean;
  restricted_area_clear: boolean;
  route_deviation_km: number;
  weather_risk?: "low" | "moderate" | "high" | "critical" | string;
  remaining_drive_minutes: number;
  remaining_duty_minutes: number;
  required_drive_minutes: number;
  hos_available: boolean;
  eld_fresh: boolean;
  eld_event_age_ms: number;
  cdl_class: string;
  driver_qualified: boolean;
  medical_card_valid: boolean;
  hazmat_endorsement_valid: boolean;
  carrier_authority_active: boolean;
  carrier_insurance_valid: boolean;
  broker_authority_active: boolean;
  vehicle_maintenance_clear: boolean;
  dvir_clear: boolean;
  trailer_seal_intact: boolean;
  cargo_secured: boolean;
  cargo_temperature_c?: number;
  reefer_setpoint_c?: number;
  temperature_in_range: boolean;
  customs_clearance_present: boolean;
  appointment_valid: boolean;
  dock_available: boolean;
  yard_gate_access_granted: boolean;
  fuel_card_active: boolean;
  fuel_advance_usd?: number;
  accessorial_amount_usd?: number;
  pod_verified: boolean;
  fraud_score: number;
  double_broker_risk_score: number;
  double_broker_flag: boolean;
  telematics_age_ms: number;
  dispatcher_id?: string;
  operator_id?: string;
  manual_fallback_ready: boolean;
  policy_version?: string;
  metadata?: Record<string, JsonValue>;
}

export interface LogisticsActionContext {
  action_id: string;
  ward_id: string;
  subject: string;
  requested_at: string;
  request_id?: string;
  snapshot: LogisticsRuntimeSnapshot;
  telemetry?: Record<string, JsonValue>;
  classification?: CanonicalActionInput["classification"];
}

export interface TmsDispatchRequest {
  load_id: string;
  trip_id: string;
  driver_id: string;
  tractor_id: string;
  trailer_id: string;
  action_type?: string;
}

export interface LoadTenderRequest {
  load_id: string;
  carrier_id: string;
  rate_usd: number;
  operation: "tender" | "accept" | "reject" | string;
  action_type?: string;
}

export interface CarrierVettingRequest {
  carrier_id: string;
  driver_id?: string;
  operation: "approve" | "attest" | "hold" | string;
  action_type?: string;
}

export interface EldHosRequest {
  driver_id: string;
  status: "available" | "unavailable" | "rest-required" | string;
  remaining_drive_minutes: number;
  action_type?: string;
}

export interface RouteAuthorizationRequest {
  load_id: string;
  route_id: string;
  operation: "authorize" | "reroute" | "hold" | string;
  action_type?: string;
}

export interface WmsReleaseRequest {
  shipment_id: string;
  release_order_id: string;
  action_type?: string;
}

export interface YmsDockGateRequest {
  facility_id: string;
  dock_id: string;
  operation: "assign-dock" | "release-gate" | "hold" | string;
  action_type?: string;
}

export interface FuelAdvanceRequest {
  load_id: string;
  amount_usd: number;
  card_id?: string;
  action_type?: string;
}

export interface AccessorialPaymentRequest {
  load_id: string;
  amount_usd: number;
  reason: "detention" | "lumper" | "tonu" | "layover" | "payment-release" | string;
  action_type?: string;
}

export interface ColdChainRequest {
  shipment_id: string;
  setpoint_c?: number;
  operation: "update-setpoint" | "ack-alarm" | "hold" | string;
  action_type?: string;
}

export interface HazmatRouteRequest {
  load_id: string;
  hazmat_class: string;
  operation: "authorize-route" | "attest-placard" | "hold" | string;
  action_type?: string;
}

export interface DvirReleaseRequest {
  tractor_id: string;
  trailer_id: string;
  dvir_id: string;
  operation: "release" | "hold" | string;
  action_type?: string;
}

export interface CustomsCrossBorderRequest {
  shipment_id: string;
  entry_id: string;
  operation: "submit-entry" | "authorize-crossing" | "hold" | string;
  action_type?: string;
}

export type LogisticsAdapterRequest =
  | { kind: "tms-dispatch"; request: TmsDispatchRequest }
  | { kind: "load-tender"; request: LoadTenderRequest }
  | { kind: "carrier-vetting"; request: CarrierVettingRequest }
  | { kind: "eld-hos"; request: EldHosRequest }
  | { kind: "telematics-route"; request: RouteAuthorizationRequest }
  | { kind: "wms-release"; request: WmsReleaseRequest }
  | { kind: "yms-dock-gate"; request: YmsDockGateRequest }
  | { kind: "fuel-card-advance"; request: FuelAdvanceRequest }
  | { kind: "accessorial-payment"; request: AccessorialPaymentRequest }
  | { kind: "cold-chain-monitoring"; request: ColdChainRequest }
  | { kind: "hazmat-routing"; request: HazmatRouteRequest }
  | { kind: "maintenance-dvir"; request: DvirReleaseRequest }
  | { kind: "customs-cross-border"; request: CustomsCrossBorderRequest };

export interface LogisticsEvidenceContext {
  logistics_network_id: string;
  operations_center: string;
  logistics_domain: LogisticsDomain;
  load_id: string;
  shipment_id: string;
  trip_id: string;
  carrier_id: string;
  broker_id?: string;
  shipper_id: string;
  driver_id: string;
  tractor_id: string;
  trailer_id: string;
  route_id: string;
  origin_facility_id: string;
  destination_facility_id: string;
  cargo_profile: {
    cargo_class: string;
    commodity: string;
    hazmat_class?: string;
    temperature_controlled?: boolean;
    cargo_value_usd?: number;
    gross_weight_lbs?: number;
  };
  compliance_profile: Array<"FMCSA_HOS" | "ELD" | "DOT_SAFETY" | "HAZMAT_49_CFR" | "FSMA_SANITARY_TRANSPORT" | "CTPAT" | "CUSTOMS" | "NIST_CSF" | "LOCAL_SOP">;
  pre_checks: Array<{ name: string; ok: boolean; detail?: string }>;
  post_checks?: Array<{ name: string; ok: boolean; detail?: string }>;
  redacted_fields?: string[];
  retained_fields?: string[];
}

export interface LogisticsEvidenceBundle {
  bundle_version: "aristotle.logistics-evidence.v1";
  exported_at: string;
  logistics: LogisticsEvidenceContext;
  execution_bundle: EvidenceBundle;
  hashes: {
    logistics_context_hash: string;
    execution_bundle_hash: string;
    logistics_bundle_hash: string;
  };
  verification: { ok: boolean; failures: string[]; execution_bundle_ok: boolean };
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function snapshotParams(snapshot: LogisticsRuntimeSnapshot): Record<string, JsonValue> {
  return {
    logistics_network_id: snapshot.logistics_network_id,
    operations_center: snapshot.operations_center,
    load_id: snapshot.load_id,
    shipment_id: snapshot.shipment_id,
    trip_id: snapshot.trip_id,
    carrier_id: snapshot.carrier_id,
    ...(snapshot.broker_id ? { broker_id: snapshot.broker_id } : {}),
    shipper_id: snapshot.shipper_id,
    ...(snapshot.customer_id ? { customer_id: snapshot.customer_id } : {}),
    driver_id: snapshot.driver_id,
    tractor_id: snapshot.tractor_id,
    trailer_id: snapshot.trailer_id,
    trailer_type: snapshot.trailer_type,
    cargo_class: snapshot.cargo_class,
    cargo_type: snapshot.cargo_class,
    commodity: snapshot.commodity,
    ...(snapshot.hazmat_class ? { hazmat_class: snapshot.hazmat_class } : {}),
    ...(snapshot.cargo_value_usd !== undefined ? { cargo_value_usd: snapshot.cargo_value_usd } : {}),
    ...(snapshot.gross_weight_lbs !== undefined ? { gross_weight_lbs: snapshot.gross_weight_lbs } : {}),
    origin_facility_id: snapshot.origin_facility_id,
    destination_facility_id: snapshot.destination_facility_id,
    ...(snapshot.current_facility_id ? { current_facility_id: snapshot.current_facility_id } : {}),
    route_id: snapshot.route_id,
    ...(snapshot.geofence_id ? { geofence_id: snapshot.geofence_id } : {}),
    route_permitted: snapshot.route_permitted,
    restricted_area_clear: snapshot.restricted_area_clear,
    route_deviation_km: snapshot.route_deviation_km,
    ...(snapshot.weather_risk ? { weather_risk: snapshot.weather_risk } : {}),
    remaining_drive_minutes: snapshot.remaining_drive_minutes,
    remaining_duty_minutes: snapshot.remaining_duty_minutes,
    required_drive_minutes: snapshot.required_drive_minutes,
    hos_available: snapshot.hos_available,
    eld_fresh: snapshot.eld_fresh,
    eld_event_age_ms: snapshot.eld_event_age_ms,
    cdl_class: snapshot.cdl_class,
    driver_qualified: snapshot.driver_qualified,
    medical_card_valid: snapshot.medical_card_valid,
    hazmat_endorsement_valid: snapshot.hazmat_endorsement_valid,
    carrier_authority_active: snapshot.carrier_authority_active,
    carrier_insurance_valid: snapshot.carrier_insurance_valid,
    broker_authority_active: snapshot.broker_authority_active,
    vehicle_maintenance_clear: snapshot.vehicle_maintenance_clear,
    dvir_clear: snapshot.dvir_clear,
    trailer_seal_intact: snapshot.trailer_seal_intact,
    cargo_secured: snapshot.cargo_secured,
    ...(snapshot.cargo_temperature_c !== undefined ? { cargo_temperature_c: snapshot.cargo_temperature_c, reefer_temperature_c: snapshot.cargo_temperature_c } : {}),
    ...(snapshot.reefer_setpoint_c !== undefined ? { reefer_setpoint_c: snapshot.reefer_setpoint_c } : {}),
    temperature_in_range: snapshot.temperature_in_range,
    customs_clearance_present: snapshot.customs_clearance_present,
    appointment_valid: snapshot.appointment_valid,
    dock_available: snapshot.dock_available,
    yard_gate_access_granted: snapshot.yard_gate_access_granted,
    fuel_card_active: snapshot.fuel_card_active,
    ...(snapshot.fuel_advance_usd !== undefined ? { fuel_advance_usd: snapshot.fuel_advance_usd } : {}),
    ...(snapshot.accessorial_amount_usd !== undefined ? { accessorial_amount_usd: snapshot.accessorial_amount_usd } : {}),
    pod_verified: snapshot.pod_verified,
    fraud_score: snapshot.fraud_score,
    double_broker_risk_score: snapshot.double_broker_risk_score,
    double_broker_flag: snapshot.double_broker_flag,
    telematics_age_ms: snapshot.telematics_age_ms,
    ...(snapshot.dispatcher_id ? { dispatcher_id: snapshot.dispatcher_id } : {}),
    ...(snapshot.operator_id ? { operator_id: snapshot.operator_id } : {}),
    manual_fallback_ready: snapshot.manual_fallback_ready
  };
}

function logisticsAction(
  ctx: LogisticsActionContext,
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

export function tmsDispatchToAction(input: TmsDispatchRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  return logisticsAction(ctx, input.action_type ?? "tms.load.dispatch", `${input.load_id}:${input.driver_id}:${input.tractor_id}:${input.trailer_id}`, {
    adapter: "tms-dispatch",
    load_id: input.load_id,
    trip_id: input.trip_id,
    driver_id: input.driver_id,
    tractor_id: input.tractor_id,
    trailer_id: input.trailer_id
  });
}

export function loadTenderToAction(input: LoadTenderRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "accept" ? "carrier.load.accept" : "broker.load.tender");
  return logisticsAction(ctx, actionType, `${input.load_id}:${input.carrier_id}:${input.operation}`, {
    adapter: "load-tender",
    load_id: input.load_id,
    carrier_id: input.carrier_id,
    rate_usd: input.rate_usd,
    operation: input.operation
  });
}

export function carrierVettingToAction(input: CarrierVettingRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "attest" ? "driver.qualification.attest" : "carrier.vetting.approve");
  return logisticsAction(ctx, actionType, `${input.carrier_id}:${input.driver_id ?? "carrier"}:${input.operation}`, {
    adapter: "carrier-vetting",
    carrier_id: input.carrier_id,
    ...(input.driver_id ? { driver_id: input.driver_id } : {}),
    operation: input.operation
  });
}

export function eldHosToAction(input: EldHosRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  return logisticsAction(ctx, input.action_type ?? "eld.hos.attest", `${input.driver_id}:${input.status}`, {
    adapter: "eld-hos",
    driver_id: input.driver_id,
    hos_status: input.status,
    remaining_drive_minutes: input.remaining_drive_minutes
  });
}

export function routeAuthorizationToAction(input: RouteAuthorizationRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "reroute" ? "route.reroute.authorize" : "route.plan.authorize");
  return logisticsAction(ctx, actionType, `${input.load_id}:${input.route_id}:${input.operation}`, {
    adapter: "telematics-route",
    load_id: input.load_id,
    route_id: input.route_id,
    operation: input.operation
  });
}

export function wmsReleaseToAction(input: WmsReleaseRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  return logisticsAction(ctx, input.action_type ?? "wms.cargo.release", `${input.shipment_id}:${input.release_order_id}`, {
    adapter: "wms-release",
    shipment_id: input.shipment_id,
    release_order_id: input.release_order_id
  });
}

export function ymsDockGateToAction(input: YmsDockGateRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "release-gate" ? "yard.gate.release" : "yms.dock.assign");
  return logisticsAction(ctx, actionType, `${input.facility_id}:${input.dock_id}:${input.operation}`, {
    adapter: "yms-dock-gate",
    facility_id: input.facility_id,
    dock_id: input.dock_id,
    operation: input.operation
  });
}

export function fuelAdvanceToAction(input: FuelAdvanceRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  return logisticsAction(ctx, input.action_type ?? "fuel.advance.authorize", `${input.load_id}:${input.amount_usd}`, {
    adapter: "fuel-card-advance",
    load_id: input.load_id,
    fuel_advance_usd: input.amount_usd,
    ...(input.card_id ? { card_id: input.card_id } : {})
  });
}

export function accessorialPaymentToAction(input: AccessorialPaymentRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.reason === "payment-release" ? "payment.carrier.release" : "accessorial.approve");
  return logisticsAction(ctx, actionType, `${input.load_id}:${input.reason}:${input.amount_usd}`, {
    adapter: "accessorial-payment",
    load_id: input.load_id,
    accessorial_amount_usd: input.amount_usd,
    reason: input.reason
  });
}

export function coldChainToAction(input: ColdChainRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "ack-alarm" ? "coldchain.alarm.ack" : "coldchain.setpoint.update");
  return logisticsAction(ctx, actionType, `${input.shipment_id}:${input.operation}`, {
    adapter: "cold-chain-monitoring",
    shipment_id: input.shipment_id,
    operation: input.operation,
    ...(input.setpoint_c !== undefined ? { reefer_setpoint_c: input.setpoint_c } : {})
  });
}

export function hazmatRouteToAction(input: HazmatRouteRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "attest-placard" ? "hazmat.placard.attest" : "hazmat.route.authorize");
  return logisticsAction(ctx, actionType, `${input.load_id}:${input.hazmat_class}:${input.operation}`, {
    adapter: "hazmat-routing",
    load_id: input.load_id,
    hazmat_class: input.hazmat_class,
    operation: input.operation
  });
}

export function dvirReleaseToAction(input: DvirReleaseRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "release" ? "dvir.vehicle.release" : "maintenance.hold.release");
  return logisticsAction(ctx, actionType, `${input.tractor_id}:${input.trailer_id}:${input.dvir_id}:${input.operation}`, {
    adapter: "maintenance-dvir",
    tractor_id: input.tractor_id,
    trailer_id: input.trailer_id,
    dvir_id: input.dvir_id,
    operation: input.operation
  });
}

export function customsCrossBorderToAction(input: CustomsCrossBorderRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  const actionType = input.action_type ?? (input.operation === "authorize-crossing" ? "crossborder.dispatch.authorize" : "customs.entry.submit");
  return logisticsAction(ctx, actionType, `${input.shipment_id}:${input.entry_id}:${input.operation}`, {
    adapter: "customs-cross-border",
    shipment_id: input.shipment_id,
    entry_id: input.entry_id,
    operation: input.operation
  });
}

export function logisticsAdapterToAction(input: LogisticsAdapterRequest, ctx: LogisticsActionContext): CanonicalActionInput {
  if (input.kind === "tms-dispatch") return tmsDispatchToAction(input.request, ctx);
  if (input.kind === "load-tender") return loadTenderToAction(input.request, ctx);
  if (input.kind === "carrier-vetting") return carrierVettingToAction(input.request, ctx);
  if (input.kind === "eld-hos") return eldHosToAction(input.request, ctx);
  if (input.kind === "telematics-route") return routeAuthorizationToAction(input.request, ctx);
  if (input.kind === "wms-release") return wmsReleaseToAction(input.request, ctx);
  if (input.kind === "yms-dock-gate") return ymsDockGateToAction(input.request, ctx);
  if (input.kind === "fuel-card-advance") return fuelAdvanceToAction(input.request, ctx);
  if (input.kind === "accessorial-payment") return accessorialPaymentToAction(input.request, ctx);
  if (input.kind === "cold-chain-monitoring") return coldChainToAction(input.request, ctx);
  if (input.kind === "hazmat-routing") return hazmatRouteToAction(input.request, ctx);
  if (input.kind === "maintenance-dvir") return dvirReleaseToAction(input.request, ctx);
  return customsCrossBorderToAction(input.request, ctx);
}

export function logisticsSnapshotToRuntimeRegister(snapshot: LogisticsRuntimeSnapshot): RuntimeRegister {
  const telemetry = snapshotParams(snapshot);
  return {
    ...(snapshot.policy_version ? { policy_version: snapshot.policy_version } : {}),
    telemetry,
    registers: telemetry
  };
}

export function evaluateLogisticsSafetyInvariants(action: CanonicalActionInput, ward: WardManifest): PhysicalInvariantResult {
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

function logisticsBundleHash(input: Omit<LogisticsEvidenceBundle, "hashes" | "verification"> & { hashes: Omit<LogisticsEvidenceBundle["hashes"], "logistics_bundle_hash"> }): string {
  return sha256(stableStringify(input));
}

export function exportLogisticsEvidenceBundle(input: ExportEvidenceBundleInput & { logistics: LogisticsEvidenceContext }): LogisticsEvidenceBundle {
  const execution_bundle = exportEvidenceBundle(input);
  const partial = {
    bundle_version: "aristotle.logistics-evidence.v1" as const,
    exported_at: input.exportedAt ?? execution_bundle.exported_at,
    logistics: JSON.parse(stableStringify(input.logistics)) as LogisticsEvidenceContext,
    execution_bundle
  };
  const hashes = {
    logistics_context_hash: sha256(stableStringify(partial.logistics)),
    execution_bundle_hash: evidenceBundleMaterialHash(execution_bundle),
    logistics_bundle_hash: ""
  };
  hashes.logistics_bundle_hash = logisticsBundleHash({
    ...partial,
    hashes: {
      logistics_context_hash: hashes.logistics_context_hash,
      execution_bundle_hash: hashes.execution_bundle_hash
    }
  });
  const draft: LogisticsEvidenceBundle = { ...partial, hashes, verification: { ok: false, failures: [], execution_bundle_ok: false } };
  return { ...draft, verification: verifyLogisticsEvidenceBundle(draft) };
}

export function verifyLogisticsEvidenceBundle(bundle: LogisticsEvidenceBundle): LogisticsEvidenceBundle["verification"] {
  const failures: string[] = [];
  if (bundle.bundle_version !== "aristotle.logistics-evidence.v1") failures.push("unsupported logistics evidence bundle version");
  const contextHash = sha256(stableStringify(bundle.logistics));
  if (contextHash !== bundle.hashes.logistics_context_hash) failures.push("logistics context hash mismatch");
  const executionHash = evidenceBundleMaterialHash(bundle.execution_bundle);
  if (executionHash !== bundle.hashes.execution_bundle_hash) failures.push("execution bundle hash mismatch");
  const executionVerification = verifyEvidenceBundle(bundle.execution_bundle);
  if (!executionVerification.ok) failures.push(`execution evidence failed: ${executionVerification.failures.join(";")}`);
  const expected = logisticsBundleHash({
    bundle_version: bundle.bundle_version,
    exported_at: bundle.exported_at,
    logistics: bundle.logistics,
    execution_bundle: bundle.execution_bundle,
    hashes: {
      logistics_context_hash: bundle.hashes.logistics_context_hash,
      execution_bundle_hash: bundle.hashes.execution_bundle_hash
    }
  });
  if (expected !== bundle.hashes.logistics_bundle_hash) failures.push("logistics bundle hash mismatch");
  return { ok: failures.length === 0, failures, execution_bundle_ok: executionVerification.ok };
}
