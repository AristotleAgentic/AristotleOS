// AristotleOS-native adapter harness.
//
// Every agent framework ultimately emits a *tool call* (a name + arguments). This
// harness reduces any such call to a Canonical Governed Action, runs it through the
// real execution-control boundary (Commit Gate -> Warrant -> Governance Evidence
// Ledger), and executes the downstream effect ONLY after an `ALLOW` with a
// verified, single-use Warrant. `REFUSE` and `ESCALATE` never execute.
//
// This is where AristotleOS sits in the runtime path: between the agent deciding to
// act and the irreversible consequence. The agent holds no standing authority and
// no long-lived secrets — it receives a Warrant for one action, or nothing.
//
// It is framework-agnostic on purpose: OpenAI Agents SDK, Anthropic tool use,
// LangGraph, CrewAI, AutoGen, Google ADK, and MCP all map onto `ToolCall`.
import { randomUUID } from "node:crypto";
import {
  type AristotleSigner,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ExecutionControlReasonCode,
  type GelRecord,
  type JsonValue,
  type WardManifest,
  type Warrant,
  LedgerStore,
  evaluateExecutionControl,
  getDefaultDevSigner,
  verifyWarrant
} from "@aristotle/execution-control-runtime";

/** A framework-agnostic tool/function call. OpenAI, Anthropic, MCP, etc. reduce to this. */
export interface ToolCall {
  /** Tool / function name, e.g. "stripe.refund" or "k8s.apply". */
  name: string;
  arguments: Record<string, JsonValue>;
  /** Framework call id; used as the idempotency/request id when present. */
  callId?: string;
}

/** Where the action lands in AristotleOS authority context. */
export interface GovernedToolBinding {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  subject: string;
  /** Map a tool call onto a Canonical Governed Action's type/target/params (+ overrides). */
  toAction: (call: ToolCall) =>
    { action_type: string; target: string; params?: Record<string, JsonValue> } & Partial<CanonicalActionInput>;
  /** Warrant signer. Defaults to the process-stable dev key (use a durable key in prod). */
  signer?: AristotleSigner;
  /** Optional pre-built ledger store; otherwise a file ledger at `ledgerPath` is used. */
  ledger?: LedgerStore;
  ledgerPath?: string;
  /** Fixed clock for deterministic demos/tests. */
  now?: string;
  /** Runtime Register snapshot (telemetry/required state) supplied to the gate. */
  runtimeRegister?: Record<string, JsonValue>;
}

export interface ExecuteContext {
  warrant: Warrant;
  action: CanonicalActionInput;
}

export type GovernedOutcome<T> =
  | { status: "executed"; decision: "ALLOW"; warrant: Warrant; result: T; record: GelRecord; canonical_action_hash: string }
  | { status: "refused"; decision: "REFUSE"; reason_codes: ExecutionControlReasonCode[]; record: GelRecord }
  | { status: "escalated"; decision: "ESCALATE"; reason_codes: ExecutionControlReasonCode[]; record: GelRecord }
  | { status: "blocked"; decision: "ALLOW"; reason: string; record: GelRecord };

/**
 * Govern a single framework tool call. Builds the Canonical Governed Action, asks
 * the Commit Gate, and runs `execute` only on `ALLOW` + verified Warrant.
 * Always returns the signed GEL record — including for REFUSE/ESCALATE — so the
 * decision is auditable whether or not the action ran.
 */
export async function governToolCall<T>(
  call: ToolCall,
  binding: GovernedToolBinding,
  execute: (ctx: ExecuteContext) => Promise<T> | T
): Promise<GovernedOutcome<T>> {
  const signer = binding.signer ?? getDefaultDevSigner();
  const mapped = binding.toAction(call);
  const requestedAt = binding.now ?? new Date().toISOString();
  const action: CanonicalActionInput = {
    // When the framework supplies a call id, derive a deterministic action id from
    // it so re-delivering the same call is caught by single-use replay protection
    // (idempotency). Without one, each call is unique.
    action_id: mapped.action_id ?? (call.callId ? `act-${call.callId}` : `act-${call.name}-${randomUUID().slice(0, 8)}`),
    ward_id: binding.ward.ward_id,
    subject: binding.subject,
    action_type: mapped.action_type,
    target: mapped.target,
    params: mapped.params ?? {},
    requested_at: mapped.requested_at ?? requestedAt,
    request_id: mapped.request_id ?? call.callId ?? `req-${randomUUID().slice(0, 8)}`,
    nonce: mapped.nonce,
    telemetry: mapped.telemetry
  };

  // Resolve a ledger: explicit store, else a file at ledgerPath, else a fresh
  // in-memory store (so one-shot demos/tests never write a stray ledger file).
  const ledger = binding.ledger ?? (binding.ledgerPath ? undefined : LedgerStore.memory());

  const evaluation = evaluateExecutionControl({
    ward: binding.ward,
    authorityEnvelope: binding.authorityEnvelope,
    action,
    runtimeRegister: binding.runtimeRegister,
    ledger,
    ledgerPath: binding.ledgerPath ?? "unused",
    signer,
    now: binding.now,
    replayProtection: true
  });

  if (evaluation.decision === "REFUSE") {
    return { status: "refused", decision: "REFUSE", reason_codes: evaluation.reason_codes, record: evaluation.gel_record };
  }
  if (evaluation.decision === "ESCALATE") {
    return { status: "escalated", decision: "ESCALATE", reason_codes: evaluation.reason_codes, record: evaluation.gel_record };
  }

  // ALLOW. Defense in depth: never execute against an unverifiable Warrant.
  const warrant = evaluation.warrant!;
  const verification = verifyWarrant(warrant, evaluation.canonical_action_hash, binding.now);
  if (!verification.ok) {
    return { status: "blocked", decision: "ALLOW", reason: `warrant verification failed: ${verification.reason}`, record: evaluation.gel_record };
  }

  const result = await execute({ warrant, action });
  return {
    status: "executed",
    decision: "ALLOW",
    warrant,
    result,
    record: evaluation.gel_record,
    canonical_action_hash: evaluation.canonical_action_hash
  };
}
