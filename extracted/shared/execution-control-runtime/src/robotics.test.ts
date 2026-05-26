import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type RoboticsRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  evaluateExecutionControl,
  evaluateRoboticsSafetyInvariants,
  exportRoboticsEvidenceBundle,
  hriToAction,
  humanoidLocomotionToAction,
  manipulationToAction,
  mobileBaseToAction,
  motionToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  roboticsAdapterToAction,
  roboticsFleetToAction,
  roboticsHistorianWriteToAction,
  roboticsSnapshotToRuntimeRegister,
  safetyConfigToAction,
  teleopToAction,
  verifyRoboticsEvidenceBundle
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: RoboticsRuntimeSnapshot = {
  asset_id: "HUM-A-01",
  asset_type: "humanoid",
  workcell_id: "cell-humanoid-a",
  robot_zone: "zone-assembly-1",
  system_model_id: "model-hum-2026-05-25",
  operating_mode: "collaborative",
  robot_state: "running",
  tcp_speed_mm_s: 250,
  force_n: 50,
  torque_nm: 10,
  power_w: 30,
  separation_distance_mm: 800,
  com_deviation_mm: 20,
  step_height_mm: 120,
  payload_kg: 5,
  telemetry_age_ms: 400,
  estop_functional: true,
  protective_stop_armed: true,
  ssm_active: true,
  pfl_active: true,
  collision_detection_active: true,
  safety_scanner_active: true,
  human_present: true,
  balance_controller_active: true,
  fall_protection_armed: true,
  teleop_link_healthy: true,
  operator_qualified: true,
  operator_id: "operator:cell-a",
  task_id: "TASK-3391",
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-robotics-humanoid-cell",
  name: "Humanoid Collaborative Cell A",
  sovereignty_context: "operator-robotics-authority",
  authority_domain: "robotics-humanoid-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:robot-ops-orchestrator"],
  physical_bounds: {
    permitted_workcell_id: "cell-humanoid-a",
    permitted_robot_zones: ["zone-assembly-1", "zone-handover", "zone-walkway"],
    permitted_asset_types: ["humanoid", "cobot", "amr", "gripper"],
    permitted_operating_modes: ["automatic", "t1-reduced-speed", "collaborative"],
    permitted_robot_states: ["idle", "running", "paused", "recovery"],
    max_tcp_speed_mm_s: 1500,
    max_force_n: 140,
    max_torque_nm: 40,
    max_power_w: 80,
    min_separation_distance_mm: 500,
    max_com_deviation_mm: 60,
    max_step_height_mm: 200,
    max_payload_kg: 25,
    max_telemetry_age_ms: 1000,
    require_estop_functional: true,
    require_protective_stop_armed: true,
    require_ssm_active: true,
    require_pfl_active: true,
    require_collision_detection_active: true,
    require_safety_scanner_active: true,
    require_balance_controller_active: true,
    require_fall_protection_armed: true,
    require_collaborative_mode_when_human_present: true,
    require_operator_qualified: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["ROBOTICS_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-robotics-operations-001",
  ward_id: ward.ward_id,
  subject: "agent:robot-ops-orchestrator",
  allowed_actions: [
    "motion.move",
    "motion.trajectory.execute",
    "manipulation.grasp",
    "manipulation.release",
    "manipulation.force.apply",
    "base.navigate",
    "humanoid.step.execute",
    "humanoid.posture.set",
    "humanoid.locomotion.start",
    "teleop.mode.set",
    "teleop.takeover",
    "hri.handover",
    "hri.collaborative.start",
    "safety.zone.configure",
    "fleet.task.assign",
    "fleet.dispatch",
    "historian.record.write"
  ],
  denied_actions: ["robot.disable_estop", "robot.override_speed_separation_monitoring", "robot.override_power_force_limiting", "humanoid.disable_balance_controller", "humanoid.disable_fall_protection"],
  constraints: {
    required_runtime_registers: [
      "telemetry.asset_id",
      "telemetry.workcell_id",
      "telemetry.robot_zone",
      "telemetry.operating_mode",
      "telemetry.estop_functional",
      "telemetry.protective_stop_armed",
      "telemetry.ssm_active",
      "telemetry.pfl_active",
      "telemetry.collision_detection_active",
      "telemetry.safety_scanner_active",
      "telemetry.operator_qualified",
      "telemetry.operator_id"
    ],
    dual_control: { actions: ["manipulation.force.apply", "humanoid.locomotion.start", "teleop.takeover", "fleet.dispatch"], required: 2, ttl_ms: 600000 },
    budget: { maxCallsPerWindow: 600, windowMs: 3600000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-robotics-ops-root",
  classification: { level: "CUI", caveats: ["ROBOTICS_OPS"] }
};

const ctx = {
  action_id: "act-robotics-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-robotics-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["ROBOTICS_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-robotics-")), "gel.jsonl");
}

function expectRefuse(snapshotOverride: Partial<RoboticsRuntimeSnapshot>, label: string) {
  const action = humanoidLocomotionToAction(
    { humanoid_id: "HUM-A-01", operation: "step" },
    { ...ctx, action_id: `act-${Math.random().toString(36).slice(2)}`, snapshot: { ...snapshot, ...snapshotOverride } }
  );
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE", `${label} should REFUSE`);
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"), `${label} should fail a physical invariant`);
}

test("robotics adapter builders produce Canonical Governed Actions", () => {
  const motion = motionToAction({ robot_id: "ARM-1", operation: "move", target: { joint: [0, 1] } }, ctx);
  assert.equal(motion.action_type, "motion.move");
  assert.equal(motion.params.adapter, "motion-control");
  assert.equal(motion.params.workcell_id, "cell-humanoid-a");

  const grasp = manipulationToAction({ robot_id: "ARM-1", operation: "force-apply", value: { newtons: 50 } }, { ...ctx, action_id: "act-robotics-002" });
  assert.equal(grasp.action_type, "manipulation.force.apply");

  const base = mobileBaseToAction({ base_id: "AMR-9", operation: "navigate", goal: { x: 3, y: 2 } }, { ...ctx, action_id: "act-robotics-003", snapshot: { ...snapshot, asset_type: "amr" } });
  assert.equal(base.action_type, "base.navigate");

  const step = humanoidLocomotionToAction({ humanoid_id: "HUM-A-01", operation: "step" }, { ...ctx, action_id: "act-robotics-004" });
  assert.equal(step.action_type, "humanoid.step.execute");

  const locomotion = humanoidLocomotionToAction({ humanoid_id: "HUM-A-01", operation: "locomotion-start" }, { ...ctx, action_id: "act-robotics-005" });
  assert.equal(locomotion.action_type, "humanoid.locomotion.start");

  const teleop = teleopToAction({ robot_id: "HUM-A-01", operation: "takeover" }, { ...ctx, action_id: "act-robotics-006" });
  assert.equal(teleop.action_type, "teleop.takeover");

  const hri = hriToAction({ robot_id: "HUM-A-01", operation: "handover" }, { ...ctx, action_id: "act-robotics-007" });
  assert.equal(hri.action_type, "hri.handover");

  const safety = safetyConfigToAction({ robot_id: "HUM-A-01", operation: "zone-configure", value: { zone: "z1" } }, { ...ctx, action_id: "act-robotics-008" });
  assert.equal(safety.action_type, "safety.zone.configure");

  const fleet = roboticsFleetToAction({ fleet_id: "FLEET-A", operation: "task-assign", task_id: "T-1" }, { ...ctx, action_id: "act-robotics-009" });
  assert.equal(fleet.action_type, "fleet.task.assign");

  const historian = roboticsHistorianWriteToAction({ historian_id: "HIST-R", stream: "motion", record_type: "operator-note", payload: { note: "step ok" } }, { ...ctx, action_id: "act-robotics-010" });
  assert.equal(historian.action_type, "historian.record.write");

  const viaDispatcher = roboticsAdapterToAction({ kind: "motion-control", request: { robot_id: "ARM-1", operation: "trajectory" } }, { ...ctx, action_id: "act-robotics-011" });
  assert.equal(viaDispatcher.action_type, "motion.trajectory.execute");
});

test("sample robotics Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "robotics");
  const sampleWard = loadWardManifest(path.join(base, "ward.humanoid_cell.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.cell_operator.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "humanoid_step.json"));
  const force = loadCanonicalAction(path.join(base, "actions", "refuse_force_over_limit.json"));
  const separation = loadCanonicalAction(path.join(base, "actions", "refuse_separation_breach.json"));
  const notCollab = loadCanonicalAction(path.join(base, "actions", "refuse_human_present_not_collaborative.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  for (const [action, label] of [[force, "force"], [separation, "separation"], [notCollab, "not-collaborative"]] as const) {
    const result = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
    assert.equal(result.decision, "REFUSE", `${label} fixture should REFUSE`);
    assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  }
});

test("robotics safety invariants refuse a broad set of unsafe conditions", () => {
  expectRefuse({ force_n: 200 }, "force over biomechanical limit");
  expectRefuse({ tcp_speed_mm_s: 1800 }, "TCP speed over limit");
  expectRefuse({ torque_nm: 60 }, "torque over limit");
  expectRefuse({ power_w: 120 }, "power over limit");
  expectRefuse({ separation_distance_mm: 300 }, "separation breach (SSM)");
  expectRefuse({ com_deviation_mm: 90 }, "center-of-mass deviation (balance)");
  expectRefuse({ step_height_mm: 260 }, "step height over limit");
  expectRefuse({ ssm_active: false }, "speed-separation monitoring off");
  expectRefuse({ pfl_active: false }, "power-force limiting off");
  expectRefuse({ estop_functional: false }, "e-stop not functional");
  expectRefuse({ collision_detection_active: false }, "collision detection off");
  expectRefuse({ safety_scanner_active: false }, "safety scanner off");
  expectRefuse({ balance_controller_active: false }, "humanoid balance controller off");
  expectRefuse({ fall_protection_armed: false }, "humanoid fall protection off");
  expectRefuse({ human_present: true, operating_mode: "automatic" }, "human present but not collaborative mode");
  expectRefuse({ operator_qualified: false }, "operator not qualified");
});

test("robotics hard interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "humanoid.disable_balance_controller"], denied_actions: [] };
  const action = humanoidLocomotionToAction(
    { humanoid_id: "HUM-A-01", operation: "posture-set", action_type: "humanoid.disable_balance_controller" },
    { ...ctx, action_id: "act-robotics-disable-001" }
  );
  const direct = evaluateRoboticsSafetyInvariants(action, ward);
  assert.equal(direct.ok, false);
  assert.ok(direct.detail.includes("hard robotics safety interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control robotics actions fail closed without an approval store", () => {
  const action = manipulationToAction({ robot_id: "HUM-A-01", operation: "force-apply", value: { newtons: 50 } }, { ...ctx, action_id: "act-robotics-force-001" });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control robotics actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = manipulationToAction({ robot_id: "HUM-A-01", operation: "force-apply", value: { newtons: 50 } }, { ...ctx, action_id: "act-robotics-force-002" });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "operator:cell-supervisor", "approve", "PFL limits and separation verified", now);
  approvalStore.vote(pending.request_id, "operator:safety-engineer", "approve", "collaborative mode and biomechanical limits confirmed", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("robotics evidence bundle wraps execution evidence with cell context", () => {
  const action = humanoidLocomotionToAction({ humanoid_id: "HUM-A-01", operation: "step" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: roboticsSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportRoboticsEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    robotics: {
      operator_id: "operator-cell-a",
      control_station: "cell-a-hmi",
      robotics_domain: "humanoid",
      operational_scope: "cell-humanoid-a",
      asset_id: "HUM-A-01",
      workcell_id: "cell-humanoid-a",
      robot_zone: "zone-assembly-1",
      system_model_id: "model-hum-2026-05-25",
      task_id: "TASK-3391",
      controller_id: "operator:cell-a",
      collaboration_risk_class: "medium",
      regulatory_evidence_profile: ["ISO_10218", "ISO_TS_15066", "ISO_13482", "ISO_13849", "PFL", "SSM"],
      pre_checks: [{ name: "PFL active", ok: true }, { name: "SSM active", ok: true }, { name: "balance controller active", ok: true }],
      post_checks: [{ name: "separation maintained", ok: true }],
      redacted_fields: ["operator_phone", "facility_layout"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.robotics-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyRoboticsEvidenceBundle(bundle).ok, true);
});
