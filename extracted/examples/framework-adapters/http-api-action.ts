// Plain HTTP API mutation adapter.
//
// A consequential HTTP call is governed before it leaves the agent: the request is
// sent only on ALLOW + verified Warrant. In production, prefer the credential broker
// (proxyGovernedAction) so the agent never holds the downstream secret; here the
// executor stands in for the forwarded call.
import { governToolCall, type GovernedOutcome, type ToolCall } from "./govern.js";
import { httpBinding } from "./_fixtures.js";
import type { JsonValue } from "@aristotle/execution-control-runtime";

/** Govern an HTTP mutation. `send` performs the call only when authorized. */
export async function governHttpMutation(
  method: "post" | "put" | "get" | "delete",
  url: string,
  body: Record<string, JsonValue> = {},
  send: () => Promise<unknown> | unknown = () => ({ status: 200 })
): Promise<GovernedOutcome<unknown>> {
  const call: ToolCall = { name: `http.${method}`, arguments: { url, method, body }, callId: `${method}:${url}` };
  return governToolCall(call, httpBinding, send);
}

void (async () => {
  if (!process.argv[1]?.endsWith("http-api-action.ts")) return;
  const ok = await governHttpMutation("post", "https://api.internal/refunds", { amount: 8000 });
  console.log("POST  ->", ok.status, ok.decision);
  const denied = await governHttpMutation("delete", "https://api.internal/customers/42");
  console.log("DELETE ->", denied.status, denied.decision, "reason_codes" in denied ? denied.reason_codes : "");
})();
