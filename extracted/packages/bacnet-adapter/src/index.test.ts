import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import {
  DemonstrationBacnetTransport,
  BacnetShimTransport,
  governBacnetOperation,
  type BacnetAuthorization,
  type BacnetOperation
} from "./index.js";

function mockFetch(h: (req: { url: string; body?: string }) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; body?: string }> = [];
  const fn = (async (url: string, init: { method?: string; body?: string } = {}) => {
    const r = { url, body: init.body };
    calls.push(r);
    const { status, body } = h(r);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const AUTHZ: BacnetAuthorization = {
  warrant_id: "warrant:demo", warrant_signature: "ed25519:demo",
  consumed: true, consumed_at: "2026-05-26T15:00:00.500Z",
  action_hash: "sha256:demo",
  site_id: "building:hq-east",
  permitted_object_ids: ["analog_value:101", "binary_output:5"],
  max_priority: 8
};

const SETPOINT: BacnetOperation = {
  kind: "write_property",
  device_instance: 1234,
  writes: [{
    object_id: { type: "analog_value", instance: 101 },
    property_id: 85, value: 72.5, priority: 10
  }],
  label: "AHU-1 supply-air-temp setpoint",
  requested_at: "2026-05-26T15:00:00.000Z"
};

const BOOL_OP: BacnetOperation = {
  kind: "write_property",
  device_instance: 1234,
  writes: [{
    object_id: { type: "binary_output", instance: 5 },
    property_id: 85, value: true, priority: 12
  }],
  requested_at: "2026-05-26T15:00:00.000Z"
};

const ALLOW = { decision: "ALLOW", reason_codes: [], canonical_action_hash: "sha256:bound", warrant: { warrant_id: "warrant:from-gate" }, gel_record: { record_id: "r", record_hash: "rh" } };

test("DemonstrationBacnetTransport emits hash-bound receipt for analog setpoint", async () => {
  const t = new DemonstrationBacnetTransport({ clock: () => "2026-05-26T15:00:01.000Z" });
  const out = await t.emit(SETPOINT, AUTHZ);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.receipt.kind, "write_property");
    assert.equal(out.receipt.device_instance, 1234);
    assert.equal(out.receipt.writes[0].value, 72.5);
    assert.equal(out.receipt.production_validated, false);
    assert.equal(out.receipt.receipt_hash.length, 64);
  }
});

test("DemonstrationBacnetTransport emits for binary output", async () => {
  const t = new DemonstrationBacnetTransport();
  const out = await t.emit(BOOL_OP, AUTHZ);
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.receipt.writes[0].value, true);
});

test("transport REFUSES object ids outside authz.permitted_object_ids", async () => {
  const t = new DemonstrationBacnetTransport();
  const evil: BacnetOperation = {
    ...SETPOINT,
    writes: [{ ...SETPOINT.writes[0], object_id: { type: "binary_output", instance: 99 } }]
  };
  const out = await t.emit(evil, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "OBJECT_OUTSIDE_AUTHZ");
});

test("transport REFUSES priority above the authz cap (lower number = higher priority)", async () => {
  const t = new DemonstrationBacnetTransport();
  // Authz max_priority is 8. priority=4 is HIGHER priority -> refused.
  const tooHigh: BacnetOperation = {
    ...SETPOINT,
    writes: [{ ...SETPOINT.writes[0], priority: 4 }]
  };
  const out = await t.emit(tooHigh, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "PRIORITY_OVER_LIMIT");
});

test("transport REFUSES priority outside the 1..16 range", async () => {
  const t = new DemonstrationBacnetTransport();
  const bad: BacnetOperation = {
    ...SETPOINT,
    writes: [{ ...SETPOINT.writes[0], priority: 99 }]
  };
  const out = await t.emit(bad, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "MALFORMED_OPERATION");
});

test("transport REFUSES write_property with multiple writes (use write_property_multiple)", async () => {
  const t = new DemonstrationBacnetTransport();
  const bad: BacnetOperation = {
    kind: "write_property",
    device_instance: 1234,
    writes: [SETPOINT.writes[0], BOOL_OP.writes[0]],
    requested_at: SETPOINT.requested_at
  };
  const out = await t.emit(bad, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "MALFORMED_OPERATION");
});

