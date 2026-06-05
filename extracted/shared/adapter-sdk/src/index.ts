/**
 * @aristotle/adapter-sdk
 *
 * Generic adapter contract for AristotleOS. Closes the shippable
 * portion of ROADMAP_TO_100.md Category 3 "build an adapter SDK with
 * documented contracts, so third parties can ship adapters without
 * modifying this repo".
 *
 * Every first-party adapter in packages/ today (mavlink-px4,
 * ros2-bridge, opcua-adapter, dnp3-adapter, modbus-adapter,
 * bacnet-adapter, k8s-admission) implements approximately the same
 * shape: an `*ControlTransport` interface, a `Demonstration*Transport`
 * stub, a `*ShimTransport` for caller-supplied drivers, and a
 * `govern*()` orchestrator that talks to AristotleClient. This package
 * generalizes that shape so third-party adapters never need to
 * rediscover it.
 *
 * What ships:
 *
 *   - AristotleAdapterTransport<Op, Authz, Receipt> — generic
 *     interface every adapter transport satisfies. Three type params
 *     keep adapter-specific data structures honest at the type level
 *     instead of erasing them to `unknown`.
 *
 *   - DemonstrationTransport<Op, Authz, Receipt> — abstract base for
 *     "doesn't actually open a socket" stubs. Subclass + implement
 *     `buildReceipt()`. Always reports production_validated: false.
 *
 *   - RecordingTransport<Op, Authz, Receipt> — test helper. Records
 *     every emit() call so assertions can inspect what would have
 *     been sent.
 *
 *   - governThroughAdapter — generic orchestrator. The seven
 *     first-party adapters' govern* functions all follow the same
 *     pattern; this is that pattern lifted out. Third-party adapters
 *     get the same fail-closed evaluate -> warrant check ->
 *     production_validated gate -> emit pipeline by passing their
 *     transport + a small action-construction callback.
 *
 *   - AdapterRefusalCode — the closed enum of refusal codes the
 *     orchestrator produces, so third parties can pattern-match
 *     without inventing new codes.
 *
 * Reference: an existing first-party adapter like
 * packages/modbus-adapter/src/index.ts is the worked example of every
 * concept here in concrete form.
 */

import type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
import { AristotleApiError } from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * Authorization material the gate produces on ALLOW. Every governed
 * adapter receives this from the orchestrator; transports use it to
 * carry the warrant binding into the wire-level emission.
 */
export interface AdapterAuthorization {
  warrant_id: string;
  warrant_signature: string;
  consumed: true;
  consumed_at: string;
  action_hash: string;
}

/**
 * Generic transport contract. Op is the adapter-specific operation
 * (Modbus write, MAVLink command, BACnet property write, etc.).
 * Authz is the adapter-specific authorization (typically extends
 * AdapterAuthorization with adapter-specific fields like
 * permitted_register_addresses). Receipt is the adapter-specific
 * outcome.
 *
 * Three discipline points every implementation must honor:
 *
 *   - readonly id           — stable identifier for log / audit attribution.
 *   - readonly production_validated  — false by default. Set true only
 *                                       after operator + (where
 *                                       applicable) range sign-off.
 *   - emit(op, authz)       — synchronously or asynchronously perform
 *                              the wire-level action. Must return
 *                              { ok: false, refusal } instead of
 *                              throwing on operational errors
 *                              (timeout, transport error, authz
 *                              mismatch); throw only on programmer
 *                              errors.
 */
export interface AristotleAdapterTransport<
  Op,
  Authz extends AdapterAuthorization = AdapterAuthorization,
  Receipt = unknown
> {
  readonly id: string;
  readonly production_validated: boolean;
  emit(op: Op, authz: Authz): Promise<AdapterEmitOutcome<Receipt>>;
}

export type AdapterEmitOutcome<Receipt> =
  | { ok: true; receipt: Receipt }
  | { ok: false; refusal: { code: string; detail: string } };

