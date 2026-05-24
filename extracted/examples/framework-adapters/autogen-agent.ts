// AutoGen / CrewAI pre-tool-execution hook.
//
// A pre-tool hook intercepts before a tool runs and decides whether the agent may
// proceed. Here the decision is the Commit Gate: the hook returns `proceed` only on
// ALLOW + verified Warrant, and hands back the Warrant + GEL record for attribution.
import { governToolCall, type ToolCall } from "./govern.js";
import { paymentsBinding } from "./_fixtures.js";
import type { JsonValue, Warrant } from "@aristotle/execution-control-runtime";

export interface PreToolDecision {
  proceed: boolean;
  decision: "ALLOW" | "REFUSE" | "ESCALATE";
  warrant?: Warrant;
  gel_record_id: string;
  reason?: string;
}

/** Gate an AutoGen/CrewAI tool call before execution. Does not run the tool itself. */
export async function beforeAutoGenToolExecution(toolName: string, parameters: Record<string, JsonValue>, callId?: string): Promise<PreToolDecision> {
  const call: ToolCall = { name: toolName, arguments: parameters, callId };
  // The hook authorizes; the framework runs the tool only if `proceed` is true.
  const outcome = await governToolCall(call, paymentsBinding, () => undefined);
  if (outcome.status === "executed") {
    return { proceed: true, decision: "ALLOW", warrant: outcome.warrant, gel_record_id: outcome.record.record_id };
  }
  return {
    proceed: false,
    decision: outcome.status === "escalated" ? "ESCALATE" : "REFUSE",
    gel_record_id: outcome.record.record_id,
    reason: "reason_codes" in outcome ? outcome.reason_codes.join(", ") : outcome.reason
  };
}

void (async () => {
  if (!process.argv[1]?.endsWith("autogen-agent.ts")) return;
  const decision = await beforeAutoGenToolExecution("stripe.refund", { amount: 8000, currency: "USD", customerId: "cus_17" }, "ag-1");
  console.log(`proceed=${decision.proceed} decision=${decision.decision} ${decision.warrant?.warrant_id ?? decision.reason ?? ""}`);
})();
