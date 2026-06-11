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
 *
 * Internally this wrapper now sits on `@aristotle/adapter-sdk`'s
 * `governThroughHandler` — the third substrate orchestrator pattern
 * (after governThroughAdapter for transport-shaped adapters and
 * governThroughResponse for response-shaped ones). The SDK gives us the
 * fail-closed evaluate -> ALLOW -> warrant-present pipeline for free;
 * this file adds the LangChain-specific shape on top: throw the
 * framework-typed errors, fire onDecision telemetry, honor passthrough
 * tools, and decide whether gate-unreachable should deny/escalate/raw-throw.
 */

import { AristotleApiError, AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";
import { governThroughHandler, type GovernedHandlerResult, type HandlerContext } from "@aristotle/adapter-sdk";

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
// Internal helpers
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
 * Stand-in EvaluateResponse used when the gate itself was unreachable or
 * HTTP-errored; preserves the existing ToolGovernanceError / ToolEscalationError
 * constructor shape so consumers' switch-on-decision code is unaffected.
 */
function syntheticDecision(kind: "REFUSE" | "ESCALATE", reason: string): EvaluateResponse {
  return {
    decision: kind,
    reason_codes: [reason],
    canonical_action_hash: "",
    gel_record: { record_id: "", record_hash: "" }
  } as EvaluateResponse;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Wrap a LangChain tool with an AristotleOS governance check. Returns a new
 * tool with the same shape; the original is not mutated.
 *
 * Routes the gate evaluation + warrant-present guard through
 * `governThroughHandler` (Pattern 3 in @aristotle/adapter-sdk); the
 * LangChain-specific behavior — onEscalate / onError / passthroughTools /
 * onDecision telemetry — is the layer this file owns.
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

  // Shape of what the SDK orchestrator sees as "input" — we precompute the
  // toolInput / action so we can hand the orchestrator buildAction(input)
  // and inside the handler we still have the original (input, config)
  // closures available for the underlying tool's invoke contract.
  interface SdkInput {
    rawInput: unknown;
    config: unknown;
    toolInput: Record<string, unknown>;
    action: CanonicalAction;
  }

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
      : defaultBuildAction({
          toolName: tool.name,
          toolInput,
          now,
          invocationId,
          wardId: options.wardId,
          subject: options.subject,
          actionType
        });

    const sdkInput: SdkInput = { rawInput: input, config, toolInput, action };
    const t0 = Date.now();

    let result: GovernedHandlerResult<unknown>;
    try {
      result = await governThroughHandler<SdkInput, unknown>(sdkInput, {
        // SDK calls evaluate() with whatever the client returns. We pre-built
        // the action so the SDK's buildAction is a noop projector.
        client: options.client,
        buildAction: (i) => i.action,
        handler: (i, _ctx: HandlerContext) => originalInvoke(i.rawInput, i.config)
      });
    } catch (err) {
      // governThroughHandler itself never throws (it catches evaluate's
      // throws and the handler's throws). A throw here would be a defect
      // in the SDK — surface it with the same fail-closed semantics as
      // a network error so the agent doesn't crash uncontrollably.
      const elapsedMs = Date.now() - t0;
      const reason = `aristotle: governThroughHandler defect: ${err instanceof Error ? err.message : String(err)}`;
      options.onDecision?.({
        toolName: tool.name,
        toolInput,
        action,
        decision: { decision: "ERROR", reason_codes: [reason] },
        elapsedMs
      });
      throw new ToolGovernanceError(reason, tool.name, action, [reason], undefined, syntheticDecision("REFUSE", reason));
    }

    const elapsedMs = Date.now() - t0;

    // ALLOW path: warrant present + handler ran successfully.
    if (result.ok) {
      options.onDecision?.({ toolName: tool.name, toolInput, action, decision: result.decision, elapsedMs });
      return result.output;
    }

    // Non-ALLOW path: refusal codes from governThroughHandler.
    const refusalCode = result.refusal.code;
    const refusalDetail = result.refusal.detail;
    const decision = result.decision;

    // Gate-unreachable family: GATE_UNREACHABLE + any GATE_HTTP_<n>.
    if (refusalCode === "GATE_UNREACHABLE" || refusalCode.startsWith("GATE_HTTP_")) {
      const reason = refusalCode === "GATE_UNREACHABLE"
        ? `aristotle: gate unreachable: ${refusalDetail}`
        : `aristotle: gate error ${refusalCode.replace(/^GATE_HTTP_/, "HTTP ")}: ${refusalDetail}`;
      options.onDecision?.({
        toolName: tool.name,
        toolInput,
        action,
        decision: { decision: "ERROR", reason_codes: [reason] },
        elapsedMs
      });
      if (onError === "throw") {
        // Reconstruct the original error: HTTP_<n> -> AristotleApiError, else a plain Error.
        if (refusalCode.startsWith("GATE_HTTP_")) {
          const status = Number(refusalCode.replace(/^GATE_HTTP_/, ""));
          throw new AristotleApiError(status, refusalDetail);
        }
        throw new Error(refusalDetail);
      }
      if (onError === "escalate") {
        throw new ToolEscalationError(reason, tool.name, action, [reason], undefined, syntheticDecision("ESCALATE", reason));
      }
      // onError === "deny" (default, fail-closed)
      throw new ToolGovernanceError(reason, tool.name, action, [reason], undefined, syntheticDecision("REFUSE", reason));
    }

    // Defensive guards from the SDK — these correspond to fail-closed
    // outcomes (gate returned no warrant on ALLOW; handler threw after
    // ALLOW). MISSING_WARRANT we treat as a refusal (the gate did not
    // produce the binding artifact our integration requires).
    if (refusalCode === "MISSING_WARRANT") {
      const reason = `aristotle: ${refusalDetail}`;
      const synthetic = decision ?? syntheticDecision("REFUSE", reason);
      options.onDecision?.({ toolName: tool.name, toolInput, action, decision: synthetic, elapsedMs });
      throw new ToolGovernanceError(reason, tool.name, action, [reason], undefined, synthetic);
    }

    // TRANSPORT_REFUSED only happens here when the underlying tool's invoke
    // threw after a successful ALLOW. The pre-SDK implementation surfaced
    // that throw to the caller raw (it was outside the gate's purview);
    // preserve that exact behavior so consumers can still try/catch the
    // tool's own error type.
    if (refusalCode === "TRANSPORT_REFUSED") {
      options.onDecision?.({
        toolName: tool.name,
        toolInput,
        action,
        decision: decision ?? syntheticDecision("REFUSE", refusalDetail),
        elapsedMs
      });
      // Re-raise as a plain Error preserving the underlying message.
      // The detail begins with "handler threw: " — strip that prefix so
      // callers see the original error text they would have caught
      // before this wrapper existed.
      throw new Error(refusalDetail.replace(/^handler threw: /, ""));
    }

    // GATE_REFUSED: decision is present and is one of REFUSE / ESCALATE /
    // EXPIRE (anything that wasn't ALLOW). Branch on decision.decision.
    if (refusalCode === "GATE_REFUSED" && decision) {
      options.onDecision?.({ toolName: tool.name, toolInput, action, decision, elapsedMs });
      if (decision.decision === "ESCALATE") {
        const msg = `aristotle: ESCALATE on ${tool.name} · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}`;
        if (onEscalate === "return") {
          return msg;
        }
        throw new ToolEscalationError(
          msg,
          tool.name,
          action,
          decision.reason_codes,
          decision.gel_record?.record_id as string | undefined,
          decision
        );
      }
      // REFUSE or EXPIRE — both surface as ToolGovernanceError.
      const refuseMsg = `aristotle: ${decision.decision} on ${tool.name} · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}`;
      // Preserve the pre-SDK message exactly for the REFUSE case so callers
      // matching against "REFUSE on" continue to match.
      const message = decision.decision === "REFUSE" ? `aristotle: REFUSE on ${tool.name} · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}` : refuseMsg;
      throw new ToolGovernanceError(
        message,
        tool.name,
        action,
        decision.reason_codes,
        decision.gel_record?.record_id as string | undefined,
        decision
      );
    }

    // DEMONSTRATION_ONLY_BLOCKED would only appear if a future SDK path
    // produced it through this orchestrator; treat as a refusal for
    // forward-compatibility.
    const fallbackReason = `aristotle: ${refusalCode}: ${refusalDetail}`;
    const fallbackDecision = decision ?? syntheticDecision("REFUSE", fallbackReason);
    options.onDecision?.({ toolName: tool.name, toolInput, action, decision: fallbackDecision, elapsedMs });
    throw new ToolGovernanceError(fallbackReason, tool.name, action, [fallbackReason], undefined, fallbackDecision);
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
