/**
 * @aristotle/mastra — govern Mastra tool calls through the AristotleOS
 * execution-control Commit Gate.
 *
 * Mastra tools (from ``@mastra/core``'s ``createTool({...})``) carry an
 * ``execute`` function the agent runtime calls when the LLM picks the
 * tool. This adapter wraps ``execute`` so every invocation routes through
 * the gate first; on ALLOW it forwards to the original implementation, on
 * REFUSE / ESCALATE / gate failure it returns a structured outcome or
 * throws (configurable).
 *
 *   import { createTool } from "@mastra/core/tools";
 *   import { AristotleClient } from "@aristotle/os-sdk";
 *   import { governMastraTool } from "@aristotle/mastra";
 *   import { z } from "zod";
 *
 *   const aos = new AristotleClient({ baseUrl: "http://127.0.0.1:8181" });
 *
 *   const raw = createTool({
 *     id: "send_email", description: "Send an email.",
 *     inputSchema: z.object({ to: z.string(), body: z.string() }),
 *     execute: async ({ context }) => sendEmail(context.to, context.body),
 *   });
 *
 *   const governed = governMastraTool(raw, {
 *     client: aos, wardId: "ward-ops", subject: "agent:1"
 *   });
 */

import { AristotleApiError, AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// Structural Mastra Tool shape (mirrored locally; @mastra/core is a peer).
// ---------------------------------------------------------------------------

export interface MastraToolLike {
  id?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  execute?: (executionContext: MastraExecutionContext) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

/** Mastra passes a context object to ``execute`` containing ``context`` (the
 *  validated tool input) plus framework metadata (mastra, runtimeContext,
 *  threadId, resourceId, etc.). We only need ``context`` for the canonical
 *  action params. */
export interface MastraExecutionContext {
  context: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Outcome / error
// ---------------------------------------------------------------------------

export interface AristotleToolOutcome {
  __aristotle: "REFUSE" | "ESCALATE" | "GATE_UNREACHABLE";
  toolName: string;
  reasonCodes: string[];
  message: string;
  gelRecordId?: string;
  warrantId?: string;
}

export class AristotleGateError extends Error {
  constructor(
    public readonly kind: "REFUSE" | "ESCALATE" | "GATE_UNREACHABLE",
    public readonly toolName: string,
    public readonly reasonCodes: string[],
    public readonly gelRecordId: string | undefined,
    public readonly decision: EvaluateResponse | undefined,
    message: string
  ) {
    super(message);
    this.name = "AristotleGateError";
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface GovernMastraToolOptions {
  client: AristotleClient;
  wardId: string;
  subject: string;
  actionTypePrefix?: string;
  actionTypeFor?: (toolName: string) => string;
  buildAction?: (input: { toolName: string; toolInput: Record<string, unknown>; now: string }) => CanonicalAction;
  passthroughTools?: ReadonlySet<string> | string[];
  /** "return-outcome" (default — return AristotleToolOutcome so the agent sees it) or "throw". */
  onRefuse?: "return-outcome" | "throw";
  onEscalate?: "return-outcome" | "throw";
  /** "throw" (default, fail-closed) or "return-outcome". */
  onError?: "throw" | "return-outcome";
  onDecision?: (info: { toolName: string; toolInput: Record<string, unknown>; action: CanonicalAction; decision: EvaluateResponse | { decision: "ERROR"; reason_codes: string[] }; elapsedMs: number }) => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function asSet(input: ReadonlySet<string> | string[] | undefined): ReadonlySet<string> {
  if (!input) return new Set();
  if (input instanceof Set) return input;
  return new Set(input);
}

function defaultActionType(name: string, prefix: string): string {
  return `${prefix}.${name.toLowerCase()}`;
}

function defaultBuildAction(args: { toolName: string; toolInput: Record<string, unknown>; now: string; wardId: string; subject: string; actionType: string }): CanonicalAction {
  return {
    action_id: `mastra-${args.toolName}-${Date.now().toString(16)}`,
    ward_id: args.wardId,
    subject: args.subject,
    action_type: args.actionType,
    params: args.toolInput,
    requested_at: args.now,
    telemetry: { agent_runtime: "mastra" }
  };
}

/**
 * Wrap a Mastra tool with Aristotle governance. Returns a new tool object
 * with the same fields but ``execute`` replaced. The original is unchanged.
 *
 * Tools without an ``execute`` (e.g. external / provider-defined) are
 * returned unchanged.
 */
export function governMastraTool<T extends MastraToolLike>(tool: T, options: GovernMastraToolOptions): T {
  if (!options.client) throw new Error("governMastraTool requires options.client");
  if (!options.wardId) throw new Error("governMastraTool requires options.wardId");
  if (!options.subject) throw new Error("governMastraTool requires options.subject");

  if (!tool.execute) return tool;

  const toolName = tool.id ?? "tool";
  const passthrough = asSet(options.passthroughTools);
  if (passthrough.has(toolName)) return tool;

  const prefix = options.actionTypePrefix ?? "tool";
  const onRefuse = options.onRefuse ?? "return-outcome";
  const onEscalate = options.onEscalate ?? "return-outcome";
  const onError = options.onError ?? "throw";
  const innerExecute = tool.execute;

  const governedExecute = async (executionContext: MastraExecutionContext): Promise<unknown> => {
    const toolInput = (executionContext.context ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    const actionType = options.actionTypeFor ? options.actionTypeFor(toolName) : defaultActionType(toolName, prefix);
    const action = options.buildAction
      ? options.buildAction({ toolName, toolInput, now })
      : defaultBuildAction({ toolName, toolInput, now, wardId: options.wardId, subject: options.subject, actionType });

    const t0 = Date.now();
    let decision: EvaluateResponse;
    try {
      decision = await options.client.evaluate(action, { now });
    } catch (err) {
      const elapsedMs = Date.now() - t0;
      const message =
        err instanceof AristotleApiError
          ? `aristotle: gate error HTTP ${err.status}: ${err.message}`
          : `aristotle: gate unreachable: ${err instanceof Error ? err.message : String(err)}`;
      options.onDecision?.({ toolName, toolInput, action, decision: { decision: "ERROR", reason_codes: [message] }, elapsedMs });
      if (onError === "throw") {
        throw new AristotleGateError("GATE_UNREACHABLE", toolName, [message], undefined, undefined, message);
      }
      return { __aristotle: "GATE_UNREACHABLE", toolName, reasonCodes: [message], message } satisfies AristotleToolOutcome;
    }

    const elapsedMs = Date.now() - t0;
    options.onDecision?.({ toolName, toolInput, action, decision, elapsedMs });

    if (decision.decision === "ALLOW") {
      return await innerExecute(executionContext);
    }

    const reasonCodes = decision.reason_codes;
    const gelRecordId = decision.gel_record?.record_id;
    const warrantId = decision.warrant?.warrant_id;

    if (decision.decision === "ESCALATE") {
      const message = `aristotle: ESCALATE on ${toolName} - ${reasonCodes.join(", ") || "no reason codes"} - record ${gelRecordId ?? "(none)"}`;
      if (onEscalate === "throw") {
        throw new AristotleGateError("ESCALATE", toolName, reasonCodes, gelRecordId, decision, message);
      }
      return { __aristotle: "ESCALATE", toolName, reasonCodes, message, gelRecordId, warrantId } satisfies AristotleToolOutcome;
    }

    const message = `aristotle: REFUSE on ${toolName} - ${reasonCodes.join(", ") || "no reason codes"} - record ${gelRecordId ?? "(none)"}`;
    if (onRefuse === "throw") {
      throw new AristotleGateError("REFUSE", toolName, reasonCodes, gelRecordId, decision, message);
    }
    return { __aristotle: "REFUSE", toolName, reasonCodes, message, gelRecordId, warrantId } satisfies AristotleToolOutcome;
  };

  return { ...tool, execute: governedExecute };
}

/**
 * Wrap an entire tools record (keyed by tool id) with one option set.
 */
export function governMastraTools<R extends Record<string, MastraToolLike>>(tools: R, options: GovernMastraToolOptions): R {
  const out: Record<string, MastraToolLike> = {};
  for (const [key, tool] of Object.entries(tools)) {
    out[key] = governMastraTool(tool, options);
  }
  return out as R;
}

export { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
