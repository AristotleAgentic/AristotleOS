/**
 * @aristotle/sdk-anthropic
 *
 * First-party Anthropic Claude SDK tool-wrapping adapter for AristotleOS.
 *
 * Distinct from `@aristotle/claude-agents` (which targets the higher-level
 * `@anthropic-ai/claude-agent-sdk` Agent SDK + its `PreToolUse` hooks).
 * THIS package targets callers using the lower-level `@anthropic-ai/sdk`
 * Messages API directly with `tool_use` content blocks — the common
 * pattern when the host is orchestrating the assistant loop itself.
 *
 * What ships:
 *
 *   - `governAnthropicTool(tool, opts)` — same shape in, same shape
 *     out. The returned tool definition is what you pass into
 *     `anthropic.messages.create({ tools })`. The wrapper doesn't
 *     intercept the model's tool_use selection — Anthropic's SDK
 *     doesn't expose a hook there. Instead, you wire the host-side
 *     handler through `GovernedAnthropicHandler.executeTool(name, input)`
 *     and that path is gated.
 *
 *   - `governAnthropicTools(toolsRecord, opts)` — batch variant for
 *     `Record<string, AnthropicTool>` (the typical layout when callers
 *     keep tools in a map keyed by name).
 *
 *   - `GovernedAnthropicHandler` — the wrapper for the host's
 *     tool_use dispatch loop. `executeTool(name, input)` builds the
 *     CanonicalAction, calls `client.evaluate`, and only invokes the
 *     caller's handler on ALLOW + warrant. Refusals format as
 *     `tool_result` content the Messages API can pass back to the
 *     model.
 *
 * The shape of `AnthropicTool` mirrors what the SDK accepts in
 * `Anthropic.Messages.Tool`: `{ name, description, input_schema }`.
 * We declare it locally so this package compiles without the peer dep.
 *
 *   import Anthropic from "@anthropic-ai/sdk";
 *   import { AristotleClient } from "@aristotle/os-sdk";
 *   import { GovernedAnthropicHandler, governAnthropicTools } from "@aristotle/sdk-anthropic";
 *
 *   const anthropic = new Anthropic({ apiKey });
 *   const aos = new AristotleClient({ baseUrl, token });
 *
 *   const tools = governAnthropicTools({
 *     search_database: {
 *       name: "search_database",
 *       description: "Search the customer database",
 *       input_schema: {
 *         type: "object",
 *         properties: { query: { type: "string" } },
 *         required: ["query"]
 *       }
 *     }
 *   }, { client: aos, wardId: "ward-agent-ops", subject: "agent:assistant" });
 *
 *   const handler = new GovernedAnthropicHandler({
 *     client: aos, wardId: "ward-agent-ops", subject: "agent:assistant",
 *     handlers: {
 *       search_database: async ({ query }) => `results for ${query}`
 *     }
 *   });
 *
 *   // ... message loop:
 *   const response = await anthropic.messages.create({
 *     model: "claude-opus-4-5", max_tokens: 1024,
 *     tools: Object.values(tools),
 *     messages
 *   });
 *
 *   for (const block of response.content) {
 *     if (block.type === "tool_use") {
 *       const result = await handler.executeTool(block.name, block.input as Record<string, unknown>);
 *       // result.tool_use_id, result.content, result.isError — wire into the next message
 *       messages.push({
 *         role: "user",
 *         content: [{ type: "tool_result", tool_use_id: block.id, content: result.content, is_error: result.isError }]
 *       });
 *     }
 *   }
 */

import { AristotleApiError, type AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// Public types — mirror @anthropic-ai/sdk's `Anthropic.Messages.Tool` shape
// ---------------------------------------------------------------------------

export interface AnthropicToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/** The tool definition the Anthropic Messages API accepts in `tools`. */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: AnthropicToolInputSchema;
  /** Anthropic's SDK also accepts `cache_control` and friends; we pass
   *  through any extra fields unchanged. */
  [key: string]: unknown;
}

/**
 * Same as `AnthropicTool` but augmented with an `execute` handler. Used
 * when callers want to keep the handler co-located with the tool
 * definition (the Vercel AI SDK / OpenAI Agents SDK pattern). The
 * `executeTool` dispatcher on `GovernedAnthropicHandler` picks these up
 * automatically.
 */
export interface GovernedAnthropicTool extends AnthropicTool {
  execute: AnthropicToolHandler;
}

/** The host's handler for one tool. Receives the model-supplied input. */
export type AnthropicToolHandler = (
  input: Record<string, unknown>,
  ctx: GovernanceContext
) => Promise<unknown> | unknown;

/** Context passed to a governed handler when it's invoked. */
export interface GovernanceContext {
  warrant_id: string;
  canonical_action_hash: string;
  evaluated_at: string;
  ward_id: string;
  subject: string;
}

