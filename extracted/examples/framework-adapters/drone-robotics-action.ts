import { evaluateTrialAction, PAYMENTS_GOVERNANCE_SOURCE, TRIAL_SCENARIOS } from "@aristotle/trial-engine";

const scenario = TRIAL_SCENARIOS.find((item) => item.id === "drone-restricted-airspace") ?? TRIAL_SCENARIOS[0];
const decision = evaluateTrialAction({ source: PAYMENTS_GOVERNANCE_SOURCE, intent: scenario.intent });

console.log("actuator command withheld unless PERMIT", decision.decision, decision.explanation);
