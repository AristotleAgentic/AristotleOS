/**
 * @aristotle/openai-agents — govern every OpenAI Agents SDK tool call
 * through the AristotleOS execution-control Commit Gate before it runs.
 *
 * Returns a `ToolInputGuardrailDefinition` you attach to a tool (or to
 * an agent's tools collectively) via the SDK's first-class guardrail
 * primitive. Every tool invocation is admitted only on ALLOW + warrant;
 * REFUSE becomes `rejectContent` so the agent sees a structured refusal
 * message; ESCALATE becomes `rejectContent` (default) or `throwException`
 * (configurable) so the host's approval workflow can pick it up.
 *
 *   import { tool } from "@openai/agents";
 *   import { AristotleClient } from "@aristotle/os-sdk";
 *   import { aristotleToolInputGuardrail } from "@aristotle/openai-agents";
 *   import { z } from "zod";
 *
 *   const aos = new AristotleClient({ baseUrl: "http://127.0.0.1:8181", token: "..." });
 *   const guardrail = aristotleToolInputGuardrail({
 *     client: aos,
 *     wardId: "ward-agent-ops",
 *     subject: "agent:assistant-1"
 *   });
 *
 *   const sendEmail = tool({
 *     name: "send_email",
 *     description: "Send an email.",
 *     parameters: z.object({ to: z.string(), body: z.string() }),
 *     execute: async (args) => `sent to ${args.to}`,
 *     toolInputGuardrails: [guardrail]
 *   });
 */

import { AristotleApiError, AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// SDK types (mirrored locally; @openai/agents is a peer)
// ---------------------------------------------------------------------------

/**
 * Mirrored `ToolGuardrailBehavior` shape from
 * `@openai/agents-core/toolGuardrail`. The structural type is stable;
 * we don't import from the peer so the package compiles without it.
 */
export type ToolGuardrailBehavior =
  | { type: "allow" }
  | { type: "rejectContent"; message: string }
  | { type: "throwException" };

export interface ToolGuardrailFunctionOutput {
  outputInfo?: unknown;
  behavior: ToolGuardrailBehavior;
}

/** Subset of the SDK's `FunctionCallItem` we read. */
export interface SdkFunctionCall {
  callId: string;
  name: string;
  /** JSON-encoded arguments string. */
  arguments: string;
  type?: "function_call";
  id?: string;
  status?: "in_progress" | "completed" | "incomplete";
}

/** Subset of the SDK's `ToolInputGuardrailData` we read. */
export interface ToolInputGuardrailData {
  toolCall: SdkFunctionCall;
  agent?: { name?: string } & Record<string, unknown>;
  context?: unknown;
}

export type ToolInputGuardrailFunction = (
  data: ToolInputGuardrailData
) => Promise<ToolGuardrailFunctionOutput>;

export interface ToolInputGuardrailDefinition {
  name: string;
  type: "tool_input";
  run: ToolInputGuardrailFunction;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AristotleToolInputGuardrailOptions {
  /** An AristotleClient already constructed and pointed at the gate. */
  client: AristotleClient;
  /** Ward the tool calls fall under. */
  wardId: string;
  /** Subject identifier for the agent (e.g. "agent:assistant-1"). */
  subject: string;

  /**
   * Name registered on the resulting `ToolInputGuardrailDefinition`.
   * Default: `"aristotle-commit-gate"`. Visible in the agent run trace.
   */
  guardrailName?: string;

  /**
   * Prefix prepended to the lowercased tool name to form the
   * `action_type`. Default: `"tool"` → `tool.send_email`, `tool.lookup`.
   */
  actionTypePrefix?: string;

  /** Map a tool name to a fully-qualified action_type (vertical routing). */
  actionTypeFor?: (toolName: string) => string;

  /** Take full control over the CanonicalAction shape. */
  buildAction?: (input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    callId: string;
    now: string;
    agentName: string | undefined;
  }) => CanonicalAction;

  /** Tools (by name) to never gate. */
  passthroughTools?: ReadonlySet<string> | string[];

  /**
   * Behavior on ESCALATE. Default: `"rejectContent"` (the agent sees a
   * structured refusal message describing the escalation and can
   * incorporate it into its response). `"throwException"` halts the
   * runner and surfaces the escalation to the host immediately.
   */
  onEscalate?: "rejectContent" | "throwException";

  /**
   * Behavior when the gate is unreachable. Default: `"rejectContent"`
   * (fail-closed with a message the agent can incorporate). Use
   * `"throwException"` to halt the runner and let the host decide.
   */
  onError?: "rejectContent" | "throwException";

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
  callId: string;
  now: string;
  agentName: string | undefined;
  wardId: string;
  subject: string;
  actionType: string;
}): CanonicalAction {
  return {
    action_id: args.callId,
    ward_id: args.wardId,
    subject: args.subject,
    action_type: args.actionType,
    params: args.toolInput,
    requested_at: args.now,
    telemetry: { agent_runtime: "openai-agents-sdk", agent_name: args.agentName }
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { input: parsed };
  } catch {
    // Not valid JSON — pass the raw string through under `input` so the
    // gate still gets an evidence-able payload.
    return { input: raw };
  }
}

