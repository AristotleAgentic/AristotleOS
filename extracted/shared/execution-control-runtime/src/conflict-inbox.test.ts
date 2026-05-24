import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConflictInboxStore } from "./conflict-inbox.js";
import type { AuthorityEnvelope, CanonicalActionInput, WardManifest } from "./index.js";
import type { EdgeRecord } from "./reconcile.js";

const ward: WardManifest = {
  ward_id: "montana-drone-test-range",
  name: "Montana Drone Test Range",
  sovereignty_context: "private-ranch-field-test",
  authority_domain: "drone-swarm-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:survey-planner"],
  physical_bounds: { max_altitude_m: 120, permitted_boundary_id: "ranch-test-grid-a", battery_minimum_pct: 20 }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-drone-survey-001",
  ward_id: ward.ward_id,
  subject: "agent:survey-planner",
  allowed_actions: ["drone.takeoff", "drone.scan_area"],
  denied_actions: ["drone.leave_boundary", "drone.disable_geofence"],
  constraints: { required_runtime_registers: ["telemetry.gps_lock"], max_altitude_m: 120, permitted_boundary_id: "ranch-test-grid-a" },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-root"
};

const now = "2026-05-24T12:00:00.000Z";

function action(id: string, type: string): CanonicalActionInput {
  return {
    action_id: id,
    ward_id: ward.ward_id,
    subject: "agent:survey-planner",
    action_type: type,
    target: "drone-swarm/unit-7",
    params: { boundary_id: "ranch-test-grid-a", altitude_m: 80, battery_pct: 87 },
    requested_at: now,
    telemetry: { gps_lock: true }
  };
}

// An edge that ALLOWED a now-denied action (edge_more_permissive) and an agreement.
const records: EdgeRecord[] = [
  { action: action("act-permissive", "drone.disable_geofence"), edge_decision: "ALLOW", edge_policy_version: "0.0.9", occurred_at: now },
  { action: action("act-agree", "drone.takeoff"), edge_decision: "ALLOW", occurred_at: now }
];

function inboxPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-conflict-inbox-")), "inbox.json");
}

test("ingest classifies conflicts open and agreements reconciled", () => {
  const store = ConflictInboxStore.memory();
  const report = store.ingest({ records, ward, authorityEnvelope: envelope, now });
  assert.equal(report.count, 2);
  assert.equal(report.conflicts, 1);
  const items = store.list();
  const permissive = items.find((i) => i.action_id === "act-permissive");
  const agree = items.find((i) => i.action_id === "act-agree");
  assert.equal(permissive?.status, "open");
  assert.equal(permissive?.conflict_kind, "edge_more_permissive");
  assert.equal(agree?.status, "reconciled");
  assert.equal(agree?.agrees, true);
});

test("list orders conflicts before agreements", () => {
  const store = ConflictInboxStore.memory();
  store.ingest({ records, ward, authorityEnvelope: envelope, now });
  const items = store.list();
  assert.equal(items[0].agrees, false); // conflict first
});

test("resolve transitions an open conflict and attributes the operator", () => {
  const store = ConflictInboxStore.memory();
  store.ingest({ records, ward, authorityEnvelope: envelope, now });
  const resolved = store.resolve("act-permissive", "reject", "alice@corp", "edge exceeded current authority", "2026-05-24T12:05:00.000Z");
  assert.equal(resolved.status, "rejected");
  assert.equal(resolved.resolved_by, "alice@corp");
  assert.equal(resolved.resolution_action, "reject");
  assert.equal(resolved.resolution_reason, "edge exceeded current authority");
  assert.equal(resolved.resolved_at, "2026-05-24T12:05:00.000Z");
  assert.equal(store.get("act-permissive")?.status, "rejected");
});

test("resolve rejects an unknown conflict and a double resolution", () => {
  const store = ConflictInboxStore.memory();
  store.ingest({ records, ward, authorityEnvelope: envelope, now });
  assert.throws(() => store.resolve("nope", "accept", "alice@corp"), /unknown conflict/);
  store.resolve("act-permissive", "escalate", "alice@corp");
  // escalate -> escalated is still resolvable once more
  store.resolve("act-permissive", "reject", "bob@corp");
  assert.throws(() => store.resolve("act-permissive", "accept", "alice@corp"), /already in status/);
});

test("re-ingest preserves an operator resolution and refreshes evidence", () => {
  const store = ConflictInboxStore.memory();
  store.ingest({ records, ward, authorityEnvelope: envelope, now });
  store.resolve("act-permissive", "reject", "alice@corp", "reviewed");
  // Re-ingest the same batch (e.g. edge reconnects again).
  store.ingest({ records, ward, authorityEnvelope: envelope, now: "2026-05-24T13:00:00.000Z" });
  const item = store.get("act-permissive");
  assert.equal(item?.status, "rejected"); // not reopened
  assert.equal(item?.resolved_by, "alice@corp");
});

test("summary counts open/conflicts/by-status", () => {
  const store = ConflictInboxStore.memory();
  store.ingest({ records, ward, authorityEnvelope: envelope, now });
  const before = store.summary();
  assert.equal(before.total, 2);
  assert.equal(before.conflicts, 1);
  assert.equal(before.open, 1);
  store.resolve("act-permissive", "accept", "alice@corp");
  const after = store.summary();
  assert.equal(after.open, 0);
  assert.equal(after.by_status.accepted, 1);
});

test("file-backed store persists across instances", () => {
  const file = inboxPath();
  const a = new ConflictInboxStore(file);
  a.ingest({ records, ward, authorityEnvelope: envelope, now });
  a.resolve("act-permissive", "reject", "alice@corp", "reviewed");
  const b = new ConflictInboxStore(file);
  assert.equal(b.get("act-permissive")?.status, "rejected");
  assert.equal(b.list().length, 2);
});
