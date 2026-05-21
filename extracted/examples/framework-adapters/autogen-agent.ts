import { evaluateTrialAction, PAYMENTS_GOVERNANCE_SOURCE, TRIAL_SCENARIOS } from "@aristotle/trial-engine";

export function beforeAutoGenToolExecution(toolName: string, parameters: Record<string, string | number | boolean>) {
  return evaluateTrialAction({
    source: PAYMENTS_GOVERNANCE_SOURCE,
    intent: { ...TRIAL_SCENARIOS[0].intent, requestedAction: toolName, parameters }
  });
}
