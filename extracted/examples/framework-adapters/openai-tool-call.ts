// OpenAI Agents SDK / function-calling adapter.
//
// An OpenAI tool call (`{ name, arguments }`) is reduced to an AristotleOS ToolCall
// and governed through the execution-control boundary. The refund "executes" only
// after an ALLOW + verified Warrant; REFUSE/ESCALATE never run. Run with:
//   npx tsx examples/framework-adapters/openai-tool-call.ts
import type { AuthorityEnvelope, WardManifest } from "@aristotle/execution-control-runtime";
import { governToolCall, type GovernedToolBinding, type ToolCall } from "./govern.js";

const ward: WardManifest = {
  ward_id: "payments-ward",
  name: "Payments Ward",
  sovereignty_context: "fintech-prod",
  authority_domain: "payments-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:payments"]
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-payments-001",
  ward_id: "payments-ward",
  subject: "agent:payments",
  allowed_actions: ["stripe.refund"],
  denied_actions: ["stripe.payout"],
  constraints: { max_amount: 10000 },
  expires_at: "2099-12-31T23:59:59Z",
  issuer: "payments-root"
};

const binding: GovernedToolBinding = {
  ward,
  authorityEnvelope: envelope,
  subject: "agent:payments",
  toAction: (call: ToolCall) => ({
    action_type: call.name,
    target: `customer/${String(call.arguments.customerId)}`,
    params: { amount: call.arguments.amount, currency: call.arguments.currency }
  })
};

// Shape emitted by the OpenAI Agents SDK / Chat Completions tool calling.
const openAiToolCall = {
  id: "call_abc123",
  type: "function" as const,
  function: { name: "stripe.refund", arguments: JSON.stringify({ amount: 8000, currency: "USD", customerId: "cus_17" }) }
};

const call: ToolCall = {
  name: openAiToolCall.function.name,
  arguments: JSON.parse(openAiToolCall.function.arguments),
  callId: openAiToolCall.id
};

// The agent holds no payment credentials. It only gets a Warrant for this one
// action; the actual call would be brokered server-side (see proxy/credential broker).
void (async () => {
  const outcome = await governToolCall(call, binding, ({ warrant }) => {
    return { provider_response: "refunded", under_warrant: warrant.warrant_id };
  });

  if (outcome.status === "executed") {
    console.log(`ALLOW — executed under warrant ${outcome.warrant.warrant_id}`);
    console.log(`GEL record ${outcome.record.record_id} (chain hash ${outcome.record.record_hash.slice(0, 12)}…)`);
  } else {
    console.log(`${outcome.decision} — not executed`, "reason_codes" in outcome ? outcome.reason_codes : outcome.reason);
    console.log(`GEL record ${outcome.record.record_id} still written for audit`);
  }
})();
