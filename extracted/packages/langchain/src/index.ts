/**
 * @aristotle/langchain — govern every LangChain.js tool invocation through
 * the AristotleOS execution-control Commit Gate before it runs.
 *
 * `governTool(tool, options)` returns a tool with the same shape as the
 * input (name, description, schema, invoke) but whose `invoke()` first
 * evaluates the action at the gate. ALLOW runs the underlying tool's
 * invoke; REFUSE throws an `AristotleApiError`-shaped error containing
 * the gate's reason_codes; ESCALATE throws a `ToolEscalationError`
 * carrying the GEL record id so the host can route to dual-control.
 *
 *   import { tool } from "langchain";
 *   import { AristotleClient } from "@aristotle/os-sdk";
 *   import { governTools } from "@aristotle/langchain";
 *   import * as z from "zod";
 *
 *   const search = tool(({ query }) => `result for ${query}`, {
 *     name: "search_database",
 *     description: "Search the customer database",
 *     schema: z.object({ query: z.string() })
 *   });
 *
 *   const aos = new AristotleClient({ baseUrl, token });
 *   const guarded = governTools([search], { client: aos, wardId: "ward-agents", subject: "agent:assistant-1" });
 *
 *   // Now drop `guarded` into your AgentExecutor / createToolCallingAgent / etc.
 */

