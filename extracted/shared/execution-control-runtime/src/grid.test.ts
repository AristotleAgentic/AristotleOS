import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type GridRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  dermsDispatchToAction,
  dnp3ControlToAction,
  evaluateExecutionControl,
  evaluateGridSafetyInvariants,
  exportGridEvidenceBundle,
  firmwareCampaignToAction,
  gridAdapterToAction,
  gridSnapshotToRuntimeRegister,
  historianWriteToAction,
  iec61850ControlToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  modbusRegisterWriteToAction,
  opcUaToAction,
  relaySettingToAction,
  scadaCommandToAction,
  verifyGridEvidenceBundle
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: GridRuntimeSnapshot = {
  asset_id: "BRK-230-17",
  asset_type: "breaker",
  grid_boundary_id: "transmission-west",
  topology_model_id: "topo-west-2026-05-25",
  voltage_class: "230kV",
  voltage_kv: 231.4,
  frequency_hz: 60.01,
  feeder_load_pct: 63.2,
  transformer_load_pct: 71.3,
  der_export_mw: 18,
  grid_state: "maintenance",
  switching_order_id: "SWO-2026-0525-17",
  crew_clearance_released: true,
  protection_state_known: true,
  scada_fresh: true,
  telemetry_age_ms: 1200,
  manual_fallback_ready: true,
  operator_id: "operator:grid-west",
  work_order_id: "WO-8831",
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-grid-transmission-west",
  name: "Transmission Operations West",
  sovereignty_context: "utility-west-control-authority",
  authority_domain: "electric-grid-transmission-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:grid-ops-orchestrator"],
  physical_bounds: {
    permitted_boundary_id: "transmission-west",
    permitted_topology_model_id: "topo-west-2026-05-25",
    permitted_voltage_classes: ["230kV"],
    permitted_asset_types: ["breaker", "feeder", "relay", "derms-resource"],
    permitted_grid_states: ["normal", "storm-restoration", "maintenance"],
    min_voltage_kv: 218,
    max_voltage_kv: 242,
    min_frequency_hz: 59.95,
    max_frequency_hz: 60.05,
    max_feeder_load_pct: 85,
    max_transformer_load_pct: 90,
    max_der_export_mw: 50,
    max_telemetry_age_ms: 5000,
    require_switching_order: true,
    require_clearance_released: true,
    require_protection_known: true,
    require_scada_fresh: true,
    require_manual_fallback_ready: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["BES_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-grid-switching-001",
  ward_id: ward.ward_id,
  subject: "agent:grid-ops-orchestrator",
  allowed_actions: ["scada.breaker.open", "scada.breaker.close", "derms.dispatch.set", "derms.export-cap.set", "relay.setting.update", "firmware.campaign.stage", "historian.record.write", "dnp3.control.operate", "iec61850.control.operate", "modbus.register.write", "opcua.node.write"],
  denied_actions: ["grid.disable_protection", "relay.protection.disable", "breaker.force_close_without_clearance"],
  constraints: {
    required_runtime_registers: ["telemetry.asset_id", "telemetry.grid_boundary_id", "telemetry.topology_model_id", "telemetry.switching_order_id", "telemetry.crew_clearance_released", "telemetry.protection_state_known", "telemetry.scada_fresh", "telemetry.manual_fallback_ready", "telemetry.operator_id"],
    dual_control: { actions: ["scada.breaker.close", "relay.setting.update", "firmware.campaign.stage", "derms.export-cap.set"], required: 2, ttl_ms: 900000 },
    budget: { maxCallsPerWindow: 400, windowMs: 3600000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-grid-ops-root",
  classification: { level: "CUI", caveats: ["BES_OPS"] }
};

const ctx = {
  action_id: "act-grid-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-grid-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["BES_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-grid-")), "gel.jsonl");
}

test("grid adapter builders produce Canonical Governed Actions", () => {
  const scada = scadaCommandToAction({ system: "SCADA", command: "open_breaker", asset_id: "BRK-230-17" }, ctx);
  assert.equal(scada.action_type, "scada.breaker.open");
  assert.equal(scada.params.adapter, "scada-ems-adms");
  assert.equal(scada.params.switching_order_id, "SWO-2026-0525-17");

  const dnp3 = dnp3ControlToAction({ outstation_id: "RTU-17", point_index: 12, point_type: "binary-output", operation: "operate", value: true }, { ...ctx, action_id: "act-grid-002" });
  assert.equal(dnp3.action_type, "dnp3.control.operate");

  const iec = iec61850ControlToAction({ ied_id: "IED-17", logical_node: "XCBR1", control_object: "Pos", operation: "operate", value: "open" }, { ...ctx, action_id: "act-grid-003" });
  assert.equal(iec.action_type, "iec61850.control.operate");

  const modbus = modbusRegisterWriteToAction({ device_id: "GW-17", register: 40001, function_code: 16, value: 1 }, { ...ctx, action_id: "act-grid-004" });
  assert.equal(modbus.action_type, "modbus.register.write");

  const opc = opcUaToAction({ server_id: "OPCUA-17", node_id: "ns=2;s=Breaker17.Open", operation: "write", value: true }, { ...ctx, action_id: "act-grid-005" });
  assert.equal(opc.action_type, "opcua.node.write");

  const derms = gridAdapterToAction({ kind: "derms", request: { resource_id: "DER-FLEET-WEST-12", operation: "dispatch", target_mw: 32 } }, { ...ctx, action_id: "act-grid-006", snapshot: { ...snapshot, asset_id: "DER-FLEET-WEST-12", asset_type: "derms-resource", grid_state: "normal" } });
  assert.equal(derms.action_type, "derms.dispatch.set");

  const relay = relaySettingToAction({ relay_id: "RLY-230-17", setting_group: "A", setting_version: "2026.05.25", operation: "update" }, { ...ctx, action_id: "act-grid-007", snapshot: { ...snapshot, asset_id: "RLY-230-17", asset_type: "relay", relay_setting_version: "2026.05.25" } });
  assert.equal(relay.action_type, "relay.setting.update");

  const firmware = firmwareCampaignToAction({ campaign_id: "FW-2026.05.25", firmware_digest: "sha256:test", operation: "stage" }, { ...ctx, action_id: "act-grid-008", snapshot: { ...snapshot, firmware_digest: "sha256:test" } });
  assert.equal(firmware.action_type, "firmware.campaign.stage");

  const historian = historianWriteToAction({ historian_id: "HIST-WEST", stream: "switching", record_type: "operator-note", payload: { note: "switch complete" } }, { ...ctx, action_id: "act-grid-009" });
  assert.equal(historian.action_type, "historian.record.write");
});

test("sample grid Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "grid");
  const sampleWard = loadWardManifest(path.join(base, "ward.transmission_ops.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.switching_operator.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "scada_breaker_open.json"));
  const clearance = loadCanonicalAction(path.join(base, "actions", "refuse_live_crew_clearance.json"));
  const exportOverCap = loadCanonicalAction(path.join(base, "actions", "refuse_der_export_over_cap.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const blockedClearance = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: clearance, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedClearance.decision, "REFUSE");
  assert.ok(blockedClearance.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));

  const blockedDer = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: exportOverCap, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedDer.decision, "REFUSE");
  assert.ok(blockedDer.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("grid protection interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "grid.disable_protection"], denied_actions: [] };
  const action = relaySettingToAction(
    { relay_id: "RLY-230-17", setting_group: "A", setting_version: "2026.05.25", operation: "update", action_type: "grid.disable_protection" },
    { ...ctx, action_id: "act-grid-disable-001", snapshot: { ...snapshot, asset_id: "RLY-230-17", asset_type: "relay" } }
  );
  const directPig = evaluateGridSafetyInvariants(action, ward);
  assert.equal(directPig.ok, false);
  assert.ok(directPig.detail.includes("hard grid protection interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control grid actions fail closed without an approval store", () => {
  const action = relaySettingToAction({ relay_id: "RLY-230-17", setting_group: "A", setting_version: "2026.05.25", operation: "update" }, { ...ctx, action_id: "act-grid-relay-001", snapshot: { ...snapshot, asset_id: "RLY-230-17", asset_type: "relay", relay_setting_version: "2026.05.25" } });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control grid actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = relaySettingToAction({ relay_id: "RLY-230-17", setting_group: "A", setting_version: "2026.05.25", operation: "update" }, { ...ctx, action_id: "act-grid-relay-002", snapshot: { ...snapshot, asset_id: "RLY-230-17", asset_type: "relay", relay_setting_version: "2026.05.25" } });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "operator:grid-supervisor", "approve", "switching order and relay package verified", now);
  approvalStore.vote(pending.request_id, "operator:protection-engineer", "approve", "settings reviewed", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("grid evidence bundle wraps execution evidence with utility context", () => {
  const action = scadaCommandToAction({ system: "SCADA", command: "open_breaker", asset_id: "BRK-230-17" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: gridSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportGridEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    grid: {
      utility_id: "utility-west",
      control_center: "west-cc",
      grid_domain: "transmission",
      operational_scope: "transmission-west",
      asset_id: "BRK-230-17",
      switching_order_id: "SWO-2026-0525-17",
      work_order_id: "WO-8831",
      operator_id: "operator:grid-west",
      topology_model_id: "topo-west-2026-05-25",
      voltage_class: "230kV",
      bes_impact: "medium",
      cip_evidence_profile: ["CIP_002", "CIP_005", "CIP_010", "NERC_OPS", "LOCAL_SWITCHING_ORDER"],
      pre_checks: [{ name: "crew clearance released", ok: true }, { name: "SCADA fresh", ok: true }],
      post_checks: [{ name: "breaker state observed", ok: true }],
      redacted_fields: ["operator_phone", "facility_exact_address"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.grid-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyGridEvidenceBundle(bundle).ok, true);
});
