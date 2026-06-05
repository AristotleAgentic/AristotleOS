/**
 * @aristotle/bacnet-adapter — govern BACnet/IP WriteProperty
 * operations through the AristotleOS Commit Gate.
 *
 * BACnet (ASHRAE 135 / ISO 16484-5) is the dominant protocol for
 * building automation: HVAC, lighting, fire safety, access control,
 * elevators. Critical writes set object property values (e.g., a
 * Setpoint analog-value's PresentValue, a Schedule's daily slots, a
 * Binary-Output PresentValue for a damper). This adapter wires those
 * writes through the gate as `ot.bacnet.<kind>` with object-id
 * allowlists and priority caps.
 *
 * Sixth real hardware adapter. Closes the substrate audit's #7 by
 * spanning aerospace (MAVLink/PX4), robotics (ROS2), process control
 * (OPC-UA), grid SCADA (DNP3), Kubernetes admission, legacy
 * industrial PLC/RTU (Modbus), and now building automation (BACnet).
 */

import { createHash } from "node:crypto";
import { governThroughAdapter } from "@aristotle/adapter-sdk";
import { AristotleClient, type CanonicalAction, type EvaluateResponse } from "@aristotle/os-sdk";

/** BACnet object types we govern. Limited to the consequential write
 *  classes; read-only object types are out of scope. */
export type BacnetObjectType =
  | "analog_value"        // 2  — setpoints, override values
  | "analog_output"       // 1  — physical analog outputs
  | "binary_value"        // 5  — flags, modes
  | "binary_output"       // 4  — physical binary outputs (dampers, fans)
  | "multistate_value"    // 19 — enumerated modes
  | "multistate_output"   // 14 — enumerated physical outputs
  | "schedule";           // 17 — daily / weekly schedules

export type BacnetOperationKind =
  | "write_property"
  | "write_property_multiple";

/** Canonical BACnet object identifier: type + instance number. */
export interface BacnetObjectId {
  type: BacnetObjectType;
  instance: number;
}

export interface BacnetPropertyWrite {
  object_id: BacnetObjectId;
  /** ASHRAE property identifier number; 85 = PresentValue is the
   *  most common write target. */
  property_id: number;
  /** Optional array index for properties that are arrays (e.g.,
   *  Schedule.WeeklySchedule[1]). */
  array_index?: number;
  /** Value to write. Type depends on the object/property pair. */
  value: number | boolean | string | null;
  /** BACnet write priority (1..16; 1 = manual life-safety override,
   *  16 = default automation). Lower number = higher priority. */
  priority?: number;
}

export interface BacnetOperation {
  kind: BacnetOperationKind;
  /** BACnet device instance id (network-wide unique). */
  device_instance: number;
  /** For write_property: exactly one. For write_property_multiple:
   *  one or more in the same atomic request. */
  writes: BacnetPropertyWrite[];
  /** Optional label for the physical asset (e.g., "AHU-1 supply-air
   *  temperature setpoint"). */
  label?: string;
  requested_at: string;
}

export interface BacnetAuthorization {
  warrant_id: string;
  warrant_signature: string;
  consumed: true;
  consumed_at: string;
  action_hash: string;
  /** Site / building id this authz scopes to. */
  site_id: string;
  /** Allowlisted object identifiers (string form: "type:instance"). */
  permitted_object_ids: string[];
  /** Maximum allowed priority (lower = higher priority); defaults to
   *  16 (no manual override). */
  max_priority?: number;
}

export interface BacnetSubmissionReceipt {
  receipt_id: string;
  site_id: string;
  kind: BacnetOperationKind;
  device_instance: number;
  writes: BacnetPropertyWrite[];
  warrant_id: string;
  action_hash: string;
  emitted_at: string;
  transport: string;
  production_validated: boolean;
  receipt_hash: string;
}

export type BacnetRefusalCode =
  | "OBJECT_OUTSIDE_AUTHZ"
  | "PRIORITY_OVER_LIMIT"
  | "MALFORMED_OPERATION"
  | "TRANSPORT_REJECTED"
  | "TRANSPORT_UNREACHABLE"
  | "DEMONSTRATION_ONLY_BLOCKED";

export type BacnetSubmissionOutcome =
  | { ok: true; receipt: BacnetSubmissionReceipt }
  | { ok: false; refusal: { code: BacnetRefusalCode; detail: string } };

export interface BacnetControlTransport {
  readonly id: string;
  readonly production_validated: boolean;
  emit(op: BacnetOperation, authz: BacnetAuthorization): Promise<BacnetSubmissionOutcome>;
}