test("write_property_multiple: every object id must be in the allowlist", async () => {
  const t = new DemonstrationBacnetTransport();
  const op: BacnetOperation = {
    kind: "write_property_multiple",
    device_instance: 1234,
    writes: [
      { object_id: { type: "analog_value", instance: 101 }, property_id: 85, value: 72.5, priority: 10 },
      { object_id: { type: "binary_output", instance: 5 }, property_id: 85, value: true, priority: 12 }
    ],
    requested_at: "2026-05-26T15:00:00.000Z"
  };
  const out = await t.emit(op, AUTHZ);
  assert.equal(out.ok, true);
});

test("BacnetShimTransport delegates to the provided sender", async () => {
  const sent: BacnetOperation[] = [];
  const t = new BacnetShimTransport({ siteId: "building:hq-east", sender: async (op) => { sent.push(op); } });
  const out = await t.emit(SETPOINT, AUTHZ);
  assert.equal(out.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].writes[0].value, 72.5);
});

test("BacnetShimTransport: sender error -> TRANSPORT_REJECTED", async () => {
  const t = new BacnetShimTransport({ siteId: "building:hq-east", sender: async () => { throw new Error("BACNET_RESERVED_BUFFER_FAILED"); } });
  const out = await t.emit(SETPOINT, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "TRANSPORT_REJECTED");
});

test("governBacnetOperation: ALLOW path emits with action_type=ot.bacnet.write_property", async () => {
  let body = "";
  const { fn } = mockFetch((req) => { body = req.body ?? ""; return { status: 200, body: ALLOW }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationBacnetTransport();
  const result = await governBacnetOperation(SETPOINT, t, {
    client, wardId: "ward-bldg", subject: "agent:bms-controller",
    siteId: "building:hq-east", allowDemonstrationTransport: true
  });
  assert.equal(result.ok, true);
  assert.match(body, /"action_type":"ot\.bacnet\.write_property"/);
  assert.equal(t.emitted.length, 1);
});

test("governBacnetOperation: REFUSE skips the transport", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED"], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } } }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationBacnetTransport();
  const result = await governBacnetOperation(SETPOINT, t, { client, wardId: "w", subject: "s", siteId: "b", allowDemonstrationTransport: true });
  assert.equal(result.ok, false);
  assert.equal(t.emitted.length, 0);
});

test("governBacnetOperation: demo-only block without opt-in", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationBacnetTransport();
  const result = await governBacnetOperation(SETPOINT, t, { client, wardId: "w", subject: "s", siteId: "b" });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "DEMONSTRATION_ONLY_BLOCKED");
});

test("governBacnetOperation: permitted_object_ids derived from the operation's writes", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  let capturedAuthz: BacnetAuthorization | undefined;
  const capturingTransport = {
    id: "capture", production_validated: true,
    async emit(_op: BacnetOperation, authz: BacnetAuthorization) {
      capturedAuthz = authz;
      return {
        ok: true as const,
        receipt: { receipt_id: "x", site_id: authz.site_id, kind: _op.kind, device_instance: _op.device_instance, writes: _op.writes, warrant_id: authz.warrant_id, action_hash: authz.action_hash, emitted_at: "now", transport: "capture", production_validated: true, receipt_hash: "0".repeat(64) }
      };
    }
  };
  const op: BacnetOperation = {
    kind: "write_property_multiple",
    device_instance: 1234,
    writes: [
      { object_id: { type: "analog_value", instance: 101 }, property_id: 85, value: 72.5 },
      { object_id: { type: "binary_output", instance: 5 }, property_id: 85, value: true }
    ],
    requested_at: "2026-05-26T15:00:00.000Z"
  };
  const result = await governBacnetOperation(op, capturingTransport, { client, wardId: "w", subject: "s", siteId: "b" });
  assert.equal(result.ok, true);
  assert.deepEqual(capturedAuthz?.permitted_object_ids?.sort(), ["analog_value:101", "binary_output:5"]);
});
