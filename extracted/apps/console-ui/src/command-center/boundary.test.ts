import test from "node:test";
import assert from "node:assert/strict";
import {
  type GelRecordLike,
  type MarshalReportLike,
  type ShadowReportLike,
  buildRepresentativeActions,
  decisionToUi,
  mapCensusReport,
  mapGelToLedger,
  mapMetricsToSnapshot,
  mapShadowReport
} from "./boundary.js";

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

test("buildRepresentativeActions derives one probe per allowed and denied action", () => {
  const actions = buildRepresentativeActions(
    { ward_id: "w1", subject: "agent:a", allowed_actions: ["drone.takeoff", "drone.scan_area"], denied_actions: ["drone.disable_geofence"], boundary_id: "grid-a" },
    "2026-05-24T00:00:00.000Z"
  );
  assert.equal(actions.length, 3);
  assert.equal(actions[0].action.action_type, "drone.takeoff");
  assert.equal(actions[0].action.ward_id, "w1");
  assert.equal(actions[0].action.subject, "agent:a");
  assert.deepEqual(actions[0].action.params, { boundary_id: "grid-a" });
  assert.equal(actions[2].action.action_type, "drone.disable_geofence");
});

test("mapShadowReport maps a live ShadowReport into the console profile summary", () => {
  const report: ShadowReportLike = {
    ward_id: "ward-payments",
    authority_envelope_id: "ae-refund-114",
    count: 5,
    decisions: { ALLOW: 3, REFUSE: 1, ESCALATE: 1 },
    rollout: { ready: false, allow_rate: 0.6 },
    findings: {
      missing_runtime_registers: [{ action_id: "shadow-001", registers: ["telemetry.gps_lock"] }],
      physical_near_misses: [{ action_id: "shadow-002", detail: "altitude within 2m of ceiling" }],
      revoked_authority: [{ action_id: "shadow-003", reason: "AUTHORITY_REVOKED" }]
    }
  };
  const summary = mapShadowReport(report);
  assert.equal(summary.wardId, "ward-payments");
  assert.equal(summary.envelopeId, "ae-refund-114");
  assert.equal(summary.evaluatedActions, 5);
  assert.equal(summary.wouldAllow, 3);
  assert.equal(summary.wouldRefuse, 1);
  assert.equal(summary.wouldEscalate, 1);
  assert.equal(summary.rolloutReady, false);
  assert.equal(summary.allowRate, 0.6);
  assert.equal(summary.findings.length, 3);
  assert.deepEqual(summary.findings.map((f) => f.kind).sort(), ["missing-register", "near-miss", "revoked-authority"]);
});

test("mapCensusReport maps live census findings into the console finding shape", () => {
  const report: MarshalReportLike = {
    findings: [
      {
        finding_id: "f1",
        agent_id: "a1",
        subject: "agent:shadow-refund-runner",
        ward_id: "ward-payments",
        status: "rogue",
        risk_score: 95,
        risk_band: "critical",
        owner: undefined,
        observed_locations: ["workstation/finance-17"],
        observed_tools: ["stripe.refunds.write"],
        credential_refs: ["vault:stripe-prod"],
        last_seen: "2026-05-24T00:00:00.000Z",
        signals: [{ code: "UNREGISTERED_AGENT", weight: 30, detail: "no registry entry" }],
        recommended_disposition: "revoke_credentials",
        evidence_hash: "deadbeef"
      }
    ]
  };
  const rows = mapCensusReport(report);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "f1");
  assert.equal(rows[0].subject, "agent:shadow-refund-runner");
  assert.equal(rows[0].status, "rogue");
  assert.equal(rows[0].riskScore, 95);
  assert.equal(rows[0].riskBand, "critical");
  assert.equal(rows[0].owner, "unknown"); // undefined owner defaults
  assert.equal(rows[0].recommendedDisposition, "revoke_credentials");
  assert.equal(rows[0].evidenceHash, "deadbeef");
});
