import { evaluateTrialAction, PAYMENTS_GOVERNANCE_SOURCE, TRIAL_SCENARIOS } from "@aristotle/trial-engine";

export function governMcpToolCall(request: { method: string; params: Record<string, string | number | boolean> }) {
  const decision = evaluateTrialAction({
    source: PAYMENTS_GOVERNANCE_SOURCE,
    intent: { ...TRIAL_SCENARIOS[0].intent, requestedAction: request.method, parameters: request.params }
  });
  return decision.decision === "PERMIT" ? { allowed: true, warrant: decision.warrant } : { allowed: false, decision };
}
