import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type LogisticsRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  accessorialPaymentToAction,
  carrierVettingToAction,
  coldChainToAction,
  customsCrossBorderToAction,
  dvirReleaseToAction,
  eldHosToAction,
  evaluateExecutionControl,
  evaluateLogisticsSafetyInvariants,
  exportLogisticsEvidenceBundle,
  fuelAdvanceToAction,
  hazmatRouteToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadTenderToAction,
  loadWardManifest,
  logisticsAdapterToAction,
  logisticsSnapshotToRuntimeRegister,
  routeAuthorizationToAction,
  tmsDispatchToAction,
  verifyLogisticsEvidenceBundle,
  wmsReleaseToAction,
  ymsDockGateToAction
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: LogisticsRuntimeSnapshot = {
  logistics_network_id: "west-freight-network",
  operations_center: "west-dispatch",
  load_id: "LOAD-8821",
  shipment_id: "SHP-5521",
  trip_id: "TRIP-2026-0525-77",
  carrier_id: "carrier:clearline",
  broker_id: "broker:atlas",
  shipper_id: "shipper:alpine-foods",
  customer_id: "customer:grocery-west",
  driver_id: "driver:diaz",
  tractor_id: "TRAC-4482",
  trailer_id: "TRL-9012",
  trailer_type: "reefer",
  cargo_class: "reefer",
  commodity: "frozen food",
  hazmat_class: "none",
  cargo_value_usd: 74000,
  gross_weight_lbs: 62100,
  origin_facility_id: "dc-denver",
  destination_facility_id: "store-salt-lake",
  current_facility_id: "dc-denver",
  route_id: "route-i70-west-safe",
  geofence_id: "western-corridor-a",
  route_permitted: true,
  restricted_area_clear: true,
  route_deviation_km: 1.1,
  weather_risk: "low",
  remaining_drive_minutes: 420,
  remaining_duty_minutes: 610,
  required_drive_minutes: 180,
  hos_available: true,
  eld_fresh: true,
  eld_event_age_ms: 900,
  cdl_class: "A",
  driver_qualified: true,
  medical_card_valid: true,
  hazmat_endorsement_valid: false,
  carrier_authority_active: true,
  carrier_insurance_valid: true,
  broker_authority_active: true,
  vehicle_maintenance_clear: true,
  dvir_clear: true,
  trailer_seal_intact: true,
  cargo_secured: true,
  cargo_temperature_c: -18,
  reefer_setpoint_c: -18,
  temperature_in_range: true,
  customs_clearance_present: false,
  appointment_valid: true,
  dock_available: true,
  yard_gate_access_granted: true,
  fuel_card_active: true,
  fuel_advance_usd: 300,
  accessorial_amount_usd: 0,
  pod_verified: false,
  fraud_score: 0.08,
  double_broker_risk_score: 0.04,
  double_broker_flag: false,
  telematics_age_ms: 1400,
  dispatcher_id: "dispatcher:west-desk",
  operator_id: "operator:logistics-supervisor",
  manual_fallback_ready: true,
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-logistics-network-west",
  name: "West Freight Network Operations",
  sovereignty_context: "shipper-carrier-broker-network-west",
  authority_domain: "trucking-logistics-dispatch",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:logistics-dispatch-orchestrator"],
  physical_bounds: {
    permitted_logistics_network_id: "west-freight-network",
    permitted_logistics_facility_ids: ["dc-denver", "store-salt-lake", "yard-denver"],
    permitted_route_ids: ["route-i70-west-safe", "route-i25-north-safe"],
    permitted_geofence_ids: ["western-corridor-a"],
    permitted_carrier_ids: ["carrier:clearline"],
    permitted_driver_ids: ["driver:diaz"],
    permitted_cargo_classes: ["reefer", "general", "hazmat"],
    permitted_logistics_hazmat_classes: ["none", "3", "8"],
    permitted_trailer_types: ["reefer", "dry-van"],
    permitted_cdl_classes: ["A"],
    max_gross_weight_lbs: 80000,
    max_cargo_value_usd: 250000,
    max_fuel_advance_usd: 750,
    max_accessorial_amount_usd: 1200,
    max_fraud_score: 0.35,
    max_double_broker_risk_score: 0.2,
    max_eld_event_age_ms: 300000,
    max_telematics_age_ms: 120000,
    max_route_deviation_km: 5,
    min_remaining_drive_minutes: 120,
    min_remaining_duty_minutes: 240,
    min_reefer_temp_c: -25,
    max_reefer_temp_c: 8,
    require_driver_qualified: true,
    require_medical_card_valid: true,
    require_carrier_authority_active: true,
    require_carrier_insurance_valid: true,
    require_broker_authority_active: true,
    require_hos_available: true,
    require_eld_fresh: true,
    require_route_permitted: true,
    require_restricted_area_clear: true,
    require_vehicle_maintenance_clear: true,
    require_dvir_clear: true,
    require_trailer_seal_intact: true,
    require_cargo_secured: true,
    require_temperature_in_range: true,
    require_logistics_hazmat_endorsement: true,
    require_logistics_appointment_valid: true,
    require_dock_available: true,
    require_yard_gate_access: true,
    require_fuel_card_active: true,
    require_manual_fallback_ready: true,
    require_logistics_dispatcher_identity: true,
    require_operator_identity: true,
    require_no_double_broker_risk: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["LOGISTICS_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-logistics-dispatch-001",
  ward_id: ward.ward_id,
  subject: "agent:logistics-dispatch-orchestrator",
  allowed_actions: [
    "tms.load.dispatch",
    "tms.trip.assign",
    "broker.load.tender",
    "carrier.load.accept",
    "carrier.vetting.approve",
    "driver.qualification.attest",
    "eld.hos.attest",
    "hos.dispatch.clear",
    "route.plan.authorize",
    "route.reroute.authorize",
    "telematics.location.attest",
    "wms.cargo.release",
    "warehouse.shipment.release",
    "yms.dock.assign",
    "yard.gate.release",
    "fuel.advance.authorize",
    "fuel.card.limit.set",
    "accessorial.approve",
    "payment.carrier.release",
    "coldchain.setpoint.update",
    "coldchain.alarm.ack",
    "hazmat.route.authorize",
    "hazmat.placard.attest",
    "dvir.vehicle.release",
    "maintenance.hold.release",
    "customs.entry.submit",
    "crossborder.dispatch.authorize"
  ],
  denied_actions: [
    "logistics.dispatch_over_hos",
    "eld.disable",
    "carrier.vetting.override",
    "driver.qualification.override",
    "hazmat.route.override",
    "coldchain.temp_alarm.override",
    "pod.force_accept",
    "payment.force_release",
    "fuel.unbounded_advance",
    "yard.force_gate_open",
    "load.double_broker.override",
    "telematics.spoof_override"
  ],
  constraints: {
    required_runtime_registers: [
      "telemetry.load_id",
      "telemetry.driver_id",
      "telemetry.carrier_id",
      "telemetry.remaining_drive_minutes",
      "telemetry.remaining_duty_minutes",
      "telemetry.required_drive_minutes",
      "telemetry.eld_event_age_ms",
      "telemetry.eld_fresh",
      "telemetry.hos_available",
      "telemetry.carrier_authority_active",
      "telemetry.carrier_insurance_valid",
      "telemetry.driver_qualified",
      "telemetry.medical_card_valid",
      "telemetry.route_permitted",
      "telemetry.restricted_area_clear",
      "telemetry.vehicle_maintenance_clear",
      "telemetry.dvir_clear",
      "telemetry.trailer_seal_intact",
      "telemetry.cargo_secured",
      "telemetry.temperature_in_range",
      "telemetry.appointment_valid",
      "telemetry.dock_available",
      "telemetry.yard_gate_access_granted",
      "telemetry.fraud_score",
      "telemetry.double_broker_risk_score",
      "telemetry.double_broker_flag",
      "telemetry.telematics_age_ms",
      "telemetry.dispatcher_id",
      "telemetry.manual_fallback_ready",
      "telemetry.operator_id"
    ],
    dual_control: { actions: ["broker.load.tender", "fuel.advance.authorize", "payment.carrier.release", "hazmat.route.authorize", "coldchain.setpoint.update"], required: 2, ttl_ms: 900000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-logistics-root",
  classification: { level: "CUI", caveats: ["LOGISTICS_OPS"] }
};

const ctx = {
  action_id: "act-logistics-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-logistics-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["LOGISTICS_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-logistics-")), "gel.jsonl");
}

test("logistics adapter builders produce Canonical Governed Actions", () => {
  const dispatch = tmsDispatchToAction({ load_id: "LOAD-8821", trip_id: "TRIP-1", driver_id: "driver:diaz", tractor_id: "TRAC-4482", trailer_id: "TRL-9012" }, ctx);
  assert.equal(dispatch.action_type, "tms.load.dispatch");
  assert.equal(dispatch.params.adapter, "tms-dispatch");

  const tender = loadTenderToAction({ load_id: "LOAD-8821", carrier_id: "carrier:clearline", rate_usd: 2850, operation: "tender" }, { ...ctx, action_id: "act-logistics-002" });
  assert.equal(tender.action_type, "broker.load.tender");

  const vetting = carrierVettingToAction({ carrier_id: "carrier:clearline", driver_id: "driver:diaz", operation: "approve" }, { ...ctx, action_id: "act-logistics-003" });
  assert.equal(vetting.action_type, "carrier.vetting.approve");

  const eld = eldHosToAction({ driver_id: "driver:diaz", status: "available", remaining_drive_minutes: 420 }, { ...ctx, action_id: "act-logistics-004" });
  assert.equal(eld.action_type, "eld.hos.attest");

  const route = logisticsAdapterToAction({ kind: "telematics-route", request: { load_id: "LOAD-8821", route_id: "route-i70-west-safe", operation: "reroute" } }, { ...ctx, action_id: "act-logistics-005" });
  assert.equal(route.action_type, "route.reroute.authorize");

  const wms = wmsReleaseToAction({ shipment_id: "SHP-5521", release_order_id: "REL-1" }, { ...ctx, action_id: "act-logistics-006" });
  assert.equal(wms.action_type, "wms.cargo.release");

  const yms = ymsDockGateToAction({ facility_id: "dc-denver", dock_id: "D-12", operation: "assign-dock" }, { ...ctx, action_id: "act-logistics-007" });
  assert.equal(yms.action_type, "yms.dock.assign");

  const fuel = fuelAdvanceToAction({ load_id: "LOAD-8821", amount_usd: 300 }, { ...ctx, action_id: "act-logistics-008" });
  assert.equal(fuel.action_type, "fuel.advance.authorize");

  const accessorial = accessorialPaymentToAction({ load_id: "LOAD-8821", amount_usd: 450, reason: "detention" }, { ...ctx, action_id: "act-logistics-009" });
  assert.equal(accessorial.action_type, "accessorial.approve");

  const cold = coldChainToAction({ shipment_id: "SHP-5521", setpoint_c: -18, operation: "update-setpoint" }, { ...ctx, action_id: "act-logistics-010" });
  assert.equal(cold.action_type, "coldchain.setpoint.update");

  const hazmat = hazmatRouteToAction({ load_id: "LOAD-HZ-1", hazmat_class: "3", operation: "authorize-route" }, { ...ctx, action_id: "act-logistics-011", snapshot: { ...snapshot, cargo_class: "hazmat", hazmat_class: "3", hazmat_endorsement_valid: true } });
  assert.equal(hazmat.action_type, "hazmat.route.authorize");

  const dvir = dvirReleaseToAction({ tractor_id: "TRAC-4482", trailer_id: "TRL-9012", dvir_id: "DVIR-1", operation: "release" }, { ...ctx, action_id: "act-logistics-012" });
  assert.equal(dvir.action_type, "dvir.vehicle.release");

  const customs = customsCrossBorderToAction({ shipment_id: "SHP-5521", entry_id: "CBP-1", operation: "submit-entry" }, { ...ctx, action_id: "act-logistics-013" });
  assert.equal(customs.action_type, "customs.entry.submit");
});

test("sample logistics Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "logistics");
  const sampleWard = loadWardManifest(path.join(base, "ward.network_west.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.dispatch_orchestrator.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "allow_load_dispatch.json"));
  const hosOverrun = loadCanonicalAction(path.join(base, "actions", "refuse_hos_overrun.json"));
  const missing = loadCanonicalAction(path.join(base, "actions", "escalate_missing_eld_state.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const blockedHos = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: hosOverrun, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedHos.decision, "REFUSE");
  assert.ok(blockedHos.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));

  const escalated = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: missing, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(escalated.decision, "ESCALATE");
  assert.ok(escalated.reason_codes.includes("RUNTIME_STATE_MISSING"));
});

test("logistics hard interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "payment.force_release"], denied_actions: [] };
  const action = accessorialPaymentToAction(
    { load_id: "LOAD-8821", amount_usd: 450, reason: "payment-release", action_type: "payment.force_release" },
    { ...ctx, action_id: "act-logistics-hard-payment-001" }
  );
  const directPig = evaluateLogisticsSafetyInvariants(action, ward);
  assert.equal(directPig.ok, false);
  assert.ok(directPig.detail.includes("hard logistics"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control logistics fuel actions fail closed without an approval store", () => {
  const action = fuelAdvanceToAction({ load_id: "LOAD-8821", amount_usd: 300, card_id: "FUEL-112" }, { ...ctx, action_id: "act-logistics-fuel-dual-001" });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control logistics fuel actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = fuelAdvanceToAction({ load_id: "LOAD-8821", amount_usd: 300, card_id: "FUEL-112" }, { ...ctx, action_id: "act-logistics-fuel-dual-002" });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "dispatch:supervisor-west", "approve", "fuel advance within route plan and fraud limit", now);
  approvalStore.vote(pending.request_id, "finance:carrier-pay-west", "approve", "carrier and payment controls verified", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("logistics evidence bundle wraps execution evidence with load context", () => {
  const action = tmsDispatchToAction({ load_id: "LOAD-8821", trip_id: "TRIP-2026-0525-77", driver_id: "driver:diaz", tractor_id: "TRAC-4482", trailer_id: "TRL-9012" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: logisticsSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportLogisticsEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    logistics: {
      logistics_network_id: "west-freight-network",
      operations_center: "west-dispatch",
      logistics_domain: "cold-chain",
      load_id: "LOAD-8821",
      shipment_id: "SHP-5521",
      trip_id: "TRIP-2026-0525-77",
      carrier_id: "carrier:clearline",
      broker_id: "broker:atlas",
      shipper_id: "shipper:alpine-foods",
      driver_id: "driver:diaz",
      tractor_id: "TRAC-4482",
      trailer_id: "TRL-9012",
      route_id: "route-i70-west-safe",
      origin_facility_id: "dc-denver",
      destination_facility_id: "store-salt-lake",
      cargo_profile: { cargo_class: "reefer", commodity: "frozen food", hazmat_class: "none", temperature_controlled: true, cargo_value_usd: 74000, gross_weight_lbs: 62100 },
      compliance_profile: ["FMCSA_HOS", "ELD", "DOT_SAFETY", "FSMA_SANITARY_TRANSPORT", "NIST_CSF", "LOCAL_SOP"],
      pre_checks: [{ name: "ELD and HOS state fresh", ok: true }, { name: "carrier authority and insurance active", ok: true }],
      post_checks: [{ name: "TMS dispatch receipt attached", ok: true }],
      redacted_fields: ["driver_phone", "exact_customer_contract"],
      retained_fields: ["load_id", "carrier_id", "canonical_action_hash"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.logistics-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyLogisticsEvidenceBundle(bundle).ok, true);
});