/** Result of `GovernedAnthropicHandler.executeTool`. Shape matches the
 *  `tool_result` content block the Anthropic Messages API accepts. */
export interface ExecuteToolResult {
  /** Echoed from the caller-supplied tool_use_id, if provided. */
  tool_use_id?: string;
  /** Stringified tool output (or refusal message on refuse / error). */
  content: string;
  /** True when the result is a refusal / error / handler exception. */
  isError: boolean;
  /** Substrate-side metadata. */
  _aristotle: {
    decision: "ALLOW" | "REFUSE" | "ESCALATE" | "EXPIRE";
    reason_codes: string[];
    warrant_id?: string;
    canonical_action_hash: string;
    gel_record_id?: string;
  };
}

// ---------------------------------------------------------------------------
// Wrap-options
// ---------------------------------------------------------------------------

export interface GovernAnthropicToolOptions {
  /** AristotleClient pointed at the gate. */
  client: AristotleClient;
  /** Ward the tool calls fall under. */
  wardId: string;
  /** Subject identifier for the agent (e.g. "agent:assistant"). */
  subject: string;
  /**
   * Prefix prepended to the tool name to form the `action_type`.
   * Default: `"anthropic"` -> `anthropic.search_database`.
   */
  actionTypePrefix?: string;
  /**
   * Override the action_type per-tool. If provided, takes precedence
   * over `actionTypePrefix`.
   */
  actionTypeFor?: (toolName: string) => string;
  /**
   * Build params on the CanonicalAction from the model's input. Default
   * pass-through.
   */
  buildParams?: (toolName: string, input: Record<string, unknown>) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool-definition wrappers (preserve shape)
// ---------------------------------------------------------------------------

/**
 * Wrap one Anthropic tool definition. Returns the same shape (so it can
 * be passed directly to `anthropic.messages.create({ tools })`).
 *
 * NOTE: the Anthropic Messages API does not invoke handlers itself — it
 * returns `tool_use` blocks for the host to dispatch. Wrapping the tool
 * definition does NOT install governance on its own. Pair it with
 * `GovernedAnthropicHandler.executeTool(name, input)` for the actual
 * gate enforcement.
 */
export function governAnthropicTool<T extends AnthropicTool>(
  tool: T,
  _opts: GovernAnthropicToolOptions
): T {
  if (!tool || typeof tool !== "object") {
    throw new Error("governAnthropicTool: tool must be an object");
  }
  if (typeof tool.name !== "string" || tool.name.length === 0) {
    throw new Error("governAnthropicTool: tool.name is required");
  }
  // Return a fresh object with the same shape so callers can compare
  // references without aliasing surprises.
  return { ...tool };
}

/**
 * Wrap every entry in a `Record<string, AnthropicTool>` (a common layout
 * in caller code so a single name lookup serves both message-creation
 * and dispatch).
 */
export function governAnthropicTools<R extends Record<string, AnthropicTool>>(
  tools: R,
  opts: GovernAnthropicToolOptions
): R {
  const out: Record<string, AnthropicTool> = {};
  for (const [k, v] of Object.entries(tools)) {
    out[k] = governAnthropicTool(v, opts);
  }
  return out as R;
}

// ---------------------------------------------------------------------------
// GovernedAnthropicHandler — the host-side dispatcher with gate enforcement
// ---------------------------------------------------------------------------

export interface GovernedAnthropicHandlerOptions extends GovernAnthropicToolOptions {
  /**
   * Per-tool handler map. The model emits a tool_use block with a name;
   * `executeTool(name, input)` looks the handler up here.
   */
  handlers: Record<string, AnthropicToolHandler>;
  /**
   * Optional decision-telemetry callback. Fires AFTER the gate returns
   * (success or fail-closed), BEFORE the handler runs.
   */
  onDecision?: (info: {
    toolName: string;
    input: Record<string, unknown>;
    action: CanonicalAction;
    decision: EvaluateResponse | { decision: "ERROR"; reason_codes: string[] };
    elapsedMs: number;
  }) => void;
}

export class GovernedAnthropicHandler {
  private readonly opts: GovernedAnthropicHandlerOptions;
  private readonly prefix: string;

  constructor(opts: GovernedAnthropicHandlerOptions) {
    if (!opts.client) throw new Error("GovernedAnthropicHandler requires opts.client");
    if (!opts.wardId) throw new Error("GovernedAnthropicHandler requires opts.wardId");
    if (!opts.subject) throw new Error("GovernedAnthropicHandler requires opts.subject");
    if (!opts.handlers || typeof opts.handlers !== "object") {
      throw new Error("GovernedAnthropicHandler requires opts.handlers");
    }
    this.opts = opts;
    this.prefix = opts.actionTypePrefix ?? "anthropic";
  }

