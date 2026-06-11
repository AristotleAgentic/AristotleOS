import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type MiningRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  blastToAction,
  evaluateExecutionControl,
  evaluateMiningSafetyInvariants,
  exportMiningEvidenceBundle,
  gasMonitoringToAction,
  haulageToAction,
  hoistToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  miningAdapterToAction,
  miningHistorianWriteToAction,
  miningSnapshotToRuntimeRegister,
  tailingsToAction,
  ventilationToAction,
  verifyMiningEvidenceBundle
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: MiningRuntimeSnapshot = {
  asset_id: "HT-PILBARA-07",
  asset_type: "haul-truck",
  site_id: "site-pilbara-west",
  zone_id: "haul-road-a",
  system_model_id: "model-pilbara-2026-05-25",
  mine_state: "normal",
  methane_pct: 0.2,
  co_ppm: 10,
  oxygen_pct: 20.9,
  airflow_cfm: 12000,
  speed_kph: 35,
  telemetry_age_ms: 1200,
  proximity_detection_active: true,
  exclusion_zone_clear: true,
  personnel_cleared: true,
  ground_control_stable: true,
  gas_monitoring_active: true,
  ventilation_on: true,
  mining_scada_fresh: true,
  operator_qualified: true,
  operator_id: "operator:mine-west",
  work_order_id: "WO-3391",
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-mining-pilbara-west",
  name: "Pilbara West Surface Operations",
  sovereignty_context: "operator-west-mine-authority",
  authority_domain: "mining-surface-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:mine-ops-orchestrator"],
  physical_bounds: {
    permitted_mine_site_id: "site-pilbara-west",
    permitted_mine_zones: ["haul-road-a", "pit-3-bench-12", "rom-pad", "tsf-1"],
    permitted_asset_types: ["haul-truck", "fan", "blast-controller", "tailings-pump", "gas-sensor", "hoist"],
    permitted_mine_states: ["normal", "maintenance", "blasting"],
    max_methane_pct: 1.0,
    max_co_ppm: 50,
    min_oxygen_pct: 19.5,
    min_airflow_cfm: 9000,
    max_haulage_speed_kph: 50,
    max_telemetry_age_ms: 5000,
    require_proximity_detection: true,
    require_exclusion_zone_clear: true,
    require_personnel_cleared: true,
    require_ground_control_stable: true,
    require_gas_monitoring: true,
    require_ventilation_on: true,
    require_mining_scada_fresh: true,
    require_operator_qualified: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["MINE_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-mining-operations-001",
  ward_id: ward.ward_id,
  subject: "agent:mine-ops-orchestrator",
  allowed_actions: [
    "haulage.dispatch.assign",
    "haulage.move.authorize",
    "haulage.stop",
    "ventilation.on",
    "ventilation.fan.setpoint",
    "blast.arm",
    "blast.initiate",
    "blast.abort",
    "tailings.decant.set",
    "gas.threshold.set",
    "hoist.move.authorize",
    "historian.record.write",
    "modbus.register.write"
  ],
  denied_actions: ["mining.disable_proximity_detection", "mining.disable_gas_monitoring", "mining.disable_ventilation", "blast.force_initiate"],
  constraints: {
    required_runtime_registers: [
      "telemetry.asset_id",
      "telemetry.site_id",
      "telemetry.zone_id",
      "telemetry.proximity_detection_active",
      "telemetry.exclusion_zone_clear",
      "telemetry.personnel_cleared",
      "telemetry.ground_control_stable",
      "telemetry.gas_monitoring_active",
      "telemetry.ventilation_on",
      "telemetry.mining_scada_fresh",
      "telemetry.operator_qualified",
      "telemetry.operator_id"
    ],
    dual_control: { actions: ["blast.initiate", "tailings.decant.set", "hoist.move.authorize"], required: 2, ttl_ms: 600000 },
    budget: { maxCallsPerWindow: 300, windowMs: 3600000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-mine-ops-root",
  classification: { level: "CUI", caveats: ["MINE_OPS"] }
};

const ctx = {
  action_id: "act-mining-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-mining-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["MINE_OPS"] }
};

const blastSnapshot: MiningRuntimeSnapshot = {
  ...snapshot,
  asset_id: "BLAST-PIT3-01",
  asset_type: "blast-controller",
  zone_id: "pit-3-bench-12",
  mine_state: "blasting",
  blast_clearance_id: "BC-2026-0525-03"
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-mining-")), "gel.jsonl");
}

test("mining adapter builders produce Canonical Governed Actions", () => {
  const haul = haulageToAction({ fleet_id: "FLEET-WEST", unit_id: "HT-PILBARA-07", operation: "move-authorize", route_id: "RT-12" }, ctx);
  assert.equal(haul.action_type, "haulage.move.authorize");
  assert.equal(haul.params.adapter, "autonomous-haulage");
  assert.equal(haul.params.zone_id, "haul-road-a");

  const vent = ventilationToAction({ fan_id: "FAN-MAIN-1", operation: "setpoint", setpoint: 14000 }, { ...ctx, action_id: "act-mining-002", snapshot: { ...snapshot, asset_id: "FAN-MAIN-1", asset_type: "fan" } });
  assert.equal(vent.action_type, "ventilation.fan.setpoint");

  const blast = blastToAction({ blast_id: "BLAST-PIT3-01", operation: "initiate" }, { ...ctx, action_id: "act-mining-003", snapshot: blastSnapshot });
  assert.equal(blast.action_type, "blast.initiate");

  const tail = tailingsToAction({ facility_id: "TSF-1", operation: "decant-set", setpoint: 2.0 }, { ...ctx, action_id: "act-mining-004", snapshot: { ...snapshot, asset_id: "TSF-1-DECANT", asset_type: "tailings-pump", zone_id: "tsf-1" } });
  assert.equal(tail.action_type, "tailings.decant.set");

  const gas = gasMonitoringToAction({ monitor_id: "GAS-UG-3", operation: "threshold-set", value: 0.8 }, { ...ctx, action_id: "act-mining-005", snapshot: { ...snapshot, asset_id: "GAS-UG-3", asset_type: "gas-sensor" } });
  assert.equal(gas.action_type, "gas.threshold.set");

  const hoist = hoistToAction({ hoist_id: "WINDER-1", operation: "move-authorize" }, { ...ctx, action_id: "act-mining-006", snapshot: { ...snapshot, asset_id: "WINDER-1", asset_type: "hoist", overspeed_protection_active: true } });
  assert.equal(hoist.action_type, "hoist.move.authorize");

  const historian = miningHistorianWriteToAction({ historian_id: "HIST-MINE", stream: "haulage", record_type: "operator-note", payload: { note: "route assigned" } }, { ...ctx, action_id: "act-mining-007" });
  assert.equal(historian.action_type, "historian.record.write");

  const viaDispatcher = miningAdapterToAction({ kind: "autonomous-haulage", request: { fleet_id: "FLEET-WEST", unit_id: "HT-PILBARA-07", operation: "stop" } }, { ...ctx, action_id: "act-mining-008" });
  assert.equal(viaDispatcher.action_type, "haulage.stop");
});

test("sample mining Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "mining");
  const sampleWard = loadWardManifest(path.join(base, "ward.open_pit.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.control_room.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "haulage_move.json"));
  const methane = loadCanonicalAction(path.join(base, "actions", "refuse_methane_over_limit.json"));
  const exclusion = loadCanonicalAction(path.join(base, "actions", "refuse_exclusion_zone_breach.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const blockedMethane = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: methane, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedMethane.decision, "REFUSE");
  assert.ok(blockedMethane.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));

  const blockedExclusion = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: exclusion, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedExclusion.decision, "REFUSE");
  assert.ok(blockedExclusion.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("mining safety interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "mining.disable_proximity_detection"], denied_actions: [] };
  const action = haulageToAction(
    { fleet_id: "FLEET-WEST", unit_id: "HT-PILBARA-07", operation: "move-authorize", action_type: "mining.disable_proximity_detection" },
    { ...ctx, action_id: "act-mining-disable-001" }
  );
  const direct = evaluateMiningSafetyInvariants(action, ward);
  assert.equal(direct.ok, false);
  assert.ok(direct.detail.includes("hard mining safety interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control mining actions fail closed without an approval store", () => {
  const action = blastToAction({ blast_id: "BLAST-PIT3-01", operation: "initiate" }, { ...ctx, action_id: "act-mining-blast-001", snapshot: blastSnapshot });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control mining actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = blastToAction({ blast_id: "BLAST-PIT3-01", operation: "initiate" }, { ...ctx, action_id: "act-mining-blast-002", snapshot: blastSnapshot });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "operator:shot-firer", "approve", "exclusion zone and personnel clearance verified", now);
  approvalStore.vote(pending.request_id, "operator:mine-manager", "approve", "blast clearance and ground control confirmed", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("mining evidence bundle wraps execution evidence with operator context", () => {
  const action = haulageToAction({ fleet_id: "FLEET-WEST", unit_id: "HT-PILBARA-07", operation: "move-authorize" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: miningSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportMiningEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    mining: {
      operator_id: "operator-west",
      control_room: "west-control-room",
      mining_domain: "autonomous-haulage",
      operational_scope: "site-pilbara-west",
      asset_id: "HT-PILBARA-07",
      site_id: "site-pilbara-west",
      zone_id: "haul-road-a",
      system_model_id: "model-pilbara-2026-05-25",
      shift_id: "SHIFT-A",
      work_order_id: "WO-3391",
      controller_id: "operator:mine-west",
      ground_hazard_level: "low",
      regulatory_evidence_profile: ["MSHA_PART_56", "PROXIMITY_DETECTION", "ISO_17757", "GROUND_CONTROL_PLAN"],
      pre_checks: [{ name: "proximity detection active", ok: true }, { name: "exclusion zone clear", ok: true }, { name: "gas within action level", ok: true }],
      post_checks: [{ name: "haul truck within zone", ok: true }],
      redacted_fields: ["operator_phone", "site_exact_coordinates"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.mining-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyMiningEvidenceBundle(bundle).ok, true);
});
