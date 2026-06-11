import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type VehicleSafetySnapshot,
  type WardManifest,
  ApprovalStore,
  automotiveAdapterToAction,
  autosarAdaptiveToAction,
  evaluateExecutionControl,
  evaluateVehicleSafetyInvariants,
  exportAutomotiveEvidenceBundle,
  fleetManagementToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  mapUpdateToAction,
  otaCampaignToAction,
  remoteAssistToAction,
  ros2DdsCommandToAction,
  simulationScenarioToAction,
  vehicleSafetySnapshotToRuntimeRegister,
  verifyAutomotiveEvidenceBundle
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const safety: VehicleSafetySnapshot = {
  vehicle_id: "AV-1042",
  fleet_region: "west",
  odd_id: "sf-soma-daylight",
  road_class: "urban-arterial",
  drive_state: "low_speed_autonomy",
  speed_mps: 8.1,
  map_confidence: 0.992,
  localization_confidence: 0.991,
  perception_confidence: 0.973,
  mrc_available: true,
  safety_case_id: "SC-AV-WEST-2026-001",
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-av-fleet-west",
  name: "Autonomous Vehicle Fleet West",
  sovereignty_context: "av-operator-western-us-safety-ops",
  authority_domain: "autonomous-vehicle-fleet",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:fleet-safety-operator"],
  physical_bounds: {
    permitted_boundary_id: "sf-soma-odd",
    permitted_odd_id: "sf-soma-daylight",
    permitted_road_classes: ["urban-arterial", "residential"],
    max_speed_mps: 13.4,
    min_map_confidence: 0.97,
    min_localization_confidence: 0.98,
    min_perception_confidence: 0.95,
    require_mrc_available: true,
    permitted_drive_states: ["parked", "remote_assist", "low_speed_autonomy"]
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["VEHICLE_SAFETY"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-av-fleet-safety-001",
  ward_id: ward.ward_id,
  subject: "agent:fleet-safety-operator",
  allowed_actions: ["fleet.vehicle.hold", "ota.campaign.stage", "map.update.activate", "remote_assist.command", "simulation.scenario.run"],
  denied_actions: ["vehicle.disable_safety_envelope", "vehicle.override.mrc"],
  constraints: {
    required_runtime_registers: ["telemetry.vehicle_id", "telemetry.odd_id", "telemetry.drive_state", "telemetry.mrc_available", "telemetry.safety_case_id"],
    dual_control: { actions: ["ota.campaign.stage", "map.update.activate", "remote_assist.command"], required: 2, ttl_ms: 900000 },
    budget: { maxCallsPerWindow: 500, windowMs: 3600000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-vehicle-safety-root",
  classification: { level: "CUI", caveats: ["VEHICLE_SAFETY"] }
};

const ctx = {
  action_id: "act-av-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-av-001",
  safety,
  classification: { level: "CUI" as const, caveats: ["VEHICLE_SAFETY"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-automotive-")), "gel.jsonl");
}

test("automotive adapter builders produce Canonical Governed Actions", () => {
  const ros = ros2DdsCommandToAction({ topic: "/vehicle/behavior", message_type: "BehaviorRequest", command: "hold" }, ctx);
  assert.equal(ros.action_type, "ros2.command.publish");
  assert.equal(ros.params.adapter, "ros2-dds");
  assert.equal(ros.params.mrc_available, true);

  const autosar = autosarAdaptiveToAction({ service: "VehicleDiagnostics", method: "ReadDtc", instance_id: "primary" }, { ...ctx, action_id: "act-av-002" });
  assert.equal(autosar.action_type, "autosar.service.invoke");

  const ota = otaCampaignToAction({ campaign_id: "AVOS-2026.05.25", image_digest: "sha256:test", rollout_wave: "canary", operation: "stage" }, { ...ctx, action_id: "act-av-003", safety: { ...safety, drive_state: "parked", speed_mps: 0, ota_image_digest: "sha256:test" } });
  assert.equal(ota.action_type, "ota.campaign.stage");

  const map = mapUpdateToAction({ map_id: "sf-soma", map_version: "2026.05.25", operation: "activate", odd_id: "sf-soma-daylight" }, { ...ctx, action_id: "act-av-004" });
  assert.equal(map.action_type, "map.update.activate");

  const remote = automotiveAdapterToAction({
    kind: "remote-assist",
    request: { session_id: "RA-8831", operator_id: "operator:remote-assist-west", command: "pull_over", reason: "construction closure" }
  }, { ...ctx, action_id: "act-av-005", safety: { ...safety, drive_state: "remote_assist", speed_mps: 3.2, remote_assist_session_id: "RA-8831", operator_id: "operator:remote-assist-west" } });
  assert.equal(remote.action_type, "remote_assist.command");

  const fleet = fleetManagementToAction({ fleet_id: "fleet-west", vehicle_id: "AV-1042", operation: "hold" }, { ...ctx, action_id: "act-av-006" });
  assert.equal(fleet.action_type, "fleet.vehicle.hold");

  const sim = simulationScenarioToAction({ scenario_id: "SOMA-unprotected-left-001", simulator: "carla", operation: "run" }, { ...ctx, action_id: "act-av-007" });
  assert.equal(sim.action_type, "simulation.scenario.run");
});

test("sample automotive Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "automotive");
  const sampleWard = loadWardManifest(path.join(base, "ward.fleet_region_west.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.fleet_safety_operator.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "fleet_vehicle_hold.json"));
  const speedViolation = loadCanonicalAction(path.join(base, "actions", "refuse_speed_envelope_violation.json"));
  const denied = loadCanonicalAction(path.join(base, "actions", "refuse_disable_safety_envelope.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const blockedByInvariant = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: speedViolation, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedByInvariant.decision, "REFUSE");
  assert.ok(blockedByInvariant.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(blockedByInvariant.warrant, undefined);

  const blockedByEnvelope = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: denied, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedByEnvelope.decision, "REFUSE");
  assert.ok(blockedByEnvelope.reason_codes.includes("ACTION_DENIED"));
});

test("vehicle safety invariants refuse hard interlocks even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "vehicle.disable_safety_envelope"], denied_actions: [] };
  const action = autosarAdaptiveToAction(
    { service: "VehicleSafetyEnvelope", method: "disable", instance_id: "primary", action_type: "vehicle.disable_safety_envelope" },
    ctx
  );
  const directPig = evaluateVehicleSafetyInvariants(action, ward);
  assert.equal(directPig.ok, false);
  assert.ok(directPig.detail.includes("hard vehicle safety interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control vehicle actions fail closed without an approval store", () => {
  const action = otaCampaignToAction({
    campaign_id: "AVOS-2026.05.25",
    image_digest: "sha256:canary",
    rollout_wave: "canary",
    operation: "stage"
  }, { ...ctx, action_id: "act-av-ota-001", safety: { ...safety, drive_state: "parked", speed_mps: 0, ota_image_digest: "sha256:canary" } });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control vehicle actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = remoteAssistToAction({
    session_id: "RA-8831",
    operator_id: "operator:remote-assist-west",
    command: "pull_over",
    reason: "construction closure"
  }, { ...ctx, action_id: "act-av-remote-001", safety: { ...safety, drive_state: "remote_assist", speed_mps: 3.2, remote_assist_session_id: "RA-8831", operator_id: "operator:remote-assist-west" } });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  assert.equal(pending.required, 2);
  approvalStore.vote(pending.request_id, "operator:safety-lead", "approve", "safety case checked", now);
  approvalStore.vote(pending.request_id, "operator:ops-watch", "approve", "remote assist verified", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("automotive evidence bundle wraps execution evidence with vehicle safety context", () => {
  const action = fleetManagementToAction({ fleet_id: "fleet-west", vehicle_id: "AV-1042", operation: "hold" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: vehicleSafetySnapshotToRuntimeRegister(safety) });
  const bundle = exportAutomotiveEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    automotive: {
      fleet_id: "fleet-west",
      vehicle_id: "AV-1042",
      safety_operator: "operator:fleet-safety-west",
      automotive_domain: "fleet-operations",
      operational_scope: "sf-soma-odd",
      odd_id: "sf-soma-daylight",
      software_version: "AVOS-2026.05.25",
      map_version: "2026.05.25",
      safety_case_id: "SC-AV-WEST-2026-001",
      pre_checks: [{ name: "mrc available", ok: true }, { name: "odd bound", ok: true }],
      post_checks: [{ name: "vehicle hold state observed", ok: true }],
      standards_profile: ["ISO_26262", "ISO_21448", "ISO_21434", "UNECE_R155", "UNECE_R156"],
      redacted_fields: ["vin", "passenger_id"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.automotive-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyAutomotiveEvidenceBundle(bundle).ok, true);
});
