import { evaluateTrialAction, PAYMENTS_GOVERNANCE_SOURCE, TRIAL_SCENARIOS } from "@aristotle/trial-engine";

export function governHttpMutation(method: string, path: string, body: Record<string, string | number | boolean>) {
  return evaluateTrialAction({
    source: PAYMENTS_GOVERNANCE_SOURCE,
    intent: {
      ...TRIAL_SCENARIOS[0].intent,
      requestedAction: `${method.toLowerCase()} ${path}`,
      target: path,
      parameters: body
    }
  });
}