// ---------------------------------------------------------------------------
// DemonstrationTransport — abstract base for "no socket" stubs
// ---------------------------------------------------------------------------

/**
 * Abstract base class for demonstration transports. Subclass +
 * implement `buildReceipt(op, authz, seq)`. The base class records
 * every emitted op in `this.emitted` so tests can inspect it.
 * Always reports production_validated: false.
 */
export abstract class DemonstrationTransport<
  Op,
  Authz extends AdapterAuthorization = AdapterAuthorization,
  Receipt = unknown
> implements AristotleAdapterTransport<Op, Authz, Receipt> {
  readonly id: string;
  readonly production_validated = false;
  readonly emitted: Op[] = [];
  private seq = 0;

  constructor(id: string) { this.id = id; }

  async emit(op: Op, authz: Authz): Promise<AdapterEmitOutcome<Receipt>> {
    this.seq = (this.seq + 1) & 0xffffffff;
    this.emitted.push(op);
    return { ok: true, receipt: this.buildReceipt(op, authz, this.seq) };
  }

  /** Build the adapter-specific receipt. Subclasses must implement. */
  protected abstract buildReceipt(op: Op, authz: Authz, seq: number): Receipt;
}

// ---------------------------------------------------------------------------
// RecordingTransport — test helper
// ---------------------------------------------------------------------------

/**
 * Test helper transport. Records every emit() call; returns the
 * caller-supplied outcome (default: { ok: true, receipt: undefined }).
 * Useful for cross-adapter invariant tests (e.g., the existing
 * refusal-before-emission test in @aristotle/tests-cross-adapter).
 */
export class RecordingTransport<
  Op,
  Authz extends AdapterAuthorization = AdapterAuthorization,
  Receipt = unknown
> implements AristotleAdapterTransport<Op, Authz, Receipt> {
  readonly id: string;
  readonly production_validated: boolean;
  readonly emitCalls: Array<{ op: Op; authz: Authz }> = [];
  private readonly nextOutcome: (op: Op, authz: Authz) => AdapterEmitOutcome<Receipt>;

  constructor(opts: {
    id?: string;
    productionValidated?: boolean;
    onEmit?: (op: Op, authz: Authz) => AdapterEmitOutcome<Receipt>;
  } = {}) {
    this.id = opts.id ?? "recording";
    this.production_validated = opts.productionValidated ?? false;
    this.nextOutcome = opts.onEmit ?? (() => ({ ok: true, receipt: undefined as unknown as Receipt }));
  }

  async emit(op: Op, authz: Authz): Promise<AdapterEmitOutcome<Receipt>> {
    this.emitCalls.push({ op, authz });
    return this.nextOutcome(op, authz);
  }
}

// ---------------------------------------------------------------------------
// Refusal codes — the closed enum of orchestrator-emitted refusals.
// ---------------------------------------------------------------------------

/**
 * Closed set of refusal codes the generic orchestrator can produce.
 * Adapter-specific refusals from the transport itself surface under
 * `code: "TRANSPORT_REFUSED"` with the transport's code in the
 * detail string (or in a structured `transport_refusal` field on
 * GovernAdapterResult). Third parties can extend the closed set by
 * subclassing the AdapterRefusalCodeExtension type or just by adding
 * their own codes in the transport refusal payload.
 */
export type AdapterRefusalCode =
  | "GATE_HTTP_400"
  | "GATE_HTTP_401"
  | "GATE_HTTP_403"
  | "GATE_HTTP_404"
  | "GATE_HTTP_429"
  | "GATE_HTTP_500"
  | "GATE_HTTP_503"
  | "GATE_UNREACHABLE"
  | "GATE_REFUSED"      // gate returned decision !== ALLOW
  | "MISSING_WARRANT"   // gate said ALLOW but didn't return a Warrant
  | "DEMONSTRATION_ONLY_BLOCKED"
  | "TRANSPORT_REFUSED";

// ---------------------------------------------------------------------------
// governThroughAdapter — the generic orchestrator
// ---------------------------------------------------------------------------

