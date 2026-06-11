/**
 * @aristotle/mavlink-px4 — govern PX4 / ArduPilot flight commands through
 * the AristotleOS execution-control Commit Gate.
 *
 * This package defines the FlightControlTransport contract and ships two
 * implementations:
 *
 *   MavlinkUdpTransport     — opens a UDP socket to a real or simulated
 *                              PX4 / ArduPilot endpoint and emits MAVLink
 *                              v2 framed messages. Use against PX4 SITL
 *                              (default port 14540) or a real autopilot.
 *
 *   DemonstrationFlightControlTransport — records what would have been
 *                              sent without opening a socket. Used by tests
 *                              and the operator-side demo flow. Reports
 *                              `production_validated: false`.
 *
 * The contract mirrors the title vertical's outbound submission shape:
 * authorization (consumed Warrant) -> packet -> outcome (ALLOW receipt OR
 * a typed refusal). The orchestrator (governFlightCommand) does
 * defense-in-depth checks before invoking the transport.
 *
 * MAVLink framing here is intentionally minimal — just enough to round-trip
 * a COMMAND_LONG against PX4 SITL. The point isn't a complete MAVLink
 * library (use mavlink2-router / pymavlink for that); the point is to prove
 * a real wire-level transport with a hash-bound governance receipt.
 */

