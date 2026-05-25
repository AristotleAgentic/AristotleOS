import test from "node:test";
import assert from "node:assert/strict";
import {
  type BehaviorEvent,
  type SequenceRule,
  analyzeAgentBehavior,
  behaviorEventsFromGel
} from "./index.js";

const T0 = Date.parse("2026-05-24T09:00:00.000Z");
function at(offsetSec: number): string {
  return new Date(T0 + offsetSec * 1000).toISOString();
}
function ev(id: string, subject: string, over: Partial<BehaviorEvent> = {}): BehaviorEvent {
  return { event_id: id, occurred_at: over.occurred_at ?? at(0), subject, ...over };
}

test("denial burst: many REFUSE for one subject within the window is flagged", () => {
  const events: BehaviorEvent[] = Array.from({ length: 6 }, (_, i) => ev(`d${i}`, "agent:probe", { occurred_at: at(i * 10), decision: "REFUSE" }));
  const report = analyzeAgentBehavior(events, { now: at(100), denialBurstThreshold: 5, windowMs: 3_600_000 });
  const burst = report.findings.find((f) => f.kind === "denial_burst");
  assert.ok(burst, "expected a denial_burst finding");
  assert.equal(burst!.subjects[0], "agent:probe");
  assert.ok(["medium", "high"].includes(burst!.severity));
  // determinism: same input -> same report hash
  assert.equal(analyzeAgentBehavior(events, { now: at(100), denialBurstThreshold: 5 }).report_hash, report.report_hash);
});

test("rate spike: a subject accelerating vs its own baseline is flagged", () => {
  const baseline = Array.from({ length: 3 }, (_, i) => ev(`b${i}`, "agent:busy", { occurred_at: at(i * 100), decision: "ALLOW" }));
  const recent = Array.from({ length: 12 }, (_, i) => ev(`r${i}`, "agent:busy", { occurred_at: at(400 + i), decision: "ALLOW" }));
  const report = analyzeAgentBehavior([...baseline, ...recent], { now: at(500), rateSpikeFactor: 3, rateSpikeMinEvents: 5 });
  assert.ok(report.findings.some((f) => f.kind === "rate_spike" && f.subjects[0] === "agent:busy"));
});

test("first_seen: a subject absent from the approved registry is flagged once", () => {
  const events = [ev("a", "agent:approved"), ev("b", "agent:rogue"), ev("c", "agent:rogue")];
  const report = analyzeAgentBehavior(events, { knownSubjects: ["agent:approved"] });
  const firstSeen = report.findings.filter((f) => f.kind === "first_seen");
  assert.equal(firstSeen.length, 1);
  assert.equal(firstSeen[0].subjects[0], "agent:rogue");
});

test("off_hours: activity outside the allowed UTC window is flagged", () => {
  // allowed 13:00-21:00 UTC; our events at 09:00 are off-hours
  const events = [ev("a", "agent:x", { occurred_at: at(0) }), ev("b", "agent:x", { occurred_at: at(60) })];
  const report = analyzeAgentBehavior(events, { allowedHoursUtc: { start: 13, end: 21 } });
  assert.ok(report.findings.some((f) => f.kind === "off_hours" && f.subjects[0] === "agent:x"));
  // inside the window -> no off_hours finding
  const inHours = analyzeAgentBehavior([ev("c", "agent:x", { occurred_at: "2026-05-24T15:00:00.000Z" })], { allowedHoursUtc: { start: 13, end: 21 } });
  assert.equal(inHours.findings.filter((f) => f.kind === "off_hours").length, 0);
});

test("target fanout: one subject hitting many distinct targets is flagged", () => {
  const events = Array.from({ length: 9 }, (_, i) => ev(`t${i}`, "agent:lateral", { occurred_at: at(i), target: `svc-${i}` }));
  const report = analyzeAgentBehavior(events, { fanoutThreshold: 8, windowMs: 3_600_000 });
  const fanout = report.findings.find((f) => f.kind === "target_fanout");
  assert.ok(fanout, "expected target_fanout");
  assert.equal(fanout!.severity, "high");
});