export interface GovernAdapterInput<
  Op,
  Authz extends AdapterAuthorization
> {
  /** Caller's AristotleClient pointed at the gate. */
  client: AristotleClient;
  /**
   * Build the CanonicalAction the gate evaluates. Receives the
   * adapter-specific Op; returns a fully-formed action with at least
   * action_id / ward_id / subject / action_type / params /
   * requested_at populated. This is the only thing third-party
   * adapters need to wire — every other piece of the pattern (gate
   * call, ALLOW check, demo-transport guard, emit) is generic.
   */
  buildAction: (op: Op) => CanonicalAction;
  /** The adapter-specific transport. */
  transport: AristotleAdapterTransport<Op, Authz, unknown>;
  /**
   * Build the adapter-specific authorization from the gate decision.
   * If undefined, the base AdapterAuthorization is used directly.
   * Adapter-specific fields (permitted_register_addresses,
   * permitted_commands, etc.) get filled in here.
   */
  buildAuthorization?: (decision: EvaluateResponse, op: Op) => Authz;
  /**
   * Set true to permit transports with production_validated: false to
   * actually emit. Default false (fail-closed) — operators who haven't
   * sign-off on a demo transport don't accidentally let it through.
   */
  allowDemonstrationTransport?: boolean;
}

export interface GovernAdapterResult {
  ok: boolean;
  decision?: EvaluateResponse;
  outcome?: AdapterEmitOutcome<unknown>;
  refusal?: { code: AdapterRefusalCode; detail: string };
}

/**
 * Generic governance orchestrator. Mirrors the pattern every
 * first-party govern*() implements in packages/. Third parties get
 * the same fail-closed pipeline by passing a buildAction callback +
 * their transport.
 *
 * Pipeline:
 *   1. buildAction(op) -> CanonicalAction.
 *   2. client.evaluate(action) -> decision. Network failure produces
 *      GATE_UNREACHABLE; HTTP error produces GATE_HTTP_<code>.
 *   3. If decision !== ALLOW: refuse with GATE_REFUSED + the decision
 *      + reason_codes.
 *   4. If decision.warrant missing: MISSING_WARRANT (defensive).
 *   5. Build authorization (default: minimal AdapterAuthorization).
 *   6. If transport.production_validated === false AND
 *      allowDemonstrationTransport === false: DEMONSTRATION_ONLY_BLOCKED.
 *   7. transport.emit(op, authz). If outcome.ok === false:
 *      TRANSPORT_REFUSED + the transport's refusal in detail.
 */
export async function governThroughAdapter<Op, Authz extends AdapterAuthorization>(
  op: Op,
  input: GovernAdapterInput<Op, Authz>
): Promise<GovernAdapterResult> {
  // (1) Build action.
  const action = input.buildAction(op);
  // (2) Evaluate.
  let decision: EvaluateResponse;
  try {
    decision = await input.client.evaluate(action);
  } catch (err) {
    if (err instanceof AristotleApiError) {
      const code = `GATE_HTTP_${err.status}` as AdapterRefusalCode;
      return { ok: false, refusal: { code, detail: err.message } };
    }
    return {
      ok: false,
      refusal: {
        code: "GATE_UNREACHABLE",
        detail: err instanceof Error ? err.message : String(err)
      }
    };
  }
  // (3) ALLOW check.
  if (decision.decision !== "ALLOW") {
    return {
      ok: false,
      decision,
      refusal: {
        code: "GATE_REFUSED",
        detail: `${decision.decision}: ${decision.reason_codes.join(", ")}`
      }
    };
  }
  // (4) Warrant present.
  const warrant = decision.warrant;
  if (!warrant) {
    return { ok: false, decision, refusal: { code: "MISSING_WARRANT", detail: "gate ALLOWed without a Warrant" } };
  }
  // (5) Build authz.
  const baseAuthz: AdapterAuthorization = {
    warrant_id: warrant.warrant_id,
    warrant_signature: (warrant.signature as string) ?? "ed25519:opaque",
    consumed: true,
    consumed_at: new Date().toISOString(),
    action_hash: decision.canonical_action_hash
  };
  const authz: Authz = input.buildAuthorization
    ? input.buildAuthorization(decision, op)
    : baseAuthz as Authz;
  // (6) Demonstration-transport guard.
  if (!input.transport.production_validated && !input.allowDemonstrationTransport) {
    return {
      ok: false,
      decision,
      refusal: {
        code: "DEMONSTRATION_ONLY_BLOCKED",
        detail: `transport ${input.transport.id} is not production-validated and allowDemonstrationTransport is false`
      }
    };
  }
  // (7) Emit.
  const outcome = await input.transport.emit(op, authz);
  if (!outcome.ok) {
    return {
      ok: false,
      decision,
      outcome,
      refusal: {
        code: "TRANSPORT_REFUSED",
        detail: `${outcome.refusal.code}: ${outcome.refusal.detail}`
      }
    };
  }
  return { ok: true, decision, outcome };
}

