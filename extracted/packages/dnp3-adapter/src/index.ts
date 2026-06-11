/**
 * @aristotle/dnp3-adapter — govern DNP3 outstation controls through the
 * AristotleOS Commit Gate. Same shape as the MAVLink / ROS2 / OPC-UA
 * adapters, scoped to electric-grid SCADA / RTU communication.
 *
 * DNP3 (IEEE 1815) is the dominant protocol for substation automation in
 * North America. Critical actions are control writes: trip/close a
 * breaker, set an analog setpoint, raise/lower a tap, etc. This adapter
 * wraps the outbound write through a Commit Gate decision.
 */

import { createHash } from "node:crypto";
import { governThroughAdapter } from "@aristotle/adapter-sdk";
import { AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

export type Dnp3ControlKind =
  | "binary_output_select_then_operate"  // CROB (object group 12)
  | "binary_output_direct_operate"
  | "analog_output_select_then_operate"  // AO setpoint (object group 41)
  | "analog_output_direct_operate";

export interface Dnp3ControlRequest {
  kind: Dnp3ControlKind;
  /** DNP3 master to outstation channel id. */
  outstation_address: number;
  /** Index of the binary output / analog output point. */
  point_index: number;
  /** For binary CROB: "trip" | "close" | "pulse_on" | "pulse_off" | "latch_on" | "latch_off". */
  operation?: string;
  /** For analog AO: numeric setpoint. */
  value?: number;
  /** Optional human-readable label for the point (substation breaker name, transformer tap, etc.). */
  point_label?: string;
  requested_at: string;
}

export interface Dnp3Authorization {
  warrant_id: string;
  warrant_signature: string;
  consumed: true;
  consumed_at: string;
  action_hash: string;
  /** Substation / RTU id this authz scopes to. */
  outstation_id: string;
  permitted_point_indexes: number[];
}

export interface Dnp3SubmissionReceipt {
  receipt_id: string;
  outstation_id: string;
  kind: Dnp3ControlKind;
  point_index: number;
  operation?: string;
  value?: number;
  warrant_id: string;
  action_hash: string;
  emitted_at: string;
  transport: string;
  production_validated: boolean;
  receipt_hash: string;
}

export type Dnp3RefusalCode =
  | "POINT_OUTSIDE_AUTHZ"
  | "TRANSPORT_REJECTED"
  | "TRANSPORT_UNREACHABLE"
  | "DEMONSTRATION_ONLY_BLOCKED";

export type Dnp3SubmissionOutcome =
  | { ok: true; receipt: Dnp3SubmissionReceipt }
  | { ok: false; refusal: { code: Dnp3RefusalCode; detail: string } };

export interface Dnp3ControlTransport {
  readonly id: string;
  readonly production_validated: boolean;
  emit(req: Dnp3ControlRequest, authz: Dnp3Authorization): Promise<Dnp3SubmissionOutcome>;
}

function sha256Hex(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function stableStringify(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + (o as unknown[]).map((x) => stableStringify(x)).join(",") + "]";
  const obj = o as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

export class DemonstrationDnp3Transport implements Dnp3ControlTransport {
  readonly id = "dnp3-demonstration";
  readonly production_validated = false;
  private seq = 0;
  readonly emitted: Dnp3ControlRequest[] = [];
  private readonly clock: () => string;
  constructor(opts?: { clock?: () => string }) {
    this.clock = opts?.clock ?? (() => new Date().toISOString());
  }
  async emit(req: Dnp3ControlRequest, authz: Dnp3Authorization): Promise<Dnp3SubmissionOutcome> {
    if (!authz.permitted_point_indexes.includes(req.point_index)) {
      return { ok: false, refusal: { code: "POINT_OUTSIDE_AUTHZ", detail: `point ${req.point_index} not in authz.permitted_point_indexes` } };
    }
    this.seq = (this.seq + 1) & 0xffff;
    this.emitted.push(req);
    const partial = {
      receipt_id: `dnp3rcpt-${this.seq.toString().padStart(6, "0")}`,
      outstation_id: authz.outstation_id,
      kind: req.kind,
      point_index: req.point_index,
      operation: req.operation,
      value: req.value,
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: this.clock(),
      transport: this.id,
      production_validated: this.production_validated
    };
    return { ok: true, receipt: { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) } };
  }
}

/** Shim transport delegating to a caller-provided DNP3 driver. */
export interface Dnp3ShimTransportOptions {
  outstationId: string;
  sender: (req: Dnp3ControlRequest) => Promise<void>;
  productionValidated?: boolean;
}

export class Dnp3ShimTransport implements Dnp3ControlTransport {
  readonly id = "dnp3-shim";
  readonly production_validated: boolean;
  private seq = 0;
  constructor(private readonly opts: Dnp3ShimTransportOptions) {
    this.production_validated = opts.productionValidated ?? false;
  }
  async emit(req: Dnp3ControlRequest, authz: Dnp3Authorization): Promise<Dnp3SubmissionOutcome> {
    if (!authz.permitted_point_indexes.includes(req.point_index)) {
      return { ok: false, refusal: { code: "POINT_OUTSIDE_AUTHZ", detail: `point ${req.point_index} not in authz.permitted_point_indexes` } };
    }
    try { await this.opts.sender(req); }
    catch (err) { return { ok: false, refusal: { code: "TRANSPORT_REJECTED", detail: (err as Error).message } }; }
    this.seq = (this.seq + 1) & 0xffff;
    const partial = {
      receipt_id: `dnp3rcpt-shim-${this.seq.toString().padStart(6, "0")}`,
      outstation_id: this.opts.outstationId,
      kind: req.kind,
      point_index: req.point_index,
      operation: req.operation,
      value: req.value,
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: new Date().toISOString(),
      transport: this.id,
      production_validated: this.production_validated
    };
    return { ok: true, receipt: { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) } };
  }
}

export interface GovernDnp3Options {
  client: AristotleClient;
  wardId: string;
  subject: string;
  outstationId: string;
  actionTypeFor?: (req: Dnp3ControlRequest) => string;
  allowDemonstrationTransport?: boolean;
}

export async function governDnp3Control(
  req: Dnp3ControlRequest,
  transport: Dnp3ControlTransport,
  options: GovernDnp3Options
): Promise<{ ok: boolean; decision?: EvaluateResponse; outcome?: Dnp3SubmissionOutcome; refusal?: { code: string; detail: string } }> {
  const result = await governThroughAdapter<Dnp3ControlRequest, Dnp3Authorization>(req, {
    client: options.client,
    transport,
    allowDemonstrationTransport: options.allowDemonstrationTransport,
    buildAction: (operation): CanonicalAction => ({
      action_id: `dnp3-${Date.now().toString(16)}`,
      ward_id: options.wardId,
      subject: options.subject,
      action_type: options.actionTypeFor ? options.actionTypeFor(operation) : `grid.dnp3.${operation.kind}`,
      params: {
        outstation_id: options.outstationId,
        kind: operation.kind,
        point_index: operation.point_index,
        operation: operation.operation,
        value: operation.value,
        point_label: operation.point_label
      },
      requested_at: operation.requested_at,
      telemetry: { agent_runtime: "dnp3" }
    }),
    buildAuthorization: (decision, operation): Dnp3Authorization => {
      const warrant = decision.warrant!;
      return {
        warrant_id: warrant.warrant_id,
        warrant_signature: (warrant.signature as string) ?? "ed25519:opaque",
        consumed: true,
        consumed_at: new Date().toISOString(),
        action_hash: decision.canonical_action_hash,
        outstation_id: options.outstationId,
        permitted_point_indexes: [operation.point_index]
      };
    }
  });
  return {
    ok: result.ok,
    decision: result.decision,
    outcome: result.outcome as Dnp3SubmissionOutcome | undefined,
    refusal: result.refusal
  };
}

export { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
