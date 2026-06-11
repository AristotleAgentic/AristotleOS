// LangChain / LangGraph tool adapter.
//
// Wrap a LangChain tool so its invocation is governed: the tool body runs only on
// ALLOW + verified Warrant. Returns a typed outcome the graph can branch on.
import { governToolCall, type GovernedOutcome, type ToolCall } from "./govern.js";
import { paymentsBinding } from "./_fixtures.js";

/** Govern a LangChain/LangGraph tool call. `run` executes only when authorized. */
export async function governedLangChainTool(
  args: { amount: number; currency: string; customerId?: string },
  run: () => Promise<unknown> | unknown = () => "refund executed"
): Promise<GovernedOutcome<unknown>> {
  const call: ToolCall = { name: "stripe.refund", arguments: { ...args }, callId: `lc-${args.customerId ?? "anon"}` };
  return governToolCall(call, paymentsBinding, run);
}

void (async () => {
  if (!process.argv[1]?.endsWith("langchain-tool.ts")) return;
  const outcome = await governedLangChainTool({ amount: 8000, currency: "USD", customerId: "cus_17" });
  console.log(outcome.status, outcome.decision, outcome.status === "executed" ? outcome.warrant.warrant_id : "");
})();
