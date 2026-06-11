import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type SwarmRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  airspaceAuthorityCompilerToAction,
  balloonMothershipToAction,
  evaluateExecutionControl,
  evaluateSwarmSafetyInvariants,
  exportSwarmEvidenceBundle,
  fluidityTokenToAction,
  flightWarrantServiceToAction,
  launchReadinessToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  meshRelayToAction,
  missionReconstructionToAction,
  nextSwarmFlightState,
  swarmAdapterToAction,
  swarmHistorianWriteToAction,
  swarmOrchestratorToAction,
  swarmPayloadCoordinationToAction,
  swarmSnapshotToRuntimeRegister,
  verifySwarmEvidenceBundle
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: SwarmRuntimeSnapshot = {
  asset_id: "swarm-wildfire-west-1",
  asset_type: "swarm-lead",
  swarm_id: "swarm-wildfire-west-1",
  mission_id: "MSN-WF-2026-05-25-A",
  mission_class: "wildfire",
  operation_volume_id: "vol-wildfire-west-1",
  system_model_id: "model-swarm-2026-05-25",
  flight_state: "mesh-relay",
  flight_state_since: "2026-05-25T14:55:00.000Z",
  swarm_size: 6,
  lead_unit_id: "UAV-WF-01",
  swarm_radius_m: 800,
  unit_separation_m: 60,
  swarm_battery_soc_min_pct: 55,
  mesh_link_quality: 0.7,
  mesh_hops: 2,
  mesh_peers_count: 5,
  mesh_relay_healthy: true,
  authority_sync_age_ms: 3000,
  lost_link_seconds: 5,
  fluidity_token_id: "ft-2026-05-25-001",
  fluidity_token_issued_at: "2026-05-25T14:55:00.000Z",
  fluidity_token_expires_at: "2026-05-25T15:05:00.000Z",
  fluidity_token_valid: true,
  launch_readiness_approved: true,
  recovery_plan_active: true,
  airspace_authorization_active: true,
  no_active_tfr: true,
  geofence_active: true,
  daa_active: true,
  c2_link_healthy: false,
  remote_id_broadcasting: true,
  weather_within_limits: true,
  altitude_agl_ft: 350,
  groundspeed_kts: 50,
  wind_speed_kts: 12,
  visibility_sm: 5,
  payload_kg: 5,
  ops_over_people_authorized: false,
  operator_qualified: true,
  operator_id: "operator:incident-commander",
  waiver_id: "WAIVER-107-2026-WF-WEST",
  coa_ref: "COA-2026-WF-WEST",
  telemetry_age_ms: 1200,
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-swarm-wildfire-west",
  name: "Wildfire Response Swarm West",
  sovereignty_context: "incident-command-authority",
  authority_domain: "swarm-disconnected-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:swarm-ops-orchestrator"],
  physical_bounds: {
    permitted_swarm_id: "swarm-wildfire-west-1",
    permitted_mission_classes: ["wildfire", "disaster-response", "temporary-comms-mesh"],
    permitted_flight_states: ["preflight", "connected", "degraded", "mesh-relay", "hold-safe", "recover", "landing", "landed"],
    permitted_asset_types: ["swarm-lead", "swarm-member"],
    min_swarm_size: 3,
    max_swarm_size: 12,
    max_swarm_radius_m: 1500,
    min_unit_separation_m: 10,
    max_unit_separation_m: 200,
    min_swarm_battery_soc_pct: 30,
    min_mesh_link_quality: 0.5,
    max_mesh_hops: 4,
    max_lost_link_seconds: 30,
    max_authority_sync_age_ms: 10000,
    max_telemetry_age_ms: 5000,
    max_altitude_agl_ft: 400,
    max_groundspeed_kts: 80,
    max_wind_speed_kts: 25,
    max_payload_kg: 30,
    require_mesh_relay_healthy: true,
    require_fluidity_token_valid: true,
    require_launch_readiness_approved: true,
    require_recovery_plan_active: true,
    require_geofence_active: true,
    require_remote_id_broadcasting: true,
    require_daa_active: true,
    require_airspace_authorization: true,
    require_no_active_tfr: true,
    require_weather_within_limits: true,
    require_operator_qualified: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["SWARM_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-swarm-operations-001",
  ward_id: ward.ward_id,
  subject: "agent:swarm-ops-orchestrator",
  allowed_actions: [
    "swarm.mission.tick",
    "swarm.launch.execute",
    "swarm.recover.execute",
    "swarm.hold.safe",
    "swarm.payload.coordinate",
    "swarm.payload.release",
    "mesh.relay.activate",
    "mesh.relay.handover",
    "mesh.revocation.propagate",
    "airspace.authority.compile",
    "launch.readiness.approve",
    "flight_warrant.issue",
    "flight_warrant.refresh",
    "flight_warrant.verify",
    "mission.reconstruction.export",
    "mission.reconstruction.verify",
    "fluidity_token.issue",
    "fluidity_token.refresh",
    "fluidity_token.revoke",
    "balloon.launch",
    "balloon.position.report",
    "balloon.release_stack",
    "balloon.recover",
    "historian.record.write"
  ],
  denied_actions: [
    "swarm.disable_mesh",
    "swarm.bypass_launch_readiness",
    "swarm.override_fluidity_token",
    "swarm.override_lost_link_failsafe",
    "balloon.disable_position_monitor"
  ],
  constraints: {
    required_runtime_registers: [
      "telemetry.swarm_id",
      "telemetry.mission_id",
      "telemetry.flight_state",
      "telemetry.swarm_size",
      "telemetry.mesh_relay_healthy",
      "telemetry.fluidity_token_valid",
      "telemetry.launch_readiness_approved",
      "telemetry.recovery_plan_active",
      "telemetry.airspace_authorization_active",
      "telemetry.geofence_active",
      "telemetry.remote_id_broadcasting",
      "telemetry.daa_active",
      "telemetry.operator_qualified",
      "telemetry.operator_id"
    ],
    dual_control: {
      actions: ["swarm.launch.execute", "swarm.recover.execute", "swarm.payload.release", "balloon.launch", "balloon.release_stack"],
      required: 2,
      ttl_ms: 600000
    },
    budget: { maxCallsPerWindow: 1200, windowMs: 3600000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-swarm-ops-root",
  classification: { level: "CUI", caveats: ["SWARM_OPS"] }
};

const ctx = {
  action_id: "act-swarm-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-swarm-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["SWARM_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-swarm-")), "gel.jsonl");
}

function expectRefuse(snapshotOverride: Partial<SwarmRuntimeSnapshot>, label: string) {
  const action = swarmOrchestratorToAction(
    { swarm_id: "swarm-wildfire-west-1", operation: "mission-tick" },
    { ...ctx, action_id: `act-${Math.random().toString(36).slice(2)}`, snapshot: { ...snapshot, ...snapshotOverride } }
  );
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE", `${label} should REFUSE`);
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"), `${label} should fail a physical invariant`);
}

test("swarm adapter builders produce Canonical Governed Actions", () => {
  const tick = swarmOrchestratorToAction({ swarm_id: "swarm-wildfire-west-1", operation: "mission-tick" }, ctx);
  assert.equal(tick.action_type, "swarm.mission.tick");
  assert.equal(tick.params.adapter, "swarm-orchestrator");
  assert.equal(tick.params.swarm_id, "swarm-wildfire-west-1");
  assert.equal(tick.params.mission_class, "wildfire");

  const mesh = meshRelayToAction({ mesh_id: "MESH-WF-1", operation: "activate" }, { ...ctx, action_id: "act-swarm-002" });
  assert.equal(mesh.action_type, "mesh.relay.activate");

  const compile = airspaceAuthorityCompilerToAction({ authority_id: "COA-WF", operation: "compile" }, { ...ctx, action_id: "act-swarm-003" });
  assert.equal(compile.action_type, "airspace.authority.compile");

  const launch = launchReadinessToAction({ swarm_id: "swarm-wildfire-west-1", operation: "approve" }, { ...ctx, action_id: "act-swarm-004" });
  assert.equal(launch.action_type, "launch.readiness.approve");

  const warrant = flightWarrantServiceToAction({ warrant_id: "FW-1", operation: "issue", unit_id: "UAV-WF-02" }, { ...ctx, action_id: "act-swarm-005" });
  assert.equal(warrant.action_type, "flight_warrant.issue");

  const recon = missionReconstructionToAction({ mission_id: "MSN-WF-2026-05-25-A", operation: "export" }, { ...ctx, action_id: "act-swarm-006" });
  assert.equal(recon.action_type, "mission.reconstruction.export");

  const fluidity = fluidityTokenToAction({ token_id: "ft-2", operation: "refresh", ttl_seconds: 600 }, { ...ctx, action_id: "act-swarm-007" });
  assert.equal(fluidity.action_type, "fluidity_token.refresh");

  const payload = swarmPayloadCoordinationToAction({ swarm_id: "swarm-wildfire-west-1", operation: "coordinate" }, { ...ctx, action_id: "act-swarm-008" });
  assert.equal(payload.action_type, "swarm.payload.coordinate");

  const balloon = balloonMothershipToAction({ balloon_id: "BAL-1", operation: "position-report" }, { ...ctx, action_id: "act-swarm-009" });
  assert.equal(balloon.action_type, "balloon.position.report");

  const historian = swarmHistorianWriteToAction({ historian_id: "HIST-SWARM", stream: "mission", record_type: "mission-marker", payload: { note: "mesh-relay engaged" } }, { ...ctx, action_id: "act-swarm-010" });
  assert.equal(historian.action_type, "historian.record.write");

  const viaDispatcher = swarmAdapterToAction({ kind: "swarm-orchestrator", request: { swarm_id: "swarm-wildfire-west-1", operation: "hold-safe" } }, { ...ctx, action_id: "act-swarm-011" });
  assert.equal(viaDispatcher.action_type, "swarm.hold.safe");
});

test("sample swarm Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "swarm");
  const sampleWard = loadWardManifest(path.join(base, "ward.wildfire_swarm.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.incident_commander.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "swarm_mission_tick.json"));
  const lostLink = loadCanonicalAction(path.join(base, "actions", "refuse_lost_link_timeout.json"));
  const fluidity = loadCanonicalAction(path.join(base, "actions", "refuse_fluidity_token_expired.json"));
  const meshUnhealthy = loadCanonicalAction(path.join(base, "actions", "refuse_mesh_unhealthy.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  for (const [action, label] of [[lostLink, "lost-link timeout"], [fluidity, "fluidity expired"], [meshUnhealthy, "mesh unhealthy"]] as const) {
    const r = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
    assert.equal(r.decision, "REFUSE", `${label} should REFUSE`);
    assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  }
});

test("swarm safety invariants refuse a broad set of disconnected-operation hazards", () => {
  expectRefuse({ fluidity_token_valid: false }, "fluidity token expired");
  expectRefuse({ mesh_relay_healthy: false }, "mesh relay unhealthy");
  expectRefuse({ launch_readiness_approved: false }, "launch readiness not approved");
  expectRefuse({ recovery_plan_active: false }, "recovery plan inactive");
  expectRefuse({ lost_link_seconds: 60 }, "lost-link beyond max window");
  expectRefuse({ authority_sync_age_ms: 30000 }, "authority sync too stale");
  expectRefuse({ mesh_link_quality: 0.3 }, "mesh link quality below floor");
  expectRefuse({ mesh_hops: 6 }, "mesh hops over limit");
  expectRefuse({ swarm_size: 2 }, "swarm size below minimum");
  expectRefuse({ swarm_size: 20 }, "swarm size over maximum");
  expectRefuse({ unit_separation_m: 5 }, "unit separation too tight");
  expectRefuse({ unit_separation_m: 300 }, "unit separation too wide (mesh degraded)");
  expectRefuse({ swarm_battery_soc_min_pct: 20 }, "swarm worst-battery below reserve");
  expectRefuse({ altitude_agl_ft: 500 }, "altitude over Part 107 ceiling");
  expectRefuse({ groundspeed_kts: 90 }, "groundspeed over limit");
  expectRefuse({ wind_speed_kts: 35 }, "wind speed over limit");
  expectRefuse({ geofence_active: false }, "geofence inactive");
  expectRefuse({ remote_id_broadcasting: false }, "Remote ID not broadcasting");
  expectRefuse({ daa_active: false }, "DAA inactive");
  expectRefuse({ no_active_tfr: false }, "active TFR conflict");
  expectRefuse({ airspace_authorization_active: false }, "airspace authorization missing");
  expectRefuse({ weather_within_limits: false }, "weather outside limits");
  expectRefuse({ operator_qualified: false }, "operator not qualified");
});

test("swarm hard interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "swarm.disable_mesh"], denied_actions: [] };
  const action = meshRelayToAction(
    { mesh_id: "MESH-WF-1", operation: "handover", action_type: "swarm.disable_mesh" },
    { ...ctx, action_id: "act-swarm-disable-001" }
  );
  const direct = evaluateSwarmSafetyInvariants(action, ward);
  assert.equal(direct.ok, false);
  assert.ok(direct.detail.includes("hard swarm safety interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("high-altitude balloon (Part 101) is the stress case and fails closed when position-monitor is off", () => {
  // Construct a balloon-mothership Ward (separate from the wildfire ward).
  const balloonWard: WardManifest = {
    ...ward,
    ward_id: "ward-swarm-balloon-stress",
    name: "High-Altitude Balloon Mothership (stress)",
    physical_bounds: {
      ...ward.physical_bounds,
      permitted_swarm_id: undefined,
      permitted_mission_classes: ["high-altitude-launch"],
      permitted_asset_types: ["balloon-mothership"],
      max_altitude_agl_ft: undefined, // free balloon; Part 101 governs differently
      require_balloon_position_monitor_active: true,
      require_balloon_within_envelope: true
    }
  };
  const balloonEnvelope: AuthorityEnvelope = { ...envelope, ward_id: balloonWard.ward_id };
  const balloonCtx = {
    ...ctx,
    action_id: "act-swarm-balloon-stress-001",
    snapshot: {
      ...snapshot,
      asset_id: "BAL-1",
      asset_type: "balloon-mothership" as const,
      mission_class: "high-altitude-launch",
      balloon_position_monitor_active: false, // <-- the hazardous condition
      balloon_within_envelope: true
    }
  };
  const action = balloonMothershipToAction({ balloon_id: "BAL-1", operation: "position-report" }, balloonCtx);
  const result = evaluateExecutionControl({ ward: balloonWard, authorityEnvelope: balloonEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("disconnected flight-state machine transitions correctly", () => {
  // healthy connectivity -> connected
  assert.equal(
    nextSwarmFlightState("preflight", { c2_link_healthy: true, mesh_relay_healthy: true, mesh_peers_count: 5, fluidity_token_valid: true, lost_link_seconds: 0, max_lost_link_seconds: 30, recovery_required: false }),
    "connected"
  );
  // c2 down but mesh healthy -> mesh-relay
  assert.equal(
    nextSwarmFlightState("connected", { c2_link_healthy: false, mesh_relay_healthy: true, mesh_peers_count: 4, fluidity_token_valid: true, lost_link_seconds: 5, max_lost_link_seconds: 30, recovery_required: false }),
    "mesh-relay"
  );
  // c2 + mesh down -> hold-safe
  assert.equal(
    nextSwarmFlightState("mesh-relay", { c2_link_healthy: false, mesh_relay_healthy: false, mesh_peers_count: 0, fluidity_token_valid: true, lost_link_seconds: 10, max_lost_link_seconds: 30, recovery_required: false }),
    "hold-safe"
  );
  // fluidity expired -> hold-safe (regardless of mesh)
  assert.equal(
    nextSwarmFlightState("mesh-relay", { c2_link_healthy: true, mesh_relay_healthy: true, mesh_peers_count: 5, fluidity_token_valid: false, lost_link_seconds: 0, max_lost_link_seconds: 30, recovery_required: false }),
    "hold-safe"
  );
  // lost-link beyond window -> hold-safe
  assert.equal(
    nextSwarmFlightState("mesh-relay", { c2_link_healthy: false, mesh_relay_healthy: true, mesh_peers_count: 5, fluidity_token_valid: true, lost_link_seconds: 45, max_lost_link_seconds: 30, recovery_required: false }),
    "hold-safe"
  );
  // hold-safe + recovery required -> recover
  assert.equal(
    nextSwarmFlightState("hold-safe", { c2_link_healthy: false, mesh_relay_healthy: false, mesh_peers_count: 0, fluidity_token_valid: true, lost_link_seconds: 20, max_lost_link_seconds: 30, recovery_required: true }),
    "recover"
  );
});

test("dual-control swarm launch escalates without an approval store and ALLOWs after plural approval", () => {
  const launchAction = swarmOrchestratorToAction({ swarm_id: "swarm-wildfire-west-1", operation: "launch" }, { ...ctx, action_id: "act-swarm-launch-001", snapshot: { ...snapshot, flight_state: "preflight" } });

  // No approval store -> ESCALATE / fail-closed.
  const blocked = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: launchAction, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blocked.decision, "ESCALATE");
  assert.deepEqual(blocked.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);

  const approvalStore = ApprovalStore.memory();
  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: launchAction, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "operator:incident-commander", "approve", "wildfire ward + waiver verified, recovery plan active", now);
  approvalStore.vote(pending.request_id, "operator:airboss", "approve", "airspace authority compiled, no active TFR", now);
  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: launchAction, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("swarm Mission Reconstruction evidence bundle wraps execution evidence with mission context", () => {
  const action = swarmOrchestratorToAction({ swarm_id: "swarm-wildfire-west-1", operation: "mission-tick" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: swarmSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportSwarmEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    swarm: {
      operator_id: "operator-incident-commander",
      control_station: "wildfire-icp-west",
      mission_class: "wildfire",
      operational_scope: "vol-wildfire-west-1",
      asset_id: "swarm-wildfire-west-1",
      swarm_id: "swarm-wildfire-west-1",
      mission_id: "MSN-WF-2026-05-25-A",
      system_model_id: "model-swarm-2026-05-25",
      coa_ref: "COA-2026-WF-WEST",
      waiver_id: "WAIVER-107-2026-WF-WEST",
      rpic_id: "operator:incident-commander",
      sora_risk_class: "medium",
      regulatory_evidence_profile: ["PART_107", "PART_107_WAIVER", "PART_108_BVLOS", "PART_89_REMOTE_ID", "LAANC", "ASTM_F3548_UTM", "SORA", "DISCONNECTED_OPS", "MESH_REVOCATION", "FLUIDITY_TOKEN"],
      pre_checks: [{ name: "launch readiness approved", ok: true }, { name: "fluidity token valid", ok: true }, { name: "recovery plan active", ok: true }, { name: "mesh relay healthy", ok: true }],
      post_checks: [{ name: "evidence sync complete", ok: true }],
      redacted_fields: ["operator_phone", "exact_incident_coordinates"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.swarm-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifySwarmEvidenceBundle(bundle).ok, true);
});
