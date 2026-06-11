/**
 * @aristotle/bedrock — govern AWS Bedrock Converse-API tool calls through
 * the AristotleOS execution-control Commit Gate before they run.
 *
 * The Bedrock Converse API returns ``toolUse`` blocks in the model's
 * response; the host application is responsible for dispatching each one
 * to its implementation and feeding the result back. This package gives
 * you :func:`dispatchToolUse` and :func:`makeBedrockToolDispatcher`, which
 * route every ``toolUse`` through the gate before invoking the user's
 * implementation.
 *
 *   import { AristotleClient } from "@aristotle/os-sdk";
 *   import { makeBedrockToolDispatcher } from "@aristotle/bedrock";
 *
 *   const aos = new AristotleClient({ baseUrl: "http://127.0.0.1:8181", token });
 *   const dispatch = makeBedrockToolDispatcher({
 *     client: aos, wardId: "ward-agent-ops", subject: "agent:1",
 *     tools: {
 *       send_email: async ({ to, body }) => sendEmail(to, body),
 *       search_db:  async ({ query })   => searchDb(query),
 *     },
 *   });
 *
 *   // After ConverseCommand returns a response containing a toolUse block:
 *   const result = await dispatch(toolUseBlock);
 */

import { AristotleApiError, AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// Bedrock Converse-API toolUse shape (mirrored locally; the AWS SDK is not
// a peer of this package — your application installs aws-sdk separately).
// ---------------------------------------------------------------------------

export interface BedrockToolUse {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

/** What you send back to Bedrock as the tool result. */
export type BedrockToolResultContent =
  | { json: Record<string, unknown> }
  | { text: string };

export interface BedrockToolResult {
  toolUseId: string;
  content: BedrockToolResultContent[];
  status?: "success" | "error";
}

// ---------------------------------------------------------------------------
// Structured outcome (mirrors @aristotle/vercel-ai shape).
// ---------------------------------------------------------------------------

export interface AristotleToolOutcome {
  __aristotle: "REFUSE" | "ESCALATE" | "GATE_UNREACHABLE";
  toolName: string;
  toolUseId: string;
  reasonCodes: string[];
  message: string;
  gelRecordId?: string;
  warrantId?: string;
}

export class AristotleGateError extends Error {
  constructor(
    public readonly kind: "REFUSE" | "ESCALATE" | "GATE_UNREACHABLE",
    public readonly toolName: string,
    public readonly toolUseId: string,
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

export type BedrockToolImpl = (input: Record<string, unknown>) => Promise<unknown> | unknown;

export interface MakeBedrockToolDispatcherOptions {
  client: AristotleClient;
  wardId: string;
  subject: string;

  /** Map of tool name -> implementation. */
  tools: Record<string, BedrockToolImpl>;

  actionTypePrefix?: string;
  actionTypeFor?: (toolName: string) => string;
  buildAction?: (input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
    now: string;
  }) => CanonicalAction;

  passthroughTools?: ReadonlySet<string> | string[];

  /** "tool-result" (default — return BedrockToolResult with status:"error" and outcome JSON) or "throw". */
  onRefuse?: "tool-result" | "throw";
  onEscalate?: "tool-result" | "throw";
  /** "throw" (default — fail-closed) or "tool-result". */
  onError?: "throw" | "tool-result";

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
  toolUseId: string;
  now: string;
  wardId: string;
  subject: string;
  actionType: string;
}): CanonicalAction {
  return {
    action_id: args.toolUseId,
    ward_id: args.wardId,
    subject: args.subject,
    action_type: args.actionType,
    params: args.toolInput,
    requested_at: args.now,
    telemetry: { agent_runtime: "aws-bedrock-converse" }
  };
}

function outcomeToResult(outcome: AristotleToolOutcome): BedrockToolResult {
  return {
    toolUseId: outcome.toolUseId,
    content: [{ json: { ...outcome } }],
    status: "error"
  };
}

/**
 * Build a Bedrock tool dispatcher bound to a tool registry. Feed each
 * ``toolUse`` block from a Converse response into the returned function;
 * it routes through the gate, runs the implementation on ALLOW, and
 * returns a ``BedrockToolResult`` ready to send back to Bedrock.
 */
export function makeBedrockToolDispatcher(
  options: MakeBedrockToolDispatcherOptions
): (toolUse: BedrockToolUse) => Promise<BedrockToolResult> {
  if (!options.client) throw new Error("makeBedrockToolDispatcher requires options.client");
  if (!options.wardId) throw new Error("makeBedrockToolDispatcher requires options.wardId");
  if (!options.subject) throw new Error("makeBedrockToolDispatcher requires options.subject");
  if (!options.tools) throw new Error("makeBedrockToolDispatcher requires options.tools");

  const prefix = options.actionTypePrefix ?? "tool";
  const passthrough = asSet(options.passthroughTools);
  const onRefuse = options.onRefuse ?? "tool-result";
  const onEscalate = options.onEscalate ?? "tool-result";
  const onError = options.onError ?? "throw";

  return async function dispatch(toolUse: BedrockToolUse): Promise<BedrockToolResult> {
    const impl = options.tools[toolUse.name];
    if (!impl) {
      return {
        toolUseId: toolUse.toolUseId,
        status: "error",
        content: [{ text: `Tool '${toolUse.name}' is not registered with the dispatcher.` }]
      };
    }

    if (passthrough.has(toolUse.name)) {
      const out = await impl(toolUse.input);
      return formatSuccess(toolUse.toolUseId, out);
    }

    const now = new Date().toISOString();
    const actionType = options.actionTypeFor
      ? options.actionTypeFor(toolUse.name)
      : defaultActionType(toolUse.name, prefix);
    const action = options.buildAction
      ? options.buildAction({ toolName: toolUse.name, toolInput: toolUse.input, toolUseId: toolUse.toolUseId, now })
      : defaultBuildAction({ toolName: toolUse.name, toolInput: toolUse.input, toolUseId: toolUse.toolUseId, now, wardId: options.wardId, subject: options.subject, actionType });

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
      options.onDecision?.({ toolName: toolUse.name, toolInput: toolUse.input, action, decision: { decision: "ERROR", reason_codes: [message] }, elapsedMs });
      if (onError === "throw") {
        throw new AristotleGateError("GATE_UNREACHABLE", toolUse.name, toolUse.toolUseId, [message], undefined, undefined, message);
      }
      return outcomeToResult({ __aristotle: "GATE_UNREACHABLE", toolName: toolUse.name, toolUseId: toolUse.toolUseId, reasonCodes: [message], message });
    }

    const elapsedMs = Date.now() - t0;
    options.onDecision?.({ toolName: toolUse.name, toolInput: toolUse.input, action, decision, elapsedMs });

    if (decision.decision === "ALLOW") {
      const out = await impl(toolUse.input);
      return formatSuccess(toolUse.toolUseId, out);
    }

    const reasonCodes = decision.reason_codes;
    const gelRecordId = decision.gel_record?.record_id;
    const warrantId = decision.warrant?.warrant_id;

    if (decision.decision === "ESCALATE") {
      const message = `aristotle: ESCALATE on ${toolUse.name} - ${reasonCodes.join(", ") || "no reason codes"} - record ${gelRecordId ?? "(none)"}`;
      if (onEscalate === "throw") {
        throw new AristotleGateError("ESCALATE", toolUse.name, toolUse.toolUseId, reasonCodes, gelRecordId, decision, message);
      }
      return outcomeToResult({ __aristotle: "ESCALATE", toolName: toolUse.name, toolUseId: toolUse.toolUseId, reasonCodes, message, gelRecordId, warrantId });
    }

    const message = `aristotle: REFUSE on ${toolUse.name} - ${reasonCodes.join(", ") || "no reason codes"} - record ${gelRecordId ?? "(none)"}`;
    if (onRefuse === "throw") {
      throw new AristotleGateError("REFUSE", toolUse.name, toolUse.toolUseId, reasonCodes, gelRecordId, decision, message);
    }
    return outcomeToResult({ __aristotle: "REFUSE", toolName: toolUse.name, toolUseId: toolUse.toolUseId, reasonCodes, message, gelRecordId, warrantId });
  };
}

function formatSuccess(toolUseId: string, out: unknown): BedrockToolResult {
  if (typeof out === "string") {
    return { toolUseId, content: [{ text: out }], status: "success" };
  }
  return { toolUseId, content: [{ json: (out ?? {}) as Record<string, unknown> }], status: "success" };
}

/**
 * Lower-level: dispatch a single tool use through the gate. Use when you
 * don't want a closed-over registry — the implementation is passed in
 * per call.
 */
export async function dispatchToolUse(
  toolUse: BedrockToolUse,
  impl: BedrockToolImpl,
  options: Omit<MakeBedrockToolDispatcherOptions, "tools"> & { tools?: never }
): Promise<BedrockToolResult> {
  const dispatcher = makeBedrockToolDispatcher({
    ...options,
    tools: { [toolUse.name]: impl }
  } as MakeBedrockToolDispatcherOptions);
  return dispatcher(toolUse);
}

export { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
