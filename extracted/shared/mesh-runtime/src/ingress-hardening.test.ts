/**
 * Mesh HTTP ingress hardening — tests for the four defenses added in
 * the harden(substrate) batch:
 *
 *   1. Demo-secret WARN
 *      Constructing a node with a known demo HMAC secret emits a
 *      one-time WARN to console.warn. suppressDemoSecretWarning
 *      silences it.
 *
 *   2. productionMode lockdown
 *      Constructing a node with productionMode=true + the legacy
 *      `secret` option throws. Constructing with productionMode=true
 *      + an HMAC signer throws. Constructing with productionMode=true
 *      + an Ed25519 signer succeeds.
 *
 *   3. HTTP body size cap + content-type check
 *      Oversized POST returns 413. Non-JSON content-type returns 415.
 *      Bad JSON returns 400. All responses are JSON.
 *
 *   4. MeshReplayCache
 *      Repeating the same body within the TTL window returns 409
 *      replay-detected. After TTL expires, the same body is accepted
 *      again. Different bodies are independent.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  KNOWN_DEMO_MESH_SECRETS,
  RootNode,
  createEd25519MeshSigner,
  createEd25519MeshVerifier,
  createHmacMeshSigner,
  createHmacMeshVerifier,
  createMeshRateLimiter,
  createMeshReplayCache
} from "./index.js";

function silentRoot(secret: string, port = 0) {
  return new RootNode({
    id: "r-test", host: "127.0.0.1", port, secret,
    suppressDemoSecretWarning: true
  });
}

// ---------------------------------------------------------------------------
// (1) Demo-secret WARN
// ---------------------------------------------------------------------------

test("demo-secret WARN: known demo secret emits a one-time console.warn", () => {
  // Use a fresh known-demo secret string that hasn't been warned yet.
  const fresh = "test-secret"; // present in KNOWN_DEMO_MESH_SECRETS
  assert.ok(KNOWN_DEMO_MESH_SECRETS.has(fresh));
  const originalWarn = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => { calls.push(args); };
  try {
    new RootNode({ id: "r-warn-1", host: "127.0.0.1", port: 0, secret: fresh });
    new RootNode({ id: "r-warn-2", host: "127.0.0.1", port: 0, secret: fresh });
    // Second construct with the same secret must NOT warn again — the
    // warning is one-time per secret string.
    assert.equal(calls.length, 1, `expected exactly one warn, got ${calls.length}`);
    const msg = String(calls[0][0]);
    assert.ok(msg.includes("WARNING"), "warn message must include WARNING");
    assert.ok(msg.includes("demo"), "warn message must mention demo");
  } finally { console.warn = originalWarn; }
});

test("demo-secret WARN: suppressDemoSecretWarning silences it", () => {
  const originalWarn = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => { calls.push(args); };
  try {
    new RootNode({
      id: "r-silent", host: "127.0.0.1", port: 0,
      secret: "aristotle-demo-secret",
      suppressDemoSecretWarning: true
    });
    assert.equal(calls.length, 0, "suppressDemoSecretWarning must silence WARN");
  } finally { console.warn = originalWarn; }
});

test("demo-secret WARN: a non-demo secret does NOT warn", () => {
  const originalWarn = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => { calls.push(args); };
  try {
    new RootNode({
      id: "r-real", host: "127.0.0.1", port: 0,
      secret: "an-operator-supplied-secret-with-real-entropy-fa78b3c4d5e6"
    });
    assert.equal(calls.length, 0, "non-demo secret must not WARN");
  } finally { console.warn = originalWarn; }
});

// ---------------------------------------------------------------------------
// (2) productionMode lockdown
// ---------------------------------------------------------------------------

test("productionMode: secret-only construction throws", () => {
  assert.throws(
    () => new RootNode({
      id: "r-pm", host: "127.0.0.1", port: 0,
      secret: "demo-mesh-secret",
      productionMode: true
    }),
    /productionMode=true forbids the shared-HMAC/
  );
});

test("productionMode: HMAC signer construction throws", () => {
  assert.throws(
    () => new RootNode({
      id: "r-pm", host: "127.0.0.1", port: 0,
      signer: createHmacMeshSigner({ signerId: "r-pm", secret: "demo-mesh-secret" }),
      verifier: createHmacMeshVerifier({ secret: "demo-mesh-secret" }),
      productionMode: true
    }),
    /productionMode=true forbids the HMAC signer/
  );
});

test("productionMode: Ed25519 signer construction succeeds", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
  const node = new RootNode({
    id: "r-pm-ed", host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: "r-pm-ed", privateKeyPem: priv }),
    verifier: createEd25519MeshVerifier({ trustedKeys: { "r-pm-ed": pub } }),
    productionMode: true
  });
  assert.equal(node.getId(), "r-pm-ed");
});

// ---------------------------------------------------------------------------
// (3) HTTP body size cap + content-type check
// ---------------------------------------------------------------------------

async function withServer(port: number, opts: Record<string, unknown>, body: (port: number) => Promise<void>) {
  const root = new RootNode({
    id: "r-ingress", host: "127.0.0.1", port,
    secret: "test-secret",
    suppressDemoSecretWarning: true,
    ...opts
  });
  await root.start();
  try { await body(port); } finally { await root.stop(); }
}

test("ingress: oversized POST returns 413 with structured body", async () => {
  const port = 21111;
  await withServer(port, { maxRequestBodyBytes: 256 }, async (p) => {
    const huge = "x".repeat(2048);
    const res = await fetch(`http://127.0.0.1:${p}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "PING", filler: huge })
    });
    assert.equal(res.status, 413);
    const data = await res.json() as { ok: boolean; reason: string; limit_bytes: number };
    assert.equal(data.ok, false);
    assert.equal(data.reason, "payload-too-large");
    assert.equal(data.limit_bytes, 256);
  });
});

test("ingress: non-JSON content-type returns 415", async () => {
  const port = 21112;
  await withServer(port, {}, async (p) => {
    const res = await fetch(`http://127.0.0.1:${p}/`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: '{"kind":"PING"}'
    });
    assert.equal(res.status, 415);
    const data = await res.json() as { ok: boolean; reason: string };
    assert.equal(data.reason, "unsupported-media-type");
  });
});

test("ingress: malformed JSON returns 400 with structured body", async () => {
  const port = 21113;
  await withServer(port, {}, async (p) => {
    const res = await fetch(`http://127.0.0.1:${p}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json"
    });
    assert.equal(res.status, 400);
    const data = await res.json() as { ok: boolean; reason: string };
    assert.equal(data.reason, "bad-json");
  });
});

test("ingress: well-formed PING with JSON content-type succeeds (200)", async () => {
  const port = 21114;
  await withServer(port, {}, async (p) => {
    const res = await fetch(`http://127.0.0.1:${p}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "PING" })
    });
    assert.equal(res.status, 200);
    const data = await res.json() as { id: string; role: string; ok: boolean };
    assert.equal(data.role, "root");
    assert.equal(data.ok, true);
  });
});

test("ingress: content-type with charset is accepted", async () => {
  const port = 21115;
  await withServer(port, {}, async (p) => {
    const res = await fetch(`http://127.0.0.1:${p}/`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ kind: "PING" })
    });
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// (4) MeshReplayCache
// ---------------------------------------------------------------------------

test("replay cache: same body twice within TTL -> second returns 409", async () => {
  const port = 21116;
  const replayCache = createMeshReplayCache({ ttlMs: 10_000, maxSize: 100 });
  await withServer(port, { replayCache }, async (p) => {
    const url = `http://127.0.0.1:${p}/`;
    const body = JSON.stringify({ kind: "PING", from: "r-test-peer", x: 42 });
    const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(first.status, 200, "first request must succeed");
    const second = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(second.status, 409, "exact-body replay must be rejected");
    const data = await second.json() as { ok: boolean; reason: string };
    assert.equal(data.reason, "replay-detected");
  });
});

test("replay cache: different bodies are independent", async () => {
  const port = 21117;
  const replayCache = createMeshReplayCache({ ttlMs: 10_000, maxSize: 100 });
  await withServer(port, { replayCache }, async (p) => {
    const url = `http://127.0.0.1:${p}/`;
    for (let i = 0; i < 5; i++) {
      const body = JSON.stringify({ kind: "PING", from: "r-test-peer", n: i });
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      assert.equal(res.status, 200, `request #${i} must succeed`);
    }
  });
});

test("replay cache unit: TTL-expired entries are reaccepted", () => {
  let clock = 1000;
  const cache = createMeshReplayCache({ ttlMs: 100, maxSize: 10, now: () => clock });
  assert.equal(cache.seen("h1"), false);
  assert.equal(cache.seen("h1"), true, "second sighting within TTL is replay");
  clock = 1500;
  assert.equal(cache.seen("h1"), false, "third sighting after TTL is fresh again");
});

test("replay cache unit: maxSize bounds memory (LRU-ish eviction)", () => {
  const cache = createMeshReplayCache({ ttlMs: 1_000_000, maxSize: 3 });
  assert.equal(cache.seen("a"), false);
  assert.equal(cache.seen("b"), false);
  assert.equal(cache.seen("c"), false);
  assert.equal(cache.size(), 3);
  assert.equal(cache.seen("d"), false);
  // After d, the oldest (a) should have been evicted.
  assert.equal(cache.size(), 3);
  assert.equal(cache.seen("a"), false, "evicted entry must be treated as fresh");
});

// ---------------------------------------------------------------------------
// (5) MeshRateLimiter — per-peer token bucket
// ---------------------------------------------------------------------------

test("rate limiter unit: bursting up to capacity is allowed", () => {
  const rl = createMeshRateLimiter({ capacity: 5, refillRatePerSec: 0 });
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.tryAcquire("peer-a"), true, `request #${i} should be admitted`);
  }
  assert.equal(rl.tryAcquire("peer-a"), false, "burst beyond capacity must be rejected");
});

test("rate limiter unit: per-peer isolation — one flooder doesn't starve others", () => {
  const rl = createMeshRateLimiter({ capacity: 3, refillRatePerSec: 0 });
  // Peer A exhausts its bucket.
  for (let i = 0; i < 3; i++) assert.equal(rl.tryAcquire("peer-a"), true);
  assert.equal(rl.tryAcquire("peer-a"), false);
  // Peer B still has its full capacity.
  for (let i = 0; i < 3; i++) assert.equal(rl.tryAcquire("peer-b"), true, `peer-b req #${i}`);
});

test("rate limiter unit: refill restores tokens at the configured rate", () => {
  let clock = 1000;
  const rl = createMeshRateLimiter({ capacity: 2, refillRatePerSec: 10, now: () => clock });
  assert.equal(rl.tryAcquire("p"), true);
  assert.equal(rl.tryAcquire("p"), true);
  assert.equal(rl.tryAcquire("p"), false);
  clock = 1200; // 200 ms -> 10 * 0.2 = 2 tokens refilled (capped at capacity)
  assert.equal(rl.tryAcquire("p"), true);
  assert.equal(rl.tryAcquire("p"), true);
  assert.equal(rl.tryAcquire("p"), false);
});

test("rate limiter unit: peek shows current tokens without consuming", () => {
  let clock = 0;
  const rl = createMeshRateLimiter({ capacity: 5, refillRatePerSec: 0, now: () => clock });
  assert.equal(rl.peek("p").tokens, 5);
  rl.tryAcquire("p");
  rl.tryAcquire("p");
  assert.equal(rl.peek("p").tokens, 3);
  assert.equal(rl.peek("p").capacity, 5);
});

test("ingress: rate-limited request returns 429 with structured body", async () => {
  const port = 21118;
  const rateLimiter = createMeshRateLimiter({ capacity: 2, refillRatePerSec: 0 });
  await withServer(port, { rateLimiter }, async (p) => {
    const url = `http://127.0.0.1:${p}/`;
    const body = (n: number) => JSON.stringify({ kind: "PING", from: "peer-rl-test", n });
    // First two requests succeed.
    let res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body(1) });
    assert.equal(res.status, 200);
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body(2) });
    assert.equal(res.status, 200);
    // Third request blocked.
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body(3) });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "1");
    const data = await res.json() as { ok: boolean; reason: string; peer: string };
    assert.equal(data.ok, false);
    assert.equal(data.reason, "rate-limited");
    assert.equal(data.peer, "peer-rl-test");
  });
});

test("ingress: anonymous (no msg.from) traffic is bucketed under '*'", async () => {
  const port = 21119;
  const rateLimiter = createMeshRateLimiter({ capacity: 1, refillRatePerSec: 0 });
  await withServer(port, { rateLimiter }, async (p) => {
    const url = `http://127.0.0.1:${p}/`;
    // First anonymous PING (no `from`) succeeds.
    let res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "PING" }) });
    assert.equal(res.status, 200);
    // Second anonymous PING blocked.
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "PING" }) });
    assert.equal(res.status, 429);
    const data = await res.json() as { peer: string };
    assert.equal(data.peer, "*", "anonymous traffic must bucket under '*'");
  });
});

test("ingress: rate limiter is per-peer — one flooder doesn't block others over HTTP", async () => {
  const port = 21120;
  const rateLimiter = createMeshRateLimiter({ capacity: 1, refillRatePerSec: 0 });
  await withServer(port, { rateLimiter }, async (p) => {
    const url = `http://127.0.0.1:${p}/`;
    const body = (peer: string) => JSON.stringify({ kind: "PING", from: peer });
    // peer-a uses its only token, then is rate-limited.
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body("peer-a") })).status, 200);
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body("peer-a") })).status, 429);
    // peer-b is independent — still has full capacity.
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body("peer-b") })).status, 200);
  });
});
