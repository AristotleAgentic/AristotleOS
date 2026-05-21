import { evaluateTrialAction, PAYMENTS_GOVERNANCE_SOURCE, TRIAL_SCENARIOS } from "@aristotle/trial-engine";

const anthropicToolUse = {
  type: "tool_use",
  name: "stripe.refund",
  input: { amount: 8000, currency: "USD" }
};

const decision = evaluateTrialAction({
  source: PAYMENTS_GOVERNANCE_SOURCE,
  intent: { ...TRIAL_SCENARIOS[0].intent, requestedAction: anthropicToolUse.name, parameters: anthropicToolUse.input }
});

console.log(decision.decision, decision.warrant?.id ?? "no warrant", decision.gelRecord.recordId);