/**
 * Build an OpenAI Agents SDK `ToolInputGuardrailDefinition` that routes
 * every tool call through the Aristotle Commit Gate.
 *
 * Attach to a tool via the SDK's `toolInputGuardrails` option:
 *
 *   const tool = tool({
 *     name: "send_email", ...,
 *     toolInputGuardrails: [aristotleToolInputGuardrail({ client, wardId, subject })]
 *   });
 *
 * Or define once and reuse across multiple tools.
 */
export function aristotleToolInputGuardrail(
  options: AristotleToolInputGuardrailOptions
): ToolInputGuardrailDefinition {
  if (!options.client) throw new Error("aristotleToolInputGuardrail requires options.client");
  if (!options.wardId) throw new Error("aristotleToolInputGuardrail requires options.wardId");
  if (!options.subject) throw new Error("aristotleToolInputGuardrail requires options.subject");

  const prefix = options.actionTypePrefix ?? "tool";
  const passthrough = asSet(options.passthroughTools);
  const onEscalate = options.onEscalate ?? "rejectContent";
  const onError = options.onError ?? "rejectContent";

  const run: ToolInputGuardrailFunction = async (data) => {
    const toolCall = data.toolCall;
    const toolName = toolCall.name;
    const callId = toolCall.callId;
    const agentName = data.agent?.name;

    if (passthrough.has(toolName)) {
      return { behavior: { type: "allow" }, outputInfo: { aristotle: "passthrough" } };
    }

    const toolInput = parseToolArguments(toolCall.arguments);
    const now = new Date().toISOString();
    const actionType = options.actionTypeFor ? options.actionTypeFor(toolName) : defaultActionType(toolName, prefix);
    const action = options.buildAction
      ? options.buildAction({ toolName, toolInput, callId, now, agentName })
      : defaultBuildAction({ toolName, toolInput, callId, now, agentName, wardId: options.wardId, subject: options.subject, actionType });

    const t0 = Date.now();
    let decision: EvaluateResponse;
    try {
      decision = await options.client.evaluate(action, { now });
    } catch (err) {
      const elapsedMs = Date.now() - t0;
      const reason =
        err instanceof AristotleApiError
          ? `aristotle: gate error HTTP ${err.status}: ${err.message}`
          : `aristotle: gate unreachable: ${err instanceof Error ? err.message : String(err)}`;
      options.onDecision?.({
        toolName,
        toolInput,
        action,
        decision: { decision: "ERROR", reason_codes: [reason] },
        elapsedMs
      });
      if (onError === "throwException") {
        return { behavior: { type: "throwException" }, outputInfo: { aristotle: "gate_unreachable", message: reason } };
      }
      return { behavior: { type: "rejectContent", message: reason }, outputInfo: { aristotle: "gate_unreachable" } };
    }

    const elapsedMs = Date.now() - t0;
    options.onDecision?.({ toolName, toolInput, action, decision, elapsedMs });

    if (decision.decision === "ALLOW") {
      return {
        behavior: { type: "allow" },
        outputInfo: {
          aristotle: "allow",
          warrantId: decision.warrant?.warrant_id,
          gelRecordId: decision.gel_record?.record_id
        }
      };
    }

    if (decision.decision === "ESCALATE") {
      const msg = `aristotle: ESCALATE on ${toolName} · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}`;
      if (onEscalate === "throwException") {
        return {
          behavior: { type: "throwException" },
          outputInfo: {
            aristotle: "escalate",
            reasonCodes: decision.reason_codes,
            gelRecordId: decision.gel_record?.record_id
          }
        };
      }
      return {
        behavior: { type: "rejectContent", message: msg },
        outputInfo: {
          aristotle: "escalate",
          reasonCodes: decision.reason_codes,
          gelRecordId: decision.gel_record?.record_id
        }
      };
    }

    // REFUSE
    const refuseMsg = `aristotle: REFUSE on ${toolName} · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}`;
    return {
      behavior: { type: "rejectContent", message: refuseMsg },
      outputInfo: {
        aristotle: "refuse",
        reasonCodes: decision.reason_codes,
        gelRecordId: decision.gel_record?.record_id
      }
    };
  };

  return {
    name: options.guardrailName ?? "aristotle-commit-gate",
    type: "tool_input",
    run
  };
}

// Re-export the AristotleClient + key SDK types so a consumer can install
// only this package and get everything they need.
export { AristotleApiError, AristotleClient } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
