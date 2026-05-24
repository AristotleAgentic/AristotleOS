import test from "node:test";
import assert from "node:assert/strict";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type EdgeRecord,
  type WardManifest,
  applyResolution,
  reconcileEdgeRecords
} from "./index.js";

const ward: WardManifest = {
  ward_id: "edge-ward", name: "Edge Ward", sovereignty_context: "frontier",
  authority_domain: "ops", policy_version: "0.2.0", permitted_subjects: ["agent:e"]
};
// Current policy: tightened — "drone.scan" is now denied.
const current: AuthorityEnvelope = {
  envelope_id: "ae-edge-001", ward_id: "edge-ward", subject: "agent:e",
  allowed_actions: ["drone.takeoff"], denied_actions: ["drone.scan"],
  constraints: {}, expires_at: "2099-12-31T23:59:59Z", issuer: "edge-root"
};
// Execution-time policy: looser — "drone.scan" was allowed when the edge acted.
const executionTime: AuthorityEnvelope = { ...current, allowed_actions: ["drone.takeoff", "drone.scan"], denied_actions: [] };

function action(id: string, type: string): CanonicalActionInput {
  return { action_id: id, ward_id: "edge-ward", subject: "agent:e", action_type: type, target: "unit-1", params: {}, requested_at: "2026-05-20T00:00:00.000Z", request_id: id };
}

test("reconcile classifies edge-vs-current conflicts and replays both policies", () => {
  const records: EdgeRecord[] = [
    // Edge ALLOWed a scan under the looser execution-time policy; current denies it.
    { action: action("r1", "drone.scan"), edge_decision: "ALLOW", edge_policy_version: "0.1.0", occurred_at: "2026-05-20T00:00:00.000Z", executionTimeWard: ward, executionTimeEnvelope: executionTime },
    // Agreement: takeoff allowed then and now.
    { action: action("r2", "drone.takeoff"), edge_decision: "ALLOW" },
    // Edge REFUSEd something current would allow → edge more restrictive.
    { action: action("r3", "drone.takeoff"), edge_decision: "REFUSE" }
  ];
  const report = reconcileEdgeRecords({ records, ward, authorityEnvelope: current, now: "2026-05-24T00:00:00.000Z" });

  assert.equal(report.count, 3);
  assert.equal(report.agreements, 1);
  assert.equal(report.conflicts, 2);

  const r1 = report.items.find((i) => i.action_id === "r1")!;
  assert.equal(r1.agrees, false);
  assert.equal(r1.conflict_kind, "edge_more_permissive");
  assert.equal(r1.status, "open");
  assert.equal(r1.current_decision, "REFUSE");
  // Replay confirms the edge honored the policy in force at execution time.
  assert.equal(r1.replay.against_current.decision, "REFUSE");
  assert.equal(r1.replay.against_execution_time?.decision, "ALLOW");

  const r2 = report.items.find((i) => i.action_id === "r2")!;
  assert.equal(r2.agrees, true);
  assert.equal(r2.status, "reconciled");

  const r3 = report.items.find((i) => i.action_id === "r3")!;
  assert.equal(r3.conflict_kind, "edge_more_restrictive");
});

test("applyResolution enforces the resolution state machine", () => {
  const records: EdgeRecord[] = [{ action: action("c1", "drone.scan"), edge_decision: "ALLOW" }];
  const report = reconcileEdgeRecords({ records, ward, authorityEnvelope: current });
  const open = report.items[0];
  assert.equal(open.status, "open");

  assert.equal(applyResolution(open, "accept").status, "accepted");
  assert.equal(applyResolution(open, "escalate").status, "escalated");
  // escalated → reconcile is allowed
  const escalated = applyResolution(open, "escalate");
  assert.equal(applyResolution(escalated, "reconcile").status, "reconciled");
  // resolving an already-resolved conflict throws
  assert.throws(() => applyResolution(applyResolution(open, "reject"), "accept"), /already in status/);
});
