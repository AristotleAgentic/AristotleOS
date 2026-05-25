import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type PortRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  bunkeringHazmatToAction,
  craneMoveToAction,
  customsHoldToAction,
  ediManifestToAction,
  evaluateExecutionControl,
  evaluatePortSafetyInvariants,
  exportPortEvidenceBundle,
  gateAccessToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  portAdapterToAction,
  portSnapshotToRuntimeRegister,
  reeferSetpointToAction,
  shorePowerToAction,
  tosContainerReleaseToAction,
  verifyPortEvidenceBundle,
  vtsBerthClearanceToAction,
  weighbridgeVgmToAction,
  yardMoveToAction
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: PortRuntimeSnapshot = {
  port_id: "port-of-aristotle",
  facility_id: "facility-alpha",
  terminal_id: "terminal-alpha",
  berth_id: "berth-7",
  yard_block_id: "A12",
  gate_id: "gate-3",
  container_id: "MSCU1234567",
  equipment_id: "ASC-12",
  vessel_imo: "IMO9876543",
  vessel_name: "MV Boundary",
  voyage_id: "VOY-ALPHA-19",
  truck_id: "TRK-7731",
  cargo_type: "reefer",
  hazmat_class: "none",
  container_weight_kg: 22400,
  vgm_verified: true,
  customs_hold: false,
  security_hold: false,
  inspection_hold: false,
  release_order_id: "REL-2026-0525-001",
  booking_id: "BKG-ALPHA-7781",
  bill_of_lading: "BOL-998877",
  pnt_confidence: 0.992,
  ais_track_age_ms: 1400,
  vessel_clearance_granted: true,
  berth_conflict_present: false,
  wind_speed_kn: 14,
  tide_window_open: true,
  crane_exclusion_zone_clear: true,
  twistlock_state: "locked",
  spreader_locked: true,
  reefer_temperature_c: -18,
  reefer_setpoint_c: -18,
  cold_chain_valid: true,
  shore_power_lockout_released: true,
  shore_power_isolated: true,
  fire_watch_ready: true,
  hazmat_route_approved: true,
  truck_appointment_valid: true,
  driver_identity_verified: true,
  gate_access_granted: true,
  terminal_network_zone: "tos",
  vendor_remote_session: false,
  ot_telemetry_age_ms: 900,
  tos_transaction_id: "TOS-TXN-0525-001",
  operator_id: "operator:terminal-alpha-supervisor",
  manual_fallback_ready: true,
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-port-terminal-alpha",
  name: "Container Terminal Alpha Port Operations",
  sovereignty_context: "port-authority-and-terminal-operator-alpha",
  authority_domain: "maritime-terminal-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:terminal-orchestrator"],
  physical_bounds: {
    permitted_boundary_id: "terminal-alpha",
    permitted_port_id: "port-of-aristotle",
    permitted_terminal_id: "terminal-alpha",
    permitted_berth_ids: ["berth-7"],
    permitted_yard_blocks: ["A12", "B04", "C03"],
    permitted_gate_ids: ["gate-3", "gate-4"],
    permitted_cargo_types: ["container", "reefer", "hazmat"],
    permitted_hazmat_classes: ["none", "3", "8"],
    permitted_terminal_zones: ["tos", "ot", "gate", "vessel-interface"],
    max_container_weight_kg: 32500,
    min_pnt_confidence: 0.97,
    max_ais_track_age_ms: 5000,
    max_port_telemetry_age_ms: 4000,
    max_wind_speed_kn: 35,
    min_reefer_temp_c: -30,
    max_reefer_temp_c: 20,
    require_customs_release: true,
    require_no_security_hold: true,
    require_no_inspection_hold: true,
    require_vgm_verified: true,
    require_crane_exclusion_clear: true,
    require_spreader_safe: true,
    require_berth_clear: true,
    require_tide_window_open: true,
    require_vessel_clearance: true,
    require_truck_appointment: true,
    require_driver_identity: true,
    require_manual_fallback_ready: true,
    require_cold_chain_valid: true,
    require_fire_watch_ready: true,
    require_hazmat_route_approved: true,
    require_gate_access_granted: true,
    require_operator_identity: true,
    require_no_vendor_remote_session: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["PORT_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-port-terminal-alpha-001",
  ward_id: ward.ward_id,
  subject: "agent:terminal-orchestrator",
  allowed_actions: [
    "tos.container.release",
    "tos.yard-move.authorize",
    "edi.manifest.submit",
    "pcs.release-notice.publish",
    "customs.hold.release",
    "security.hold.release",
    "vts.berth.clearance",
    "ais.track.attest",
    "crane.move.request",
    "gate.access.grant",
    "yard.move.authorize",
    "reefer.setpoint.update",
    "weighbridge.vgm.verify",
    "shore-power.energize.request",
    "shore-power.isolate.request",
    "hazmat.route.authorize",
    "bunkering.operation.authorize"
  ],
  denied_actions: ["port.disable_crane_interlock", "crane.override_exclusion_zone", "customs.force_release_hold", "gate.force_open", "shore-power.force_energize", "pnt.override_confidence"],
  constraints: {
    required_runtime_registers: [
      "telemetry.terminal_id",
      "telemetry.tos_transaction_id",
      "telemetry.customs_hold",
      "telemetry.security_hold",
      "telemetry.vgm_verified",
      "telemetry.pnt_confidence",
      "telemetry.ot_telemetry_age_ms",
      "telemetry.crane_exclusion_zone_clear",
      "telemetry.spreader_locked",
      "telemetry.berth_conflict_present",
      "telemetry.tide_window_open",
      "telemetry.vessel_clearance_granted",
      "telemetry.truck_appointment_valid",
      "telemetry.driver_identity_verified",
      "telemetry.manual_fallback_ready",
      "telemetry.operator_id"
    ],
    dual_control: { actions: ["customs.hold.release", "vts.berth.clearance", "crane.move.request", "shore-power.energize.request", "hazmat.route.authorize"], required: 2, ttl_ms: 900000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-port-root",
  classification: { level: "CUI", caveats: ["PORT_OPS"] }
};

const ctx = {
  action_id: "act-port-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-port-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["PORT_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-port-")), "gel.jsonl");
}

test("port adapter builders produce Canonical Governed Actions", () => {
  const release = tosContainerReleaseToAction({ container_id: "MSCU1234567", release_order_id: "REL-1" }, ctx);
  assert.equal(release.action_type, "tos.container.release");
  assert.equal(release.params.adapter, "terminal-operating-system");

  const edi = ediManifestToAction({ manifest_id: "MAN-1", carrier_id: "carrier:alpha", operation: "submit" }, { ...ctx, action_id: "act-port-002" });
  assert.equal(edi.action_type, "edi.manifest.submit");

  const customs = customsHoldToAction({ hold_id: "HOLD-1", container_id: "MSCU1234567", operation: "release" }, { ...ctx, action_id: "act-port-003" });
  assert.equal(customs.action_type, "customs.hold.release");

  const vts = vtsBerthClearanceToAction({ clearance_id: "CLR-1", vessel_imo: "IMO9876543", berth_id: "berth-7", operation: "clear-berth" }, { ...ctx, action_id: "act-port-004" });
  assert.equal(vts.action_type, "vts.berth.clearance");

  const crane = portAdapterToAction({ kind: "crane-automation", request: { crane_id: "QC-7", move_id: "MOVE-1", container_id: "MSCU1234567", from_slot: "VESSEL", to_slot: "A12" } }, { ...ctx, action_id: "act-port-005" });
  assert.equal(crane.action_type, "crane.move.request");

  const gate = gateAccessToAction({ gate_id: "gate-3", truck_id: "TRK-1", appointment_id: "APT-1", operation: "grant" }, { ...ctx, action_id: "act-port-006" });
  assert.equal(gate.action_type, "gate.access.grant");

  const yard = yardMoveToAction({ move_id: "YM-1", equipment_id: "AGV-9", container_id: "MSCU1234567", from_block: "A12", to_block: "B04" }, { ...ctx, action_id: "act-port-007" });
  assert.equal(yard.action_type, "yard.move.authorize");

  const reefer = reeferSetpointToAction({ container_id: "MSCU1234567", setpoint_c: -18 }, { ...ctx, action_id: "act-port-008" });
  assert.equal(reefer.action_type, "reefer.setpoint.update");

  const weight = weighbridgeVgmToAction({ weigh_ticket_id: "WGT-1", container_id: "MSCU1234567", weight_kg: 22400 }, { ...ctx, action_id: "act-port-009" });
  assert.equal(weight.action_type, "weighbridge.vgm.verify");

  const shore = shorePowerToAction({ berth_id: "berth-7", vessel_imo: "IMO9876543", operation: "energize" }, { ...ctx, action_id: "act-port-010" });
  assert.equal(shore.action_type, "shore-power.energize.request");

  const hazmat = bunkeringHazmatToAction({ operation_id: "HZ-1", operation: "authorize-route", hazmat_class: "3" }, { ...ctx, action_id: "act-port-011" });
  assert.equal(hazmat.action_type, "hazmat.route.authorize");
});

test("sample port Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "port");
  const sampleWard = loadWardManifest(path.join(base, "ward.container_terminal_alpha.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.terminal_orchestrator.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "allow_container_release.json"));
  const customsHold = loadCanonicalAction(path.join(base, "actions", "refuse_customs_hold_release.json"));
  const missing = loadCanonicalAction(path.join(base, "actions", "escalate_missing_pnt_state.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const blockedHold = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: customsHold, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedHold.decision, "REFUSE");
  assert.ok(blockedHold.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));

  const escalated = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: missing, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(escalated.decision, "ESCALATE");
  assert.ok(escalated.reason_codes.includes("RUNTIME_STATE_MISSING"));
});

test("port hard interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "gate.force_open"], denied_actions: [] };
  const action = gateAccessToAction(
    { gate_id: "gate-3", truck_id: "TRK-7731", appointment_id: "APT-1", operation: "grant", action_type: "gate.force_open" },
    { ...ctx, action_id: "act-port-force-gate-test-001" }
  );
  const directPig = evaluatePortSafetyInvariants(action, ward);
  assert.equal(directPig.ok, false);
  assert.ok(directPig.detail.includes("hard port safety interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control port crane actions fail closed without an approval store", () => {
  const action = craneMoveToAction({ crane_id: "QC-7", move_id: "MOVE-1", container_id: "MSCU1234567", from_slot: "VESSEL-BAY-42", to_slot: "A12-04-02" }, { ...ctx, action_id: "act-port-crane-dual-001", snapshot: { ...snapshot, terminal_network_zone: "ot" } });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control port crane actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = craneMoveToAction({ crane_id: "QC-7", move_id: "MOVE-2", container_id: "MSCU1234567", from_slot: "VESSEL-BAY-42", to_slot: "A12-04-02" }, { ...ctx, action_id: "act-port-crane-dual-002", snapshot: { ...snapshot, terminal_network_zone: "ot" } });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "terminal-ops:supervisor-alpha", "approve", "exclusion zone and spreader state confirmed", now);
  approvalStore.vote(pending.request_id, "maintenance:crane-safety-alpha", "approve", "equipment telemetry verified", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("port evidence bundle wraps execution evidence with terminal context", () => {
  const action = tosContainerReleaseToAction({ container_id: "MSCU1234567", release_order_id: "REL-2026-0525-001" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: portSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportPortEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    port: {
      port_id: "port-of-aristotle",
      facility_id: "facility-alpha",
      terminal_id: "terminal-alpha",
      port_domain: "container-terminal",
      operations_center: "terminal-control-alpha",
      berth_id: "berth-7",
      yard_block_id: "A12",
      gate_id: "gate-3",
      container_id: "MSCU1234567",
      vessel_imo: "IMO9876543",
      voyage_id: "VOY-ALPHA-19",
      booking_id: "BKG-ALPHA-7781",
      bill_of_lading: "BOL-998877",
      release_order_id: "REL-2026-0525-001",
      equipment_id: "ASC-12",
      cargo_profile: { cargo_type: "reefer", hazmat_class: "none", reefer: true, container_weight_kg: 22400 },
      standards_profile: ["USCG_MTSA_CYBER", "IMO_MSC_FAL", "IAPH_PORT_CYBER", "CISA_MTS_RESILIENCE", "ISPS", "NIST_CSF", "LOCAL_TERMINAL_RULE"],
      pre_checks: [{ name: "customs hold clear", ok: true }, { name: "crane exclusion zone clear", ok: true }],
      post_checks: [{ name: "TOS release receipt attached", ok: true }],
      redacted_fields: ["driver_license", "exact_gate_camera_uri"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.port-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyPortEvidenceBundle(bundle).ok, true);
});
