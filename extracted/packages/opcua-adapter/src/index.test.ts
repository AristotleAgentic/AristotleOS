import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import {
  DemonstrationOpcUaTransport,
  governOpcUaOperation,
  OpcUaShimTransport,
  type OpcUaAuthorization,
  type OpcUaOperation
} from "./index.js";

function mockFetch(h: (req: { url: string; body?: string }) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; body?: string }> = [];
  const fn = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const r = { url, body: init.body };
    calls.push(r);
    const { status, body } = h(r);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const AUTHZ: OpcUaAuthorization = {
  warrant_id: "warrant:demo", warrant_signature: "ed25519:demo",
  consumed: true, consumed_at: "2026-05-26T15:00:00.500Z",
  action_hash: "sha256:demo",
  endpoint_uri: "opc.tcp://plant-1.demo:4840",
  permitted_node_ids: ["ns=2;s=Boiler1.Setpoint"]
};

const WRITE: OpcUaOperation = {
  kind: "write", node_id: "ns=2;s=Boiler1.Setpoint",
  data_type: "Double", value: 72.5, requested_at: "2026-05-26T15:00:00.000Z"
};

const ALLOW = { decision: "ALLOW", reason_codes: [], canonical_action_hash: "sha256:bound", warrant: { warrant_id: "warrant:from-gate" }, gel_record: { record_id: "r", record_hash: "rh" } };

test("DemonstrationOpcUaTransport emits hash-bound receipt for a write", async () => {
  const t = new DemonstrationOpcUaTransport({ clock: () => "2026-05-26T15:00:01.000Z" });
  const out = await t.emit(WRITE, AUTHZ);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.receipt.kind, "write");
    assert.equal(out.receipt.node_id, "ns=2;s=Boiler1.Setpoint");
    assert.equal(out.receipt.data_type, "Double");
    assert.equal(out.receipt.production_validated, false);
    assert.equal(out.receipt.receipt_hash.length, 64);
  }
});

test("transport REFUSES nodes outside authz.permitted_node_ids", async () => {
  const t = new DemonstrationOpcUaTransport();
  const evil: OpcUaOperation = { ...WRITE, node_id: "ns=2;s=Safety.ShutdownArm" };
  const out = await t.emit(evil, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "NODE_OUTSIDE_AUTHZ");
});

test("OpcUaShimTransport delegates to the provided writer function", async () => {
  const received: OpcUaOperation[] = [];
  const t = new OpcUaShimTransport({
    endpointUri: "opc.tcp://plant-1.demo:4840",
    writer: async (op) => { received.push(op); }
  });
  const out = await t.emit(WRITE, AUTHZ);
  assert.equal(out.ok, true);
  assert.equal(received.length, 1);
  assert.equal(received[0].node_id, "ns=2;s=Boiler1.Setpoint");
});

test("OpcUaShimTransport: writer rejection surfaces as TRANSPORT_REJECTED", async () => {
  const t = new OpcUaShimTransport({
    endpointUri: "opc.tcp://plant-1.demo:4840",
    writer: async () => { throw new Error("BadAttributeIdInvalid"); }
  });
  const out = await t.emit(WRITE, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "TRANSPORT_REJECTED");
});

test("governOpcUaOperation: ALLOW path emits via transport with action_type=opcua.write", async () => {
  let body = "";
  const { fn } = mockFetch((req) => { body = req.body ?? ""; return { status: 200, body: ALLOW }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationOpcUaTransport();
  const result = await governOpcUaOperation(WRITE, t, {
    client, wardId: "ward-pipeline", subject: "agent:opcua-controller",
    endpointUri: "opc.tcp://plant-1.demo:4840", allowDemonstrationTransport: true
  });
  assert.equal(result.ok, true);
  assert.match(body, /"action_type":"opcua\.write"/);
  assert.equal(t.emitted.length, 1);
});

test("governOpcUaOperation: REFUSE skips the transport", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED"], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } } }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationOpcUaTransport();
  const result = await governOpcUaOperation(WRITE, t, { client, wardId: "w", subject: "s", endpointUri: "opc.tcp://x:4840", allowDemonstrationTransport: true });
  assert.equal(result.ok, false);
  assert.equal(t.emitted.length, 0);
});

test("governOpcUaOperation: refuses non-production-validated transport without opt-in", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationOpcUaTransport();
  const result = await governOpcUaOperation(WRITE, t, { client, wardId: "w", subject: "s", endpointUri: "opc.tcp://x:4840" });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "DEMONSTRATION_ONLY_BLOCKED");
});
