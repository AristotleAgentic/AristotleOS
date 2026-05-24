import test from "node:test";
import assert from "node:assert/strict";
import { type GelRecordLike, decisionToUi, mapGelToLedger, mapMetricsToSnapshot } from "./boundary.js";

test("decisionToUi maps gate decisions to the console vocabulary", () => {
  assert.equal(decisionToUi("ALLOW"), "allow");
  assert.equal(decisionToUi("REFUSE"), "refuse");
  assert.equal(decisionToUi("ESCALATE"), "escalate");
});

test("mapMetricsToSnapshot maps /metrics into header fields and marks the source live", () => {
  const snap = mapMetricsToSnapshot(
    { total_records: 42, decisions: { ALLOW: 30, REFUSE: 9, ESCALATE: 3 }, ledger_ok: true, kill_switch_engaged: false, runtime: { latency_ms: { p50: 4.2 } } },
    true
  );
  assert.equal(snap.source, "live");
  assert.equal(snap.warrantsToday, 30);
  assert.equal(snap.refusalsToday, 9);
  assert.equal(snap.escalationsToday, 3);
  assert.equal(snap.ledgerHeight, 42);
  assert.equal(snap.ledgerIntact, true);
  assert.equal(snap.killSwitchArmed, false);
  assert.equal(snap.posture, "green");
  assert.equal(snap.gateLatencyMs, 4.2);
});

test("mapMetricsToSnapshot: kill switch -> red posture; broken ledger -> amber", () => {
  assert.equal(mapMetricsToSnapshot({ kill_switch_engaged: true, ledger_ok: true }, true).posture, "red");
  assert.equal(mapMetricsToSnapshot({ kill_switch_engaged: false, ledger_ok: false }, false).posture, "amber");
});

test("mapGelToLedger maps signed records into ledger rows", () => {
  const records: GelRecordLike[] = [
    { record_id: "r1", timestamp: "2026-05-24T12:00:00.000Z", subject: "agent:a", ward_id: "w1", decision: "ALLOW", reason_codes: ["ALLOWED"], warrant_id: "wrn-1", policy_version: "1.0.0", canonical_action_hash: "abcdef0123456789ffff", record_hash: "h1", previous_hash: "GENESIS" },
    { record_id: "r2", timestamp: "2026-05-24T12:00:01.000Z", subject: "agent:b", ward_id: "w1", decision: "REFUSE", reason_codes: ["ACTION_DENIED"], canonical_action_hash: "0011", record_hash: "h2", previous_hash: "h1" }
  ];
  const rows = mapGelToLedger(records);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].seq, 1);
  assert.equal(rows[0].decision, "allow");
  assert.equal(rows[0].agent, "agent:a");
  assert.equal(rows[0].ward, "w1");
  assert.equal(rows[0].warrantId, "wrn-1");
  assert.equal(rows[0].registerHash, "abcdef0123456789"); // first 16 of the action hash
  assert.equal(rows[0].anchored, true);
  assert.equal(rows[1].decision, "refuse");
  assert.equal(rows[1].anchored, false); // no warrant
});