import { AristotleApiError, AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// Minimal LangChain tool shape (defined locally; @langchain/core is a peer)
// ---------------------------------------------------------------------------

/**
 * Minimal structural type for any LangChain.js tool — `StructuredTool`,
 * `DynamicTool`, the value returned by `tool()`, or any object that exposes
 * `name`, `description`, and a callable `invoke(input, config?)`.
 *
 * We deliberately don't depend on `@langchain/core` at compile time so this
 * package compiles even when the peer isn't installed; the consumer brings
 * their own LangChain.
 */
export interface LangChainToolLike {
  name: string;
  description: string;
  schema?: unknown;
  invoke(input: unknown, config?: unknown): Promise<unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the gate ESCALATES a tool call. The host (or the agent) is
 * expected to route the escalation to the dual-control approvals queue
 * (`AristotleClient.decideApproval`) or surface it to a human.
 */
export class ToolEscalationError extends Error {
  constructor(
    message: string,
    readonly toolName: string,
    readonly action: CanonicalAction,
    readonly reasonCodes: string[],
    readonly gelRecordId: string | undefined,
    readonly decision: EvaluateResponse
  ) {
    super(message);
    this.name = "ToolEscalationError";
  }
}

/** Thrown when the gate REFUSES a tool call. */
export class ToolGovernanceError extends Error {
  constructor(
    message: string,
    readonly toolName: string,
    readonly action: CanonicalAction,
    readonly reasonCodes: string[],
    readonly gelRecordId: string | undefined,
    readonly decision: EvaluateResponse
  ) {
    super(message);
    this.name = "ToolGovernanceError";
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface GovernToolOptions {
  /** An AristotleClient already constructed and pointed at the gate. */
  client: AristotleClient;
  /** Ward the tool calls fall under. */
  wardId: string;
  /** Subject identifier for the agent (e.g. "agent:assistant-1"). */
  subject: string;

  /**
   * Prefix prepended to the lowercased tool name to form the `action_type`.
   * Default: `"tool"` → `tool.search_database`, `tool.send_email`.
   */
  actionTypePrefix?: string;

  /**
   * Map a LangChain tool name to a fully-qualified action_type. Overrides
   * `actionTypePrefix`. Useful for routing tools into a vertical
   * (e.g. `transfer_title` → `title.transfer`).
   */
  actionTypeFor?: (toolName: string) => string;

  /**
   * Fully build the CanonicalAction from the tool call. Overrides the
   * default mapping entirely.
   */
  buildAction?: (input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    now: string;
    invocationId: string;
  }) => CanonicalAction;

  /** Tools (by name) to never gate. Default: `[]`. */
  passthroughTools?: ReadonlySet<string> | string[];

  /**
   * Behavior when ESCALATE is returned by the gate. Default: `"throw"`
   * (a `ToolEscalationError` is thrown so the AgentExecutor surfaces it
   * to the host). `"return"` returns a marker string so the agent itself
   * sees a structured response describing the escalation.
   */
  onEscalate?: "throw" | "return";

  /**
   * Behavior when the gate is unreachable. Default: `"deny"` (matches the
   * Commit Gate's own fail-closed posture). `"throw"` lets the consumer
   * decide; `"escalate"` raises `ToolEscalationError` so the host's
   * approval workflow can pick it up.
   */
  onError?: "deny" | "throw" | "escalate";

  /**
   * Telemetry callback fired after every gate call (including errors).
   */
  onDecision?: (info: {
    toolName: string;
    toolInput: Record<string, unknown>;
    action: CanonicalAction;
    decision: EvaluateResponse | { decision: "ERROR"; reason_codes: string[] };
    elapsedMs: number;
  }) => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function asSet(input: ReadonlySet<string> | string[] | undefined): ReadonlySet<string> {
  if (!input) return new Set();
  if (input instanceof Set) return input;
  return new Set(input);
}

function defaultActionType(toolName: string, prefix: string): string {
  return `${prefix}.${toolName.toLowerCase()}`;
}

function defaultBuildAction(args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  now: string;
  invocationId: string;
  wardId: string;
  subject: string;
  actionType: string;
}): CanonicalAction {
  return {
    action_id: args.invocationId,
    ward_id: args.wardId,
    subject: args.subject,
    action_type: args.actionType,
    params: args.toolInput,
    requested_at: args.now,
    telemetry: { agent_runtime: "langchain-js" }
  };
}

function newInvocationId(): string {
  return `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeInput(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) return {};
  if (typeof input === "string") return { input };
  if (typeof input === "object") return input as Record<string, unknown>;
  return { input };
}

/**
 * Wrap a LangChain tool with an AristotleOS governance check. Returns a new
 * tool with the same shape; the original is not mutated.
 *
 * @example
 *   const guarded = governTool(myTool, { client: aos, wardId: "w", subject: "agent:x" });
 *   agent.bindTools([guarded]);
 */
export function governTool<T extends LangChainToolLike>(
  tool: T,
  options: GovernToolOptions
): T {
  if (!options.client) throw new Error("governTool requires options.client");
  if (!options.wardId) throw new Error("governTool requires options.wardId");
  if (!options.subject) throw new Error("governTool requires options.subject");

  const prefix = options.actionTypePrefix ?? "tool";
  const passthrough = asSet(options.passthroughTools);
  const onEscalate = options.onEscalate ?? "throw";
  const onError = options.onError ?? "deny";
  const originalInvoke = tool.invoke.bind(tool);

  const governedInvoke = async (input: unknown, config?: unknown): Promise<unknown> => {
    if (passthrough.has(tool.name)) {
      return originalInvoke(input, config);
    }

    const toolInput = normalizeInput(input);
    const now = new Date().toISOString();
    const invocationId = newInvocationId();
    const actionType = options.actionTypeFor ? options.actionTypeFor(tool.name) : defaultActionType(tool.name, prefix);
    const action = options.buildAction
      ? options.buildAction({ toolName: tool.name, toolInput, now, invocationId })
      : defaultBuildAction({ toolName: tool.name, toolInput, now, invocationId, wardId: options.wardId, subject: options.subject, actionType });

    const t0 = Date.now();
    let decision: EvaluateResponse;
    try {
      decision = await options.client.evaluate(action, { now });
    } catch (err) {
      const elapsedMs = Date.now() - t0;
      const reason = err instanceof AristotleApiError
        ? `aristotle: gate error HTTP ${err.status}: ${err.message}`
        : `aristotle: gate unreachable: ${err instanceof Error ? err.message : String(err)}`;
      options.onDecision?.({
        toolName: tool.name,
        toolInput,
        action,
        decision: { decision: "ERROR", reason_codes: [reason] },
        elapsedMs
      });
      if (onError === "throw") throw err;
      if (onError === "escalate") {
        throw new ToolEscalationError(reason, tool.name, action, [reason], undefined, { decision: "ESCALATE", reason_codes: [reason], canonical_action_hash: "", gel_record: { record_id: "", record_hash: "" } } as EvaluateResponse);
      }
      // fail-closed deny
      throw new ToolGovernanceError(reason, tool.name, action, [reason], undefined, { decision: "REFUSE", reason_codes: [reason], canonical_action_hash: "", gel_record: { record_id: "", record_hash: "" } } as EvaluateResponse);
    }
    const elapsedMs = Date.now() - t0;
    options.onDecision?.({ toolName: tool.name, toolInput, action, decision, elapsedMs });

    if (decision.decision === "ALLOW") {
      return originalInvoke(input, config);
    }
    if (decision.decision === "ESCALATE") {
      const msg = `aristotle: ESCALATE on ${tool.name} · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}`;
      if (onEscalate === "return") {
        return msg;
      }
      throw new ToolEscalationError(msg, tool.name, action, decision.reason_codes, decision.gel_record?.record_id as string | undefined, decision);
    }
    // REFUSE
    const refuseMsg = `aristotle: REFUSE on ${tool.name} · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}`;
    throw new ToolGovernanceError(refuseMsg, tool.name, action, decision.reason_codes, decision.gel_record?.record_id as string | undefined, decision);
  };

  // Return a new object with the same shape, but a wrapped invoke. Preserve
  // every other property (name, description, schema, returnType, etc.) so the
  // tool looks identical to LangChain.
  const wrapped: T = { ...tool, invoke: governedInvoke } as T;
  return wrapped;
}

/** Apply `governTool` to a list of tools. */
export function governTools<T extends LangChainToolLike>(
  tools: readonly T[],
  options: GovernToolOptions
): T[] {
  return tools.map((t) => governTool(t, options));
}

// Re-export the AristotleClient + key SDK types so a consumer can install
// only this package and get everything they need.
export { AristotleApiError, AristotleClient } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
