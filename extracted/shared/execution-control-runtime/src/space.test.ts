import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type SpaceOrbitalRuntimeSnapshot,
  type SpaceRuntimeSnapshot,
  type WardManifest,
  deorbitReentryToAction,
  evaluateExecutionControl,
  exportSpaceEvidenceBundle,
  exportSpaceOrbitalEvidenceBundle,
  flightTerminationToAction,
  groundSystemsToAction,
  groundStationContactToAction,
  ignitionToAction,
  orbitManeuverToAction,
  payloadTaskingToAction,
  spacePayloadToAction,
  propellantToAction,
  rangeSafetyToAction,
  rfTransmissionToAction,
  spaceOrbitalAdapterToAction,
  spaceOrbitalSnapshotToRuntimeRegister,
  spaceSnapshotToRuntimeRegister,
  verifySpaceOrbitalEvidenceBundle,
  verifySpaceEvidenceBundle
} from "./index.js";

const now = "2026-05-26T14:00:00.000Z";

const snapshot: SpaceRuntimeSnapshot = {
  flight_id: "FL-DEMO-CCSFS-2026-05-26-001",
  vehicle_class: "orbital-launch-vehicle",
  vehicle_model: "demo-launch-vehicle",
  operator_id: "operator:demo-launch",
  launch_site: "ccsfs",
  site_rule_version: "ccsfs-demo-2026-05-26",
  countdown_phase: "terminal-count",
  window_open_at: "2026-05-26T13:30:00.000Z",
  window_close_at: "2026-05-26T15:30:00.000Z",
  range_clear: true,
  surface_wind_kts: 18,
  upper_wind_shear_kts_per_kft: 22,
  weather_within_limits: true,
  fts_armed: true,
  afts_nominal: true,
  fts_battery_ok: true,
  fts_rf_link_ok: true,
  propellant_temp_k_within_spec: true,
  itar_cleared: true,
  comms_licensed: true,
  expected_max_q_kpa: 28,
  hazard_area_cleared: true,
  tracking_radar_acquired: true,
  range_commander_go: true,
  authority_envelope_unrevoked: true,
  signer_authorized: true,
  actor_id: "actor:launch-director"
};

