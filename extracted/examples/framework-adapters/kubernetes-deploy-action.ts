import { evaluateTrialAction, PAYMENTS_GOVERNANCE_SOURCE, TRIAL_SCENARIOS } from "@aristotle/trial-engine";

const scenario = TRIAL_SCENARIOS.find((item) => item.id === "kubernetes-production-deploy") ?? TRIAL_SCENARIOS[0];
const decision = evaluateTrialAction({ source: PAYMENTS_GOVERNANCE_SOURCE, intent: scenario.intent });

console.log("kubectl apply only after PERMIT", decision.decision, decision.gelRecord.recordId);