import { createSocket, type Socket } from "node:dgram";
import { createHash } from "node:crypto";
import { governThroughAdapter } from "@aristotle/adapter-sdk";
import { AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// Flight command primitives
// ---------------------------------------------------------------------------

export type FlightCommandKind =
  | "ARM"
  | "DISARM"
  | "TAKEOFF"
  | "LAND"
  | "RTL"             // Return-to-launch
  | "GOTO_NED"        // Go to North-East-Down position
  | "SET_MODE"
  | "GEOFENCE_ARM"
  | "FTS_TRIGGER";    // Flight Termination System

export interface FlightCommand {
  command: FlightCommandKind;
  /** PX4 / ArduPilot system id (target). */
  target_system: number;
  /** PX4 / ArduPilot component id. */
  target_component: number;
  /** Per-command parameters. Keys depend on `command`. */
  params: Record<string, number | string | boolean>;
  /** ISO timestamp when the command was generated. */
  requested_at: string;
}

export interface FlightAuthorization {
  warrant_id: string;
  warrant_signature: string;
  consumed: true;
  consumed_at: string;
  action_hash: string;
  /** Aircraft id this authz scopes to. */
  aircraft_id: string;
  /** Allowed command kinds this authz permits. */
  permitted_commands: FlightCommandKind[];
}

export interface FlightSubmissionReceipt {
  receipt_id: string;
  aircraft_id: string;
  command: FlightCommandKind;
  /** Bytes actually emitted on the wire (transport-specific, base64-encoded for portability). */
  bytes_emitted_b64: string;
  warrant_id: string;
  action_hash: string;
  emitted_at: string;
  transport: string;
  production_validated: boolean;
  receipt_hash: string;
}

export type FlightRefusalCode =
  | "MISSING_AUTHORIZATION"
  | "WARRANT_NOT_CONSUMED"
  | "COMMAND_OUTSIDE_AUTHZ"
  | "AIRCRAFT_MISMATCH"
  | "TRANSPORT_REJECTED"
  | "TRANSPORT_UNREACHABLE"
  | "DEMONSTRATION_ONLY_BLOCKED";

export type FlightSubmissionOutcome =
  | { ok: true; receipt: FlightSubmissionReceipt }
  | { ok: false; refusal: { code: FlightRefusalCode; detail: string } };

export interface FlightControlTransport {
  readonly id: string;
  readonly production_validated: boolean;
  emit(command: FlightCommand, authz: FlightAuthorization): Promise<FlightSubmissionOutcome>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// MAVLink v2 minimal framing (enough for COMMAND_LONG)
// ---------------------------------------------------------------------------

/** MAVLink v2 magic byte. */
const MAVLINK_V2_STX = 0xfd;

/** Map FlightCommand.command to MAV_CMD numeric id used in PX4 / ArduPilot. */
const MAV_CMD: Record<FlightCommandKind, number> = {
  ARM: 400,               // MAV_CMD_COMPONENT_ARM_DISARM (arm=1)
  DISARM: 400,            // (arm=0)
  TAKEOFF: 22,            // MAV_CMD_NAV_TAKEOFF
  LAND: 21,               // MAV_CMD_NAV_LAND
  RTL: 20,                // MAV_CMD_NAV_RETURN_TO_LAUNCH
  GOTO_NED: 192,          // MAV_CMD_DO_REPOSITION (subset)
  SET_MODE: 176,          // MAV_CMD_DO_SET_MODE
  GEOFENCE_ARM: 2003,     // MAV_CMD_DO_FENCE_ENABLE
  FTS_TRIGGER: 185        // MAV_CMD_DO_FLIGHTTERMINATION
};

/** CRC-16/MCRF4XX as MAVLink uses for its checksum (X.25 polynomial, init 0xFFFF). */
function mavlinkCrc(buf: Uint8Array, crcExtra: number): number {
  let crc = 0xffff;
  for (let i = 0; i < buf.length; i++) {
    let tmp = buf[i] ^ (crc & 0xff);
    tmp = (tmp ^ (tmp << 4)) & 0xff;
    crc = ((crc >> 8) & 0xff) ^ ((tmp << 8) >>> 0) ^ ((tmp << 3) >>> 0) ^ ((tmp >> 4) & 0xff);
    crc &= 0xffff;
  }
  // Mix in MAVLink message crc_extra.
  let tmp = crcExtra ^ (crc & 0xff);
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  crc = ((crc >> 8) & 0xff) ^ ((tmp << 8) >>> 0) ^ ((tmp << 3) >>> 0) ^ ((tmp >> 4) & 0xff);
  return crc & 0xffff;
}

/** Build a MAVLink v2 frame for COMMAND_LONG (msg id 76). */
export function encodeCommandLong(
  systemId: number, componentId: number, sequence: number,
  command: FlightCommand
): Uint8Array {
  // COMMAND_LONG payload layout (33 bytes when full):
  //   float param1..param7 (28 bytes)
  //   uint16 command (2)
  //   uint8 target_system (1)
  //   uint8 target_component (1)
  //   uint8 confirmation (1)
  const cmdId = MAV_CMD[command.command];
  const payload = new ArrayBuffer(33);
  const dv = new DataView(payload);
  const params = [
    Number(command.params.param1 ?? 0),
    Number(command.params.param2 ?? 0),
    Number(command.params.param3 ?? 0),
    Number(command.params.param4 ?? 0),
    Number(command.params.param5 ?? 0),
    Number(command.params.param6 ?? 0),
    Number(command.params.param7 ?? 0)
  ];
  for (let i = 0; i < 7; i++) dv.setFloat32(i * 4, params[i], true);
  dv.setUint16(28, cmdId, true);
  dv.setUint8(30, command.target_system);
  dv.setUint8(31, command.target_component);
  dv.setUint8(32, 0); // confirmation = 0

  // Trim trailing zero bytes (MAVLink v2 truncation).
  const payloadBytes = new Uint8Array(payload);
  let payloadLen = payloadBytes.length;
  while (payloadLen > 1 && payloadBytes[payloadLen - 1] === 0) payloadLen--;
  const truncated = payloadBytes.slice(0, payloadLen);

  // Header (10 bytes): STX, len, incompat_flags, compat_flags, seq, sysid, compid, msgid(3)
  const header = new Uint8Array(10);
  header[0] = MAVLINK_V2_STX;
  header[1] = payloadLen;
  header[2] = 0; // incompat
  header[3] = 0; // compat
  header[4] = sequence & 0xff;
  header[5] = systemId;
  header[6] = componentId;
  header[7] = 76 & 0xff;             // msg id low
  header[8] = (76 >> 8) & 0xff;      // msg id mid
  header[9] = (76 >> 16) & 0xff;     // msg id high

  // MAVLink CRC over (header[1..end], payload), with crc_extra for msg 76 = 152.
  const crcInput = new Uint8Array(header.length - 1 + truncated.length);
  crcInput.set(header.subarray(1), 0);
  crcInput.set(truncated, header.length - 1);
  const crc = mavlinkCrc(crcInput, 152);
  const crcBuf = new Uint8Array(2);
  crcBuf[0] = crc & 0xff;
  crcBuf[1] = (crc >> 8) & 0xff;

  const frame = new Uint8Array(header.length + truncated.length + 2);
  frame.set(header, 0);
  frame.set(truncated, header.length);
  frame.set(crcBuf, header.length + truncated.length);
  return frame;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function stableStringify(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + (o as unknown[]).map((x) => stableStringify(x)).join(",") + "]";
  const obj = o as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// ---------------------------------------------------------------------------
// Demonstration transport (no socket)
// ---------------------------------------------------------------------------

export class DemonstrationFlightControlTransport implements FlightControlTransport {
  readonly id = "px4-mavlink-demonstration";
  readonly production_validated = false;
  private seq = 0;
  private readonly clock: () => string;
  /** What WOULD have been sent. Exposed for tests. */
  readonly emitted: Array<{ command: FlightCommand; bytes: Uint8Array }> = [];

  constructor(opts?: { clock?: () => string }) {
    this.clock = opts?.clock ?? (() => new Date().toISOString());
  }

  async emit(command: FlightCommand, authz: FlightAuthorization): Promise<FlightSubmissionOutcome> {
    if (!authz.permitted_commands.includes(command.command)) {
      return { ok: false, refusal: { code: "COMMAND_OUTSIDE_AUTHZ", detail: `command ${command.command} not in authz.permitted_commands` } };
    }
    this.seq = (this.seq + 1) & 0xff;
    const frame = encodeCommandLong(authz.aircraft_id.length, 1, this.seq, command);
    this.emitted.push({ command, bytes: frame });
    const partial = {
      receipt_id: `flightrcpt-${this.seq.toString().padStart(6, "0")}`,
      aircraft_id: authz.aircraft_id,
      command: command.command,
      bytes_emitted_b64: bytesToB64(frame),
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: this.clock(),
      transport: this.id,
      production_validated: this.production_validated
    };
    const receipt: FlightSubmissionReceipt = { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) };
    return { ok: true, receipt };
  }
}

// ---------------------------------------------------------------------------
// UDP MAVLink transport (for PX4 SITL on udpin:14540 or similar)
// ---------------------------------------------------------------------------

export interface MavlinkUdpTransportOptions {
  /** PX4 SITL or autopilot UDP endpoint, e.g. { host: "127.0.0.1", port: 14540 }. */
  remote: { host: string; port: number };
  /** Local UDP bind. Default: 0.0.0.0:0 (ephemeral). */
  local?: { host?: string; port?: number };
  /** MAVLink system id this transport uses for outgoing frames. */
  systemId: number;
  /** MAVLink component id. */
  componentId: number;
  /** Promote this transport to production_validated. ONLY set after counsel
   *  + range/operator sign-off; the orchestrator otherwise refuses to ship
   *  receipts into a real evidence bundle. */
  productionValidated?: boolean;
}

export class MavlinkUdpTransport implements FlightControlTransport {
  readonly id = "px4-mavlink-udp";
  readonly production_validated: boolean;
  private readonly remote: { host: string; port: number };
  private readonly systemId: number;
  private readonly componentId: number;
  private seq = 0;
  private socket: Socket | null = null;
  private opened = false;

  constructor(opts: MavlinkUdpTransportOptions) {
    this.remote = opts.remote;
    this.systemId = opts.systemId;
    this.componentId = opts.componentId;
    this.production_validated = opts.productionValidated ?? false;
  }

  private async openIfNeeded(): Promise<void> {
    if (this.opened) return;
    const sock = createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      sock.once("error", reject);
      sock.bind(0, () => resolve());
    });
    this.socket = sock;
    this.opened = true;
  }

  async emit(command: FlightCommand, authz: FlightAuthorization): Promise<FlightSubmissionOutcome> {
    if (!authz.permitted_commands.includes(command.command)) {
      return { ok: false, refusal: { code: "COMMAND_OUTSIDE_AUTHZ", detail: `command ${command.command} not in authz.permitted_commands` } };
    }
    try {
      await this.openIfNeeded();
    } catch (err) {
      return { ok: false, refusal: { code: "TRANSPORT_UNREACHABLE", detail: `failed to open UDP socket: ${(err as Error).message}` } };
    }
    this.seq = (this.seq + 1) & 0xff;
    const frame = encodeCommandLong(this.systemId, this.componentId, this.seq, command);
    try {
      await new Promise<void>((resolve, reject) => {
        this.socket!.send(Buffer.from(frame), this.remote.port, this.remote.host, (err) => err ? reject(err) : resolve());
      });
    } catch (err) {
      return { ok: false, refusal: { code: "TRANSPORT_UNREACHABLE", detail: `UDP send failed: ${(err as Error).message}` } };
    }
    const partial = {
      receipt_id: `mavrcpt-${this.seq.toString().padStart(6, "0")}`,
      aircraft_id: authz.aircraft_id,
      command: command.command,
      bytes_emitted_b64: bytesToB64(frame),
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: new Date().toISOString(),
      transport: this.id,
      production_validated: this.production_validated
    };
    const receipt: FlightSubmissionReceipt = { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) };
    return { ok: true, receipt };
  }

  async close(): Promise<void> {
    if (this.socket) await new Promise<void>((r) => this.socket!.close(() => r()));
    this.socket = null;
    this.opened = false;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator: govern a flight command before it reaches the autopilot
// ---------------------------------------------------------------------------

export interface GovernFlightCommandOptions {
  client: AristotleClient;
  wardId: string;
  subject: string;
  aircraftId: string;
  /** Optional. If omitted, defaults to `aviation.flight.<lowercased command>`. */
  actionTypeFor?: (command: FlightCommandKind) => string;
  /** Allow the demonstration transport. Defaults to false (fail-closed). */
  allowDemonstrationTransport?: boolean;
}

export interface GovernFlightCommandResult {
  ok: boolean;
  decision?: EvaluateResponse;
  outcome?: FlightSubmissionOutcome;
  refusal?: { code: string; detail: string };
}

/**
 * The governance loop:
 *
 *   1. Build a CanonicalAction from the flight command.
 *   2. Aristotle Commit Gate -> evaluate(). REFUSE / ESCALATE short-circuit.
 *   3. Build a FlightAuthorization (consumed Warrant binding action_hash).
 *   4. Orchestrator checks (transport production_validated; aircraft id;
 *      permitted_commands).
 *   5. Transport.emit() — produces FlightSubmissionReceipt with a hash that
 *      covers warrant_id + action_hash + emitted bytes.
 */
export async function governFlightCommand(
  command: FlightCommand,
  transport: FlightControlTransport,
  options: GovernFlightCommandOptions
): Promise<GovernFlightCommandResult> {
  const result = await governThroughAdapter<FlightCommand, FlightAuthorization>(command, {
    client: options.client,
    transport,
    allowDemonstrationTransport: options.allowDemonstrationTransport,
    buildAction: (operation): CanonicalAction => ({
      action_id: `flight-${options.aircraftId}-${Date.now().toString(16)}`,
      ward_id: options.wardId,
      subject: options.subject,
      action_type: options.actionTypeFor
        ? options.actionTypeFor(operation.command)
        : `aviation.flight.${operation.command.toLowerCase()}`,
      params: {
        aircraft_id: options.aircraftId,
        command: operation.command,
        target_system: operation.target_system,
        target_component: operation.target_component,
        ...operation.params
      },
      requested_at: operation.requested_at,
      telemetry: { agent_runtime: "px4-mavlink" }
    }),
    buildAuthorization: (decision, operation): FlightAuthorization => {
      const warrant = decision.warrant!;
      return {
        warrant_id: warrant.warrant_id,
        warrant_signature: (warrant.signature as string) ?? "ed25519:opaque",
        consumed: true,
        consumed_at: new Date().toISOString(),
        action_hash: decision.canonical_action_hash,
        aircraft_id: options.aircraftId,
        permitted_commands: [operation.command]
      };
    }
  });
  return {
    ok: result.ok,
    decision: result.decision,
    outcome: result.outcome as FlightSubmissionOutcome | undefined,
    refusal: result.refusal
  };
}

export { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