const ward: WardManifest = {
  ward_id: "ward-space-launch-ccsfs",
  name: "Demo CCSFS Launch Operations (DEMONSTRATION ONLY)",
  sovereignty_context: "ussf-sld-45",
  authority_domain: "space-launch-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:launch-orchestrator"],
  physical_bounds: {
    permitted_launch_sites: ["ccsfs", "vandenberg", "wallops", "starbase", "kodiak", "mojave"],
    permitted_vehicle_classes: ["orbital-launch-vehicle", "suborbital-launch-vehicle", "reentry-vehicle"],
    max_surface_wind_kts: 30,
    max_upper_wind_shear_kts_per_kft: 30,
    max_q_kpa: 35,
    require_range_clear: true,
    require_weather_within_limits: true,
    require_fts_armed: true,
    require_afts_nominal: true,
    require_fts_battery_ok: true,
    require_fts_rf_link_ok: true,
    require_propellant_temp_in_spec: true,
    require_itar_cleared: true,
    require_comms_licensed: true,
    require_hazard_area_cleared: true,
    require_tracking_radar_acquired: true,
    require_range_commander_go: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["SPACE_OPS", "DEMONSTRATION_ONLY"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-space-launch-001",
  ward_id: ward.ward_id,
  subject: "agent:launch-orchestrator",
  allowed_actions: [
    "space.range_clear_declare",
    "space.range_commander_go",
    "space.range_hold",
    "space.propellant_load",
    "space.propellant_drain",
    "space.propellant_top_off",
    "space.igniter_arm",
    "space.ignite",
    "space.abort_ignition",
    "space.fts_arm",
    "space.fts_disarm",
    "space.fts_trigger",
    "space.payload_deploy",
    "space.payload_despin",
    "space.payload_separate",
    "space.water_deluge_arm",
    "space.hold_down_release",
    "space.pad_emergency_stop",
    "space.comms_freq_acknowledge",
    "space.weather_constraint_acknowledge",
    "space.historian_write"
  ],
  denied_actions: [
    "space.disable_flight_termination",
    "space.override_range_safety",
    "space.bypass_collision_avoidance",
    "space.ignite_outside_window",
    "space.bypass_wind_limits",
    "space.override_propellant_limits",
    "space.bypass_pad_interlocks",
    "space.payload_deploy_outside_primary"
  ],
  constraints: {
    required_runtime_registers: [
      "telemetry.launch_site",
      "telemetry.vehicle_class",
      "telemetry.countdown_phase",
      "telemetry.range_clear",
      "telemetry.weather_within_limits",
      "telemetry.fts_armed",
      "telemetry.afts_nominal",
      "telemetry.range_commander_go",
      "telemetry.itar_cleared",
      "telemetry.comms_licensed"
    ],
    dual_control: {
      actions: ["space.ignite", "space.fts_trigger", "space.payload_deploy", "space.hold_down_release"],
      required: 2,
      ttl_ms: 600000
    },
    budget: { maxCallsPerWindow: 5000, windowMs: 3600000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-space-launch-root",
  classification: { level: "CUI", caveats: ["SPACE_OPS"] }
};

const ctx = {
  action_id: "act-space-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-space-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["SPACE_OPS"] }
};

const orbitalSnapshot: SpaceOrbitalRuntimeSnapshot = {
  asset_id: "sat-aurora-7",
  asset_type: "satellite",
  mission_id: "mission-aurora-earth-observation",
  mission_class: "earth-observation",
  orbit_regime: "LEO",
  ground_station_id: "gs-pine-gap-demo",
  rf_band: "S-band",
  payload_mode: "earth-observation",
  target_region: "us-mountain-west",
  operator_id: "operator:space-flight-director",
  controller_id: "controller:space-ops",
  command_window_active: true,
  command_window_age_ms: 5000,
  ephemeris_age_ms: 30000,
  telemetry_age_ms: 900,
  delta_v_mps: 0.4,
  burn_duration_s: 18,
  conjunction_probability: 0.00001,
  miss_distance_km: 12,
  power_margin_pct: 24,
  thermal_limits_nominal: true,
  attitude_control_stable: true,
  safe_mode_available: true,
  collision_avoidance_enabled: true,
  conjunction_screening_clear: true,
  debris_mitigation_plan_approved: true,
  rf_authorization_active: true,
  ground_station_authorized: true,
  payload_tasking_authorized: true,
  export_control_clearance: true,
  deorbit_plan_approved: true,
  casualty_risk_accepted: true,
  relative_navigation_valid: true,
  operator_console_locked: true,
  policy_version: "0.1.0"
};

const orbitalWard: WardManifest = {
  ward_id: "ward-space-orbital-ops",
  name: "Aurora Orbital Operations Ward",
  sovereignty_context: "licensed-us-commercial-space-operator",
  authority_domain: "space-mission-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:space-mission-controller"],
  physical_bounds: {
    permitted_space_asset_ids: ["sat-aurora-7", "gs-pine-gap-demo"],
    permitted_orbit_regimes: ["LEO", "MEO", "GEO"],
    permitted_space_mission_classes: ["earth-observation", "communications", "space-domain-awareness", "deorbit"],
    permitted_ground_station_ids: ["gs-pine-gap-demo", "gs-alaska-demo"],
    permitted_rf_bands: ["S-band", "X-band"],
    permitted_payload_modes: ["earth-observation", "calibration", "safe"],
    max_delta_v_mps: 1.5,
    max_burn_duration_s: 120,
    max_conjunction_probability: 0.0001,
    min_miss_distance_km: 5,
    min_power_margin_pct: 10,
    max_ephemeris_age_ms: 120000,
    max_command_window_age_ms: 60000,
    max_telemetry_age_ms: 60000,
    require_conjunction_screening_clear: true,
    require_debris_mitigation_plan: true,
    require_rf_authorization: true,
    require_ground_station_authorized: true,
    require_ephemeris_fresh: true,
    require_attitude_control_stable: true,
    require_safe_mode_available: true,
    require_power_margin_positive: true,
    require_thermal_limits_nominal: true,
    require_operator_console_locked: true,
    require_payload_tasking_authorized: true,
    require_export_control_clearance: true,
    require_deorbit_plan_approved: true,
    require_collision_avoidance_enabled: true
  },
  criticality: "safety_critical",
  classification: { level: "SECRET", caveats: ["SPACE_OPS"] }
};

const orbitalEnvelope: AuthorityEnvelope = {
  envelope_id: "ae-space-mission-controller-001",
  ward_id: orbitalWard.ward_id,
  subject: "agent:space-mission-controller",
  allowed_actions: [
    "orbit.stationkeeping.burn",
    "orbit.collision_avoidance.burn",
    "rf.transmit.enable",
    "payload.image.collect",
    "ground_station.contact.schedule",
    "conjunction.assessment.run",
    "rpo.approach.execute",
    "deorbit.burn.execute",
    "space.historian_write"
  ],
  denied_actions: [
    "space.disable_safe_mode",
    "space.disable_collision_avoidance",
    "space.disable_conjunction_screening",
    "space.rf_transmit_without_authorization",
    "space.force_deorbit_without_approval",
    "space.payload_task_denied_target",
    "space.bypass_export_control",
    "space.disable_evidence"
  ],
  constraints: {
    required_runtime_registers: [
      "telemetry.asset_id",
      "telemetry.mission_id",
      "telemetry.orbit_regime",
      "telemetry.command_window_active",
      "telemetry.ephemeris_age_ms",
      "telemetry.conjunction_screening_clear",
      "telemetry.rf_authorization_active",
      "telemetry.ground_station_authorized",
      "telemetry.operator_console_locked"
    ],
    dual_control: {
      actions: ["rpo.approach.execute", "deorbit.burn.execute"],
      required: 2,
      ttl_ms: 600000
    }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-space-orbital-root",
  classification: { level: "SECRET", caveats: ["SPACE_OPS"] }
};

const orbitalCtx = {
  action_id: "act-space-orbital-001",
  ward_id: orbitalWard.ward_id,
  subject: orbitalEnvelope.subject,
  requested_at: now,
  request_id: "req-space-orbital-001",
  snapshot: orbitalSnapshot,
  classification: { level: "SECRET" as const, caveats: ["SPACE_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-space-")), "gel.jsonl");
}

// ---------------------------------------------------------------------------

test("space adapter builders produce Canonical Governed Actions with snapshot params merged in", () => {
  const a = ignitionToAction({ action_type: "space.igniter_arm", stage: "stage-1" }, ctx);
  assert.equal(a.action_type, "space.igniter_arm");
  assert.equal(a.params.launch_site, "ccsfs");
  assert.equal(a.params.fts_armed, true);
  assert.equal(a.params.stage, "stage-1");
});

test("clean countdown-resume action ALLOWs through the gate with all invariants satisfied", () => {
  const action = rangeSafetyToAction({ action_type: "space.range_commander_go" }, ctx);
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(snapshot)
  });
  assert.equal(r.decision, "ALLOW", `expected ALLOW, got ${r.decision} (${r.reason_codes.join(",")})`);
  assert.ok(r.warrant);
});