test("sequence chain: cross-agent read -> exfiltrate -> delete is detected", () => {
  const rule: SequenceRule = {
    id: "exfil",
    name: "data exfiltration chain",
    steps: [{ match: "data\\.read" }, { match: "net\\.egress|http\\.post" }, { match: "data\\.delete" }],
    withinMs: 600_000,
    crossSubject: true,
    severity: "critical"
  };
  const events: BehaviorEvent[] = [
    ev("1", "agent:reader", { occurred_at: at(0), action_type: "data.read", decision: "ALLOW" }),
    ev("2", "agent:courier", { occurred_at: at(30), action_type: "net.egress", decision: "ALLOW" }),
    ev("3", "agent:janitor", { occurred_at: at(60), action_type: "data.delete", decision: "ALLOW" })
  ];
  const report = analyzeAgentBehavior(events, { sequenceRules: [rule] });
  const seq = report.findings.find((f) => f.kind === "sequence_chain");
  assert.ok(seq, "expected a sequence_chain finding");
  assert.equal(seq!.severity, "critical");
  assert.equal(seq!.subjects.length, 3, "collusion across three subjects");
  assert.equal(seq!.recommended_disposition, "terminate_execution");

  // the same steps spread beyond withinMs must NOT match
  const slow = [
    ev("1", "agent:reader", { occurred_at: at(0), action_type: "data.read" }),
    ev("2", "agent:courier", { occurred_at: at(30), action_type: "net.egress" }),
    ev("3", "agent:janitor", { occurred_at: at(100000), action_type: "data.delete" })
  ];
  assert.equal(analyzeAgentBehavior(slow, { sequenceRules: [rule] }).findings.filter((f) => f.kind === "sequence_chain").length, 0);
});

test("behaviorEventsFromGel maps the signed ledger into the event stream", () => {
  const records = [
    { record_id: "rec-1", timestamp: at(0), subject: "agent:a", decision: "REFUSE", reason_codes: ["ACTION_DENIED"], ward_id: "w1" },
    { record_id: "rec-2", timestamp: at(1), subject: "agent:a", decision: "ALLOW", reason_codes: [], ward_id: "w1" }
  ] as unknown as Parameters<typeof behaviorEventsFromGel>[0];
  const events = behaviorEventsFromGel(records);
  assert.equal(events.length, 2);
  assert.equal(events[0].event_id, "rec-1");
  assert.equal(events[0].decision, "REFUSE");
  assert.equal(events[0].subject, "agent:a");
});

test("a clean stream produces no findings", () => {
  const events = [ev("a", "agent:approved", { decision: "ALLOW" }), ev("b", "agent:approved", { occurred_at: at(3600), decision: "ALLOW" })];
  const report = analyzeAgentBehavior(events, { knownSubjects: ["agent:approved"] });
  assert.equal(report.findings.length, 0);
  assert.equal(report.summary.high_or_critical, 0);
});

test("coordinated_denial: the same action refused across many agents is a campaign", () => {
  const events: BehaviorEvent[] = ["a", "b", "c"].map((s, i) =>
    ev(`c${i}`, `agent:${s}`, { occurred_at: at(i * 5), action_type: "drone.disable_geofence", decision: "REFUSE" })
  );
  const report = analyzeAgentBehavior(events, { now: at(100), coordinatedThreshold: 3, windowMs: 3_600_000 });
  const finding = report.findings.find((f) => f.kind === "coordinated_denial");
  assert.ok(finding, "expected a coordinated_denial finding");
  assert.deepEqual(finding!.subjects, ["agent:a", "agent:b", "agent:c"]);
});

