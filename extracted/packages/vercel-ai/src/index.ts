/**
 * @aristotle/vercel-ai — govern every Vercel AI SDK tool call through the
 * AristotleOS execution-control Commit Gate before it runs.
 *
 * Wraps a tool's `execute` so every invocation by the agent is admitted only
 * on ALLOW + warrant. REFUSE / ESCALATE either return a structured result the
 * LLM can incorporate (default) or throw so the SDK emits a `tool-error` part.
 *
 *   import { generateText, tool } from "ai";
 *   import { z } from "zod";
 *   import { AristotleClient } from "@aristotle/os-sdk";
 *   import { governTools } from "@aristotle/vercel-ai";
 *
 *   const aos = new AristotleClient({ baseUrl: "http://127.0.0.1:8181" });
 *
 *   const tools = governTools({
 *     send_email: tool({
 *       description: "Send an email.",
 *       inputSchema: z.object({ to: z.string(), body: z.string() }),
 *       execute: async ({ to, body }) => `sent to ${to}`
 *     }),
 *     // ... more tools
 *   }, { client: aos, wardId: "ward-agent-ops", subject: "agent:assistant-1" });
 *
 *   const result = await generateText({ model, prompt, tools });
 */

import { AristotleApiError, AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// Vercel AI SDK structural types (mirrored locally; `ai` is a peer dep)
// ---------------------------------------------------------------------------

/**
 * The subset of Vercel AI SDK's `ToolExecutionOptions` that we read in the
 * governed `execute`. Structural; matches the SDK's public type.
 */
export interface VercelToolExecutionOptions {
  toolCallId: string;
  messages?: unknown[];
  abortSignal?: AbortSignal;
  experimental_context?: unknown;
}

/**
 * The subset of Vercel AI SDK's `Tool` shape we need. The SDK's full type is
 * generic over `INPUT` / `OUTPUT`; we erase those to keep the adapter
 * framework-agnostic. The returned governed tool is still type-compatible.
 */
export interface VercelTool {
  description?: string;
  title?: string;
  inputSchema?: unknown;
  execute?: (input: unknown, options: VercelToolExecutionOptions) => unknown | Promise<unknown>;
  needsApproval?: unknown;
  toModelOutput?: unknown;
  type?: "function" | "dynamic" | "provider";
  // Allow any extra fields the user attached (forward-compatible).
  [key: string]: unknown;
}

export type VercelToolSet = Record<string, VercelTool>;

/**
 * Structured tool-result the governed `execute` returns on REFUSE / ESCALATE
 * (when `onRefuse` / `onEscalate` is `"return-error"`, the default). The
 * `__aristotle` discriminator lets the agent recognize and reason about
 * Aristotle decisions explicitly.
 */
export interface AristotleToolOutcome {
  __aristotle: "REFUSE" | "ESCALATE" | "GATE_UNREACHABLE";
  toolName: string;
  reasonCodes: string[];
  message: string;
  gelRecordId?: string;
  warrantId?: string;
}

// ---------------------------------------------------------------------------
// Errors thrown by the wrapper when configured to throw
// ---------------------------------------------------------------------------

export class AristotleGateError extends Error {
  constructor(
    readonly kind: "REFUSE" | "ESCALATE" | "GATE_UNREACHABLE",
    readonly toolName: string,
    readonly reasonCodes: readonly string[],
    readonly gelRecordId: string | undefined,
    readonly decision: EvaluateResponse | undefined,
    message: string
  ) {
    super(message);
    this.name = `AristotleGateError(${kind})`;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AristotleVercelOptions {
  /** AristotleClient already pointed at the Commit Gate. */
  client: AristotleClient;
  /** Ward the tool calls fall under. */
  wardId: string;
  /** Subject identifier for the agent. */
  subject: string;
  /** Prefix prepended to lowercased tool name. Default: `"tool"`. */
  actionTypePrefix?: string;
  /** Map a tool name to a fully-qualified action_type (vertical routing). */
  actionTypeFor?: (toolName: string) => string;
  /** Take full control over the CanonicalAction shape. */
  buildAction?: (input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolCallId: string;
    now: string;
  }) => CanonicalAction;
  /** Tools to never gate. */
  passthroughTools?: ReadonlySet<string> | string[];
  /** Behavior on REFUSE. Default `"return-error"`. */
  onRefuse?: "throw" | "return-error";
  /** Behavior on ESCALATE. Default `"return-error"`. */
  onEscalate?: "throw" | "return-error";
  /** Behavior when the gate is unreachable. Default `"throw"`. */
  onError?: "throw" | "return-error";
  /** Telemetry callback fired after every decision. */
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

function normalizeInput(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) return {};
  if (typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  return { input };
}

function refuseMessage(toolName: string, decision: EvaluateResponse): string {
  const codes = decision.reason_codes ?? [];
  const recordId = decision.gel_record?.record_id ?? "(none)";
  return `aristotle: REFUSE on ${toolName} · ${codes.length ? codes.join(", ") : "no reason codes"} · record ${recordId}`;
}

function escalateMessage(toolName: string, decision: EvaluateResponse): string {
  const codes = decision.reason_codes ?? [];
  const recordId = decision.gel_record?.record_id ?? "(none)";
  return `aristotle: ESCALATE on ${toolName} · ${codes.length ? codes.join(", ") : "no reason codes"} · record ${recordId}`;
}

function errorMessage(toolName: string, err: unknown): string {
  if (err instanceof AristotleApiError) return `aristotle: gate error HTTP ${err.status} on ${toolName}: ${err.message}`;
  return `aristotle: gate unreachable on ${toolName}: ${err instanceof Error ? err.message : String(err)}`;
}

/**
 * Wrap a single Vercel AI SDK tool with Aristotle governance.
 *
 * The Vercel SDK derives a tool's name from the key in the `tools` record
 * passed to `generateText` / `streamText`, NOT from a field on the tool
 * itself — so callers must pass the name explicitly.
 *
 * Returns a new `Tool` object with the same fields as `tool`, but whose
 * `execute` first calls the Commit Gate. Pure tools (no `execute`,
 * e.g. provider-defined tools) are passed through unchanged.
 */
export function governTool<T extends VercelTool>(
  name: string,
  tool: T,
  options: AristotleVercelOptions
): T {
  if (!options.client) throw new Error("governTool requires options.client");
  if (!options.wardId) throw new Error("governTool requires options.wardId");
  if (!options.subject) throw new Error("governTool requires options.subject");
  if (!name) throw new Error("governTool requires a non-empty tool name");

  const passthrough = asSet(options.passthroughTools);
  if (passthrough.has(name)) return tool;

  const innerExecute = tool.execute;
  if (!innerExecute) return tool;

  const prefix = options.actionTypePrefix ?? "tool";
  const onRefuse = options.onRefuse ?? "return-error";
  const onEscalate = options.onEscalate ?? "return-error";
  const onError = options.onError ?? "throw";

  const governedExecute = async (input: unknown, execOptions: VercelToolExecutionOptions): Promise<unknown> => {
    const toolInput = normalizeInput(input);
    const now = new Date().toISOString();
    const actionType = options.actionTypeFor
      ? options.actionTypeFor(name)
      : defaultActionType(name, prefix);
    const action: CanonicalAction = options.buildAction
      ? options.buildAction({ toolName: name, toolInput, toolCallId: execOptions.toolCallId, now })
      : {
          action_id: execOptions.toolCallId,
          ward_id: options.wardId,
          subject: options.subject,
          action_type: actionType,
          params: toolInput,
          requested_at: now,
          telemetry: { agent_runtime: "vercel-ai-sdk" }
        };

    const t0 = Date.now();
    let decision: EvaluateResponse;
    try {
      decision = await options.client.evaluate(action, { now });
    } catch (err) {
      const elapsedMs = Date.now() - t0;
      const msg = errorMessage(name, err);
      options.onDecision?.({
        toolName: name,
        toolInput,
        action,
        decision: { decision: "ERROR", reason_codes: [msg] },
        elapsedMs
      });
      if (onError === "throw") {
        throw new AristotleGateError("GATE_UNREACHABLE", name, [msg], undefined, undefined, msg);
      }
      const outcome: AristotleToolOutcome = {
        __aristotle: "GATE_UNREACHABLE",
        toolName: name,
        reasonCodes: [msg],
        message: msg
      };
      return outcome;
    }

    const elapsedMs = Date.now() - t0;
    options.onDecision?.({ toolName: name, toolInput, action, decision, elapsedMs });

    if (decision.decision === "ALLOW") {
      return await innerExecute(input, execOptions);
    }

    if (decision.decision === "ESCALATE") {
      const msg = escalateMessage(name, decision);
      if (onEscalate === "throw") {
        throw new AristotleGateError("ESCALATE", name, decision.reason_codes ?? [], decision.gel_record?.record_id, decision, msg);
      }
      const outcome: AristotleToolOutcome = {
        __aristotle: "ESCALATE",
        toolName: name,
        reasonCodes: decision.reason_codes ?? [],
        message: msg,
        gelRecordId: decision.gel_record?.record_id
      };
      return outcome;
    }

    // REFUSE
    const msg = refuseMessage(name, decision);
    if (onRefuse === "throw") {
      throw new AristotleGateError("REFUSE", name, decision.reason_codes ?? [], decision.gel_record?.record_id, decision, msg);
    }
    const outcome: AristotleToolOutcome = {
      __aristotle: "REFUSE",
      toolName: name,
      reasonCodes: decision.reason_codes ?? [],
      message: msg,
      gelRecordId: decision.gel_record?.record_id
    };
    return outcome;
  };

  return { ...tool, execute: governedExecute as T["execute"] };
}

/**
 * Wrap an entire `tools` record at once. Most users want this — pass the
 * same shape `generateText({ tools })` expects, get the same shape back
 * with every tool's `execute` governed.
 *
 *   const tools = governTools({
 *     send_email: tool({...}),
 *     search_db:  tool({...}),
 *   }, { client, wardId, subject });
 *
 *   await generateText({ model, prompt, tools });
 */
export function governTools<T extends VercelToolSet>(
  tools: T,
  options: AristotleVercelOptions
): T {
  const out: Record<string, VercelTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    out[name] = governTool(name, tool, options);
  }
  return out as T;
}

// Re-export so a consumer can install only this package.
export { AristotleApiError, AristotleClient } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
