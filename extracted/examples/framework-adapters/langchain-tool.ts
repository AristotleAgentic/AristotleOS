import { evaluateTrialAction, PAYMENTS_GOVERNANCE_SOURCE, TRIAL_SCENARIOS } from "@aristotle/trial-engine";

export async function governedLangChainTool(input: { amount: number; currency: string }) {
  const decision = evaluateTrialAction({
    source: PAYMENTS_GOVERNANCE_SOURCE,
    intent: { ...TRIAL_SCENARIOS[0].intent, requestedAction: "stripe.refund", parameters: input }
  });
  if (decision.decision !== "PERMIT") return { blocked: true, decision };
  return { blocked: false, warrant: decision.warrant, result: "refund would execute here" };
}