test("peer_anomaly: a volume outlier vs the cohort is flagged", () => {
  const quiet: BehaviorEvent[] = Array.from({ length: 6 }, (_, i) => ev(`q${i}`, `agent:peer${i}`, { occurred_at: at(i) }));
  const noisy: BehaviorEvent[] = Array.from({ length: 10 }, (_, i) => ev(`n${i}`, "agent:outlier", { occurred_at: at(i) }));
  const report = analyzeAgentBehavior([...quiet, ...noisy], { now: at(100), peerStdevFactor: 2 });
  const finding = report.findings.find((f) => f.kind === "peer_anomaly");
  assert.ok(finding, "expected a peer_anomaly finding");
  assert.deepEqual(finding!.subjects, ["agent:outlier"]);
});

test("privilege_escalation: routine → sensitive pivot (blocked) is high severity", () => {
  const events: BehaviorEvent[] = [
    ev("p0", "agent:x", { occurred_at: at(0), action_type: "data.read", decision: "ALLOW" }),
    ev("p1", "agent:x", { occurred_at: at(10), action_type: "secrets.vault.read", decision: "REFUSE" })
  ];
  const report = analyzeAgentBehavior(events, { now: at(100), sensitiveActions: ["secrets\.", "admin\."] });
  const finding = report.findings.find((f) => f.kind === "privilege_escalation");
  assert.ok(finding, "expected a privilege_escalation finding");
  assert.equal(finding!.severity, "high");
  assert.equal(finding!.recommended_disposition, "quarantine");
});

test("privilege_escalation does not run without configured sensitive actions", () => {
  const events: BehaviorEvent[] = [
    ev("p0", "agent:x", { occurred_at: at(0), action_type: "data.read" }),
    ev("p1", "agent:x", { occurred_at: at(10), action_type: "secrets.vault.read" })
  ];
  const report = analyzeAgentBehavior(events, { now: at(100) });
  assert.equal(report.findings.filter((f) => f.kind === "privilege_escalation").length, 0);
});

test("new_capability: action types absent from baseline appearing later are scope creep", () => {
  const events: BehaviorEvent[] = [
    ev("a0", "agent:x", { occurred_at: at(0), action_type: "warehouse.read" }),
    ev("a1", "agent:x", { occurred_at: at(10), action_type: "warehouse.read" }),
    ev("a2", "agent:x", { occurred_at: at(20), action_type: "warehouse.read" }),
    ev("a3", "agent:x", { occurred_at: at(30), action_type: "stripe.refund", decision: "REFUSE" })
  ];
  const report = analyzeAgentBehavior(events, { now: at(100) });
  const finding = report.findings.find((f) => f.kind === "new_capability");
  assert.ok(finding, "expected a new_capability finding");
  assert.match(finding!.detail, /stripe\.refund/);
});

test("credential_reuse: one credential across distinct agents is lateral movement", () => {
  const events: BehaviorEvent[] = [
    ev("k0", "agent:a", { occurred_at: at(0), credential_refs: ["vault:prod-db"] }),
    ev("k1", "agent:b", { occurred_at: at(10), credential_refs: ["vault:prod-db"] }),
    ev("k2", "agent:c", { occurred_at: at(20), credential_refs: ["vault:prod-db"] })
  ];
  const report = analyzeAgentBehavior(events, { now: at(100) });
  const finding = report.findings.find((f) => f.kind === "credential_reuse");
  assert.ok(finding, "expected a credential_reuse finding");
  assert.equal(finding!.severity, "critical"); // 3 distinct subjects
  assert.deepEqual(finding!.subjects, ["agent:a", "agent:b", "agent:c"]);
});

test("higher-order detectors stay silent on a benign single-agent stream", () => {
  const events: BehaviorEvent[] = Array.from({ length: 3 }, (_, i) => ev(`b${i}`, "agent:solo", { occurred_at: at(i * 10), action_type: "warehouse.read", decision: "ALLOW" }));
  const report = analyzeAgentBehavior(events, { now: at(100), sensitiveActions: ["secrets\."] });
  for (const kind of ["coordinated_denial", "peer_anomaly", "privilege_escalation", "new_capability", "credential_reuse"]) {
    assert.equal(report.findings.filter((f) => f.kind === kind).length, 0, `${kind} should not fire`);
  }
});
