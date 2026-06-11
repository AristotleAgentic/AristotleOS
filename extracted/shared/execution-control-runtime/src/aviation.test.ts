import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type AviationRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  aviationAdapterToAction,
  aviationHistorianWriteToAction,
  aviationSnapshotToRuntimeRegister,
  c2LinkToAction,
  daaToAction,
  evaluateAviationSafetyInvariants,
  evaluateExecutionControl,
  exportAviationEvidenceBundle,
  flightControlToAction,
  geofenceToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  payloadToAction,
  remoteIdToAction,
  utmToAction,
  vertiportToAction,
  verifyAviationEvidenceBundle
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: AviationRuntimeSnapshot = {
  asset_id: "UAS-NYC-07",
  asset_type: "multirotor",
  airspace_id: "airspace-knyc-volume",
  airspace_class: "G",
  operation_volume_id: "vol-corridor-7",
  system_model_id: "model-nyc-2026-05-25",
  flight_state: "in-flight",
  altitude_agl_ft: 350,
  groundspeed_kts: 30,
  battery_soc_pct: 78,
  wind_speed_kts: 12,
  visibility_sm: 6,
  ceiling_ft: 4000,
  payload_kg: 2,
  telemetry_age_ms: 800,
  geofence_active: true,
  remote_id_broadcasting: true,
  daa_active: true,
  c2_link_healthy: true,
  airspace_authorization_active: true,
  no_active_tfr: true,
  vlos_or_waiver: true,
  rtl_available: true,
  weather_within_limits: true,
  operator_qualified: true,
  operator_id: "rpic:nyc-west",
  mission_id: "MSN-3391",
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-aviation-bvlos-corridor",
  name: "BVLOS Corridor Operations NYC",
  sovereignty_context: "operator-bvlos-authority",
  authority_domain: "aviation-bvlos-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:flight-ops-orchestrator"],
  physical_bounds: {
    permitted_airspace_id: "airspace-knyc-volume",
    permitted_airspace_classes: ["G", "E"],
    permitted_operation_volumes: ["vol-corridor-7", "vol-inspection-a"],
    permitted_asset_types: ["multirotor", "fixed-wing", "vtol"],
    permitted_flight_states: ["preflight", "armed", "in-flight", "rtl", "landing", "landed"],
    max_altitude_agl_ft: 400,
    max_groundspeed_kts: 87,
    min_battery_soc_pct: 30,
    max_wind_speed_kts: 25,
    min_visibility_sm: 3,
    min_ceiling_ft: 1000,
    max_payload_kg: 5,
    max_telemetry_age_ms: 3000,
    require_geofence_active: true,
    require_remote_id_broadcasting: true,
    require_daa_active: true,
    require_c2_link_healthy: true,
    require_airspace_authorization: true,
    require_no_active_tfr: true,
    require_vlos_or_waiver: true,
    require_rtl_available: true,
    require_weather_within_limits: true,
    require_operator_qualified: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["AVIATION_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-aviation-operations-001",
  ward_id: ward.ward_id,
  subject: "agent:flight-ops-orchestrator",
  allowed_actions: [
    "uas.flight.authorize",
    "uas.deconfliction.submit",
    "flight.arm",
    "flight.takeoff",
    "flight.waypoint.set",
    "flight.hold",
    "flight.land",
    "flight.rtl",
    "geofence.set",
    "payload.release",
    "payload.gimbal.set",
    "vertiport.takeoff.clear",
    "daa.maneuver.execute",
    "c2.switch",
    "remote_id.session.set",
    "historian.record.write"
  ],
  denied_actions: ["uas.disable_geofence", "uas.disable_detect_and_avoid", "uas.disable_remote_id", "uas.override_airspace_authorization", "uas.disable_return_to_home", "uas.enter_active_tfr"],
  constraints: {
    required_runtime_registers: [
      "telemetry.asset_id",
      "telemetry.airspace_id",
      "telemetry.operation_volume_id",
      "telemetry.altitude_agl_ft",
      "telemetry.battery_soc_pct",
      "telemetry.geofence_active",
      "telemetry.remote_id_broadcasting",
      "telemetry.daa_active",
      "telemetry.c2_link_healthy",
      "telemetry.airspace_authorization_active",
      "telemetry.no_active_tfr",
      "telemetry.rtl_available",
      "telemetry.operator_qualified",
      "telemetry.operator_id"
    ],
    dual_control: { actions: ["flight.takeoff", "payload.release", "vertiport.takeoff.clear", "uas.flight.authorize"], required: 2, ttl_ms: 600000 },
    budget: { maxCallsPerWindow: 400, windowMs: 3600000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-aviation-ops-root",
  classification: { level: "CUI", caveats: ["AVIATION_OPS"] }
};

const ctx = {
  action_id: "act-aviation-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-aviation-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["AVIATION_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-aviation-")), "gel.jsonl");
}

const waypoint = () => flightControlToAction({ aircraft_id: "UAS-NYC-07", operation: "waypoint", waypoint: { lat: 40.7, lon: -74.0, alt_ft: 350 } }, { ...ctx, action_id: `act-${Math.random().toString(36).slice(2)}` });

function expectRefuse(snapshotOverride: Partial<AviationRuntimeSnapshot>, label: string) {
  const action = flightControlToAction(
    { aircraft_id: "UAS-NYC-07", operation: "waypoint" },
    { ...ctx, action_id: `act-${Math.random().toString(36).slice(2)}`, snapshot: { ...snapshot, ...snapshotOverride } }
  );
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE", `${label} should REFUSE`);
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"), `${label} should fail a physical invariant`);
}

test("aviation adapter builders produce Canonical Governed Actions", () => {
  const utm = utmToAction({ uss_id: "USS-NYC", operation: "authorize", volume_id: "vol-corridor-7" }, ctx);
  assert.equal(utm.action_type, "uas.flight.authorize");
  assert.equal(utm.params.adapter, "utm");
  assert.equal(utm.params.airspace_id, "airspace-knyc-volume");

  const flight = flightControlToAction({ aircraft_id: "UAS-NYC-07", operation: "takeoff" }, { ...ctx, action_id: "act-aviation-002" });
  assert.equal(flight.action_type, "flight.takeoff");

  const geofence = geofenceToAction({ fence_id: "FENCE-7", operation: "update", value: { radius_m: 500 } }, { ...ctx, action_id: "act-aviation-003" });
  assert.equal(geofence.action_type, "geofence.update");

  const payload = payloadToAction({ payload_id: "PL-1", operation: "release" }, { ...ctx, action_id: "act-aviation-004" });
  assert.equal(payload.action_type, "payload.release");

  const vert = vertiportToAction({ vertiport_id: "VP-1", operation: "takeoff-clear", pad_id: "PAD-3" }, { ...ctx, action_id: "act-aviation-005", snapshot: { ...snapshot, asset_type: "evtol", vertiport_clearance: true } });
  assert.equal(vert.action_type, "vertiport.takeoff.clear");

  const daa = daaToAction({ aircraft_id: "UAS-NYC-07", operation: "maneuver", value: { heading: 270 } }, { ...ctx, action_id: "act-aviation-006" });
  assert.equal(daa.action_type, "daa.maneuver.execute");

  const c2 = c2LinkToAction({ aircraft_id: "UAS-NYC-07", operation: "switch", link_id: "LTE-2" }, { ...ctx, action_id: "act-aviation-007" });
  assert.equal(c2.action_type, "c2.switch");

  const rid = remoteIdToAction({ aircraft_id: "UAS-NYC-07", operation: "session-set", session_id: "RID-9" }, { ...ctx, action_id: "act-aviation-008" });
  assert.equal(rid.action_type, "remote_id.session.set");

  const historian = aviationHistorianWriteToAction({ historian_id: "HIST-AV", stream: "flight", record_type: "operator-note", payload: { note: "waypoint set" } }, { ...ctx, action_id: "act-aviation-009" });
  assert.equal(historian.action_type, "historian.record.write");

  const viaDispatcher = aviationAdapterToAction({ kind: "flight-control", request: { aircraft_id: "UAS-NYC-07", operation: "rtl" } }, { ...ctx, action_id: "act-aviation-010" });
  assert.equal(viaDispatcher.action_type, "flight.rtl");
});

test("sample aviation Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "aviation");
  const sampleWard = loadWardManifest(path.join(base, "ward.bvlos_corridor.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.rpic.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "waypoint_flight.json"));
  const altitude = loadCanonicalAction(path.join(base, "actions", "refuse_altitude_ceiling.json"));
  const tfr = loadCanonicalAction(path.join(base, "actions", "refuse_active_tfr.json"));
  const geofenceOff = loadCanonicalAction(path.join(base, "actions", "refuse_geofence_inactive.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  for (const [action, label] of [[altitude, "altitude"], [tfr, "tfr"], [geofenceOff, "geofence"]] as const) {
    const result = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
    assert.equal(result.decision, "REFUSE", `${label} fixture should REFUSE`);
    assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  }
});

test("aviation safety invariants refuse a broad set of unsafe conditions", () => {
  expectRefuse({ altitude_agl_ft: 450 }, "altitude over ceiling");
  expectRefuse({ battery_soc_pct: 18 }, "battery below RTL reserve");
  expectRefuse({ c2_link_healthy: false }, "C2 link lost");
  expectRefuse({ daa_active: false }, "detect-and-avoid inactive");
  expectRefuse({ geofence_active: false }, "geofence inactive");
  expectRefuse({ remote_id_broadcasting: false }, "Remote ID off");
  expectRefuse({ airspace_authorization_active: false }, "no airspace authorization");
  expectRefuse({ no_active_tfr: false }, "active TFR");
  expectRefuse({ rtl_available: false }, "RTL failsafe unavailable");
  expectRefuse({ wind_speed_kts: 40 }, "wind over limit");
  expectRefuse({ groundspeed_kts: 120 }, "groundspeed over limit");
  expectRefuse({ operation_volume_id: "vol-unauthorized" }, "outside operation volume");
  expectRefuse({ operator_qualified: false }, "RPIC not certificated");
});

test("aviation hard interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "uas.disable_geofence"], denied_actions: [] };
  const action = geofenceToAction(
    { fence_id: "FENCE-7", operation: "update", action_type: "uas.disable_geofence" },
    { ...ctx, action_id: "act-aviation-disable-001" }
  );
  const direct = evaluateAviationSafetyInvariants(action, ward);
  assert.equal(direct.ok, false);
  assert.ok(direct.detail.includes("hard aviation safety interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control aviation actions fail closed without an approval store", () => {
  const action = flightControlToAction({ aircraft_id: "UAS-NYC-07", operation: "takeoff" }, { ...ctx, action_id: "act-aviation-takeoff-001", snapshot: { ...snapshot, flight_state: "armed", altitude_agl_ft: 0 } });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control aviation actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = flightControlToAction({ aircraft_id: "UAS-NYC-07", operation: "takeoff" }, { ...ctx, action_id: "act-aviation-takeoff-002", snapshot: { ...snapshot, flight_state: "armed", altitude_agl_ft: 0 } });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "rpic:pilot-in-command", "approve", "airspace authorization and DAA verified", now);
  approvalStore.vote(pending.request_id, "operator:flight-director", "approve", "weather, C2, and RTL reserve confirmed", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("aviation evidence bundle wraps execution evidence with RPIC context", () => {
  const action = waypoint();
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: aviationSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportAviationEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    aviation: {
      operator_id: "operator-bvlos",
      control_station: "nyc-gcs",
      aviation_domain: "bvlos",
      operational_scope: "airspace-knyc-volume",
      asset_id: "UAS-NYC-07",
      airspace_id: "airspace-knyc-volume",
      operation_volume_id: "vol-corridor-7",
      system_model_id: "model-nyc-2026-05-25",
      mission_id: "MSN-3391",
      waiver_id: "WAIVER-107.31-BVLOS",
      rpic_id: "rpic:nyc-west",
      sora_risk_class: "medium",
      regulatory_evidence_profile: ["PART_107", "PART_108_BVLOS", "PART_89_REMOTE_ID", "LAANC", "ASTM_F3548_UTM", "DETECT_AND_AVOID", "SORA"],
      pre_checks: [{ name: "airspace authorization active", ok: true }, { name: "DAA active", ok: true }, { name: "RTL reserve ok", ok: true }],
      post_checks: [{ name: "geofence contained", ok: true }],
      redacted_fields: ["operator_phone", "home_point_coordinates"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.aviation-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyAviationEvidenceBundle(bundle).ok, true);
});
