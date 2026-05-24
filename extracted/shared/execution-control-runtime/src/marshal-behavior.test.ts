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
