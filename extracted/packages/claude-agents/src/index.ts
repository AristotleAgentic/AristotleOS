/**
 * @aristotle/claude-agents — govern every Claude Agent SDK tool call through
 * the AristotleOS execution-control Commit Gate before it runs.
 *
 * Drop the returned hook into a `query()` call from `@anthropic-ai/claude-agent-sdk`
 * and every tool invocation by the agent is admitted ONLY on ALLOW + warrant;
 * REFUSE is returned to the agent as a `deny`; ESCALATE is returned as `ask`
 * so the host can route it to a human approver (or to the dual-control
 * approvals queue via `aos.decideApproval()`).
 *
 *   import { query } from "@anthropic-ai/claude-agent-sdk";
 *   import { AristotleClient } from "@aristotle/os-sdk";
 *   import { aristotleGuard } from "@aristotle/claude-agents";
 *
 *   const aos = new AristotleClient({ baseUrl: "https://gate.internal", token });
 *   const guard = aristotleGuard({ client: aos, wardId: "ward-agent-ops", subject: "agent:assistant-1" });
 *
 *   for await (const msg of query({
 *     prompt: "Help me reconcile the customer refund",
 *     options: { hooks: guard.hooksConfig }
 *   })) { ... }
 */

import { AristotleApiError, AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";
import { governThroughHandler, type GovernedHandlerResult, type HandlerContext } from "@aristotle/adapter-sdk";

// ---------------------------------------------------------------------------
// Claude Agent SDK hook types (defined locally so this package does not have
// to import from `@anthropic-ai/claude-agent-sdk` at compile time; the SDK is
// a peer dependency at runtime). These shapes mirror the SDK's official
// `PreToolUseHookInput` / `HookOutput` per the public docs.
// ---------------------------------------------------------------------------

export interface PreToolUseHookInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id: string;
  cwd: string;
  agent_id?: string;
  agent_type?: string;
}

/** The full union the SDK passes — we only act on PreToolUse. */
export interface AnyHookInput {
  hook_event_name: string;
  [key: string]: unknown;
}

export type PermissionDecision = "allow" | "deny" | "ask" | "defer";

export interface PreToolUseHookOutput {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: PermissionDecision;
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
  systemMessage?: string;
  continue?: boolean;
}

export type PreToolUseHook = (
  input: AnyHookInput,
  toolUseId: string | undefined,
  context: { signal: AbortSignal }
) => Promise<PreToolUseHookOutput>;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AristotleGuardOptions {
  /** An AristotleClient already constructed and pointed at the gate. */
  client: AristotleClient;
  /** Ward the tool calls fall under. */
  wardId: string;
  /** Subject identifier for the agent (e.g. "agent:assistant-1"). */
  subject: string;

  /**
   * Prefix prepended to the lowercased Claude tool name to form the
   * `action_type`. Default: `"tool"` → `tool.bash`, `tool.write`, `tool.read`.
   * Pass a custom prefix to namespace by deployment (e.g. `"agent.ops.tool"`).
   */
  actionTypePrefix?: string;

  /**
   * Map a Claude tool name to a fully-qualified action_type. Overrides
   * `actionTypePrefix`. Useful for routing some tools into a vertical
   * namespace (e.g. `Bash` → `infra.shell.run`).
   */
  actionTypeFor?: (toolName: string) => string;

  /**
   * Fully build the CanonicalAction from the tool call. If provided, this
   * overrides the default mapping entirely. Use when you need control over
   * `params`, `target`, `telemetry`, etc.
   */
  buildAction?: (input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    sessionId: string;
    toolUseId: string | undefined;
    cwd: string;
    now: string;
  }) => CanonicalAction;

  /**
   * Tools to never gate. Default: `[]` (gate everything that reaches the hook;
   * use the SDK's `matcher` to scope by tool name pattern as well).
   */
  passthroughTools?: ReadonlySet<string> | string[];

  /**
   * Decision the hook returns when the gate is unreachable or the SDK throws
   * before responding. Default: `"deny"` (fail-closed, matching the Aristotle
   * Commit Gate's own fail-closed posture).
   */
  onError?: "deny" | "ask";

  /**
   * Telemetry / audit callback fired after every gate decision (including
   * errors). Use to forward decisions into your own observability stack.
   */
  onDecision?: (info: {
    toolName: string;
    toolInput: Record<string, unknown>;
    action: CanonicalAction;
    decision: EvaluateResponse | { decision: "ERROR"; reason_codes: string[] };
    elapsedMs: number;
  }) => void;
}

export interface AristotleGuardResult {
  /** The raw hook callback — register it however you wire your query. */
  hook: PreToolUseHook;
  /** Ready-made `hooks` config to spread into `query({ options })`. */
  hooksConfig: {
    PreToolUse: Array<{ matcher?: string; hooks: PreToolUseHook[] }>;
  };
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
  sessionId: string;
  toolUseId: string | undefined;
  cwd: string;
  now: string;
  wardId: string;
  subject: string;
  actionType: string;
}): CanonicalAction {
  return {
    action_id: args.toolUseId ?? `claude-tool-${args.sessionId}-${args.now}`,
    ward_id: args.wardId,
    subject: args.subject,
    action_type: args.actionType,
    params: args.toolInput,
    request_id: args.sessionId,
    requested_at: args.now,
    telemetry: { agent_runtime: "claude-agent-sdk", cwd: args.cwd }
  };
}

