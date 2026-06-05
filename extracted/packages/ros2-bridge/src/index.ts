/**
 * @aristotle/ros2-bridge — govern ROS2 topic publishes + service calls
 * through the AristotleOS Commit Gate.
 *
 * ROS2 doesn't ship with a TypeScript-native client; production deployments
 * typically bridge via rosbridge_suite (websockets) or a sidecar
 * micro-ROS / rclnodejs process. This package targets that bridge surface
 * directly: an outgoing message becomes a CanonicalAction, goes through
 * the Commit Gate, and only on ALLOW + Warrant gets forwarded as a
 * rosbridge JSON op (publish / call_service) to a configured websocket.
 *
 * For tests + demos we ship a recording transport that captures what
 * would have been sent without opening a socket.
 */

import { createHash } from "node:crypto";
import { governThroughAdapter } from "@aristotle/adapter-sdk";
import { AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

export interface RosMessage {
  /** "publish" -> publishes to a topic; "call_service" -> service call. */
  kind: "publish" | "call_service";
  /** ROS topic name or service name. */
  target: string;
  /** Optional type hint (e.g. "geometry_msgs/Twist", "std_srvs/Trigger"). */
  msg_type?: string;
  /** Payload. Caller is responsible for matching the msg_type schema. */
  data: Record<string, unknown>;
  requested_at: string;
}

export interface RosAuthorization {
  warrant_id: string;
  warrant_signature: string;
  consumed: true;
  consumed_at: string;
  action_hash: string;
  /** ROS node id this authz scopes to. */
  node_id: string;
  /** Targets (topic / service names) this authz permits. */
  permitted_targets: string[];
}

export interface RosSubmissionReceipt {
  receipt_id: string;
  node_id: string;
  kind: RosMessage["kind"];
  target: string;
  msg_type?: string;
  payload_b64: string;
  warrant_id: string;
  action_hash: string;
  emitted_at: string;
  transport: string;
  production_validated: boolean;
  receipt_hash: string;
}

export type RosRefusalCode =
  | "MISSING_AUTHORIZATION"
  | "TARGET_OUTSIDE_AUTHZ"
  | "TRANSPORT_REJECTED"
  | "TRANSPORT_UNREACHABLE"
  | "DEMONSTRATION_ONLY_BLOCKED";

export type RosSubmissionOutcome =
  | { ok: true; receipt: RosSubmissionReceipt }
  | { ok: false; refusal: { code: RosRefusalCode; detail: string } };

export interface RosControlTransport {
  readonly id: string;
  readonly production_validated: boolean;
  emit(msg: RosMessage, authz: RosAuthorization): Promise<RosSubmissionOutcome>;
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
function payloadB64(rosOp: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(rosOp)).toString("base64");
}

// ---------------------------------------------------------------------------
// Demonstration transport — records would-be rosbridge ops without a socket.
// ---------------------------------------------------------------------------

export class DemonstrationRosTransport implements RosControlTransport {
  readonly id = "ros2-rosbridge-demonstration";
  readonly production_validated = false;
  private seq = 0;
  private readonly clock: () => string;
  readonly emitted: Array<{ msg: RosMessage; op: Record<string, unknown> }> = [];

  constructor(opts?: { clock?: () => string }) {
    this.clock = opts?.clock ?? (() => new Date().toISOString());
  }

  async emit(msg: RosMessage, authz: RosAuthorization): Promise<RosSubmissionOutcome> {
    if (!authz.permitted_targets.includes(msg.target)) {
      return { ok: false, refusal: { code: "TARGET_OUTSIDE_AUTHZ", detail: `target ${msg.target} not in authz.permitted_targets` } };
    }
    this.seq = (this.seq + 1) & 0xffff;
    const op = msg.kind === "publish"
      ? { op: "publish", topic: msg.target, type: msg.msg_type, msg: msg.data }
      : { op: "call_service", service: msg.target, type: msg.msg_type, args: msg.data };
    this.emitted.push({ msg, op });
    const partial = {
      receipt_id: `rosrcpt-${this.seq.toString().padStart(6, "0")}`,
      node_id: authz.node_id,
      kind: msg.kind,
      target: msg.target,
      msg_type: msg.msg_type,
      payload_b64: payloadB64(op),
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: this.clock(),
      transport: this.id,
      production_validated: this.production_validated
    };
    const receipt: RosSubmissionReceipt = { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) };
    return { ok: true, receipt };
  }
}

