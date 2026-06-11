import test from "node:test";
import assert from "node:assert/strict";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Execution-gate /commit-point + /decide + /kill-switch behavioral tests.
 *
 * The execution-gate is the substrate's enforcement point: it
 * combines the real evaluateCommitGate (substrate decision) with
 * operator-side overlays (kill-switch, witness, identity, telemetry).
 * Getting the combination right is load-bearing — a single
 * fail-open path turns the substrate into theater.
 *
 * Coverage:
 *   (1) /health surfaces killSwitchState + substrate_wired
 *   (2) global /kill-switch → /commit-point returns halt + killSwitchState=active
 *   (3) mission-scope /kill-switch only halts the matching mission;
 *       other missions still get the substrate's decision
 *   (4) /commit-point happy path → allow, killSwitchState=inactive
 *   (5) /commit-point with witnessRequired=true + witnessAccepted=false
 *       → deny + extraReasons includes "Witness obligation unsatisfied"
 *   (6) /commit-point with identityLegitimate=false → deny
 *   (7) /commit-point with telemetrySatisfied=false → deny + custom reasons
 *   (8) /decide happy path with witnessAccepted=true → allow
 *   (9) /decide with witnessRequired=true + witnessAccepted=false → deny
 *
 * No production code is modified. The substrate's evaluateCommitGate is
 * called for real on each request; the operator overlays layer on top.
 */

/**
 * Minimum substrate fixture that evaluateCommitGate will accept as ALLOW
 * when none of the operator overlays force a deny. Supplied explicitly
 * so the test's substrate decision is deterministic — without it the
 * gate's defaultWard / defaultEnvelope / defaultAction would generate
 * shapes per-request and the test would couple to the synthesis code.
 */
function substrateAllow() {
  return {
    ward: {
      ward_id: "ward-test",
      name: "Test Ward",
      sovereignty_context: "test",
      authority_domain: "test-ops",
      policy_version: "1.0.0",
      permitted_subjects: ["agent:tester"]
    },
    authorityEnvelope: {
      envelope_id: "env-test-allow",
      ward_id: "ward-test",
      subject: "agent:tester",
      allowed_actions: ["test.do"],
      denied_actions: [],
      constraints: {},
      expires_at: "2099-12-31T23:59:59Z",
      issuer: "test-issuer"
    },
    action: {
      action_id: "act-test-1",
      ward_id: "ward-test",
      subject: "agent:tester",
      action_type: "test.do",
      target: "test-target",
      params: {},
      requested_at: "2026-06-05T12:00:00.000Z"
    }
  };
}

test("/health surfaces killSwitchState, activeKillScopes, and substrate_wired=true", async () => {
  const svc = await startService("execution-gate");
  try {
    const { status, body } = await svc.get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "execution-gate");
    assert.equal(body.killSwitchState, "inactive");
    assert.deepEqual(body.activeKillScopes, []);
    assert.equal(body.substrate_wired, true);
  } finally { await svc.stop(); }
});