// ---------------------------------------------------------------------------
// Response-shaped governance — for adapters that emit a response
// object instead of calling a transport.
//
// Some adapters don't have a wire transport at the substrate's layer.
// The Kubernetes admission webhook is the canonical example: the
// adapter receives an AdmissionReviewRequest from the API server and
// MUST return an AdmissionReviewResponse synchronously. There's no
// "transport" to call after the gate ALLOWs; the response itself IS
// the effect.
//
// `governThroughResponse` provides the response-shaped equivalent of
// `governThroughAdapter`: same fail-closed pipeline, same closed-set
// refusal codes, same decision -> ALLOW check + missing-Warrant
// guard, but the operator supplies `buildAllowResponse` and
// `buildRefusalResponse` callbacks instead of a transport.
//
// Third-party adapter authors with response-shaped use cases (custom
// admission controllers, HTTP middleware, message broker handlers
// that respond synchronously) get the same fail-closed pipeline
// without re-deriving it.
// ---------------------------------------------------------------------------

export interface GovernThroughResponseInput<Req, Resp> {
  /** AristotleClient pointed at the gate. */
  client: AristotleClient;
  /** Translate the request into a CanonicalAction the gate evaluates. */
  buildAction: (request: Req) => CanonicalAction;
  /**
   * Build the success response on ALLOW. The warrant is guaranteed
   * non-null at this point (the SDK rejects ALLOW-without-Warrant as
   * MISSING_WARRANT before this callback runs).
   */
  buildAllowResponse: (
    request: Req,
    decision: EvaluateResponse,
    warrant: NonNullable<EvaluateResponse["warrant"]>
  ) => Resp;
  /**
   * Build the refusal response on any rejection. The callback decides
   * how to map the substrate's refusal codes into the response
   * vocabulary the wire protocol expects (HTTP status codes,
   * AdmissionReviewResponse status objects, custom MQ NACK shapes,
   * etc.).
   */
  buildRefusalResponse: (
    request: Req,
    refusal: ResponseRefusal
  ) => Resp;
}

/** Refusal carried into buildRefusalResponse. */
export interface ResponseRefusal {
  code: AdapterRefusalCode;
  detail: string;
  /** EvaluateResponse when the rejection came AFTER a gate call (REFUSE / EXPIRE / ESCALATE). Absent when the gate itself was unreachable. */
  decision?: EvaluateResponse;
}

/**
 * Response-shaped governance pipeline. Mirrors governThroughAdapter
 * step-for-step except the terminal effect is a response object the
 * caller returns to whatever invoked them, instead of a transport
 * emission.
 *
 * Pipeline:
 *   1. buildAction(request) -> CanonicalAction.
 *   2. client.evaluate(action) -> decision. HTTP error -> GATE_HTTP_<code>.
 *      Network error -> GATE_UNREACHABLE.
 *   3. If decision !== ALLOW: buildRefusalResponse with code GATE_REFUSED
 *      + the decision passed through for callback inspection.
 *   4. If decision.warrant missing: buildRefusalResponse with
 *      MISSING_WARRANT (defensive).
 *   5. buildAllowResponse(request, decision, warrant).
 *
 * The callback gets the FULL decision on refusal so it can map
 * decision.decision ("REFUSE" vs "ESCALATE" vs "EXPIRE") and
 * reason_codes into its protocol's response vocabulary.
 */