export function aristotleGuard(options: AristotleGuardOptions): AristotleGuardResult {
  if (!options.client) throw new Error("aristotleGuard requires options.client");
  if (!options.wardId) throw new Error("aristotleGuard requires options.wardId");
  if (!options.subject) throw new Error("aristotleGuard requires options.subject");

  const prefix = options.actionTypePrefix ?? "tool";
  const passthrough = asSet(options.passthroughTools);
  const onError = options.onError ?? "deny";

  const hook: PreToolUseHook = async (input, toolUseId, _ctx) => {
    if (input.hook_event_name !== "PreToolUse") {
      return {};
    }
    const pre = input as unknown as PreToolUseHookInput;
    const toolName = pre.tool_name;
    const toolInput = pre.tool_input ?? {};

    if (passthrough.has(toolName)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: `aristotle: passthrough tool ${toolName}`
        }
      };
    }

    const now = new Date().toISOString();
    const actionType = options.actionTypeFor ? options.actionTypeFor(toolName) : defaultActionType(toolName, prefix);
    const action = options.buildAction
      ? options.buildAction({
          toolName,
          toolInput,
          sessionId: pre.session_id,
          toolUseId,
          cwd: pre.cwd,
          now
        })
      : defaultBuildAction({
          toolName,
          toolInput,
          sessionId: pre.session_id,
          toolUseId,
          cwd: pre.cwd,
          now,
          wardId: options.wardId,
          subject: options.subject,
          actionType
        });

    // Pattern 3: governThroughHandler. Like openai-agents, claude-agents is
    // admission-only — Claude's SDK runs the tool itself after we resolve to
    // permissionDecision:'allow'. The handler is a no-op.
    interface SdkInput { toolName: string; toolInput: Record<string, unknown>; action: CanonicalAction; }
    const sdkInput: SdkInput = { toolName, toolInput, action };
    const t0 = Date.now();

    let result: GovernedHandlerResult<void>;
    try {
      result = await governThroughHandler<SdkInput, void>(sdkInput, {
        client: options.client,
        buildAction: (i) => i.action,
        handler: (_i, _ctx: HandlerContext) => { /* admission only */ }
      });
    } catch (err) {
      // Defect: orchestrator should never throw. Treat as gate-unreachable.
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
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: onError,
          permissionDecisionReason: reason
        }
      };
    }

    const elapsedMs = Date.now() - t0;

    // ALLOW path: handler ran (no-op), warrant present.
    if (result.ok) {
      const decision = result.decision;
      options.onDecision?.({ toolName, toolInput, action, decision, elapsedMs });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: `aristotle: ALLOW · warrant ${decision.warrant?.warrant_id ?? "(none)"} · record ${decision.gel_record?.record_id ?? "(none)"}`
        }
      };
    }

    const refusalCode = result.refusal.code;
    const refusalDetail = result.refusal.detail;
    const decision = result.decision;

    // Gate-unreachable family.
    if (refusalCode === "GATE_UNREACHABLE" || refusalCode.startsWith("GATE_HTTP_")) {
      const reason = refusalCode.startsWith("GATE_HTTP_")
        ? `aristotle: gate error HTTP ${refusalCode.replace(/^GATE_HTTP_/, "")}: ${refusalDetail}`
        : `aristotle: gate unreachable: ${refusalDetail}`;
      options.onDecision?.({
        toolName,
        toolInput,
        action,
        decision: { decision: "ERROR", reason_codes: [reason] },
        elapsedMs
      });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: onError,
          permissionDecisionReason: reason
        }
      };
    }

    // MISSING_WARRANT: treat as REFUSE.
    if (refusalCode === "MISSING_WARRANT" && decision) {
      options.onDecision?.({ toolName, toolInput, action, decision, elapsedMs });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `aristotle: REFUSE · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}`
        }
      };
    }

    // GATE_REFUSED: REFUSE / ESCALATE / EXPIRE.
    if (refusalCode === "GATE_REFUSED" && decision) {
      options.onDecision?.({ toolName, toolInput, action, decision, elapsedMs });

      if (decision.decision === "ESCALATE") {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: `aristotle: ESCALATE · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}`
          }
        };
      }
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `aristotle: REFUSE · ${decision.reason_codes.join(", ") || "no reason codes"} · record ${decision.gel_record?.record_id ?? "(none)"}`
        }
      };
    }

    // Forward-compat fallback.
    const fallback = `aristotle: ${refusalCode}: ${refusalDetail}`;
    options.onDecision?.({
      toolName,
      toolInput,
      action,
      decision: decision ?? { decision: "ERROR", reason_codes: [fallback] },
      elapsedMs
    });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: fallback
      }
    };
  };

  return {
    hook,
    hooksConfig: {
      PreToolUse: [{ hooks: [hook] }]
    }
  };
}

// Re-export the AristotleClient + key SDK types so a consumer can install
// only this package and get everything they need to construct the client.
export { AristotleApiError, AristotleClient } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
