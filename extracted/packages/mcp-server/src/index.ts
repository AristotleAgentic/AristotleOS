/**
 * @aristotle/mcp-server
 *
 * AristotleOS as a Model Context Protocol (MCP) server. Wraps
 * caller-supplied tools with the substrate's commit gate so any
 * MCP-speaking agent (Claude Desktop, IDEs, custom clients) that
 * connects gets governance on every tool call.
 *
 * What ships:
 *
 *   - GovernedMcpTool — the contract for a tool wrapped with
 *     AristotleOS governance. Has the standard MCP tool shape (name,
 *     description, inputSchema) plus a handler that runs under the
 *     gate.
 *
 *   - createGovernedMcpServer — factory that takes a list of
 *     UnwrappedMcpTool definitions + an AristotleClient and returns
 *     GovernedMcpTools whose handlers go through evaluate -> warrant ->
 *     execute. Refusals surface as MCP tool errors with the substrate's
 *     reason_codes in the error message.
 *
 *   - listTools / callTool — transport-agnostic helpers that mirror
 *     the MCP server protocol's `tools/list` and `tools/call` shape.
 *     Connect any MCP-compatible transport (stdio, SSE, websocket) by
 *     forwarding requests to these helpers.
 *
 * Design notes:
 *
 *   - We do NOT take a hard dependency on the @modelcontextprotocol/sdk
 *     package. The MCP spec defines tool / call shapes that are stable
 *     and we replicate the minimal types here. Consumers who want to
 *     wire to the real SDK do so at their transport layer.
 *
 *   - Every tool call carries the substrate's standard CanonicalAction
 *     shape under the hood. The mapping is:
 *       MCP tool name  -> action_type (`mcp.${toolName}`)
 *       MCP tool args  -> action.params
 *       Caller-injected ward + subject  -> action.ward_id + action.subject
 *
 *   - Refusals are surfaced as MCP-compatible error responses with
 *     `isError: true` and a content block describing the gate's
 *     decision + reason_codes.
 *
 *   - This package is structurally an "agent framework adapter" in
 *     the same family as @aristotle/langchain, @aristotle/vercel-ai,
 *     @aristotle/mastra, @aristotle/openai-agents, @aristotle/claude-agents.
 *     It's bucketed under packages/ rather than examples/framework-adapters/
 *     because the MCP server surface is a published wire protocol the
 *     substrate publicly exposes, not a private worked example.
 */

import { AristotleApiError, type AristotleClient, type CanonicalAction } from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// MCP shapes — minimal replication so we don't take a hard SDK dep
// ---------------------------------------------------------------------------

/**
 * JSON-Schema-ish shape for tool inputs. Matches the MCP spec's
 * `inputSchema` field (a JSON Schema object). Kept loose-typed
 * because MCP itself is loose-typed here.
 */
export type McpInputSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

/** Content block in an MCP tool result. */
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; mimeType?: string } };

/** Result of a `tools/call` request — success OR isError. */
export interface McpCallResult {
  content: McpContent[];
  isError?: boolean;
  /** Substrate-side metadata operators can surface in audit views. */
  _aristotle?: {
    decision: "ALLOW" | "REFUSE" | "ESCALATE" | "EXPIRE";
    reason_codes: string[];
    warrant_id?: string;
    canonical_action_hash: string;
    gel_record_id?: string;
  };
}

// ---------------------------------------------------------------------------
// Unwrapped tool: caller-supplied implementation
// ---------------------------------------------------------------------------

export interface UnwrappedMcpTool<Args = Record<string, unknown>, Result = unknown> {
  name: string;
  description: string;
  inputSchema: McpInputSchema;
  /**
   * The actual tool implementation. Called ONLY if the gate ALLOWs the
   * action. Receives the validated args + the substrate's
   * GovernanceContext for the call (warrant_id, action_hash) so the
   * tool's emission can record the binding alongside its own state.
   */
  handler: (args: Args, ctx: GovernanceContext) => Promise<Result> | Result;
  /**
   * Optional: how to format the handler's result as MCP content blocks.
   * Default: stringify the result and wrap in a text content block.
   */
  formatResult?: (result: Result) => McpContent[];
}

/** Context passed to a governed tool handler. */
export interface GovernanceContext {
  warrant_id: string;
  canonical_action_hash: string;
  evaluated_at: string;
  ward_id: string;
  subject: string;
}

// ---------------------------------------------------------------------------
// Governed tool
// ---------------------------------------------------------------------------

export interface GovernedMcpTool {
  name: string;
  description: string;
  inputSchema: McpInputSchema;
  /**
   * The MCP-callable handler. Args come from the MCP client's
   * `tools/call` request; returns an McpCallResult. Internally:
   *   1. Build a CanonicalAction.
   *   2. client.evaluate(action) -> EvaluateResponse.
   *   3. If decision !== ALLOW, return { content: [...refusal text],
   *      isError: true, _aristotle: { ... } }.
   *   4. If ALLOW, invoke the unwrapped handler with args + context.
   *   5. Return the handler's result formatted as content blocks +
   *      _aristotle metadata.
   */
  call(args: Record<string, unknown>): Promise<McpCallResult>;
}

// ---------------------------------------------------------------------------
// Server options + factory
// ---------------------------------------------------------------------------