export async function governThroughResponse<Req, Resp>(
  request: Req,
  input: GovernThroughResponseInput<Req, Resp>
): Promise<Resp> {
  // (1) Build action.
  const action = input.buildAction(request);
  // (2) Evaluate.
  let decision: EvaluateResponse;
  try {
    decision = await input.client.evaluate(action);
  } catch (err) {
    if (err instanceof AristotleApiError) {
      const code = `GATE_HTTP_${err.status}` as AdapterRefusalCode;
      return input.buildRefusalResponse(request, { code, detail: err.message });
    }
    return input.buildRefusalResponse(request, {
      code: "GATE_UNREACHABLE",
      detail: err instanceof Error ? err.message : String(err)
    });
  }
  // (3) ALLOW check.
  if (decision.decision !== "ALLOW") {
    return input.buildRefusalResponse(request, {
      code: "GATE_REFUSED",
      detail: `${decision.decision}: ${decision.reason_codes.join(", ")}`,
      decision
    });
  }
  // (4) Warrant present.
  const warrant = decision.warrant;
  if (!warrant) {
    return input.buildRefusalResponse(request, {
      code: "MISSING_WARRANT",
      detail: "gate ALLOWed without a Warrant",
      decision
    });
  }
  // (5) Build success response.
  return input.buildAllowResponse(request, decision, warrant);
}

// ---------------------------------------------------------------------------
// Pattern 3: governThroughHandler — for framework tool wrappers
// (langchain, vercel-ai, mastra, openai-agents, claude-agents, anthropic).
//
// The third operational shape: wrap an arbitrary handler function with the
// gate. The handler receives the validated input + a HandlerContext on
// ALLOW; it is never invoked on REFUSE.
//
// First-party framework wrappers (packages/langchain, packages/vercel-ai,
// packages/mastra, packages/openai-agents, packages/claude-agents,
// packages/sdk-anthropic) all rediscover the same shape: build a
// CanonicalAction from the tool name + input, evaluate at the gate, run the
// caller-supplied handler with the warrant binding on ALLOW, surface a
// framework-appropriate error on any other decision. This is that pattern
// lifted out — the third orchestrator next to governThroughAdapter
// (transport-shaped) and governThroughResponse (response-shaped).
//
// Third-party agent runtimes (custom MCP brokers, internal tool dispatchers,
// orchestration glue we haven't written yet) get the same fail-closed
// pipeline by passing buildAction + handler. No transport, no response —
// just a function that runs on ALLOW.
// ---------------------------------------------------------------------------

/**
 * Context handed to the handler on ALLOW. The warrant binding is established
 * before the handler runs; the handler can stamp these into its own outputs
 * (audit log entries, downstream RPC headers, etc.) to carry the binding
 * forward.
 */
export interface HandlerContext {
  /** Warrant id issued by the gate; single-use. */
  warrant_id: string;
  /** Canonical hash the warrant binds to. */
  canonical_action_hash: string;
  /** Full evaluate response, for handlers that want the gel_record or full warrant body. */
  decision: EvaluateResponse;
}

export interface GovernThroughHandlerInput<TInput, TOutput> {
  /** AristotleClient pointed at the gate. */
  client: AristotleClient;
  /** Translate the input into a CanonicalAction the gate evaluates. */
  buildAction: (input: TInput) => CanonicalAction;
  /**
   * The handler invoked on ALLOW with the validated input and the
   * post-decision context. Never invoked on any non-ALLOW outcome.
   * May return synchronously or asynchronously. If the handler throws,
   * the orchestrator surfaces the throw as TRANSPORT_REFUSED (matching
   * the substrate's "transport-rejected-the-emit-after-ALLOW" semantics).
   */
  handler: (input: TInput, context: HandlerContext) => Promise<TOutput> | TOutput;
}

