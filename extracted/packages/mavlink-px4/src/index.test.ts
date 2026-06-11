import test from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { AristotleClient } from "@aristotle/os-sdk";
import {
  DemonstrationFlightControlTransport,
  encodeCommandLong,
  governFlightCommand,
  MavlinkUdpTransport,
  type FlightAuthorization,
  type FlightCommand
} from "./index.js";

function mockFetch(handler: (req: { url: string; body?: string }) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; body?: string }> = [];
  const fn = (async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const r = { url, body: init.body };
    calls.push(r);
    const { status, body } = handler(r);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const AUTHZ: FlightAuthorization = {
  warrant_id: "warrant:demo-flight-001",
  warrant_signature: "ed25519:demo",
  consumed: true,
  consumed_at: "2026-05-26T15:00:00.500Z",
  action_hash: "sha256:demo-action-abc",
  aircraft_id: "uav:demo-001",
  permitted_commands: ["TAKEOFF", "LAND", "RTL", "ARM", "GOTO_NED"]
};

const TAKEOFF: FlightCommand = {
  command: "TAKEOFF",
  target_system: 1,
  target_component: 1,
  params: { param7: 50.0 }, // takeoff altitude (m)
  requested_at: "2026-05-26T15:00:00.000Z"
};

// --- MAVLink framing -------------------------------------------------------

test("encodeCommandLong produces a MAVLink v2 frame starting with 0xfd", () => {
  const frame = encodeCommandLong(1, 1, 0, TAKEOFF);
  assert.equal(frame[0], 0xfd);
  // Header is 10 bytes; payload is truncated; CRC is last 2 bytes.
  assert.ok(frame.length >= 12);
});

test("encodeCommandLong encodes MAV_CMD_NAV_TAKEOFF (22) at the expected offset", () => {
  const frame = encodeCommandLong(1, 1, 0, TAKEOFF);
  // payload starts at byte 10; command field is at offset 28..29 of the full
  // 33-byte payload BUT MAVLink v2 truncates trailing zeros. For TAKEOFF with
  // param7=50 we should see the command bytes present after the four-byte
  // param fields. Easier check: round-trip through readUInt16 at the right offset.
  // The first 28 bytes of payload are the 7 floats (params 1..7). We know
  // param7=50 occupies offset 24..27. Command id 22 lives at 28..29.
  const dv = new DataView(frame.buffer, frame.byteOffset + 10, frame.length - 12);
  assert.equal(dv.getUint16(28, true), 22);
});

test("encodeCommandLong with ARM uses MAV_CMD_COMPONENT_ARM_DISARM (400) at the right offset", () => {
  const ARM: FlightCommand = {
    command: "ARM",
    target_system: 1,
    target_component: 1,
    params: { param1: 1 },
    requested_at: "2026-05-26T15:00:00.000Z"
  };
  const frame = encodeCommandLong(1, 1, 1, ARM);
  const dv = new DataView(frame.buffer, frame.byteOffset + 10, frame.length - 12);
  assert.equal(dv.getUint16(28, true), 400);
});

// --- Demonstration transport ----------------------------------------------

test("DemonstrationFlightControlTransport emits with hash-bound receipt", async () => {
  const t = new DemonstrationFlightControlTransport({ clock: () => "2026-05-26T15:00:01.000Z" });
  const out = await t.emit(TAKEOFF, AUTHZ);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.receipt.command, "TAKEOFF");
  assert.equal(out.receipt.aircraft_id, "uav:demo-001");
  assert.equal(out.receipt.warrant_id, AUTHZ.warrant_id);
  assert.equal(out.receipt.action_hash, AUTHZ.action_hash);
  assert.equal(out.receipt.production_validated, false);
  assert.match(out.receipt.receipt_id, /^flightrcpt-\d{6}$/);
  assert.ok(out.receipt.bytes_emitted_b64.length > 0);
  assert.ok(out.receipt.receipt_hash.length === 64);
});

test("DemonstrationFlightControlTransport REFUSEs commands outside authz.permitted_commands", async () => {
  const t = new DemonstrationFlightControlTransport();
  const narrowed: FlightAuthorization = { ...AUTHZ, permitted_commands: ["LAND"] };
  const out = await t.emit(TAKEOFF, narrowed);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.refusal.code, "COMMAND_OUTSIDE_AUTHZ");
});

// --- UDP transport against a real UDP listener ----------------------------

test("MavlinkUdpTransport sends a real UDP datagram to a listener", async () => {
  const listener = createSocket("udp4");
  await new Promise<void>((r) => listener.bind(0, "127.0.0.1", () => r()));
  const address = listener.address();
  const port = address.port;
  const received: Buffer[] = [];
  listener.on("message", (m) => received.push(m));

  const transport = new MavlinkUdpTransport({
    remote: { host: "127.0.0.1", port },
    systemId: 7,
    componentId: 1
  });
  try {
    const out = await transport.emit(TAKEOFF, AUTHZ);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.receipt.transport, "px4-mavlink-udp");
      assert.equal(out.receipt.production_validated, false);
    }
    // Wait briefly for delivery.
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(received.length, 1, "listener must have received exactly one UDP datagram");
    assert.equal(received[0][0], 0xfd, "datagram must be MAVLink v2 (starts with 0xfd)");
  } finally {
    await transport.close();
    await new Promise<void>((r) => listener.close(() => r()));
  }
});