  /**
   * Dispatch a `tool_use` block emitted by the Anthropic Messages API.
   * Returns a structured `tool_result`-shaped object the host can wire
   * back into the next message in the conversation.
   *
   * Pipeline (mirrors the cross-adapter fail-closed contract):
   *   1. Build CanonicalAction.
   *   2. client.evaluate(action). On throw -> GATE_UNREACHABLE (isError).
   *   3. decision !== ALLOW -> GATE_REFUSED (isError), handler NOT invoked.
   *   4. ALLOW but no warrant -> MISSING_WARRANT (isError), handler NOT invoked.
   *   5. Handler runs. Throws -> HANDLER_THREW (isError).
   *   6. Success -> stringified content + ALLOW metadata.
   */
  async executeTool(
    name: string,
    input: Record<string, unknown>,
    options?: { toolUseId?: string }
  ): Promise<ExecuteToolResult> {
    const handler = this.opts.handlers[name];
    const tool_use_id = options?.toolUseId;

    if (!handler) {
      return {
        tool_use_id,
        content: `Unknown tool: ${name}`,
        isError: true,
        _aristotle: {
          decision: "REFUSE",
          reason_codes: ["UNKNOWN_TOOL"],
          canonical_action_hash: "unknown"
        }
      };
    }

    const actionType = this.opts.actionTypeFor
      ? this.opts.actionTypeFor(name)
      : `${this.prefix}.${name}`;
    const params = this.opts.buildParams
      ? this.opts.buildParams(name, input)
      : input;
    const action: CanonicalAction = {
      action_id: `ant-${Date.now().toString(16)}-${name}`,
      ward_id: this.opts.wardId,
      subject: this.opts.subject,
      action_type: actionType,
      params,
      requested_at: new Date().toISOString(),
      telemetry: { agent_runtime: "anthropic-sdk" }
    };

    const t0 = Date.now();
    let decision: EvaluateResponse;
    try {
      decision = await this.opts.client.evaluate(action);
    } catch (err) {
      const elapsedMs = Date.now() - t0;
      const reason = err instanceof AristotleApiError
        ? `gate HTTP ${err.status}: ${err.message}`
        : err instanceof Error ? err.message : String(err);
      this.opts.onDecision?.({
        toolName: name, input, action,
        decision: { decision: "ERROR", reason_codes: ["GATE_UNREACHABLE", reason] },
        elapsedMs
      });
      return {
        tool_use_id,
        content: `AristotleOS gate unreachable: ${reason}. Tool '${name}' not executed (fail-closed).`,
        isError: true,
        _aristotle: {
          decision: "REFUSE",
          reason_codes: ["GATE_UNREACHABLE"],
          canonical_action_hash: "unknown"
        }
      };
    }
    const elapsedMs = Date.now() - t0;
    this.opts.onDecision?.({ toolName: name, input, action, decision, elapsedMs });

    if (decision.decision !== "ALLOW") {
      return {
        tool_use_id,
        content: `AristotleOS ${decision.decision} for tool '${name}': ${decision.reason_codes.join(", ") || "no reason codes"}`,
        isError: true,
        _aristotle: {
          decision: decision.decision,
          reason_codes: ["GATE_REFUSED", ...decision.reason_codes],
          canonical_action_hash: decision.canonical_action_hash,
          gel_record_id: decision.gel_record?.record_id as string | undefined
        }
      };
    }

    const warrant = decision.warrant;
    if (!warrant) {
      return {
        tool_use_id,
        content: `AristotleOS gate ALLOWed but issued no Warrant for tool '${name}'. This is a substrate invariant violation; refusing.`,
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
      ward_id: this.opts.wardId,
      subject: this.opts.subject
    };

    let raw: unknown;
    try {
      raw = await handler(input, ctx);
    } catch (err) {
      return {
        tool_use_id,
        content: `Tool '${name}' handler threw after ALLOW: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
        _aristotle: {
          decision: "ALLOW",
          reason_codes: ["HANDLER_THREW"],
          warrant_id: warrant.warrant_id,
          canonical_action_hash: decision.canonical_action_hash
        }
      };
    }

    return {
      tool_use_id,
      content: formatResult(raw),
      isError: false,
      _aristotle: {
        decision: "ALLOW",
        reason_codes: [],
        warrant_id: warrant.warrant_id,
        canonical_action_hash: decision.canonical_action_hash,
        gel_record_id: decision.gel_record?.record_id as string | undefined
      }
    };
  }

  /** Convenience: dispatch directly from a `tool_use` content block. */
  async executeToolUseBlock(block: {
    type: "tool_use";
    id?: string;
    name: string;
    input: Record<string, unknown>;
  }): Promise<ExecuteToolResult> {
    return this.executeTool(block.name, block.input, { toolUseId: block.id });
  }
}

function formatResult(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "";
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
export { AristotleApiError } from "@aristotle/os-sdk";