/**
 * Result of governThroughHandler. ALLOW path returns `ok: true` with the
 * handler's output and the warrant binding. Any non-ALLOW outcome returns
 * `ok: false` with the closed-set refusal code; the `decision` is attached
 * when the rejection came after a successful gate call so callers can map
 * `decision.reason_codes` into their framework's error vocabulary.
 */
export type GovernedHandlerResult<TOutput> =
  | { ok: true; output: TOutput; warrant_id: string; canonical_action_hash: string; decision: EvaluateResponse }
  | { ok: false; refusal: { code: AdapterRefusalCode; detail: string }; decision?: EvaluateResponse };

/**
 * Handler-shaped governance pipeline. Mirrors governThroughAdapter /
 * governThroughResponse step-for-step except the terminal effect is a
 * caller-supplied function instead of a transport emission or a wire
 * response object.
 *
 * Pipeline:
 *   1. buildAction(input) -> CanonicalAction.
 *   2. client.evaluate(action) -> decision. AristotleApiError ->
 *      GATE_HTTP_<status>; any other thrown error -> GATE_UNREACHABLE.
 *   3. If decision !== ALLOW: { ok: false, refusal: GATE_REFUSED, decision }.
 *   4. If decision.warrant missing: { ok: false, refusal: MISSING_WARRANT, decision } (defensive).
 *   5. handler(input, { warrant_id, canonical_action_hash, decision }).
 *      Throw -> { ok: false, refusal: TRANSPORT_REFUSED }.
 *   6. { ok: true, output, warrant_id, canonical_action_hash, decision }.
 */
export async function governThroughHandler<TInput, TOutput>(
  input: TInput,
  config: GovernThroughHandlerInput<TInput, TOutput>
): Promise<GovernedHandlerResult<TOutput>> {
  // (1) Build action.
  const action = config.buildAction(input);
  // (2) Evaluate.
  let decision: EvaluateResponse;
  try {
    decision = await config.client.evaluate(action);
  } catch (err) {
    if (err instanceof AristotleApiError) {
      const code = `GATE_HTTP_${err.status}` as AdapterRefusalCode;
      return { ok: false, refusal: { code, detail: err.message } };
    }
    return {
      ok: false,
      refusal: {
        code: "GATE_UNREACHABLE",
        detail: err instanceof Error ? err.message : String(err)
      }
    };
  }
  // (3) ALLOW check.
  if (decision.decision !== "ALLOW") {
    return {
      ok: false,
      decision,
      refusal: {
        code: "GATE_REFUSED",
        detail: `${decision.decision}: ${decision.reason_codes.join(", ")}`
      }
    };
  }
  // (4) Warrant present (defensive guard).
  const warrant = decision.warrant;
  if (!warrant) {
    return {
      ok: false,
      decision,
      refusal: { code: "MISSING_WARRANT", detail: "gate ALLOWed without a Warrant" }
    };
  }
  // (5) Invoke handler.
  try {
    const output = await config.handler(input, {
      warrant_id: warrant.warrant_id,
      canonical_action_hash: decision.canonical_action_hash,
      decision
    });
    return {
      ok: true,
      output,
      warrant_id: warrant.warrant_id,
      canonical_action_hash: decision.canonical_action_hash,
      decision
    };
  } catch (err) {
    return {
      ok: false,
      decision,
      refusal: {
        code: "TRANSPORT_REFUSED",
        detail: `handler threw: ${err instanceof Error ? err.message : String(err)}`
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Re-exports so third-party adapters only need to import from this package.
// ---------------------------------------------------------------------------

export type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
export { AristotleApiError } from "@aristotle/os-sdk";
