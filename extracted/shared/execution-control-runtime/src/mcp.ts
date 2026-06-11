import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  type AristotleSigner,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type RuntimeRegister,
  type WardManifest,
  evaluateExecutionControl,
  verifyGelChain
} from "./index.js";
import { type CredentialBroker, proxyGovernedAction } from "./proxy.js";

/**
 * Model Context Protocol server for the AristotleOS execution-control boundary.
 *
 * Implemented directly over newline-delimited JSON-RPC on stdio (no external SDK)
 * so the runtime stays dependency-free and bundles cleanly. MCP-capable agent
 * runtimes can call the boundary's tools before performing consequential actions.
 */

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "aristotle-execution-control";
const SERVER_VERSION = "0.1.0";

export interface ExecutionControlMcpOptions {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  ledgerPath: string;
  signer?: AristotleSigner;
  broker?: CredentialBroker;
  input?: Readable;
  output?: Writable;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "aristotle_evaluate_action",
    description: "Evaluate a Canonical Governed Action at the AristotleOS Commit Gate. Returns ALLOW/REFUSE/ESCALATE, a signed Warrant on ALLOW, and a Governance Evidence Ledger record. Call this before any consequential action.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "object", description: "Canonical Governed Action (action_id, ward_id, subject, action_type, target, params, requested_at)" },
        runtime_register: { type: "object", description: "Runtime register snapshot (telemetry, registers)" }
      }
    }
  },
  {
    name: "aristotle_proxy_action",
    description: "Evaluate a governed HTTP action and forward it downstream only on ALLOW. Credentials are injected server-side by the broker and never returned to the caller.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "object", description: "Canonical Governed Action describing an http.* request" }
      }
    }
  },
  {
    name: "aristotle_audit_verify",
    description: "Verify the integrity of the Governance Evidence Ledger hash chain.",
    inputSchema: { type: "object", properties: {} }
  }
] as const;

export function createExecutionControlMcpServer(options: ExecutionControlMcpOptions) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  const send = (message: Record<string, unknown>) => output.write(`${JSON.stringify(message)}\n`);
  const reply = (id: JsonRpcMessage["id"], result: unknown) => send({ jsonrpc: "2.0", id, result });
  const replyError = (id: JsonRpcMessage["id"], code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });
  const toolResult = (payload: unknown, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError });

  async function callTool(params: Record<string, unknown> | undefined) {
    const name = params?.name as string | undefined;
    const args = (params?.arguments as Record<string, unknown> | undefined) ?? {};
    try {
      if (name === "aristotle_evaluate_action") {
        const result = evaluateExecutionControl({
          ward: options.ward,
          authorityEnvelope: options.authorityEnvelope,
          action: args.action as CanonicalActionInput,
          runtimeRegister: args.runtime_register as RuntimeRegister | undefined,
          ledgerPath: options.ledgerPath,
          signer: options.signer
        });
        return toolResult({
          decision: result.decision,
          reason_codes: result.reason_codes,
          canonical_action_hash: result.canonical_action_hash,
          warrant_id: result.warrant?.warrant_id ?? null,
          signing_key_id: result.warrant?.signing_key_id ?? null,
          gel_record_hash: result.gel_record.record_hash,
          ledger_verification: result.ledger_verification
        }, result.decision !== "ALLOW");
      }
      if (name === "aristotle_proxy_action") {
        const result = await proxyGovernedAction({
          ward: options.ward,
          authorityEnvelope: options.authorityEnvelope,
          action: args.action as CanonicalActionInput,
          ledgerPath: options.ledgerPath,
          signer: options.signer,
          broker: options.broker
        });
        return toolResult({
          decision: result.decision,
          reason_codes: result.reason_codes,
          forwarded: result.forwarded,
          injected_headers: result.injected_headers,
          warrant_id: result.warrant?.warrant_id ?? null,
          response: result.response ? { status: result.response.status, body: result.response.body } : null,
          error: result.error
        }, result.decision !== "ALLOW" || !result.forwarded);
      }
      if (name === "aristotle_audit_verify") {
        return toolResult(verifyGelChain(options.ledgerPath));
      }
      return toolResult({ error: `unknown tool: ${name}` }, true);
    } catch (error) {
      return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
    }
  }

  async function handle(message: JsonRpcMessage) {
    const { id, method, params } = message;
    if (method === "initialize") {
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
      return;
    }
    if (method === "tools/list") {
      reply(id, { tools: TOOLS });
      return;
    }
    if (method === "tools/call") {
      reply(id, await callTool(params));
      return;
    }
    if (method === "ping") {
      reply(id, {});
      return;
    }
    if (method?.startsWith("notifications/")) return; // notifications get no response
    if (id !== undefined && id !== null) replyError(id, -32601, `method not found: ${method}`);
  }

  const rl = createInterface({ input });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      return; // ignore non-JSON lines
    }
    void handle(message);
  });

  const closed = new Promise<void>((resolve) => rl.on("close", resolve));

  return {
    tools: TOOLS,
    close: () => rl.close(),
    closed
  };
}