test("propellant load action ALLOWs in nominal conditions", () => {
  const action = propellantToAction({ action_type: "space.propellant_load", stage: "stage-1", volume_l: 30000 }, ctx);
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(snapshot)
  });
  assert.equal(r.decision, "ALLOW");
});

test("ignite REFUSEs when range is not clear", () => {
  const localCtx = { ...ctx, snapshot: { ...snapshot, range_clear: false } };
  const action = ignitionToAction({ action_type: "space.ignite", stage: "stage-1" }, localCtx);
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(localCtx.snapshot)
  });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("ignite REFUSEs when surface wind exceeds site limit", () => {
  const localCtx = { ...ctx, snapshot: { ...snapshot, surface_wind_kts: 35 } };
  const action = ignitionToAction({ action_type: "space.ignite", stage: "stage-1" }, localCtx);
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(localCtx.snapshot)
  });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("ignite REFUSEs when FTS is not armed", () => {
  const localCtx = { ...ctx, snapshot: { ...snapshot, fts_armed: false } };
  const action = ignitionToAction({ action_type: "space.ignite", stage: "stage-1" }, localCtx);
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(localCtx.snapshot)
  });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("hard interlock: space.disable_flight_termination is REFUSEd even if envelope mistakenly allowed it", () => {
  const reuseEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "space.disable_flight_termination"], denied_actions: [] };
  const action = flightTerminationToAction({ action_type: "space.disable_flight_termination", reason: "operator panic" }, ctx);
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: reuseEnvelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(snapshot)
  });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("hard interlock: space.override_range_safety is REFUSEd", () => {
  const reuseEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "space.override_range_safety"], denied_actions: [] };
  const action = rangeSafetyToAction({ action_type: "space.override_range_safety", reason: "wave it through" }, ctx);
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: reuseEnvelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(snapshot)
  });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("hard interlock: space.ignite_outside_window is REFUSEd", () => {
  const reuseEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "space.ignite_outside_window"], denied_actions: [] };
  const action = ignitionToAction({ action_type: "space.ignite_outside_window", stage: "stage-1" }, ctx);
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: reuseEnvelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(snapshot)
  });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("hard interlock: space.payload_deploy_outside_primary is REFUSEd", () => {
  const reuseEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "space.payload_deploy_outside_primary"], denied_actions: [] };
  const action = spacePayloadToAction({ action_type: "space.payload_deploy_outside_primary", payload_id: "sat-1" }, ctx);
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: reuseEnvelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(snapshot)
  });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("dual-control: ignite ESCALATEs without approvals then ALLOWs with two", async () => {
  const { ApprovalStore } = await import("./index.js");
  const approvalStore = ApprovalStore.memory();
  const action = ignitionToAction({ action_type: "space.ignite", stage: "stage-1" }, ctx);
  const first = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    approvalStore,
    runtimeRegister: spaceSnapshotToRuntimeRegister(snapshot)
  });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "operator:launch-director", "approve", "range green, weather green, vehicle green", now);
  approvalStore.vote(pending.request_id, "operator:range-commander", "approve", "range commander GO concurrent", now);
  const second = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    ledgerPath: ledgerPath(), now, replayProtection: false,
    approvalStore,
    runtimeRegister: spaceSnapshotToRuntimeRegister(snapshot)
  });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("space Evidence Bundle wraps execution evidence with space context and verifies; tampering breaks verification", () => {
  const action = groundSystemsToAction({ action_type: "space.water_deluge_arm" }, ctx);
  const ledger = ledgerPath();
  const r = evaluateExecutionControl({
    ward, authorityEnvelope: envelope, action,
    ledgerPath: ledger, now, replayProtection: false,
    runtimeRegister: spaceSnapshotToRuntimeRegister(snapshot)
  });
  assert.equal(r.decision, "ALLOW");
  const bundle = exportSpaceEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: r.gel_record.record_id,
    warrant: r.warrant,
    exportedAt: now,
    space: {
      flight_id: snapshot.flight_id,
      operator_id: snapshot.operator_id,
      launch_site: snapshot.launch_site,
      site_rule_version: snapshot.site_rule_version,
      vehicle_class: snapshot.vehicle_class,
      vehicle_model: snapshot.vehicle_model,
      countdown_phase: snapshot.countdown_phase,
      window_open_at: snapshot.window_open_at,
      window_close_at: snapshot.window_close_at,
      range_commander_id: "operator:range-commander",
      itar_posture: "cleared",
      comms_licensing_posture: "filed",
      regulatory_evidence_profile: ["FAA_PART_450", "FAA_AST_LICENSE", "USSF_RANGE_SAFETY", "ITAR_USML_IV", "ITAR_USML_XV", "FCC_PART_25"],
      rule_validation_state: "demonstration",
      pre_checks: [
        { name: "range_clear", ok: true },
        { name: "fts_armed", ok: true },
        { name: "weather_within_limits", ok: true },
        { name: "range_commander_go", ok: true }
      ],
      post_checks: [{ name: "warrant single-use consumed", ok: true }],
      redacted_fields: ["payload_telemetry"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.space-evidence.v1");
  assert.equal(bundle.verification.ok, true, `failures=${bundle.verification.failures.join(";")}`);

  // Tamper-detection
  const tampered = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
  tampered.space.range_commander_id = "operator:attacker";
  const ver = verifySpaceEvidenceBundle(tampered);
  assert.equal(ver.ok, false);
  assert.ok(ver.failures.some((f) => f.includes("space context hash")));
});

test("orbital space adapter builders produce Canonical Governed Actions", () => {
  const burn = orbitManeuverToAction({ maneuver_id: "mnv-1", operation: "stationkeeping" }, orbitalCtx);
  assert.equal(burn.action_type, "orbit.stationkeeping.burn");
  assert.equal(burn.params.adapter, "orbit-maneuver");
  assert.equal(burn.params.asset_id, "sat-aurora-7");

  assert.equal(rfTransmissionToAction({ carrier_id: "car-1", operation: "enable", rf_band: "S-band" }, { ...orbitalCtx, action_id: "act-orb-rf" }).action_type, "rf.transmit.enable");
  assert.equal(payloadTaskingToAction({ task_id: "task-1", operation: "image-collect", payload_mode: "earth-observation" }, { ...orbitalCtx, action_id: "act-orb-payload" }).action_type, "payload.image.collect");
  assert.equal(groundStationContactToAction({ contact_id: "ct-1", ground_station_id: "gs-pine-gap-demo", operation: "schedule" }, { ...orbitalCtx, action_id: "act-orb-gs" }).action_type, "ground_station.contact.schedule");
  assert.equal(spaceOrbitalAdapterToAction({ kind: "orbit-maneuver", request: { maneuver_id: "mnv-2", operation: "stationkeeping" } }, { ...orbitalCtx, action_id: "act-orb-generic" }).action_type, "orbit.stationkeeping.burn");
});

test("orbital stationkeeping ALLOWs and issues a Warrant", () => {
  const action = orbitManeuverToAction({ maneuver_id: "mnv-clean-001", operation: "stationkeeping" }, orbitalCtx);
  const r = evaluateExecutionControl({
    ward: orbitalWard,
    authorityEnvelope: orbitalEnvelope,
    action,
    ledgerPath: ledgerPath(),
    now,
    replayProtection: false,
    runtimeRegister: spaceOrbitalSnapshotToRuntimeRegister(orbitalSnapshot)
  });
  assert.equal(r.decision, "ALLOW", `expected ALLOW, got ${r.decision} (${r.reason_codes.join(",")})`);
  assert.ok(r.warrant);
});

test("orbital invariants REFUSE unsafe or unauthorized mission state", () => {
  const localCtx = { ...orbitalCtx, snapshot: { ...orbitalSnapshot, conjunction_screening_clear: false } };
  const action = orbitManeuverToAction({ maneuver_id: "mnv-unsafe-001", operation: "stationkeeping" }, localCtx);
  const r = evaluateExecutionControl({
    ward: orbitalWard,
    authorityEnvelope: orbitalEnvelope,
    action,
    ledgerPath: ledgerPath(),
    now,
    replayProtection: false,
    runtimeRegister: spaceOrbitalSnapshotToRuntimeRegister(localCtx.snapshot)
  });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("orbital hard interlock REFUSEs even if envelope mistakenly allows it", () => {
  const badEnvelope = { ...orbitalEnvelope, allowed_actions: [...orbitalEnvelope.allowed_actions, "space.disable_collision_avoidance"], denied_actions: [] };
  const action = orbitManeuverToAction(
    { maneuver_id: "mnv-bad", operation: "stationkeeping", action_type: "space.disable_collision_avoidance" },
    { ...orbitalCtx, action_id: "act-orb-interlock" }
  );
  const r = evaluateExecutionControl({
    ward: orbitalWard,
    authorityEnvelope: badEnvelope,
    action,
    ledgerPath: ledgerPath(),
    now,
    replayProtection: false,
    runtimeRegister: spaceOrbitalSnapshotToRuntimeRegister(orbitalSnapshot)
  });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("orbital deorbit requires dual-control before ALLOW", async () => {
  const { ApprovalStore } = await import("./index.js");
  const approvalStore = ApprovalStore.memory();
  const action = deorbitReentryToAction(
    { disposal_id: "disp-approved-001", operation: "deorbit-burn" },
    { ...orbitalCtx, action_id: "act-orb-deorbit", snapshot: { ...orbitalSnapshot, mission_class: "deorbit" } }
  );
  const first = evaluateExecutionControl({
    ward: orbitalWard,
    authorityEnvelope: orbitalEnvelope,
    action,
    ledgerPath: ledgerPath(),
    now,
    replayProtection: false,
    approvalStore,
    runtimeRegister: spaceOrbitalSnapshotToRuntimeRegister({ ...orbitalSnapshot, mission_class: "deorbit" })
  });
  assert.equal(first.decision, "ESCALATE");
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "operator:flight-director", "approve", "conjunction clear and disposal plan approved", now);
  approvalStore.vote(pending.request_id, "operator:mission-assurance", "approve", "casualty risk and passivation reviewed", now);
  const second = evaluateExecutionControl({
    ward: orbitalWard,
    authorityEnvelope: orbitalEnvelope,
    action,
    ledgerPath: ledgerPath(),
    now,
    replayProtection: false,
    approvalStore,
    runtimeRegister: spaceOrbitalSnapshotToRuntimeRegister({ ...orbitalSnapshot, mission_class: "deorbit" })
  });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("orbital Space Evidence Bundle wraps execution evidence and verifies; tampering breaks verification", () => {
  const action = orbitManeuverToAction({ maneuver_id: "mnv-evidence-001", operation: "stationkeeping" }, orbitalCtx);
  const ledger = ledgerPath();
  const r = evaluateExecutionControl({
    ward: orbitalWard,
    authorityEnvelope: orbitalEnvelope,
    action,
    ledgerPath: ledger,
    now,
    replayProtection: false,
    runtimeRegister: spaceOrbitalSnapshotToRuntimeRegister(orbitalSnapshot)
  });
  const bundle = exportSpaceOrbitalEvidenceBundle({
    ledgerPath: ledger,
    ward: orbitalWard,
    authorityEnvelope: orbitalEnvelope,
    recordId: r.gel_record.record_id,
    warrant: r.warrant,
    exportedAt: now,
    orbital: {
      mission_id: orbitalSnapshot.mission_id,
      asset_id: orbitalSnapshot.asset_id,
      asset_type: orbitalSnapshot.asset_type,
      mission_class: orbitalSnapshot.mission_class,
      orbit_regime: orbitalSnapshot.orbit_regime,
      operator_id: orbitalSnapshot.operator_id,
      ground_station_id: orbitalSnapshot.ground_station_id,
      rf_band: orbitalSnapshot.rf_band,
      payload_mode: orbitalSnapshot.payload_mode,
      maneuver_id: "mnv-evidence-001",
      conjunction_probability: orbitalSnapshot.conjunction_probability,
      miss_distance_km: orbitalSnapshot.miss_distance_km,
      regulatory_evidence_profile: ["FCC_ITU_SPECTRUM", "SSA_CONJUNCTION_SCREENING", "IADC_DEBRIS_MITIGATION", "MISSION_ASSURANCE"],
      redaction_manifest: {
        redacted_fields: ["target_region", "ground_station_precise_location"],
        retained_hashes: ["canonical_action_hash", "warrant_id", "gel_record_hash"]
      }
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.space-orbital-evidence.v1");
  assert.equal(bundle.verification.ok, true, `failures=${bundle.verification.failures.join(";")}`);

  const tampered = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
  tampered.orbital.asset_id = "sat-attacker";
  const ver = verifySpaceOrbitalEvidenceBundle(tampered);
  assert.equal(ver.ok, false);
  assert.ok(ver.failures.some((f) => f.includes("orbital context hash")));
});
