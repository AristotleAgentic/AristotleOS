import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import {
  DemonstrationModbusTransport,
  ModbusShimTransport,
  governModbusOperation,
  type ModbusAuthorization,
  type ModbusOperation
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

const AUTHZ_REG: ModbusAuthorization = {
  warrant_id: "warrant:demo", warrant_signature: "ed25519:demo",
  consumed: true, consumed_at: "2026-05-26T15:00:00.500Z",
  action_hash: "sha256:demo",
  device_id: "plc:plant-1",
  permitted_register_addresses: [40001, 40002, 40003],
  max_register_value: { 40001: 100 }
};

const AUTHZ_COIL: ModbusAuthorization = {
  warrant_id: "warrant:demo", warrant_signature: "ed25519:demo",
  consumed: true, consumed_at: "2026-05-26T15:00:00.500Z",
  action_hash: "sha256:demo",
  device_id: "plc:plant-1",
  permitted_coil_addresses: [101, 102]
};

const REG_OP: ModbusOperation = {
  kind: "write_single_register",
  unit_id: 1, start_address: 40001, values: [42],
  label: "Tank-1 setpoint", requested_at: "2026-05-26T15:00:00.000Z"
};

const COIL_OP: ModbusOperation = {
  kind: "write_single_coil",
  unit_id: 1, start_address: 101, coils: [true],
  label: "Pump-A start", requested_at: "2026-05-26T15:00:00.000Z"
};

const ALLOW = { decision: "ALLOW", reason_codes: [], canonical_action_hash: "sha256:bound", warrant: { warrant_id: "warrant:from-gate" }, gel_record: { record_id: "r", record_hash: "rh" } };

test("DemonstrationModbusTransport emits hash-bound receipt for register write", async () => {
  const t = new DemonstrationModbusTransport({ clock: () => "2026-05-26T15:00:01.000Z" });
  const out = await t.emit(REG_OP, AUTHZ_REG);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.receipt.kind, "write_single_register");
    assert.equal(out.receipt.start_address, 40001);
    assert.deepEqual(out.receipt.values, [42]);
    assert.equal(out.receipt.production_validated, false);
    assert.equal(out.receipt.receipt_hash.length, 64);
  }
});

test("DemonstrationModbusTransport emits for coil write", async () => {
  const t = new DemonstrationModbusTransport();
  const out = await t.emit(COIL_OP, AUTHZ_COIL);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.receipt.kind, "write_single_coil");
    assert.deepEqual(out.receipt.coils, [true]);
  }
});

test("transport REFUSES register addresses outside authz", async () => {
  const t = new DemonstrationModbusTransport();
  const out = await t.emit({ ...REG_OP, start_address: 49999 }, AUTHZ_REG);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "ADDRESS_OUTSIDE_AUTHZ");
});

test("transport REFUSES coil addresses outside authz", async () => {
  const t = new DemonstrationModbusTransport();
  const out = await t.emit({ ...COIL_OP, start_address: 999 }, AUTHZ_COIL);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "ADDRESS_OUTSIDE_AUTHZ");
});

test("transport REFUSES values over per-address cap", async () => {
  const t = new DemonstrationModbusTransport();
  // Cap is 100 on register 40001; value 200 exceeds.
  const out = await t.emit({ ...REG_OP, values: [200] }, AUTHZ_REG);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "VALUE_OVER_LIMIT");
});

test("transport REFUSES malformed register writes (out-of-range value)", async () => {
  const t = new DemonstrationModbusTransport();
  const out = await t.emit({ ...REG_OP, values: [70000] }, AUTHZ_REG);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "MALFORMED_OPERATION");
});

test("transport REFUSES register write with empty values[]", async () => {
  const t = new DemonstrationModbusTransport();
  const out = await t.emit({ ...REG_OP, values: [] }, AUTHZ_REG);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "MALFORMED_OPERATION");
});

test("write_multiple_registers: every address must be in the allowlist", async () => {
  const t = new DemonstrationModbusTransport();
  // 40001 + 40002 allowed; 40009 not.
  const out = await t.emit({
    kind: "write_multiple_registers",
    unit_id: 1, start_address: 40001, values: [10, 20, 30, 40, 50, 60, 70, 80, 90],
    requested_at: "2026-05-26T15:00:00.000Z"
  }, AUTHZ_REG);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "ADDRESS_OUTSIDE_AUTHZ");
});

test("ModbusShimTransport delegates to the provided sender", async () => {
  const sent: ModbusOperation[] = [];
  const t = new ModbusShimTransport({ deviceId: "plc:plant-1", sender: async (op) => { sent.push(op); } });
  const out = await t.emit(REG_OP, AUTHZ_REG);
  assert.equal(out.ok, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].values, [42]);
});

test("ModbusShimTransport: sender error -> TRANSPORT_REJECTED", async () => {
  const t = new ModbusShimTransport({ deviceId: "plc:plant-1", sender: async () => { throw new Error("MODBUS_EXCEPTION_GATEWAY_TARGET_FAILED_TO_RESPOND"); } });
  const out = await t.emit(REG_OP, AUTHZ_REG);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "TRANSPORT_REJECTED");
});

test("governModbusOperation: ALLOW path emits with action_type=ot.modbus.write_single_register", async () => {
  let body = "";
  const { fn } = mockFetch((req) => { body = req.body ?? ""; return { status: 200, body: ALLOW }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationModbusTransport();
  const result = await governModbusOperation(REG_OP, t, {
    client, wardId: "ward-plant", subject: "agent:scada-controller",
    deviceId: "plc:plant-1", allowDemonstrationTransport: true
  });
  assert.equal(result.ok, true);
  assert.match(body, /"action_type":"ot\.modbus\.write_single_register"/);
  assert.equal(t.emitted.length, 1);
});

test("governModbusOperation: REFUSE skips the transport", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED"], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } } }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationModbusTransport();
  const result = await governModbusOperation(REG_OP, t, { client, wardId: "w", subject: "s", deviceId: "plc", allowDemonstrationTransport: true });
  assert.equal(result.ok, false);
  assert.equal(t.emitted.length, 0);
});

test("governModbusOperation: demo-only block without opt-in", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationModbusTransport();
  const result = await governModbusOperation(REG_OP, t, { client, wardId: "w", subject: "s", deviceId: "plc" });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "DEMONSTRATION_ONLY_BLOCKED");
});

test("governModbusOperation: derives permitted_register_addresses from the operation", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  // Custom transport: capture the authz to inspect it.
  let capturedAuthz: ModbusAuthorization | undefined;
  const capturingTransport = {
    id: "capture",
    production_validated: true,
    async emit(_op: ModbusOperation, authz: ModbusAuthorization) {
      capturedAuthz = authz;
      return { ok: true as const, receipt: { receipt_id: "x", device_id: authz.device_id, kind: _op.kind, unit_id: _op.unit_id, start_address: _op.start_address, warrant_id: authz.warrant_id, action_hash: authz.action_hash, emitted_at: "now", transport: "capture", production_validated: true, receipt_hash: "0".repeat(64) } };
    }
  };
  const result = await governModbusOperation({
    kind: "write_multiple_registers", unit_id: 1, start_address: 40001, values: [1, 2, 3],
    requested_at: "2026-05-26T15:00:00.000Z"
  }, capturingTransport, {
    client, wardId: "w", subject: "s", deviceId: "plc:p1"
  });
  assert.equal(result.ok, true);
  assert.deepEqual(capturedAuthz?.permitted_register_addresses, [40001, 40002, 40003]);
});
