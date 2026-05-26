import test from "node:test";
import assert from "node:assert/strict";
import { AristotleClient } from "@aristotle/os-sdk";
import {
  DemonstrationRosTransport,
  governRosMessage,
  RosbridgeWebsocketTransport,
  type RosAuthorization,
  type RosMessage,
  type WsLike
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

const AUTHZ: RosAuthorization = {
  warrant_id: "warrant:demo", warrant_signature: "ed25519:demo",
  consumed: true, consumed_at: "2026-05-26T15:00:00.500Z",
  action_hash: "sha256:demo", node_id: "ros-node-1",
  permitted_targets: ["/cmd_vel", "/arm"]
};

const TWIST: RosMessage = {
  kind: "publish", target: "/cmd_vel", msg_type: "geometry_msgs/Twist",
  data: { linear: { x: 0.5, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0.1 } },
  requested_at: "2026-05-26T15:00:00.000Z"
};

const ALLOW = { decision: "ALLOW", reason_codes: [], canonical_action_hash: "sha256:gate-bound", warrant: { warrant_id: "warrant:from-gate" }, gel_record: { record_id: "rec-1", record_hash: "rh" } };

test("DemonstrationRosTransport emits rosbridge 'publish' op with hash-bound receipt", async () => {
  const t = new DemonstrationRosTransport({ clock: () => "2026-05-26T15:00:01.000Z" });
  const out = await t.emit(TWIST, AUTHZ);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.receipt.kind, "publish");
  assert.equal(out.receipt.target, "/cmd_vel");
  assert.equal(out.receipt.production_validated, false);
  assert.equal(out.receipt.receipt_hash.length, 64);
  assert.equal(t.emitted.length, 1);
  assert.equal(t.emitted[0].op.op, "publish");
});

test("DemonstrationRosTransport emits 'call_service' op when kind is service", async () => {
  const t = new DemonstrationRosTransport();
  const arm: RosMessage = { kind: "call_service", target: "/arm", msg_type: "std_srvs/SetBool", data: { data: true }, requested_at: "2026-05-26T15:00:00.000Z" };
  const out = await t.emit(arm, AUTHZ);
  assert.equal(out.ok, true);
  assert.equal(t.emitted[0].op.op, "call_service");
});

test("transport REFUSEs targets outside authz.permitted_targets", async () => {
  const t = new DemonstrationRosTransport();
  const evil: RosMessage = { ...TWIST, target: "/admin/halt" };
  const out = await t.emit(evil, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "TARGET_OUTSIDE_AUTHZ");
});

test("RosbridgeWebsocketTransport sends a JSON op via the injected socket", async () => {
  const sent: string[] = [];
  const fake: WsLike = {
    readyState: 1,
    send: (data, cb) => { sent.push(data); cb?.(); },
    close: () => {}
  };
  const t = new RosbridgeWebsocketTransport({ socket: fake });
  const out = await t.emit(TWIST, AUTHZ);
  assert.equal(out.ok, true);
  assert.equal(sent.length, 1);
  const parsed = JSON.parse(sent[0]);
  assert.equal(parsed.op, "publish");
  assert.equal(parsed.topic, "/cmd_vel");
  assert.equal(parsed.type, "geometry_msgs/Twist");
});

test("RosbridgeWebsocketTransport refuses when socket isn't open", async () => {
  const fake: WsLike = { readyState: 3 /* CLOSED */, send: () => {}, close: () => {} };
  const t = new RosbridgeWebsocketTransport({ socket: fake });
  const out = await t.emit(TWIST, AUTHZ);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "TRANSPORT_UNREACHABLE");
});

test("governRosMessage: ALLOW path emits via transport", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationRosTransport();
  const result = await governRosMessage(TWIST, t, {
    client, wardId: "ward-robotics", subject: "agent:ros-orchestrator", nodeId: "ros-node-1",
    allowDemonstrationTransport: true
  });
  assert.equal(result.ok, true);
  assert.equal(t.emitted.length, 1);
});

test("governRosMessage: REFUSE skips the transport entirely", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: { decision: "REFUSE", reason_codes: ["ACTION_DENIED"], canonical_action_hash: "h", gel_record: { record_id: "r", record_hash: "rh" } } }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationRosTransport();
  const result = await governRosMessage(TWIST, t, { client, wardId: "w", subject: "s", nodeId: "ros-node-1", allowDemonstrationTransport: true });
  assert.equal(result.ok, false);
  assert.equal(t.emitted.length, 0);
});

test("governRosMessage: action_type defaults to ros.<kind>.<target> with dots", async () => {
  let body = "";
  const { fn } = mockFetch((req) => { body = req.body ?? ""; return { status: 200, body: ALLOW }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationRosTransport();
  await governRosMessage(TWIST, t, { client, wardId: "w", subject: "s", nodeId: "ros-node-1", allowDemonstrationTransport: true });
  assert.match(body, /"action_type":"ros\.publish\.cmd_vel"/);
});

test("governRosMessage: refuses non-production-validated transport without opt-in", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const t = new DemonstrationRosTransport();
  const result = await governRosMessage(TWIST, t, { client, wardId: "w", subject: "s", nodeId: "ros-node-1" });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "DEMONSTRATION_ONLY_BLOCKED");
});