test("global /kill-switch → /commit-point returns halt + killSwitchState=active", async () => {
  const svc = await startService("execution-gate");
  try {
    await svc.post("/kill-switch", { state: "active", scope: "global" });
    const r = await svc.post("/commit-point", {
      warrantId: "war-halt",
      envelopeId: "env-halt",
      agentId: "agent:tester",
      substrate: substrateAllow()
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.decision, "halt", "global kill-switch must force halt");
    assert.equal(r.body.killSwitchState, "active");
    assert.ok(r.body.reasons.includes("Kill switch active for this scope"));
    assert.equal(r.body.verification.status, "failed");
  } finally { await svc.stop(); }
});

test("mission-scope /kill-switch halts ONLY the matching mission", async () => {
  const svc = await startService("execution-gate");
  try {
    await svc.post("/kill-switch", {
      state: "active",
      scope: "mission",
      scopeRef: "mission-killed"
    });
    // Killed mission: halt.
    const killed = await svc.post("/commit-point", {
      warrantId: "war-1",
      envelopeId: "env-1",
      missionId: "mission-killed",
      agentId: "agent:tester",
      substrate: substrateAllow()
    });
    assert.equal(killed.body.decision, "halt", "mission-killed must halt");

    // Other mission: substrate decision honored (no halt from the mission-scoped kill).
    const other = await svc.post("/commit-point", {
      warrantId: "war-2",
      envelopeId: "env-2",
      missionId: "mission-other",
      agentId: "agent:tester",
      substrate: substrateAllow()
    });
    assert.equal(other.body.decision, "allow", "non-killed mission must still allow");
    assert.equal(other.body.killSwitchState, "inactive");
  } finally { await svc.stop(); }
});

test("/commit-point happy path returns allow with verification=verified", async () => {
  const svc = await startService("execution-gate");
  try {
    const r = await svc.post("/commit-point", {
      warrantId: "war-happy",
      envelopeId: "env-happy",
      agentId: "agent:tester",
      substrate: substrateAllow()
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.decision, "allow");
    assert.equal(r.body.killSwitchState, "inactive");
    assert.equal(r.body.witnessStatus, "not-required");
    assert.equal(r.body.verification.status, "verified");
    // The substrate reason code is surfaced verbatim alongside any operator reasons.
    assert.ok(r.body.reasons.some((reason) => reason.startsWith("commit_gate:")),
      `expected at least one commit_gate:* reason, got ${JSON.stringify(r.body.reasons)}`);
  } finally { await svc.stop(); }
});

test("/commit-point with witnessRequired=true + witnessAccepted=false → deny with witness reason", async () => {
  const svc = await startService("execution-gate");
  try {
    const r = await svc.post("/commit-point", {
      warrantId: "war-witness",
      envelopeId: "env-witness",
      witnessRequired: true,
      witnessAccepted: false,
      agentId: "agent:tester",
      substrate: substrateAllow()
    });
    assert.equal(r.body.decision, "deny",
      "operator-overlay witness fail must override substrate ALLOW");
    assert.equal(r.body.witnessStatus, "unsatisfied");
    assert.ok(r.body.reasons.includes("Witness obligation unsatisfied"));
    assert.equal(r.body.verification.status, "failed");
  } finally { await svc.stop(); }
});

test("/commit-point with identityLegitimate=false → deny with identity reason", async () => {
  const svc = await startService("execution-gate");
  try {
    const r = await svc.post("/commit-point", {
      warrantId: "war-identity",
      envelopeId: "env-identity",
      identityLegitimate: false,
      agentId: "agent:tester",
      substrate: substrateAllow()
    });
    assert.equal(r.body.decision, "deny");
    assert.ok(r.body.reasons.some((reason) => /Identity legitimacy/.test(reason)),
      `expected an identity-legitimacy reason, got ${JSON.stringify(r.body.reasons)}`);
  } finally { await svc.stop(); }
});

test("/commit-point with telemetrySatisfied=false + telemetryReasons → deny + custom reasons surface", async () => {
  const svc = await startService("execution-gate");
  try {
    const r = await svc.post("/commit-point", {
      warrantId: "war-telemetry",
      envelopeId: "env-telemetry",
      telemetrySatisfied: false,
      telemetryReasons: ["GPS jam detected", "Battery below threshold"],
      agentId: "agent:tester",
      substrate: substrateAllow()
    });
    assert.equal(r.body.decision, "deny");
    assert.ok(r.body.reasons.includes("GPS jam detected"));
    assert.ok(r.body.reasons.includes("Battery below threshold"));
  } finally { await svc.stop(); }
});

test("/decide happy path with witnessAccepted=true returns allow", async () => {
  const svc = await startService("execution-gate");
  try {
    const r = await svc.post("/decide", {
      warrantId: "war-decide-ok",
      envelopeId: "env-decide-ok",
      witnessAccepted: true,
      witnessRequired: true,
      agentId: "agent:tester",
      substrate: substrateAllow()
    });
    assert.equal(r.body.decision, "allow");
    assert.equal(r.body.witnessStatus, "satisfied");
    assert.ok(r.body.reasons.includes("Witness obligation satisfied"));
  } finally { await svc.stop(); }
});

test("/decide with witnessRequired=true + witnessAccepted=false returns deny", async () => {
  const svc = await startService("execution-gate");
  try {
    const r = await svc.post("/decide", {
      warrantId: "war-decide-deny",
      envelopeId: "env-decide-deny",
      witnessAccepted: false,
      witnessRequired: true,
      agentId: "agent:tester",
      substrate: substrateAllow()
    });
    assert.equal(r.body.decision, "deny");
    assert.equal(r.body.witnessStatus, "unsatisfied");
    assert.ok(r.body.reasons.includes("Witness obligation unsatisfied"));
  } finally { await svc.stop(); }
});
