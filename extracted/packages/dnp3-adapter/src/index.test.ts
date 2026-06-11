import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import {
  DemonstrationDnp3Transport,
  Dnp3ShimTransport,
  governDnp3Control,
  type Dnp3Authorization,
  type Dnp3ControlRequest
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

const AUTHZ: Dnp3Authorization = {
  warrant_id: "warrant:demo", warrant_signature: "ed25519:demo",
  consumed: true, consumed_at: "2026-05-26T15:00:00.500Z",
  action_hash: "sha256:demo",
  outstation_id: "substation:SS-14",
  permitted_point_indexes: [42]
};

const TRIP: Dnp3ControlRequest = {
  kind: "binary_output_select_then_operate",
  outstation_address: 1,
  point_index: 42,
  operation: "trip",
  point_label: "Feeder-3-Recloser",
  requested_at: "2026-05-26T15:00:00.000Z"
};

const ALLOW = { decision: "ALLOW", reason_codes: [], canonical_action_hash: "sha256:bound", warrant: { warrant_id: "warrant:from-gate" }, gel_record: { record_id: "r", record_hash: "rh" } };

test("DemonstrationDnp3Transport emits hash-bound receipt for breaker trip", async () => {
  const t = new DemonstrationDnp3Transport({ clock: () => "2026-05-26T15:00:01.000Z" });
  const out = await t.emit(TRIP, AUTHZ);
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.receipt.kind, "binary_output_select_then_operate");
    assert.equal(out.receipt.point_index, 42);
    assert.equal(out.receipt.operation, "trip");
    assert.equal(out.receipt.production_validated, false);
    assert.equal(out.receipt.receipt_hash.length, 64);
  }
});

test("transport REFUSES point indexes outside authz", async () => {
  const t = new DemonstrationDnp3Transport();
  const out = await t.emit({ ...TRIP, point_index: 99 }, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "POINT_OUTSIDE_AUTHZ");
});

test("Dnp3ShimTransport delegates to the provided sender", async () => {
  const sent: Dnp3ControlRequest[] = [];
  const t = new Dnp3ShimTransport({ outstationId: "ss-14", sender: async (req) => { sent.push(req); } });
  const out = await t.emit(TRIP, AUTHZ);
  assert.equal(out.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].operation, "trip");
});

test("Dnp3ShimTransport: sender error -> TRANSPORT_REJECTED", async () => {
  const t = new Dnp3ShimTransport({ outstationId: "ss-14", sender: async () => { throw new Error("OPERATE_NOT_SUPPORTED"); } });
  const out = await t.emit(TRIP, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "TRANSPORT_REJECTED");
});

test("governDnp3Control: ALLOW path emits with action_type=grid.dnp3.binary_output_select_then_operate", async () => {
  let body = "";
  const { fn } = mockFetch((req) => { body = req.body ?? ""; return { status: 200, body: ALLOW }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationDnp3Transport();
  const result = await governDnp3Control(TRIP, t, {
    client, wardId: "ward-grid", subject: "agent:grid-controller",
    outstationId: "substation:SS-14", allowDemonstrationTransport: true
  });
  assert.equal(result.ok, true);
  assert.match(body, /"action_type":"grid\.dnp3\.binary_output_select_then_operate"/);
  assert.equal(t.emitted.length, 1);
});

test("governDnp3Control: REFUSE skips the transport", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED"], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } } }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationDnp3Transport();
  const result = await governDnp3Control(TRIP, t, { client, wardId: "w", subject: "s", outstationId: "ss-14", allowDemonstrationTransport: true });
  assert.equal(result.ok, false);
  assert.equal(t.emitted.length, 0);
});

test("governDnp3Control: demo-only block without opt-in", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationDnp3Transport();
  const result = await governDnp3Control(TRIP, t, { client, wardId: "w", subject: "s", outstationId: "ss-14" });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "DEMONSTRATION_ONLY_BLOCKED");
});
