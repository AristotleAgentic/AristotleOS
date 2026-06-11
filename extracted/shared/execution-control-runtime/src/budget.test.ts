import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BudgetGovernor, budgetPolicyFrom, checkBudget } from "./budget.js";
import type { AuthorityEnvelope, CanonicalActionInput, WardManifest } from "./index.js";
import { evaluateExecutionControl } from "./index.js";

const HOUR = 3_600_000;

test("checkBudget enforces call and cost ceilings within the window", () => {
  const policy = { windowMs: HOUR, maxCallsPerWindow: 2, maxCostPerWindow: 100 };
  assert.equal(checkBudget(policy, [], 1000, 10).ok, true);
  // two prior calls already at the cap ⇒ a third is refused
  const twoCalls = [{ at: 100, cost: 1 }, { at: 200, cost: 1 }];
  assert.equal(checkBudget(policy, twoCalls, 1000, 1).ok, false);
  // cost ceiling: 90 spent + 20 > 100 ⇒ refused
  const costHeavy = [{ at: 100, cost: 90 }];
  const c = checkBudget({ windowMs: HOUR, maxCostPerWindow: 100 }, costHeavy, 1000, 20);
  assert.equal(c.ok, false);
  assert.match((c as { reason: string }).reason, /cost budget exceeded/);
});

test("checkBudget ignores spend outside the rolling window", () => {
  const policy = { windowMs: HOUR, maxCallsPerWindow: 1 };
  const old = [{ at: 0, cost: 1 }];
  // now is 2h later ⇒ the old call has aged out, so a new call is allowed
  assert.equal(checkBudget(policy, old, 2 * HOUR, 1).ok, true);
});

test("budgetPolicyFrom parses snake/camel and rejects empty/invalid blobs", () => {
  assert.deepEqual(budgetPolicyFrom({ window_ms: HOUR, max_calls_per_window: 5 }), { windowMs: HOUR, maxCallsPerWindow: 5 });
  assert.deepEqual(budgetPolicyFrom({ windowMs: HOUR, maxCostPerWindow: 50 }), { windowMs: HOUR, maxCostPerWindow: 50 });
  assert.equal(budgetPolicyFrom({ windowMs: HOUR }), undefined); // no cap ⇒ not a policy
  assert.equal(budgetPolicyFrom({ maxCallsPerWindow: 5 }), undefined); // no window
  assert.equal(budgetPolicyFrom(null), undefined);
});

test("BudgetGovernor records spend and persists across instances (file-backed)", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "aos-budget-")), "budget.json");
  const a = new BudgetGovernor(file);
  a.record("agent:x", 30, 1000, HOUR);
  a.record("agent:x", 30, 2000, HOUR);
  const b = new BudgetGovernor(file);
  assert.deepEqual(b.spent("agent:x", HOUR, 3000), { calls: 2, cost: 60 });
  // a third $50 would push 60+50=110 over a 100 cap
  assert.equal(b.check("agent:x", { windowMs: HOUR, maxCostPerWindow: 100 }, 3000, 50).ok, false);
});

// --- end-to-end through the gate -------------------------------------------

const ward: WardManifest = {
  ward_id: "w-pay", name: "Payments", sovereignty_context: "corp", authority_domain: "fin",
  policy_version: "0.1.0", permitted_subjects: ["agent:refunder"]
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-pay", ward_id: "w-pay", subject: "agent:refunder",
  allowed_actions: ["stripe.refund"], denied_actions: [],
  constraints: { budget: { windowMs: HOUR, maxCostPerWindow: 100 } },
  expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};
function refund(id: string, cost: number): CanonicalActionInput {
  return { action_id: id, ward_id: "w-pay", subject: "agent:refunder", action_type: "stripe.refund", target: "stripe", params: { cost }, requested_at: "2026-05-24T12:00:00.000Z" };
}
function ledger() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-budget-gel-")), "gel.jsonl");
}

test("evaluateExecutionControl refuses BUDGET_EXCEEDED once the envelope budget is spent", () => {
  const governor = BudgetGovernor.memory();
  const file = ledger();
  const now = "2026-05-24T12:00:00.000Z";
  // $60 then $30 = $90 ALLOWed; the next $30 would hit $120 > $100 ⇒ refused.
  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: refund("r1", 60), ledgerPath: file, now, budgetGovernor: governor });
  assert.equal(first.decision, "ALLOW");
  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: refund("r2", 30), ledgerPath: file, now, budgetGovernor: governor });
  assert.equal(second.decision, "ALLOW");
  const third = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: refund("r3", 30), ledgerPath: file, now, budgetGovernor: governor });
  assert.equal(third.decision, "REFUSE");
  assert.deepEqual(third.reason_codes, ["BUDGET_EXCEEDED"]);
  assert.equal(third.warrant, undefined);
});

test("no budget governor ⇒ budget is not enforced (opt-in)", () => {
  const file = ledger();
  const now = "2026-05-24T12:00:00.000Z";
  const r = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: refund("r1", 9999), ledgerPath: file, now });
  assert.equal(r.decision, "ALLOW"); // governor absent ⇒ no enforcement
});
