import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type PipelineRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  pipelineDnp3ControlToAction,
  evaluateExecutionControl,
  evaluatePipelineSafetyInvariants,
  exportPipelineEvidenceBundle,
  pipelineHistorianWriteToAction,
  leakDetectionToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  pipelineModbusRegisterWriteToAction,
  pipelineOpcUaToAction,
  pigToAction,
  pipelineAdapterToAction,
  pipelineSnapshotToRuntimeRegister,
  pressureToAction,
  scadaCompressorToAction,
  scadaPumpToAction,
  valveToAction,
  verifyPipelineEvidenceBundle
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: PipelineRuntimeSnapshot = {
  asset_id: "PUMP-PS-WEST-03-1",
  asset_type: "pump",
  segment_id: "segment-transmission-west",
  system_model_id: "model-west-2026-05-25",
  pipeline_state: "normal",
  pressure_psig: 850,
  maop_psig: 1200,
  flow_bbl_per_day: 35000,
  telemetry_age_ms: 1200,
  leak_detection_armed: true,
  overpressure_protection_active: true,
  esd_ready: true,
  segment_isolation_ready: true,
  pump_primed: true,
  pipeline_scada_fresh: true,
  operator_qualified: true,
  operator_id: "operator:pipeline-west",
  work_order_id: "WO-7781",
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-pipeline-transmission-segment-west",
  name: "Transmission Segment Operations West",
  sovereignty_context: "operator-west-control-authority",
  authority_domain: "pipeline-transmission-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:pipeline-ops-orchestrator"],
  physical_bounds: {
    permitted_segment_id: "segment-transmission-west",
    permitted_system_model_id: "model-west-2026-05-25",
    permitted_asset_types: ["pump", "compressor", "valve", "pressure-monitor", "regulator"],
    permitted_pipeline_states: ["normal", "maintenance", "startup"],
    max_pressure_psig: 1200,
    min_pressure_psig: 150,
    max_pressure_pct_maop: 100,
    max_flow_bbl_per_day: 50000,
    max_telemetry_age_ms: 5000,
    require_leak_detection_armed: true,
    require_overpressure_protection: true,
    require_esd_ready: true,
    require_segment_isolation_ready: true,
    require_pump_primed: true,
    require_pipeline_scada_fresh: true,
    require_operator_qualified: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["PIPELINE_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-pipeline-operations-001",
  ward_id: ward.ward_id,
  subject: "agent:pipeline-ops-orchestrator",
  allowed_actions: [
    "scada.pump.start",
    "scada.pump.stop",
    "scada.compressor.start",
    "valve.isolate.close",
    "valve.isolation.open",
    "pressure.setpoint.set",
    "pressure.relief.set",
    "leak_detection.threshold.set",
    "pig.launch.execute",
    "historian.record.write",
    "modbus.register.write",
    "dnp3.control.operate",
    "opcua.node.write"
  ],
  denied_actions: ["pipeline.disable_leak_detection", "pipeline.disable_overpressure_protection", "pipeline.isolation.bypass", "pressure.relief.disable"],
  constraints: {
    required_runtime_registers: [
      "telemetry.asset_id",
      "telemetry.segment_id",
      "telemetry.system_model_id",
      "telemetry.pressure_psig",
      "telemetry.leak_detection_armed",
      "telemetry.overpressure_protection_active",
      "telemetry.esd_ready",
      "telemetry.segment_isolation_ready",
      "telemetry.pump_primed",
      "telemetry.pipeline_scada_fresh",
      "telemetry.operator_qualified",
      "telemetry.operator_id"
    ],
    dual_control: { actions: ["valve.isolate.close", "pressure.relief.set", "scada.compressor.start", "pig.launch.execute"], required: 2, ttl_ms: 600000 },
    budget: { maxCallsPerWindow: 200, windowMs: 3600000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-pipeline-ops-root",
  classification: { level: "CUI", caveats: ["PIPELINE_OPS"] }
};

const ctx = {
  action_id: "act-pipeline-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-pipeline-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["PIPELINE_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-pipeline-")), "gel.jsonl");
}

test("pipeline adapter builders produce Canonical Governed Actions", () => {
  const pump = scadaPumpToAction({ station_id: "PS-WEST-03", unit_id: "UNIT-1", operation: "start" }, ctx);
  assert.equal(pump.action_type, "scada.pump.start");
  assert.equal(pump.params.adapter, "scada-pump-control");
  assert.equal(pump.params.segment_id, "segment-transmission-west");
  assert.equal(pump.params.pressure_pct_maop, 70.8);

  const compressor = scadaCompressorToAction({ station_id: "CS-WEST-01", unit_id: "C1", operation: "start" }, { ...ctx, action_id: "act-pipeline-002", snapshot: { ...snapshot, asset_id: "COMP-CS-WEST-01-1", asset_type: "compressor" } });
  assert.equal(compressor.action_type, "scada.compressor.start");

  const valve = valveToAction({ valve_id: "MLV-WEST-12", valve_kind: "block", operation: "isolate" }, { ...ctx, action_id: "act-pipeline-003", snapshot: { ...snapshot, asset_id: "MLV-WEST-12", asset_type: "valve" } });
  assert.equal(valve.action_type, "valve.isolate.close");

  const pressure = pressureToAction({ device_id: "PCV-WEST-03", device_kind: "control-valve", operation: "set", setpoint_psig: 900 }, { ...ctx, action_id: "act-pipeline-004", snapshot: { ...snapshot, asset_id: "PCV-WEST-03", asset_type: "regulator" } });
  assert.equal(pressure.action_type, "pressure.setpoint.set");
  assert.equal(pressure.params.setpoint_psig, 900);

  const cpm = leakDetectionToAction({ monitor_id: "CPM-WEST", operation: "threshold-set", value: 0.4 }, { ...ctx, action_id: "act-pipeline-005" });
  assert.equal(cpm.action_type, "leak_detection.threshold.set");

  const pig = pigToAction({ trap_id: "LAUNCHER-WEST-1", operation: "launch", pig_id: "PIG-2026-05" }, { ...ctx, action_id: "act-pipeline-006", snapshot: { ...snapshot, asset_id: "LAUNCHER-WEST-1", asset_type: "pig-trap", pig_id: "PIG-2026-05" } });
  assert.equal(pig.action_type, "pig.launch.execute");

  const modbus = pipelineModbusRegisterWriteToAction({ device_id: "RTU-WEST-9", register: 40010, function_code: 16, value: 1 }, { ...ctx, action_id: "act-pipeline-007" });
  assert.equal(modbus.action_type, "modbus.register.write");

  const dnp3 = pipelineDnp3ControlToAction({ outstation_id: "RTU-9", point_index: 4, point_type: "binary-output", operation: "operate", value: true }, { ...ctx, action_id: "act-pipeline-008" });
  assert.equal(dnp3.action_type, "dnp3.control.operate");

  const opc = pipelineOpcUaToAction({ server_id: "OPCUA-9", node_id: "ns=2;s=Pump1.Start", operation: "write", value: true }, { ...ctx, action_id: "act-pipeline-009" });
  assert.equal(opc.action_type, "opcua.node.write");

  const historian = pipelineHistorianWriteToAction({ historian_id: "HIST-WEST", stream: "pump-ops", record_type: "operator-note", payload: { note: "pump started" } }, { ...ctx, action_id: "act-pipeline-010" });
  assert.equal(historian.action_type, "historian.record.write");

  const viaDispatcher = pipelineAdapterToAction({ kind: "scada-pump-control", request: { station_id: "PS-WEST-03", unit_id: "UNIT-1", operation: "stop" } }, { ...ctx, action_id: "act-pipeline-011" });
  assert.equal(viaDispatcher.action_type, "scada.pump.stop");
});

test("sample pipeline Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "pipeline");
  const sampleWard = loadWardManifest(path.join(base, "ward.transmission_segment.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.operations_center.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "pump_start.json"));
  const overpressure = loadCanonicalAction(path.join(base, "actions", "refuse_overpressure.json"));
  const cpmOffline = loadCanonicalAction(path.join(base, "actions", "refuse_leak_detection_offline.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const blockedPressure = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: overpressure, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedPressure.decision, "REFUSE");
  assert.ok(blockedPressure.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));

  const blockedCpm = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: cpmOffline, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedCpm.decision, "REFUSE");
  assert.ok(blockedCpm.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("pipeline safety interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "pipeline.disable_leak_detection"], denied_actions: [] };
  const action = leakDetectionToAction(
    { monitor_id: "CPM-WEST", operation: "mode-set", value: "off", action_type: "pipeline.disable_leak_detection" },
    { ...ctx, action_id: "act-pipeline-disable-001" }
  );
  const direct = evaluatePipelineSafetyInvariants(action, ward);
  assert.equal(direct.ok, false);
  assert.ok(direct.detail.includes("hard pipeline safety interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control pipeline actions fail closed without an approval store", () => {
  const action = valveToAction({ valve_id: "MLV-WEST-12", valve_kind: "block", operation: "isolate" }, { ...ctx, action_id: "act-pipeline-valve-001", snapshot: { ...snapshot, asset_id: "MLV-WEST-12", asset_type: "valve" } });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control pipeline actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = valveToAction({ valve_id: "MLV-WEST-12", valve_kind: "block", operation: "isolate" }, { ...ctx, action_id: "act-pipeline-valve-002", snapshot: { ...snapshot, asset_id: "MLV-WEST-12", asset_type: "valve" } });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "operator:pipeline-supervisor", "approve", "isolation plan and segment state verified", now);
  approvalStore.vote(pending.request_id, "operator:integrity-engineer", "approve", "MAOP margin and ESD readiness confirmed", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("pipeline evidence bundle wraps execution evidence with operator context", () => {
  const action = scadaPumpToAction({ station_id: "PS-WEST-03", unit_id: "UNIT-1", operation: "start" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: pipelineSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportPipelineEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    pipeline: {
      operator_id: "operator-west",
      control_room: "west-control-room",
      pipeline_domain: "hazardous-liquid-transmission",
      operational_scope: "segment-transmission-west",
      asset_id: "PUMP-PS-WEST-03-1",
      segment_id: "segment-transmission-west",
      system_model_id: "model-west-2026-05-25",
      work_order_id: "WO-7781",
      controller_id: "operator:pipeline-west",
      hca_impact: "medium",
      regulatory_evidence_profile: ["PHMSA_195", "CONTROL_ROOM_MANAGEMENT", "OPERATOR_QUALIFICATION", "API_1164", "API_1173", "API_RP_1175"],
      pre_checks: [{ name: "leak detection armed", ok: true }, { name: "overpressure protection active", ok: true }, { name: "SCADA fresh", ok: true }],
      post_checks: [{ name: "discharge pressure within MAOP", ok: true }],
      redacted_fields: ["operator_phone", "facility_exact_address"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.pipeline-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyPipelineEvidenceBundle(bundle).ok, true);
});
