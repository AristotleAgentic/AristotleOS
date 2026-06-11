import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type WardManifest,
  type WaterRuntimeSnapshot,
  ApprovalStore,
  chemicalDosingToAction,
  evaluateExecutionControl,
  evaluateWaterSafetyInvariants,
  exportWaterEvidenceBundle,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  pumpStationToAction,
  scadaProcessSetpointToAction,
  valveControlToAction,
  verifyWaterEvidenceBundle,
  waterAdapterToAction,
  waterSnapshotToRuntimeRegister
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: WaterRuntimeSnapshot = {
  utility_id: "west-municipal-water",
  water_system_id: "west-water-system",
  facility_id: "west-treatment-plant",
  facility_type: "treatment-plant",
  asset_id: "PUMP-WEST-2",
  asset_type: "pump",
  process_area: "distribution",
  pressure_zone_id: "west-zone-a",
  pump_station_id: "booster-west-2",
  chlorine_residual_mg_l: 0.8,
  chlorine_dose_mg_l: 1.7,
  ph: 7.3,
  turbidity_ntu: 0.08,
  pressure_psi: 62,
  tank_level_pct: 66,
  flow_mgd: 12.4,
  uv_intensity_pct: 91,
  pump_available: true,
  pump_running: true,
  valve_position: "open",
  valve_interlock_clear: true,
  backflow_risk_clear: true,
  disinfection_active: true,
  chemical_inventory_ok: true,
  lab_sample_age_min: 45,
  sensor_age_ms: 1100,
  scada_fresh: true,
  manual_fallback_ready: true,
  operator_id: "operator:water-shift-a",
  work_order_id: "WO-WATER-0525-11",
  discharge_permit_id: "NPDES-WEST-001",
  discharge_permit_window_open: true,
  bypass_active: false,
  vendor_remote_session: false,
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-water-plant-west",
  name: "West Drinking Water Treatment Plant",
  sovereignty_context: "municipal-water-authority-west",
  authority_domain: "water-treatment-distribution-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:water-ops-orchestrator"],
  physical_bounds: {
    permitted_boundary_id: "west-water-system",
    permitted_water_system_id: "west-water-system",
    permitted_facility_id: "west-treatment-plant",
    permitted_pressure_zones: ["west-zone-a", "west-zone-b"],
    permitted_process_areas: ["intake", "filtration", "disinfection", "distribution"],
    permitted_water_asset_types: ["pump", "valve", "chemical-feed", "tank", "uv-reactor", "plc", "rtu"],
    permitted_discharge_permit_ids: ["NPDES-WEST-001"],
    max_chlorine_dose_mg_l: 4,
    min_chlorine_residual_mg_l: 0.2,
    min_pressure_psi: 35,
    max_pressure_psi: 120,
    min_tank_level_pct: 20,
    max_tank_level_pct: 92,
    max_turbidity_ntu: 0.3,
    min_ph: 6.5,
    max_ph: 8.5,
    max_sensor_age_ms: 5000,
    max_lab_sample_age_min: 240,
    max_flow_mgd: 24,
    min_uv_intensity_pct: 85,
    require_water_scada_fresh: true,
    require_backflow_clear: true,
    require_disinfection_active: true,
    require_chemical_inventory_ok: true,
    require_pump_available: true,
    require_valve_interlock_clear: true,
    require_manual_fallback_ready: true,
    require_operator_identity: true,
    require_no_vendor_remote_session: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["WATER_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-water-ops-001",
  ward_id: ward.ward_id,
  subject: "agent:water-ops-orchestrator",
  allowed_actions: [
    "scada.process.setpoint",
    "plc.register.write",
    "pump.speed.set",
    "pump.start.request",
    "pump.stop.request",
    "valve.position.set",
    "chemical.dose.adjust",
    "chlorine.feed.set",
    "lims.sample.accept",
    "historian.record.write",
    "tank.level.setpoint",
    "uv.intensity.set",
    "disinfection.release.authorize",
    "discharge.release.authorize"
  ],
  denied_actions: ["water.disable_disinfection", "chemical.force_overfeed", "plc.force_override", "valve.force_open", "pump.force_run_dry", "wastewater.bypass.force_open"],
  constraints: {
    required_runtime_registers: [
      "telemetry.facility_id",
      "telemetry.asset_id",
      "telemetry.process_area",
      "telemetry.chlorine_residual_mg_l",
      "telemetry.ph",
      "telemetry.turbidity_ntu",
      "telemetry.pressure_psi",
      "telemetry.sensor_age_ms",
      "telemetry.scada_fresh",
      "telemetry.backflow_risk_clear",
      "telemetry.disinfection_active",
      "telemetry.chemical_inventory_ok",
      "telemetry.pump_available",
      "telemetry.valve_interlock_clear",
      "telemetry.manual_fallback_ready",
      "telemetry.operator_id"
    ],
    dual_control: { actions: ["chemical.dose.adjust", "chlorine.feed.set", "valve.position.set", "plc.register.write", "disinfection.release.authorize", "discharge.release.authorize"], required: 2, ttl_ms: 900000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-water-root",
  classification: { level: "CUI", caveats: ["WATER_OPS"] }
};

const ctx = {
  action_id: "act-water-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-water-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["WATER_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-water-")), "gel.jsonl");
}

test("water adapter builders produce Canonical Governed Actions", () => {
  const pump = pumpStationToAction({ pump_id: "PUMP-WEST-2", operation: "set-speed", speed_pct: 72 }, ctx);
  assert.equal(pump.action_type, "pump.speed.set");
  assert.equal(pump.params.adapter, "pump-station");

  const scada = scadaProcessSetpointToAction({ system: "SCADA", setpoint: "filter-backwash-threshold", value: 0.12 }, { ...ctx, action_id: "act-water-002" });
  assert.equal(scada.action_type, "scada.process.setpoint");

  const valve = valveControlToAction({ valve_id: "VALVE-ZA-14", requested_position: "throttled" }, { ...ctx, action_id: "act-water-003", snapshot: { ...snapshot, asset_id: "VALVE-ZA-14", asset_type: "valve" } });
  assert.equal(valve.action_type, "valve.position.set");

  const chemical = chemicalDosingToAction({ chemical: "chlorine", dose_mg_l: 2.2 }, { ...ctx, action_id: "act-water-004", snapshot: { ...snapshot, asset_id: "CHLORINE-FEED-1", asset_type: "chemical-feed", process_area: "disinfection" } });
  assert.equal(chemical.action_type, "chlorine.feed.set");

  const routed = waterAdapterToAction({ kind: "pump-station", request: { pump_id: "PUMP-WEST-2", operation: "start" } }, { ...ctx, action_id: "act-water-005" });
  assert.equal(routed.action_type, "pump.start.request");
});

test("sample water Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "water");
  const sampleWard = loadWardManifest(path.join(base, "ward.drinking_water_plant.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.water_operator.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "allow_pump_speed_adjust.json"));
  const overfeed = loadCanonicalAction(path.join(base, "actions", "refuse_chlorine_overfeed.json"));
  const backflow = loadCanonicalAction(path.join(base, "actions", "refuse_backflow_valve.json"));
  const missing = loadCanonicalAction(path.join(base, "actions", "escalate_missing_turbidity_state.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const unsafeDose = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: overfeed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(unsafeDose.decision, "REFUSE");
  assert.ok(unsafeDose.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));

  const unsafeValve = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: backflow, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(unsafeValve.decision, "REFUSE");
  assert.ok(unsafeValve.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));

  const escalated = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: missing, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(escalated.decision, "ESCALATE");
  assert.ok(escalated.reason_codes.includes("RUNTIME_STATE_MISSING"));
});

test("water hard interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "water.disable_disinfection"], denied_actions: [] };
  const action = scadaProcessSetpointToAction(
    { system: "SCADA", setpoint: "disinfection-enabled", value: false, action_type: "water.disable_disinfection" },
    { ...ctx, action_id: "act-water-disable-disinfection-001" }
  );

  const directPig = evaluateWaterSafetyInvariants(action, ward);
  assert.equal(directPig.ok, false);
  assert.ok(directPig.detail.includes("hard water safety interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control water chemical actions fail closed without an approval store", () => {
  const action = chemicalDosingToAction(
    { chemical: "chlorine", dose_mg_l: 2.2 },
    { ...ctx, action_id: "act-water-chemical-dual-001", snapshot: { ...snapshot, asset_id: "CHLORINE-FEED-1", asset_type: "chemical-feed", process_area: "disinfection" } }
  );
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control water chemical actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = chemicalDosingToAction(
    { chemical: "chlorine", dose_mg_l: 2.2 },
    { ...ctx, action_id: "act-water-chemical-dual-002", snapshot: { ...snapshot, asset_id: "CHLORINE-FEED-1", asset_type: "chemical-feed", process_area: "disinfection" } }
  );

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "operator:water-supervisor-west", "approve", "dose in operating band", now);
  approvalStore.vote(pending.request_id, "operator:water-quality-lead", "approve", "residual and turbidity verified", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("water evidence bundle wraps execution evidence with utility context", () => {
  const action = pumpStationToAction({ pump_id: "PUMP-WEST-2", operation: "set-speed", speed_pct: 72 }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: waterSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportWaterEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    water: {
      utility_id: "west-municipal-water",
      water_system_id: "west-water-system",
      facility_id: "west-treatment-plant",
      water_domain: "drinking-water-treatment",
      operations_center: "west-water-control",
      asset_id: "PUMP-WEST-2",
      asset_type: "pump",
      process_area: "distribution",
      pressure_zone_id: "west-zone-a",
      work_order_id: "WO-WATER-0525-11",
      discharge_permit_id: "NPDES-WEST-001",
      process_snapshot: { chlorine_residual_mg_l: 0.8, ph: 7.3, turbidity_ntu: 0.08, pressure_psi: 62, tank_level_pct: 66, flow_mgd: 12.4 },
      standards_profile: ["EPA_WATER_CYBER", "CISA_WWS_CPG", "AWWA_CYBER", "AWIA_RRA", "NIST_CSF", "LOCAL_OPERATING_PROCEDURE"],
      pre_checks: [{ name: "SCADA state fresh", ok: true }, { name: "backflow risk clear", ok: true }],
      post_checks: [{ name: "pump speed receipt attached", ok: true }],
      redacted_fields: ["customer_id", "exact_pipe_segment"],
      retained_fields: ["gel_record_hash", "warrant_id", "process_snapshot"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.water-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyWaterEvidenceBundle(bundle).ok, true);
});
