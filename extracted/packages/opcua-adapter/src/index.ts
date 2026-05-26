/**
 * @aristotle/opcua-adapter — govern OPC-UA writes + method calls through
 * the AristotleOS Commit Gate.
 *
 * OPC-UA is the dominant industrial-automation protocol (IEC 62541). This
 * package defines the `OpcUaControlTransport` contract and ships a
 * demonstration transport plus a generic `OpcUaClient`-shim transport that
 * delegates to whichever OPC-UA library the deployment uses
 * (node-opcua-client, opcua-binding, vendor SDK).
 *
 * The hardware-governance pattern is identical to @aristotle/mavlink-px4
 * and @aristotle/ros2-bridge: an outbound action becomes a CanonicalAction,
 * goes through the Commit Gate, and only on ALLOW + Warrant is forwarded
 * to the OPC-UA server with a hash-bound receipt.
 */

import { createHash } from "node:crypto";
import { AristotleApiError, AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

export interface OpcUaOperation {
  kind: "write" | "method_call";
  /** NodeId in OPC-UA syntax: "ns=2;s=Boiler1.Setpoint". */
  node_id: string;
  /** For write: data type hint (Int32, Double, Boolean, etc.). */
  data_type?: string;
  /** For write: value to set. For method_call: input arguments. */
  value: unknown;
  /** For method_call: parent object node id. */
  object_id?: string;
  requested_at: string;
}

export interface OpcUaAuthorization {
  warrant_id: string;
  warrant_signature: string;
  consumed: true;
  consumed_at: string;
  action_hash: string;
  /** OPC-UA server endpoint URI this authz scopes to. */
  endpoint_uri: string;
  permitted_node_ids: string[];
}

export interface OpcUaSubmissionReceipt {
  receipt_id: string;
  endpoint_uri: string;
  kind: OpcUaOperation["kind"];
  node_id: string;
  data_type?: string;
  value_b64: string;
  warrant_id: string;
  action_hash: string;
  emitted_at: string;
  transport: string;
  production_validated: boolean;
  receipt_hash: string;
}

export type OpcUaRefusalCode =
  | "MISSING_AUTHORIZATION"
  | "NODE_OUTSIDE_AUTHZ"
  | "TRANSPORT_REJECTED"
  | "TRANSPORT_UNREACHABLE"
  | "DEMONSTRATION_ONLY_BLOCKED";

export type OpcUaSubmissionOutcome =
  | { ok: true; receipt: OpcUaSubmissionReceipt }
  | { ok: false; refusal: { code: OpcUaRefusalCode; detail: string } };

export interface OpcUaControlTransport {
  readonly id: string;
  readonly production_validated: boolean;
  emit(op: OpcUaOperation, authz: OpcUaAuthorization): Promise<OpcUaSubmissionOutcome>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------------

function sha256Hex(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function stableStringify(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + (o as unknown[]).map((x) => stableStringify(x)).join(",") + "]";
  const obj = o as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
function valueB64(v: unknown): string { return Buffer.from(JSON.stringify(v)).toString("base64"); }

// ---------------------------------------------------------------------------
// Demonstration transport
// ---------------------------------------------------------------------------

export class DemonstrationOpcUaTransport implements OpcUaControlTransport {
  readonly id = "opcua-demonstration";
  readonly production_validated = false;
  private seq = 0;
  private readonly clock: () => string;
  readonly emitted: OpcUaOperation[] = [];

  constructor(opts?: { clock?: () => string }) {
    this.clock = opts?.clock ?? (() => new Date().toISOString());
  }

  async emit(op: OpcUaOperation, authz: OpcUaAuthorization): Promise<OpcUaSubmissionOutcome> {
    if (!authz.permitted_node_ids.includes(op.node_id)) {
      return { ok: false, refusal: { code: "NODE_OUTSIDE_AUTHZ", detail: `node ${op.node_id} not in authz.permitted_node_ids` } };
    }
    this.seq = (this.seq + 1) & 0xffff;
    this.emitted.push(op);
    const partial = {
      receipt_id: `opcrcpt-${this.seq.toString().padStart(6, "0")}`,
      endpoint_uri: authz.endpoint_uri,
      kind: op.kind,
      node_id: op.node_id,
      data_type: op.data_type,
      value_b64: valueB64(op.value),
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: this.clock(),
      transport: this.id,
      production_validated: this.production_validated
    };
    const receipt: OpcUaSubmissionReceipt = { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) };
    return { ok: true, receipt };
  }
}

// ---------------------------------------------------------------------------
// Generic shim transport: delegates the actual OPC-UA call to a function
// the caller provides (node-opcua-client, vendor SDK, etc.).
// ---------------------------------------------------------------------------

export interface OpcUaShimTransportOptions {
  endpointUri: string;
  writer: (op: OpcUaOperation) => Promise<void>;
  productionValidated?: boolean;
}

export class OpcUaShimTransport implements OpcUaControlTransport {
  readonly id = "opcua-shim";
  readonly production_validated: boolean;
  private seq = 0;
  private readonly endpointUri: string;
  private readonly writer: (op: OpcUaOperation) => Promise<void>;

  constructor(opts: OpcUaShimTransportOptions) {
    this.endpointUri = opts.endpointUri;
    this.writer = opts.writer;
    this.production_validated = opts.productionValidated ?? false;
  }

  async emit(op: OpcUaOperation, authz: OpcUaAuthorization): Promise<OpcUaSubmissionOutcome> {
    if (!authz.permitted_node_ids.includes(op.node_id)) {
      return { ok: false, refusal: { code: "NODE_OUTSIDE_AUTHZ", detail: `node ${op.node_id} not in authz.permitted_node_ids` } };
    }
    try {
      await this.writer(op);
    } catch (err) {
      return { ok: false, refusal: { code: "TRANSPORT_REJECTED", detail: (err as Error).message } };
    }
    this.seq = (this.seq + 1) & 0xffff;
    const partial = {
      receipt_id: `opcrcpt-shim-${this.seq.toString().padStart(6, "0")}`,
      endpoint_uri: this.endpointUri,
      kind: op.kind,
      node_id: op.node_id,
      data_type: op.data_type,
      value_b64: valueB64(op.value),
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: new Date().toISOString(),
      transport: this.id,
      production_validated: this.production_validated
    };
    const receipt: OpcUaSubmissionReceipt = { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) };
    return { ok: true, receipt };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface GovernOpcUaOptions {
  client: AristotleClient;
  wardId: string;
  subject: string;
  endpointUri: string;
  actionTypeFor?: (op: OpcUaOperation) => string;
  allowDemonstrationTransport?: boolean;
}

export async function governOpcUaOperation(
  op: OpcUaOperation,
  transport: OpcUaControlTransport,
  options: GovernOpcUaOptions
): Promise<{ ok: boolean; decision?: EvaluateResponse; outcome?: OpcUaSubmissionOutcome; refusal?: { code: string; detail: string } }> {
  const actionType = options.actionTypeFor ? options.actionTypeFor(op) : `opcua.${op.kind}`;
  const action: CanonicalAction = {
    action_id: `opcua-${Date.now().toString(16)}`,
    ward_id: options.wardId,
    subject: options.subject,
    action_type: actionType,
    params: { endpoint_uri: options.endpointUri, kind: op.kind, node_id: op.node_id, data_type: op.data_type, value: op.value as unknown },
    requested_at: op.requested_at,
    telemetry: { agent_runtime: "opcua" }
  };
  let decision: EvaluateResponse;
  try {
    decision = await options.client.evaluate(action);
  } catch (err) {
    if (err instanceof AristotleApiError) return { ok: false, refusal: { code: `GATE_HTTP_${err.status}`, detail: err.message } };
    return { ok: false, refusal: { code: "GATE_UNREACHABLE", detail: err instanceof Error ? err.message : String(err) } };
  }
  if (decision.decision !== "ALLOW") {
    return { ok: false, decision, refusal: { code: decision.decision, detail: decision.reason_codes.join(", ") } };
  }
  const warrant = decision.warrant;
  if (!warrant) return { ok: false, decision, refusal: { code: "MISSING_WARRANT", detail: "gate returned ALLOW but no warrant" } };
  const authz: OpcUaAuthorization = {
    warrant_id: warrant.warrant_id,
    warrant_signature: (warrant.signature as string) ?? "ed25519:opaque",
    consumed: true,
    consumed_at: new Date().toISOString(),
    action_hash: decision.canonical_action_hash,
    endpoint_uri: options.endpointUri,
    permitted_node_ids: [op.node_id]
  };
  if (!transport.production_validated && !options.allowDemonstrationTransport) {
    return { ok: false, decision, refusal: { code: "DEMONSTRATION_ONLY_BLOCKED", detail: `transport ${transport.id} is not production-validated` } };
  }
  const outcome = await transport.emit(op, authz);
  return { ok: outcome.ok, decision, outcome };
}

export { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
