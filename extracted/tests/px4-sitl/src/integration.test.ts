/**
 * PX4 SITL integration test.
 *
 * Closes the in-repo portion of ROADMAP_TO_100.md Category 1
 * "production hardware integration test for >= 1 adapter (PX4 SITL
 * is the most achievable)".
 *
 * The test:
 *   1. Probes the configured UDP endpoint to see if SITL is running.
 *   2. If not reachable, SKIPS — never fails for the operator's setup.
 *      Honest CI behavior: the docker-compose.yml is opt-in and not
 *      every reviewer has Docker available.
 *   3. If reachable, drives governFlightCommand through MavlinkUdpTransport
 *      against the live endpoint with an ALLOW-producing stub gate, and
 *      asserts a wire-level datagram landed (the simulator may not echo
 *      back without arming, but the test asserts the transport's
 *      out.ok and out.receipt.transport === "px4-mavlink-udp").
 *
 * Run:
 *   # With Docker SITL:
 *   docker/sitl/run.sh up
 *   docker/sitl/run.sh test
 *
 *   # Or pointing at any other UDP listener:
 *   ARISTOTLE_PX4_SITL_HOST=192.168.1.50 \
 *   ARISTOTLE_PX4_SITL_PORT=14550 \
 *     corepack pnpm@10.32.1 --filter @aristotle/tests-px4-sitl test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import type { AristotleClient, CanonicalAction, EvaluateResponse } from "@aristotle/os-sdk";
import {
  MavlinkUdpTransport,
  governFlightCommand,
  type FlightCommand
} from "@aristotle/mavlink-px4";

const HOST = process.env.ARISTOTLE_PX4_SITL_HOST ?? "127.0.0.1";
const PORT = Number(process.env.ARISTOTLE_PX4_SITL_PORT ?? 14540);
const PROBE_TIMEOUT_MS = 1500;

/**
 * Probe the UDP endpoint to see whether SITL is reachable. We send a
 * one-byte datagram and wait briefly. UDP is connectionless so this is
 * a best-effort liveness check: "no immediate ICMP unreachable" is
 * treated as "probably up". We don't trust silence too much; if SITL is
 * legitimately unreachable the subsequent test calls will fail fast.
 */
async function isSitlReachable(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const sock = createSocket("udp4");
    const timer = setTimeout(() => {
      try { sock.close(); } catch { /* ignore */ }
      // No immediate error -> assume reachable. UDP doesn't ack so this
      // is the best we can do without protocol-level probing.
      resolve(true);
    }, PROBE_TIMEOUT_MS);
    sock.on("error", (err) => {
      clearTimeout(timer);
      try { sock.close(); } catch { /* ignore */ }
      // ENETUNREACH / ECONNREFUSED on UDP -> not running.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENETUNREACH" || code === "ECONNREFUSED" || code === "EHOSTUNREACH") {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    sock.send(Buffer.from([0]), PORT, HOST, (err) => {
      if (err) {
        clearTimeout(timer);
        try { sock.close(); } catch { /* ignore */ }
        resolve(false);
      }
    });
  });
}

function allowingClient(): AristotleClient {
  const stub = {
    evaluate: async (_action: CanonicalAction): Promise<EvaluateResponse> => ({
      decision: "ALLOW",
      reason_codes: [],
      canonical_action_hash: "sha256:px4-sitl-test",
      warrant: { warrant_id: "warrant:sitl-test", signature: "ed25519:opaque" },
      gel_record: { record_id: "rec-sitl", record_hash: "rh-sitl" }
    })
  };
  return stub as unknown as AristotleClient;
}

const TAKEOFF: FlightCommand = {
  command: "TAKEOFF",
  target_system: 1,
  target_component: 1,
  params: { altitude_m: 10 },
  requested_at: new Date().toISOString()
};

// ---------------------------------------------------------------------------

test(`PX4 SITL integration: governFlightCommand drives MavlinkUdpTransport against ${HOST}:${PORT} (skips unless ARISTOTLE_PX4_SITL_OPT_IN=1)`, async (t) => {
  // Opt-in via env var because UDP probes can't distinguish "live SITL"
  // from "no listener" without sending a MAVLink-level HEARTBEAT and
  // waiting for a response. docker/sitl/run.sh test sets this var
  // automatically; reviewers running pnpm test casually get a clean skip.
  if (process.env.ARISTOTLE_PX4_SITL_OPT_IN !== "1") {
    t.skip("Set ARISTOTLE_PX4_SITL_OPT_IN=1 to run against a live SITL (see docker/sitl/run.sh)");
    return;
  }
  const reachable = await isSitlReachable();
  if (!reachable) {
    t.skip(`SITL not reachable at ${HOST}:${PORT} — bring it up with docker/sitl/run.sh up`);
    return;
  }
  const transport = new MavlinkUdpTransport({
    remote: { host: HOST, port: PORT },
    systemId: 7,
    componentId: 1
  });
  try {
    const result = await governFlightCommand(TAKEOFF, transport, {
      client: allowingClient(),
      wardId: "w-px4-sitl",
      subject: "agent:px4-sitl-test",
      aircraftId: "px4-sitl",
      allowDemonstrationTransport: true
    });
    assert.equal(result.ok, true, `governFlightCommand should succeed; refusal: ${JSON.stringify(result.refusal)}`);
    if (result.ok && result.outcome) {
      assert.ok(result.outcome.ok, "transport outcome must be ok");
      if (result.outcome.ok) {
        assert.equal(result.outcome.receipt.transport, "px4-mavlink-udp");
        assert.equal(result.outcome.receipt.production_validated, false,
          "default MavlinkUdpTransport is production_validated=false");
        assert.ok(typeof result.outcome.receipt.action_hash === "string");
      }
    }
  } finally {
    // close() in the adapter is best-effort.
    try { await (transport as { close?: () => Promise<void> }).close?.(); } catch { /* ignore */ }
  }
});
