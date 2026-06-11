// Anthropic (Claude) tool-use adapter.
//
// A Claude `tool_use` content block is reduced to an AristotleOS ToolCall and
// governed through the execution-control boundary; the refund runs only on ALLOW +
// verified Warrant. Run: npx tsx examples/framework-adapters/anthropic-tool-use.ts
import { governToolCall, type ToolCall } from "./govern.js";
import { paymentsBinding } from "./_fixtures.js";

// Shape of an Anthropic tool_use block.
const toolUse = { type: "tool_use" as const, id: "toolu_01", name: "stripe.refund", input: { amount: 8000, currency: "USD", customerId: "cus_17" } };

const call: ToolCall = { name: toolUse.name, arguments: toolUse.input, callId: toolUse.id };

void (async () => {
  const outcome = await governToolCall(call, paymentsBinding, ({ warrant }) => ({ tool_result: "refunded", under_warrant: warrant.warrant_id }));
  if (outcome.status === "executed") {
    console.log(`ALLOW — executed under warrant ${outcome.warrant.warrant_id} (GEL ${outcome.record.record_id})`);
  } else {
    console.log(`${outcome.decision} — not executed`, "reason_codes" in outcome ? outcome.reason_codes : outcome.reason);
  }
})();