// ---------------------------------------------------------------------------
// Rosbridge websocket transport
// ---------------------------------------------------------------------------

/** Minimal websocket interface — any WebSocket-like (ws library / native) works. */
export interface WsLike {
  readyState: number;
  send(data: string, cb?: (err?: Error) => void): void;
  close(): void;
}

export interface RosbridgeWebsocketTransportOptions {
  /** A pre-opened websocket to rosbridge_suite (default ws://localhost:9090). */
  socket: WsLike;
  productionValidated?: boolean;
}

export class RosbridgeWebsocketTransport implements RosControlTransport {
  readonly id = "ros2-rosbridge-ws";
  readonly production_validated: boolean;
  private seq = 0;
  private readonly socket: WsLike;

  constructor(opts: RosbridgeWebsocketTransportOptions) {
    this.socket = opts.socket;
    this.production_validated = opts.productionValidated ?? false;
  }

  async emit(msg: RosMessage, authz: RosAuthorization): Promise<RosSubmissionOutcome> {
    if (!authz.permitted_targets.includes(msg.target)) {
      return { ok: false, refusal: { code: "TARGET_OUTSIDE_AUTHZ", detail: `target ${msg.target} not in authz.permitted_targets` } };
    }
    if (this.socket.readyState !== 1) { // 1 = OPEN
      return { ok: false, refusal: { code: "TRANSPORT_UNREACHABLE", detail: `websocket not open (readyState=${this.socket.readyState})` } };
    }
    this.seq = (this.seq + 1) & 0xffff;
    const op = msg.kind === "publish"
      ? { op: "publish", topic: msg.target, type: msg.msg_type, msg: msg.data }
      : { op: "call_service", service: msg.target, type: msg.msg_type, args: msg.data };
    try {
      await new Promise<void>((resolve, reject) => {
        this.socket.send(JSON.stringify(op), (err) => err ? reject(err) : resolve());
      });
    } catch (err) {
      return { ok: false, refusal: { code: "TRANSPORT_UNREACHABLE", detail: (err as Error).message } };
    }
    const partial = {
      receipt_id: `rosrcpt-ws-${this.seq.toString().padStart(6, "0")}`,
      node_id: authz.node_id,
      kind: msg.kind,
      target: msg.target,
      msg_type: msg.msg_type,
      payload_b64: payloadB64(op),
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: new Date().toISOString(),
      transport: this.id,
      production_validated: this.production_validated
    };
    const receipt: RosSubmissionReceipt = { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) };
    return { ok: true, receipt };
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface GovernRosMessageOptions {
  client: AristotleClient;
  wardId: string;
  subject: string;
  nodeId: string;
  actionTypeFor?: (msg: RosMessage) => string;
  allowDemonstrationTransport?: boolean;
}

export async function governRosMessage(
  msg: RosMessage,
  transport: RosControlTransport,
  options: GovernRosMessageOptions
): Promise<{ ok: boolean; decision?: EvaluateResponse; outcome?: RosSubmissionOutcome; refusal?: { code: string; detail: string } }> {
  const result = await governThroughAdapter<RosMessage, RosAuthorization>(msg, {
    client: options.client,
    transport,
    allowDemonstrationTransport: options.allowDemonstrationTransport,
    buildAction: (operation): CanonicalAction => ({
      action_id: `ros-${options.nodeId}-${Date.now().toString(16)}`,
      ward_id: options.wardId,
      subject: options.subject,
      action_type: options.actionTypeFor
        ? options.actionTypeFor(operation)
        : `ros.${operation.kind}.${operation.target.replace(/^\/+/, "").replace(/\//g, ".")}`,
      params: {
        node_id: options.nodeId,
        kind: operation.kind,
        target: operation.target,
        msg_type: operation.msg_type,
        data: operation.data
      },
      requested_at: operation.requested_at,
      telemetry: { agent_runtime: "ros2-rosbridge" }
    }),
    buildAuthorization: (decision, operation): RosAuthorization => {
      const warrant = decision.warrant!;
      return {
        warrant_id: warrant.warrant_id,
        warrant_signature: (warrant.signature as string) ?? "ed25519:opaque",
        consumed: true,
        consumed_at: new Date().toISOString(),
        action_hash: decision.canonical_action_hash,
        node_id: options.nodeId,
        permitted_targets: [operation.target]
      };
    }
  });
  return {
    ok: result.ok,
    decision: result.decision,
    outcome: result.outcome as RosSubmissionOutcome | undefined,
    refusal: result.refusal
  };
}

export { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
