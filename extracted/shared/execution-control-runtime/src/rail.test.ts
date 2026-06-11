import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type RailRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  consistHazmatToAction,
  crewBulletinToAction,
  dispatchMovementAuthorityToAction,
  evaluateExecutionControl,
  evaluateRailSafetyInvariants,
  exportRailEvidenceBundle,
  gradeCrossingToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  locomotiveCommandToAction,
  maintenanceOfWayToAction,
  ptcRestrictionToAction,
  railAdapterToAction,
  railSnapshotToRuntimeRegister,
  switchMachineToAction,
  verifyRailEvidenceBundle,
  waysideSignalToAction,
  yardAutomationToAction
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: RailRuntimeSnapshot = {
  railroad_id: "northstar-rail",
  host_railroad_id: "northstar-rail",
  tenant_railroad_id: "prairie-tenant",
  territory_id: "west-subdivision",
  subdivision: "West Subdivision",
  route_id: "route-west-main-1",
  track_id: "main-1",
  milepost_from: 12.4,
  milepost_to: 18.9,
  train_id: "NSR-4521",
  train_symbol: "M-WEST-4521",
  locomotive_id: "NSR-8842",
  train_type: "freight",
  consist_hash: "sha256:consist-4521-a",
  hazmat_classes: ["none"],
  movement_authority_id: "MA-2026-0525-019",
  dispatcher_id: "dispatcher:west-desk-a",
  crew_id: "crew:4521",
  crew_acknowledged: true,
  ptc_active: true,
  ptc_mode: "enforcing",
  ptc_telemetry_age_ms: 1100,
  signal_aspect: "clear",
  switch_id: "SW-WEST-17",
  switch_position: "normal",
  switch_position_proven: true,
  grade_crossing_protected: true,
  work_zone_id: "none",
  work_zone_released: true,
  track_bulletin_ack: true,
  brake_test_current: true,
  manual_fallback_ready: true,
  conflicting_authority_present: false,
  speed_mph: 18,
  authority_speed_mph: 45,
  train_separation_m: 3200,
  train_length_ft: 7200,
  train_tonnage: 14200,
  route_class: "mainline",
  track_class: "class-4",
  operating_state: "normal",
  event_recorder_ref: "event-recorder:NSR-8842:2026-05-25T15",
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-rail-subdivision-west",
  name: "West Subdivision Rail Operations",
  sovereignty_context: "host-railroad-west-dispatch",
  authority_domain: "railroad-dispatch-ptc-wayside-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:rail-dispatch-orchestrator"],
  physical_bounds: {
    permitted_boundary_id: "west-subdivision",
    permitted_territory_id: "west-subdivision",
    permitted_route_classes: ["mainline", "siding"],
    permitted_track_classes: ["class-4", "class-5"],
    permitted_signal_aspects: ["clear", "approach", "restricting"],
    permitted_train_types: ["freight", "passenger"],
    permitted_operating_states: ["normal", "restricted"],
    max_authority_speed_mph: 60,
    min_train_separation_m: 1800,
    max_train_length_ft: 8500,
    max_train_tonnage: 18000,
    max_ptc_telemetry_age_ms: 5000,
    require_ptc_active: true,
    require_switch_proven: true,
    require_signal_not_stop: true,
    require_work_zone_released: true,
    require_track_bulletin_ack: true,
    require_dispatcher_identity: true,
    require_brake_test_current: true,
    require_consist_verified: true,
    require_grade_crossing_protected: true,
    require_crew_acknowledged: true,
    require_no_conflicting_authority: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["RAIL_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-rail-dispatch-001",
  ward_id: ward.ward_id,
  subject: "agent:rail-dispatch-orchestrator",
  allowed_actions: [
    "rail.movement.authority.issue",
    "rail.route.lineup.authorize",
    "ptc.restriction.update",
    "ptc.authority.sync",
    "signal.aspect.request",
    "signal.route.clear",
    "switch.align.request",
    "crossing.protection.request",
    "locomotive.command.request",
    "crew.bulletin.ack",
    "consist.route.validate",
    "hazmat.routing.authorize",
    "mow.work-zone.release",
    "yard.route.line"
  ],
  denied_actions: ["rail.disable_ptc", "ptc.override.enforcement", "signal.force_clear", "switch.force_unlock"],
  constraints: {
    required_runtime_registers: [
      "telemetry.territory_id",
      "telemetry.dispatcher_id",
      "telemetry.movement_authority_id",
      "telemetry.ptc_active",
      "telemetry.ptc_telemetry_age_ms",
      "telemetry.signal_aspect",
      "telemetry.switch_position_proven",
      "telemetry.work_zone_released",
      "telemetry.track_bulletin_ack",
      "telemetry.crew_acknowledged",
      "telemetry.brake_test_current",
      "telemetry.consist_hash",
      "telemetry.grade_crossing_protected",
      "telemetry.conflicting_authority_present"
    ],
    dual_control: { actions: ["rail.route.lineup.authorize", "ptc.restriction.update", "signal.route.clear", "switch.align.request", "hazmat.routing.authorize"], required: 2, ttl_ms: 900000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-rail-ops-root",
  classification: { level: "CUI", caveats: ["RAIL_OPS"] }
};

const ctx = {
  action_id: "act-rail-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-rail-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["RAIL_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-rail-")), "gel.jsonl");
}

test("rail adapter builders produce Canonical Governed Actions", () => {
  const authority = dispatchMovementAuthorityToAction({ authority_id: "MA-1", train_id: "NSR-4521", from_milepost: 12.4, to_milepost: 18.9, max_speed_mph: 45, track_id: "main-1" }, ctx);
  assert.equal(authority.action_type, "rail.movement.authority.issue");
  assert.equal(authority.params.adapter, "dispatch-cad");
  assert.equal(authority.params.territory_id, "west-subdivision");

  const ptc = ptcRestrictionToAction({ restriction_id: "TSR-1", operation: "update", from_milepost: 14, to_milepost: 15, max_speed_mph: 25 }, { ...ctx, action_id: "act-rail-002" });
  assert.equal(ptc.action_type, "ptc.restriction.update");

  const signal = waysideSignalToAction({ signal_id: "SIG-184", requested_aspect: "approach", route_id: "route-west-main-1" }, { ...ctx, action_id: "act-rail-003" });
  assert.equal(signal.action_type, "signal.aspect.request");

  const switchAction = railAdapterToAction({ kind: "switch-machine", request: { switch_id: "SW-WEST-17", requested_position: "normal", locked: true } }, { ...ctx, action_id: "act-rail-004" });
  assert.equal(switchAction.action_type, "switch.align.request");

  const crossing = gradeCrossingToAction({ crossing_id: "XING-102", operation: "protect" }, { ...ctx, action_id: "act-rail-005" });
  assert.equal(crossing.action_type, "crossing.protect.request");

  const loco = locomotiveCommandToAction({ locomotive_id: "NSR-8842", command: "hold" }, { ...ctx, action_id: "act-rail-006" });
  assert.equal(loco.action_type, "locomotive.command.request");

  const crew = crewBulletinToAction({ bulletin_id: "TB-119", crew_id: "crew:4521", operation: "acknowledge" }, { ...ctx, action_id: "act-rail-007" });
  assert.equal(crew.action_type, "crew.bulletin.ack");

  const consist = consistHazmatToAction({ consist_hash: "sha256:consist-4521-a", route_id: "route-west-main-1", operation: "validate-route" }, { ...ctx, action_id: "act-rail-008" });
  assert.equal(consist.action_type, "consist.route.validate");

  const mow = maintenanceOfWayToAction({ work_zone_id: "WZ-144", operation: "release" }, { ...ctx, action_id: "act-rail-009" });
  assert.equal(mow.action_type, "mow.work-zone.release");

  const yard = yardAutomationToAction({ yard_id: "YARD-WEST", operation: "line-route", track_id: "yard-7" }, { ...ctx, action_id: "act-rail-010" });
  assert.equal(yard.action_type, "yard.line-route");
});

test("sample rail Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "rail");
  const sampleWard = loadWardManifest(path.join(base, "ward.subdivision_west.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.dispatcher.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "allow_movement_authority.json"));
  const conflict = loadCanonicalAction(path.join(base, "actions", "refuse_conflicting_authority.json"));
  const missing = loadCanonicalAction(path.join(base, "actions", "escalate_missing_ptc_state.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);
  assert.equal(ok.ledger_verification.ok, true);

  const blockedConflict = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: conflict, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(blockedConflict.decision, "REFUSE");
  assert.ok(blockedConflict.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));

  const escalated = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: missing, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(escalated.decision, "ESCALATE");
  assert.ok(escalated.reason_codes.includes("RUNTIME_STATE_MISSING"));
});

test("rail PTC and signal hard interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "rail.disable_ptc"], denied_actions: [] };
  const action = locomotiveCommandToAction(
    { locomotive_id: "NSR-8842", command: "release", action_type: "rail.disable_ptc" },
    { ...ctx, action_id: "act-rail-disable-ptc-001" }
  );
  const directPig = evaluateRailSafetyInvariants(action, ward);
  assert.equal(directPig.ok, false);
  assert.ok(directPig.detail.includes("hard rail safety interlock"));

  const result = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "REFUSE");
  assert.ok(result.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(result.warrant, undefined);
});

test("dual-control rail route actions fail closed without an approval store", () => {
  const action = waysideSignalToAction({ signal_id: "SIG-184", requested_aspect: "clear", route_id: "route-west-main-1" }, { ...ctx, action_id: "act-rail-signal-001" });
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(result.decision, "ESCALATE");
  assert.deepEqual(result.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(result.warrant, undefined);
});

test("dual-control rail route actions issue a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = waysideSignalToAction({ signal_id: "SIG-184", requested_aspect: "clear", route_id: "route-west-main-1" }, { ...ctx, action_id: "act-rail-signal-002" });

  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "dispatcher:chief-west", "approve", "route and PTC state verified", now);
  approvalStore.vote(pending.request_id, "signal-supervisor:west", "approve", "wayside state proven", now);

  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("rail evidence bundle wraps execution evidence with dispatch context", () => {
  const action = dispatchMovementAuthorityToAction({ authority_id: "MA-2026-0525-019", train_id: "NSR-4521", from_milepost: 12.4, to_milepost: 18.9, max_speed_mph: 45, track_id: "main-1" }, ctx);
  const ledger = ledgerPath();
  const result = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: railSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportRailEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: result.gel_record.record_id,
    warrant: result.warrant,
    exportedAt: now,
    rail: {
      railroad_id: "northstar-rail",
      operations_center: "west-dispatch",
      rail_domain: "ptc-mainline",
      territory_id: "west-subdivision",
      subdivision: "West Subdivision",
      milepost_limits: { from: 12.4, to: 18.9 },
      train_id: "NSR-4521",
      train_symbol: "M-WEST-4521",
      locomotive_id: "NSR-8842",
      movement_authority_id: "MA-2026-0525-019",
      dispatcher_id: "dispatcher:west-desk-a",
      crew_id: "crew:4521",
      consist_hash: "sha256:consist-4521-a",
      ptc_status: "active",
      route_id: "route-west-main-1",
      track_id: "main-1",
      signal_system: "ctc-ptc-overlay",
      work_zone_id: "none",
      hazmat_profile: ["none"],
      standards_profile: ["FRA_PTC", "FRA_SIGNAL_TRAIN_CONTROL", "TSA_RAIL_CYBER", "DISPATCH_LOG", "EVENT_RECORDER", "LOCAL_OPERATING_RULE"],
      pre_checks: [{ name: "PTC active", ok: true }, { name: "switch position proven", ok: true }],
      post_checks: [{ name: "authority synchronized to PTC", ok: true }],
      redacted_fields: ["crew_phone", "exact_facility_access_code"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.rail-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyRailEvidenceBundle(bundle).ok, true);
});
