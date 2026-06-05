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
// Re-exports so third-party adapters only need to import from this package.
// ---------------------------------------------------------------------------

export type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
export { AristotleApiError } from "@aristotle/os-sdk";
