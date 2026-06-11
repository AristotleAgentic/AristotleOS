// MCP (Model Context Protocol) adapter.
//
// An MCP `tools/call` request is reduced to an AristotleOS ToolCall and governed
// through the execution-control boundary before the tool runs. `governMcpToolCall`
// returns an MCP-style result; consequential tools execute only on ALLOW + verified
// Warrant. Run with: npx tsx examples/framework-adapters/mcp-tool-call.ts
import type { AuthorityEnvelope, JsonValue, WardManifest } from "@aristotle/execution-control-runtime";
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

interface McpCallToolRequest {
  method: "tools/call";
  params: { name: string; arguments: Record<string, JsonValue>; _meta?: { progressToken?: string } };
}

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Govern an MCP tool call. Returns an MCP-style result; tools run only on ALLOW. */
export async function governMcpToolCall(request: McpCallToolRequest): Promise<McpToolResult> {
  const call: ToolCall = {
    name: request.params.name,
    arguments: request.params.arguments,
    callId: request.params._meta?.progressToken
  };
  const outcome = await governToolCall(call, binding, ({ warrant }) => ({ executed_under: warrant.warrant_id }));

  if (outcome.status === "executed") {
    return { content: [{ type: "text", text: `ALLOW: executed under warrant ${outcome.warrant.warrant_id} (GEL ${outcome.record.record_id})` }] };
  }
  const detail = "reason_codes" in outcome ? outcome.reason_codes.join(", ") : outcome.reason;
  return { content: [{ type: "text", text: `${outcome.decision}: refused before execution (${detail}); GEL ${outcome.record.record_id}` }], isError: true };
}

// Demo invocation when run directly.
if (process.argv[1]?.endsWith("mcp-tool-call.ts")) {
  void (async () => {
    const result = await governMcpToolCall({
      method: "tools/call",
      params: { name: "stripe.refund", arguments: { amount: 8000, currency: "USD", customerId: "cus_17" }, _meta: { progressToken: "mcp-001" } }
    });
    console.log(result.content[0].text);
  })();
}
