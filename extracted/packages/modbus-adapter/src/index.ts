/**
 * @aristotle/modbus-adapter — govern Modbus TCP register and coil
 * writes through the AristotleOS Commit Gate.
 *
 * Modbus is the dominant legacy protocol for PLC / RTU communication
 * in factories, water treatment, building automation, pipelines, and
 * many industrial-control sites. Two write operation classes account
 * for most consequence:
 *
 *   - WRITE_SINGLE_REGISTER (FC 6)    set one holding register
 *   - WRITE_MULTIPLE_REGISTERS (FC 16) set a range
 *   - WRITE_SINGLE_COIL (FC 5)         set one coil (binary)
 *   - WRITE_MULTIPLE_COILS (FC 15)     set a range
 *
 * The adapter wires each operation through the gate as
 * `ot.modbus.<kind>` and refuses register/coil addresses outside the
 * Warrant's allowlist before any bytes hit the wire. Same shape as
 * the MAVLink / ROS2 / OPC-UA / DNP3 adapters.
 */

import { createHash } from "node:crypto";
import { governThroughAdapter } from "@aristotle/adapter-sdk";
import { AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

export type ModbusOperationKind =
  | "write_single_register"
  | "write_multiple_registers"
  | "write_single_coil"
  | "write_multiple_coils";

export interface ModbusOperation {
  kind: ModbusOperationKind;
  /** Modbus unit / slave id (1..247 typical; some gateways extend). */
  unit_id: number;
  /** First register / coil address (0-based on the wire). */
  start_address: number;
  /** For register writes: 16-bit unsigned values, one per register. */
  values?: number[];
  /** For coil writes: booleans, one per coil. */
  coils?: boolean[];
  /** Optional human-readable label for the address (e.g.,
   *  "Pump-A start command", "Tank-3 setpoint"). */
  label?: string;
  requested_at: string;
}

export interface ModbusAuthorization {
  warrant_id: string;
  warrant_signature: string;
  consumed: true;
  consumed_at: string;
  action_hash: string;
  /** Plant / endpoint id this authz scopes to. */
  device_id: string;
  /** Allowlisted register addresses (applies to register kinds). */
  permitted_register_addresses?: number[];
  /** Allowlisted coil addresses (applies to coil kinds). */
  permitted_coil_addresses?: number[];
  /** Optional per-register / per-coil value caps. Keyed by address. */
  max_register_value?: Record<number, number>;
}

export interface ModbusSubmissionReceipt {
  receipt_id: string;
  device_id: string;
  kind: ModbusOperationKind;
  unit_id: number;
  start_address: number;
  values?: number[];
  coils?: boolean[];
  warrant_id: string;
  action_hash: string;
  emitted_at: string;
  transport: string;
  production_validated: boolean;
  receipt_hash: string;
}

export type ModbusRefusalCode =
  | "ADDRESS_OUTSIDE_AUTHZ"
  | "VALUE_OVER_LIMIT"
  | "MALFORMED_OPERATION"
  | "TRANSPORT_REJECTED"
  | "TRANSPORT_UNREACHABLE"
  | "DEMONSTRATION_ONLY_BLOCKED";

export type ModbusSubmissionOutcome =
  | { ok: true; receipt: ModbusSubmissionReceipt }
  | { ok: false; refusal: { code: ModbusRefusalCode; detail: string } };

export interface ModbusControlTransport {
  readonly id: string;
  readonly production_validated: boolean;
  emit(op: ModbusOperation, authz: ModbusAuthorization): Promise<ModbusSubmissionOutcome>;
}

function sha256Hex(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function stableStringify(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + (o as unknown[]).map((x) => stableStringify(x)).join(",") + "]";
  const obj = o as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function isRegisterKind(k: ModbusOperationKind): boolean {
  return k === "write_single_register" || k === "write_multiple_registers";
}
function isCoilKind(k: ModbusOperationKind): boolean {
  return k === "write_single_coil" || k === "write_multiple_coils";
}

function addressesTouched(op: ModbusOperation): number[] {
  if (isRegisterKind(op.kind)) {
    const count = op.values?.length ?? 0;
    return Array.from({ length: count }, (_, i) => op.start_address + i);
  }
  if (isCoilKind(op.kind)) {
    const count = op.coils?.length ?? 0;
    return Array.from({ length: count }, (_, i) => op.start_address + i);
  }
  return [];
}

function preflight(op: ModbusOperation, authz: ModbusAuthorization): { ok: true } | { ok: false; refusal: { code: ModbusRefusalCode; detail: string } } {
  // Shape checks
  if (isRegisterKind(op.kind)) {
    if (!Array.isArray(op.values) || op.values.length === 0) {
      return { ok: false, refusal: { code: "MALFORMED_OPERATION", detail: "register write requires non-empty values[]" } };
    }
    if (op.values.some((v) => !Number.isInteger(v) || v < 0 || v > 0xffff)) {
      return { ok: false, refusal: { code: "MALFORMED_OPERATION", detail: "register values must be 16-bit unsigned integers" } };
    }
  }
  if (isCoilKind(op.kind)) {
    if (!Array.isArray(op.coils) || op.coils.length === 0) {
      return { ok: false, refusal: { code: "MALFORMED_OPERATION", detail: "coil write requires non-empty coils[]" } };
    }
  }
  // Address allowlist
  const touched = addressesTouched(op);
  if (isRegisterKind(op.kind)) {
    const allow = authz.permitted_register_addresses ?? [];
    const out = touched.find((a) => !allow.includes(a));
    if (out !== undefined) return { ok: false, refusal: { code: "ADDRESS_OUTSIDE_AUTHZ", detail: `register address ${out} not in authz.permitted_register_addresses` } };
  } else if (isCoilKind(op.kind)) {
    const allow = authz.permitted_coil_addresses ?? [];
    const out = touched.find((a) => !allow.includes(a));
    if (out !== undefined) return { ok: false, refusal: { code: "ADDRESS_OUTSIDE_AUTHZ", detail: `coil address ${out} not in authz.permitted_coil_addresses` } };
  }
  // Per-address value caps
  if (isRegisterKind(op.kind) && authz.max_register_value && op.values) {
    for (let i = 0; i < op.values.length; i++) {
      const addr = op.start_address + i;
      const cap = authz.max_register_value[addr];
      if (cap !== undefined && op.values[i] > cap) {
        return { ok: false, refusal: { code: "VALUE_OVER_LIMIT", detail: `register ${addr} value ${op.values[i]} exceeds cap ${cap}` } };
      }
    }
  }
  return { ok: true };
}

export class DemonstrationModbusTransport implements ModbusControlTransport {
  readonly id = "modbus-demonstration";
  readonly production_validated = false;
  private seq = 0;
  readonly emitted: ModbusOperation[] = [];
  private readonly clock: () => string;
  constructor(opts?: { clock?: () => string }) {
    this.clock = opts?.clock ?? (() => new Date().toISOString());
  }
  async emit(op: ModbusOperation, authz: ModbusAuthorization): Promise<ModbusSubmissionOutcome> {
    const pre = preflight(op, authz);
    if (!pre.ok) return pre;
    this.seq = (this.seq + 1) & 0xffff;
    this.emitted.push(op);
    const partial = {
      receipt_id: `modbusrcpt-${this.seq.toString().padStart(6, "0")}`,
      device_id: authz.device_id,
      kind: op.kind,
      unit_id: op.unit_id,
      start_address: op.start_address,
      values: op.values,
      coils: op.coils,
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: this.clock(),
      transport: this.id,
      production_validated: this.production_validated
    };
    return { ok: true, receipt: { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) } };
  }
}

/** Shim transport delegating to a caller-provided Modbus client (e.g.,
 *  jsmodbus / modbus-serial / pymodbus over a JS-bridge). */
export interface ModbusShimTransportOptions {
  deviceId: string;
  sender: (op: ModbusOperation) => Promise<void>;
  productionValidated?: boolean;
}

export class ModbusShimTransport implements ModbusControlTransport {
  readonly id = "modbus-shim";
  readonly production_validated: boolean;
  private seq = 0;
  constructor(private readonly opts: ModbusShimTransportOptions) {
    this.production_validated = opts.productionValidated ?? false;
  }
  async emit(op: ModbusOperation, authz: ModbusAuthorization): Promise<ModbusSubmissionOutcome> {
    const pre = preflight(op, authz);
    if (!pre.ok) return pre;
    try { await this.opts.sender(op); }
    catch (err) { return { ok: false, refusal: { code: "TRANSPORT_REJECTED", detail: (err as Error).message } }; }
    this.seq = (this.seq + 1) & 0xffff;
    const partial = {
      receipt_id: `modbusrcpt-shim-${this.seq.toString().padStart(6, "0")}`,
      device_id: this.opts.deviceId,
      kind: op.kind,
      unit_id: op.unit_id,
      start_address: op.start_address,
      values: op.values,
      coils: op.coils,
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: new Date().toISOString(),
      transport: this.id,
      production_validated: this.production_validated
    };
    return { ok: true, receipt: { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) } };
  }
}

export interface GovernModbusOptions {
  client: AristotleClient;
  wardId: string;
  subject: string;
  deviceId: string;
  actionTypeFor?: (op: ModbusOperation) => string;
  allowDemonstrationTransport?: boolean;
}

/**
 * Govern a Modbus operation.
 *
 * Implementation note: this function delegates to
 * `governThroughAdapter` from @aristotle/adapter-sdk so its behavior
 * stays in lockstep with the generic adapter contract. The public API
 * (function name, options shape, return shape) is unchanged from the
 * pre-migration version; existing callers see no difference.
 *
 * Modbus-specific bits live in the two callbacks:
 *   - buildAction:        produces the CanonicalAction the gate evaluates
 *   - buildAuthorization: derives permitted_register_addresses /
 *                         permitted_coil_addresses from the operation
 *
 * Everything else (gate call, ALLOW check, MISSING_WARRANT guard,
 * production_validated transport guard, transport.emit, structured
 * refusal codes) is the SDK pattern. Reference example for
 * third-party adapter authors: this is what migrating from a
 * hand-rolled govern*() to governThroughAdapter looks like.
 */
export async function governModbusOperation(
  op: ModbusOperation,
  transport: ModbusControlTransport,
  options: GovernModbusOptions
): Promise<{ ok: boolean; decision?: EvaluateResponse; outcome?: ModbusSubmissionOutcome; refusal?: { code: string; detail: string } }> {
  const result = await governThroughAdapter<ModbusOperation, ModbusAuthorization>(op, {
    client: options.client,
    transport,
    allowDemonstrationTransport: options.allowDemonstrationTransport,
    buildAction: (operation): CanonicalAction => ({
      action_id: `modbus-${Date.now().toString(16)}`,
      ward_id: options.wardId,
      subject: options.subject,
      action_type: options.actionTypeFor ? options.actionTypeFor(operation) : `ot.modbus.${operation.kind}`,
      params: {
        device_id: options.deviceId,
        kind: operation.kind,
        unit_id: operation.unit_id,
        start_address: operation.start_address,
        values: operation.values,
        coils: operation.coils,
        label: operation.label
      },
      requested_at: operation.requested_at,
      telemetry: { agent_runtime: "modbus" }
    }),
    buildAuthorization: (decision, operation): ModbusAuthorization => {
      const warrant = decision.warrant!;
      return {
        warrant_id: warrant.warrant_id,
        warrant_signature: (warrant.signature as string) ?? "ed25519:opaque",
        consumed: true,
        consumed_at: new Date().toISOString(),
        action_hash: decision.canonical_action_hash,
        device_id: options.deviceId,
        permitted_register_addresses: isRegisterKind(operation.kind) ? addressesTouched(operation) : undefined,
        permitted_coil_addresses: isCoilKind(operation.kind) ? addressesTouched(operation) : undefined
      };
    }
  });
  // Narrow the SDK's generic AdapterEmitOutcome back to the
  // adapter-specific ModbusSubmissionOutcome for callers who depend
  // on the strong return type.
  return {
    ok: result.ok,
    decision: result.decision,
    outcome: result.outcome as ModbusSubmissionOutcome | undefined,
    refusal: result.refusal
  };
}

export { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