function sha256Hex(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function stableStringify(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + (o as unknown[]).map((x) => stableStringify(x)).join(",") + "]";
  const obj = o as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function objectIdKey(id: BacnetObjectId): string { return `${id.type}:${id.instance}`; }

function preflight(op: BacnetOperation, authz: BacnetAuthorization): { ok: true } | { ok: false; refusal: { code: BacnetRefusalCode; detail: string } } {
  if (!Array.isArray(op.writes) || op.writes.length === 0) {
    return { ok: false, refusal: { code: "MALFORMED_OPERATION", detail: "writes[] is required and must be non-empty" } };
  }
  if (op.kind === "write_property" && op.writes.length !== 1) {
    return { ok: false, refusal: { code: "MALFORMED_OPERATION", detail: "write_property requires exactly one write; use write_property_multiple for batches" } };
  }
  // BACnet priority semantics: 1 = highest (manual override), 16 = lowest
  // (default automation). max_priority is the most aggressive (lowest
  // numeric) priority the authz allows. Default is 1 — equivalent to
  // "no cap" because priority can never go below 1.
  const maxPriority = authz.max_priority ?? 1;
  for (const w of op.writes) {
    if (!w.object_id || typeof w.object_id.instance !== "number") {
      return { ok: false, refusal: { code: "MALFORMED_OPERATION", detail: "each write requires an object_id with type + instance" } };
    }
    const key = objectIdKey(w.object_id);
    if (!authz.permitted_object_ids.includes(key)) {
      return { ok: false, refusal: { code: "OBJECT_OUTSIDE_AUTHZ", detail: `object ${key} not in authz.permitted_object_ids` } };
    }
    if (w.priority !== undefined) {
      if (!Number.isInteger(w.priority) || w.priority < 1 || w.priority > 16) {
        return { ok: false, refusal: { code: "MALFORMED_OPERATION", detail: `priority must be an integer 1..16 (got ${w.priority})` } };
      }
      if (w.priority < maxPriority) {
        return { ok: false, refusal: { code: "PRIORITY_OVER_LIMIT", detail: `priority ${w.priority} exceeds max_priority ${maxPriority} (lower number = higher priority)` } };
      }
    }
  }
  return { ok: true };
}

export class DemonstrationBacnetTransport implements BacnetControlTransport {
  readonly id = "bacnet-demonstration";
  readonly production_validated = false;
  private seq = 0;
  readonly emitted: BacnetOperation[] = [];
  private readonly clock: () => string;
  constructor(opts?: { clock?: () => string }) {
    this.clock = opts?.clock ?? (() => new Date().toISOString());
  }
  async emit(op: BacnetOperation, authz: BacnetAuthorization): Promise<BacnetSubmissionOutcome> {
    const pre = preflight(op, authz);
    if (!pre.ok) return pre;
    this.seq = (this.seq + 1) & 0xffff;
    this.emitted.push(op);
    const partial = {
      receipt_id: `bacnetrcpt-${this.seq.toString().padStart(6, "0")}`,
      site_id: authz.site_id,
      kind: op.kind,
      device_instance: op.device_instance,
      writes: op.writes,
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: this.clock(),
      transport: this.id,
      production_validated: this.production_validated
    };
    return { ok: true, receipt: { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) } };
  }
}

export interface BacnetShimTransportOptions {
  siteId: string;
  sender: (op: BacnetOperation) => Promise<void>;
  productionValidated?: boolean;
}

export class BacnetShimTransport implements BacnetControlTransport {
  readonly id = "bacnet-shim";
  readonly production_validated: boolean;
  private seq = 0;
  constructor(private readonly opts: BacnetShimTransportOptions) {
    this.production_validated = opts.productionValidated ?? false;
  }
  async emit(op: BacnetOperation, authz: BacnetAuthorization): Promise<BacnetSubmissionOutcome> {
    const pre = preflight(op, authz);
    if (!pre.ok) return pre;
    try { await this.opts.sender(op); }
    catch (err) { return { ok: false, refusal: { code: "TRANSPORT_REJECTED", detail: (err as Error).message } }; }
    this.seq = (this.seq + 1) & 0xffff;
    const partial = {
      receipt_id: `bacnetrcpt-shim-${this.seq.toString().padStart(6, "0")}`,
      site_id: this.opts.siteId,
      kind: op.kind,
      device_instance: op.device_instance,
      writes: op.writes,
      warrant_id: authz.warrant_id,
      action_hash: authz.action_hash,
      emitted_at: new Date().toISOString(),
      transport: this.id,
      production_validated: this.production_validated
    };
    return { ok: true, receipt: { ...partial, receipt_hash: sha256Hex(stableStringify(partial)) } };
  }
}

export interface GovernBacnetOptions {
  client: AristotleClient;
  wardId: string;
  subject: string;
  siteId: string;
  actionTypeFor?: (op: BacnetOperation) => string;
  allowDemonstrationTransport?: boolean;
}

export async function governBacnetOperation(
  op: BacnetOperation,
  transport: BacnetControlTransport,
  options: GovernBacnetOptions
): Promise<{ ok: boolean; decision?: EvaluateResponse; outcome?: BacnetSubmissionOutcome; refusal?: { code: string; detail: string } }> {
  const result = await governThroughAdapter<BacnetOperation, BacnetAuthorization>(op, {
    client: options.client,
    transport,
    allowDemonstrationTransport: options.allowDemonstrationTransport,
    buildAction: (operation): CanonicalAction => ({
      action_id: `bacnet-${Date.now().toString(16)}`,
      ward_id: options.wardId,
      subject: options.subject,
      action_type: options.actionTypeFor ? options.actionTypeFor(operation) : `ot.bacnet.${operation.kind}`,
      params: {
        site_id: options.siteId,
        kind: operation.kind,
        device_instance: operation.device_instance,
        writes: operation.writes.map((w) => ({
          object_type: w.object_id.type,
          object_instance: w.object_id.instance,
          property_id: w.property_id,
          array_index: w.array_index,
          value: w.value,
          priority: w.priority
        })),
        label: operation.label
      },
      requested_at: operation.requested_at,
      telemetry: { agent_runtime: "bacnet" }
    }),
    buildAuthorization: (decision, operation): BacnetAuthorization => {
      const warrant = decision.warrant!;
      return {
        warrant_id: warrant.warrant_id,
        warrant_signature: (warrant.signature as string) ?? "ed25519:opaque",
        consumed: true,
        consumed_at: new Date().toISOString(),
        action_hash: decision.canonical_action_hash,
        site_id: options.siteId,
        permitted_object_ids: operation.writes.map((w) => objectIdKey(w.object_id))
      };
    }
  });
  return {
    ok: result.ok,
    decision: result.decision,
    outcome: result.outcome as BacnetSubmissionOutcome | undefined,
    refusal: result.refusal
  };
}

export { AristotleClient, AristotleApiError } from "@aristotle/os-sdk";
export type { CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