export interface CreateGovernedMcpServerOptions {
  /** AristotleClient pointed at the gate. */
  client: AristotleClient;
  /** Ward id the tool calls fall under. */
  wardId: string;
  /** Subject identifier for the agent invoking tools (e.g. "agent:claude-desktop"). */
  subject: string;
  /**
   * The tools to wrap. Each gets a governed handler. The MCP server
   * only exposes these — the gate is non-bypassable from the MCP side.
   */
  tools: UnwrappedMcpTool[];
  /**
   * Optional: override the action_type derivation. Default is
   * `mcp.${toolName}`. Useful when the substrate's policy authors want
   * a different namespace.
   */
  actionTypeFor?: (tool: UnwrappedMcpTool) => string;
  /**
   * Optional: override how MCP args become CanonicalAction.params. By
   * default, args are passed through unchanged. Useful when the tool
   * needs telemetry fields synthesized at call time (e.g., timestamp
   * extraction from args, or stripping nullable fields).
   */
  buildParams?: (tool: UnwrappedMcpTool, args: Record<string, unknown>) => Record<string, unknown>;
}

export interface GovernedMcpServer {
  /** All governed tools in the server. */
  readonly tools: GovernedMcpTool[];
  /** MCP `tools/list` response shape. */
  listTools(): { tools: Array<{ name: string; description: string; inputSchema: McpInputSchema }> };
  /** MCP `tools/call` dispatcher. */
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
}

export function createGovernedMcpServer(opts: CreateGovernedMcpServerOptions): GovernedMcpServer {
  const tools: GovernedMcpTool[] = opts.tools.map((tool) => wrapTool(tool, opts));
  const byName = new Map(tools.map((t) => [t.name, t] as const));

  return {
    tools,
    listTools() {
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      };
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
      const tool = byName.get(name);
      if (!tool) {
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true
        };
      }
      return tool.call(args);
    }
  };
}

// ---------------------------------------------------------------------------
// Wrapping
// ---------------------------------------------------------------------------

function wrapTool(
  tool: UnwrappedMcpTool,
  opts: CreateGovernedMcpServerOptions
): GovernedMcpTool {
  const actionType = opts.actionTypeFor ? opts.actionTypeFor(tool) : `mcp.${tool.name}`;
  const buildParams = opts.buildParams ?? ((_t, args) => args);
  const formatResult = tool.formatResult ?? defaultFormatResult;

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async call(args: Record<string, unknown>): Promise<McpCallResult> {
      const action: CanonicalAction = {
        action_id: `mcp-${Date.now().toString(16)}-${tool.name}`,
        ward_id: opts.wardId,
        subject: opts.subject,
        action_type: actionType,
        params: buildParams(tool, args),
        requested_at: new Date().toISOString(),
        telemetry: { agent_runtime: "mcp" }
      };

      let decision;
      try {
        decision = await opts.client.evaluate(action);
      } catch (err) {
        const msg = err instanceof AristotleApiError
          ? `gate HTTP ${err.status}: ${err.message}`
          : err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text",
            text: `AristotleOS gate unreachable: ${msg}. Tool '${tool.name}' not executed (fail-closed).`
          }],
          isError: true,
          _aristotle: {
            decision: "REFUSE",
            reason_codes: ["GATE_UNREACHABLE"],
            canonical_action_hash: "unknown"
          }
        };
      }

      if (decision.decision !== "ALLOW") {
        return {
          content: [{
            type: "text",
            text: `AristotleOS ${decision.decision} for tool '${tool.name}': ${decision.reason_codes.join(", ")}`
          }],
          isError: true,
          _aristotle: {
            decision: decision.decision,
            reason_codes: decision.reason_codes,
            canonical_action_hash: decision.canonical_action_hash,
            gel_record_id: decision.gel_record?.record_id as string | undefined
          }
        };
      }

      const warrant = decision.warrant;
      if (!warrant) {
        return {
          content: [{
            type: "text",
            text: `AristotleOS gate ALLOWed but issued no Warrant for tool '${tool.name}'. This is a substrate invariant violation; refusing.`
          }],
          isError: true,
          _aristotle: {
            decision: "REFUSE",
            reason_codes: ["MISSING_WARRANT"],
            canonical_action_hash: decision.canonical_action_hash
          }
        };
      }

      const ctx: GovernanceContext = {
        warrant_id: warrant.warrant_id,
        canonical_action_hash: decision.canonical_action_hash,
        evaluated_at: new Date().toISOString(),
        ward_id: opts.wardId,
        subject: opts.subject
      };

      try {
        const result = await tool.handler(args, ctx);
        return {
          content: formatResult(result),
          _aristotle: {
            decision: "ALLOW",
            reason_codes: [],
            warrant_id: warrant.warrant_id,
            canonical_action_hash: decision.canonical_action_hash,
            gel_record_id: decision.gel_record?.record_id as string | undefined
          }
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: `Tool '${tool.name}' handler threw after ALLOW: ${err instanceof Error ? err.message : String(err)}`
          }],
          isError: true,
          _aristotle: {
            decision: "ALLOW",
            reason_codes: ["HANDLER_THREW"],
            warrant_id: warrant.warrant_id,
            canonical_action_hash: decision.canonical_action_hash
          }
        };
      }
    }
  };
}

function defaultFormatResult(result: unknown): McpContent[] {
  if (typeof result === "string") return [{ type: "text", text: result }];
  if (result === undefined || result === null) return [{ type: "text", text: "" }];
  try {
    return [{ type: "text", text: JSON.stringify(result, null, 2) }];
  } catch {
    return [{ type: "text", text: String(result) }];
  }
}

// ---------------------------------------------------------------------------
// Re-exports for caller convenience
// ---------------------------------------------------------------------------

export type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
export { AristotleApiError } from "@aristotle/os-sdk";
