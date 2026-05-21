import { evaluateTrialAction, PAYMENTS_GOVERNANCE_SOURCE, TRIAL_SCENARIOS } from "@aristotle/trial-engine";

const openAiStyleToolCall = {
  name: "stripe.refund",
  arguments: { amount: 8000, currency: "USD", customerId: "cus_enterprise_17" }
};

const intent = {
  ...TRIAL_SCENARIOS[0].intent,
  requestedAction: openAiStyleToolCall.name,
  parameters: openAiStyleToolCall.arguments
};

const decision = evaluateTrialAction({ source: PAYMENTS_GOVERNANCE_SOURCE, intent });
if (decision.decision !== "PERMIT") {
  console.log("do not execute", decision.decision, decision.explanation);
} else {
  console.log("execute only with warrant", decision.warrant?.id);
}