test("MavlinkUdpTransport reports production_validated when explicitly opted in", () => {
  const transport = new MavlinkUdpTransport({
    remote: { host: "127.0.0.1", port: 0 },
    systemId: 7,
    componentId: 1,
    productionValidated: true
  });
  assert.equal(transport.production_validated, true);
});

// --- Orchestrator integration ---------------------------------------------

const ALLOW_BODY = {
  decision: "ALLOW",
  reason_codes: [],
  canonical_action_hash: "sha256:gate-bound-hash",
  warrant: { warrant_id: "warrant:from-gate" },
  gel_record: { record_id: "rec-1", record_hash: "rh" }
};

const REFUSE_BODY = {
  decision: "REFUSE",
  reason_codes: ["ACTION_DENIED"],
  canonical_action_hash: "h",
  gel_record: { record_id: "rec-1", record_hash: "rh" }
};

test("governFlightCommand: ALLOW path emits via transport and returns hash-bound receipt", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW_BODY }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const transport = new DemonstrationFlightControlTransport({ clock: () => "2026-05-26T15:00:01.000Z" });
  const result = await governFlightCommand(TAKEOFF, transport, {
    client, wardId: "ward-aviation", subject: "agent:uav-orchestrator",
    aircraftId: "uav:demo-001",
    allowDemonstrationTransport: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision?.decision, "ALLOW");
  if (result.outcome && result.outcome.ok) {
    assert.equal(result.outcome.receipt.warrant_id, "warrant:from-gate");
    assert.equal(result.outcome.receipt.action_hash, "sha256:gate-bound-hash");
    assert.equal(result.outcome.receipt.production_validated, false);
  }
  assert.equal(transport.emitted.length, 1);
  assert.equal(transport.emitted[0].command.command, "TAKEOFF");
});

test("governFlightCommand: REFUSE path does NOT call the transport", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: REFUSE_BODY }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const transport = new DemonstrationFlightControlTransport();
  const result = await governFlightCommand(TAKEOFF, transport, {
    client, wardId: "ward-aviation", subject: "agent:uav-orchestrator",
    aircraftId: "uav:demo-001",
    allowDemonstrationTransport: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.decision?.decision, "REFUSE");
  assert.equal(transport.emitted.length, 0, "REFUSE must not reach the autopilot");
});

test("governFlightCommand: refuses non-production-validated transport by default", async () => {
  const { fn } = mockFetch(() => ({ status: 200, body: ALLOW_BODY }));
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const transport = new DemonstrationFlightControlTransport();
  const result = await governFlightCommand(TAKEOFF, transport, {
    client, wardId: "ward-aviation", subject: "agent:uav-orchestrator",
    aircraftId: "uav:demo-001"
    // allowDemonstrationTransport: not set
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "DEMONSTRATION_ONLY_BLOCKED");
  assert.equal(transport.emitted.length, 0);
});

test("governFlightCommand: action_type defaults to aviation.flight.<lowercased command>", async () => {
  let lastBody = "";
  const { fn } = mockFetch((req) => { lastBody = req.body ?? ""; return { status: 200, body: ALLOW_BODY }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const transport = new DemonstrationFlightControlTransport();
  await governFlightCommand(TAKEOFF, transport, {
    client, wardId: "w", subject: "s", aircraftId: "uav:demo-001", allowDemonstrationTransport: true
  });
  assert.match(lastBody, /"action_type":"aviation\.flight\.takeoff"/);
});

test("governFlightCommand: actionTypeFor overrides the default action_type", async () => {
  let lastBody = "";
  const { fn } = mockFetch((req) => { lastBody = req.body ?? ""; return { status: 200, body: ALLOW_BODY }; });
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: fn });
  const transport = new DemonstrationFlightControlTransport();
  await governFlightCommand(TAKEOFF, transport, {
    client, wardId: "w", subject: "s", aircraftId: "uav:demo-001",
    actionTypeFor: () => "swarm.flight.takeoff",
    allowDemonstrationTransport: true
  });
  assert.match(lastBody, /"action_type":"swarm\.flight\.takeoff"/);
});

test("governFlightCommand: gate-unreachable returns GATE_UNREACHABLE refusal and never emits", async () => {
  const client = new AristotleClient({ baseUrl: "https://gate.internal", token: "t", fetch: (async () => { throw new Error("network down"); }) as unknown as typeof fetch });
  const transport = new DemonstrationFlightControlTransport();
  const result = await governFlightCommand(TAKEOFF, transport, {
    client, wardId: "w", subject: "s", aircraftId: "uav:demo-001", allowDemonstrationTransport: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "GATE_UNREACHABLE");
  assert.equal(transport.emitted.length, 0);
});
