import test from "node:test";
import assert from "node:assert/strict";
import {
  PAYMENTS_GOVERNANCE_SOURCE,
  TRIAL_SCENARIOS,
  evaluateTrialAction,
  parseGovernanceSource,
  planGovernanceChange,
  validateGovernanceSource
} from "./index.js";

test("governance file validates required AristotleOS primitives", () => {
  const result = validateGovernanceSource(PAYMENTS_GOVERNANCE_SOURCE);
  assert.equal(result.ok, true);
  assert.equal(result.policy?.ward.id, "enterprise-payments");
  assert.equal(result.policy?.commitGate.requireAuthority, "refund-authority");
});

test("payments flagship scenario defers before warrant issuance", () => {
  const scenario = TRIAL_SCENARIOS.find((item) => item.id === "payments-refund-8000");
  assert.ok(scenario);
  const result = evaluateTrialAction({ source: PAYMENTS_GOVERNANCE_SOURCE, intent: scenario.intent, now: "2026-05-20T00:00:00.000Z" });
  assert.equal(result.decision, "DEFER");
  assert.equal(result.warrant, undefined);
  assert.ok(result.deferToken);
  assert.equal(result.gelRecord.decision, "DEFER");
});

test("operator approval issues a single-use warrant and commits GEL", () => {
  const scenario = TRIAL_SCENARIOS[0];
  const result = evaluateTrialAction({ source: PAYMENTS_GOVERNANCE_SOURCE, intent: scenario.intent, approval: "approve", now: "2026-05-20T00:00:00.000Z" });
  assert.equal(result.decision, "PERMIT");
  assert.equal(result.warrant?.singleUse, true);
  assert.equal(result.gelRecord.replayable, true);
});

test("denied payout never receives a warrant", () => {
  const scenario = TRIAL_SCENARIOS.find((item) => item.id === "payments-payout-deny");
  assert.ok(scenario);
  const result = evaluateTrialAction({ source: PAYMENTS_GOVERNANCE_SOURCE, intent: scenario.intent });
  assert.equal(result.decision, "DENY");
  assert.equal(result.warrant, undefined);
  assert.equal(result.controllingRule.includes("deny_action") || result.controllingRule.includes("permitted_actions"), true);
});

test("missing authority binding fails closed", () => {
  const broken = PAYMENTS_GOVERNANCE_SOURCE.replace('require_authority = "refund-authority"', 'require_authority = "missing-authority"');
  const policy = parseGovernanceSource(broken);
  const result = evaluateTrialAction({ policy, intent: TRIAL_SCENARIOS[0].intent });
  assert.equal(result.decision, "FAIL_CLOSED");
  assert.equal(result.decisionCode, "MISSING_AUTHORITY_BINDING");
});

test("plan reports governance artifact changes", () => {
  const next = PAYMENTS_GOVERNANCE_SOURCE.replace("max_amount = 10000", "max_amount = 9000");
  const plan = planGovernanceChange(next);
  assert.equal(plan.ok, true);
  assert.ok(plan.changes.some((line) => line.includes("max_amount")));
});
