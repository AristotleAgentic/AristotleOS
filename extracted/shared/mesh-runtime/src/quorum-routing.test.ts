import test from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryMeshPersistence,
  QuorumCollector,
  StaticSovereignRouter,
  verifyQuorumSignature,
  witnessCoSign,
  type AuthorityEnvelope,
  type NodeId,
  type Revocation,
  type Warrant
} from "./index.js";

const WARRANT: Warrant = {
  warrant_id: "wrt-demo-001",
  envelope_id: "env-demo-001",
  action_type: "demo.run",
  action_hash: "sha256:demo",
  issued_by_edge: "edge-1",
  issued_at: "2026-05-26T15:00:00.000Z",
  under_fluidity_token: "flt-1",
  root_reachable_at_issue: true,
  signature: "demo-signature"
};

// --- Quorum signing -------------------------------------------------------

test("QuorumCollector reaches required count after m witnesses sign", () => {
  const c = new QuorumCollector(2, ["w1", "w2", "w3"]);
  c.add(WARRANT.warrant_id, witnessCoSign("secret", "w1", WARRANT));
  assert.equal(c.satisfied(WARRANT.warrant_id), false);
  c.add(WARRANT.warrant_id, witnessCoSign("secret", "w2", WARRANT));
  assert.equal(c.satisfied(WARRANT.warrant_id), true);
  assert.equal(c.count(WARRANT.warrant_id), 2);
});

test("QuorumCollector deduplicates re-signing by the same witness", () => {
  const c = new QuorumCollector(2, ["w1", "w2", "w3"]);
  c.add(WARRANT.warrant_id, witnessCoSign("secret", "w1", WARRANT));
  c.add(WARRANT.warrant_id, witnessCoSign("secret", "w1", WARRANT));
  assert.equal(c.count(WARRANT.warrant_id), 1);
});

test("QuorumCollector ignores signatures from non-witness ids", () => {
  const c = new QuorumCollector(1, ["w1", "w2"]);
  c.add(WARRANT.warrant_id, witnessCoSign("secret", "attacker", WARRANT));
  assert.equal(c.count(WARRANT.warrant_id), 0);
});

test("verifyQuorumSignature: valid signature passes, tampered fails", () => {
  const sig = witnessCoSign("secret", "w1", WARRANT);
  assert.equal(verifyQuorumSignature("secret", WARRANT, sig), true);
  const tampered = { ...WARRANT, action_hash: "sha256:mitm" };
  assert.equal(verifyQuorumSignature("secret", tampered, sig), false);
});

// --- Persistence ----------------------------------------------------------

test("InMemoryMeshPersistence: save and load envelopes + revocations", () => {
  const p = new InMemoryMeshPersistence();
  const env: AuthorityEnvelope = {
    envelope_id: "env-1", mae_id: "mae-1", ward_id: "ward-1", subject: "agent:1",
    allowed_action_types: ["x"], expires_at: "2027-01-01T00:00:00Z", version: 1,
    issued_by: "root-1", issued_at: "2026-01-01T00:00:00Z", signature: "demo"
  };
  const rev: Revocation = {
    revocation_id: "rev-1", target_id: "env-1", kind: "envelope",
    reason: "demo", revoked_at: "2026-05-01T00:00:00Z", issued_by: "root-1", signature: "demo"
  };
  p.saveEnvelope(env);
  p.saveRevocation(rev);
  assert.deepEqual(p.loadEnvelopes(), [env]);
  assert.deepEqual(p.loadRevocations(), [rev]);

  // Idempotent saves don't duplicate.
  p.saveEnvelope(env);
  assert.equal(p.loadEnvelopes().length, 1);
});

// --- Sovereign routing ----------------------------------------------------

test("StaticSovereignRouter: local mae returns no route; foreign mae routes to anchor", () => {
  const foreignTarget: NodeId = { id: "foreign-root", role: "root", host: "10.0.0.1", port: 8000 };
  const router = new StaticSovereignRouter("mae-local", [
    { mae_id: "mae-foreign-1", target: foreignTarget }
  ]);
  assert.equal(router.route("mae-local"), undefined);
  assert.equal(router.isLocal("mae-local"), true);
  const r = router.route("mae-foreign-1");
  assert.ok(r);
  assert.equal(r!.target.id, "foreign-root");
});

test("StaticSovereignRouter: unknown foreign mae returns undefined", () => {
  const router = new StaticSovereignRouter("mae-local", []);
  assert.equal(router.route("mae-unknown"), undefined);
  assert.deepEqual(router.anchorIds(), []);
});

// --- TLS hook (custom httpClient) -----------------------------------------

test("MeshNode.httpClient: injected client is used for cross-process sendTo", async () => {
  // We can't directly test sendTo because it's protected; instead test
  // via the RootNode HTTP transport against a real local TCP listener
  // BUT route the outbound through a custom client. We use bindRegistry
  // for in-process fast path (which bypasses fetch entirely), so to
  // exercise the httpClient hook we must NOT bind the target.
  const { RootNode, EdgeNode } = await import("./index.js");
  const calls: Array<{ url: string }> = [];
  const fakeFetch = (async (url: string) => {
    calls.push({ url: url });
    return new Response(JSON.stringify({ id: "fake-target", role: "edge", ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  const root = new RootNode({
    id: "root-tls", host: "127.0.0.1", port: 0, secret: "s",
    httpClient: fakeFetch,
    urlFor: (t) => `https://${t.id}.internal/`,
    peers: [{ id: "edge-tls", role: "edge", host: "10.0.0.1", port: 8443 }]
  });
  // Force the cross-process path by NOT binding the registry.
  // The simplest way to exercise sendTo without exposing it: have
  // root issue an envelope, which triggers propagateEnvelope which
  // calls sendTo for each peer. We can't easily await that result,
  // so use ping path via a dummy edge object below.
  // For deterministic test, use the EdgeNode's pingRoot which calls
  // sendTo internally; but that's also private. Instead, use the
  // fact that issueEnvelope's async propagation is fire-and-forget.
  void new EdgeNode({ id: "edge-tls", host: "10.0.0.1", port: 8443, secret: "s" });
  root.issueEnvelope({
    envelope_id: "env-tls-test", mae_id: "mae-x", ward_id: "ward-x",
    subject: "agent:x", allowed_action_types: ["x.do"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), version: 1
  });
  // Give propagation a tick.
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(calls.length >= 1, "httpClient should have been called");
  assert.match(calls[0].url, /^https:\/\/edge-tls\.internal\//);
});

test("MeshNode.urlFor: defaults to http when not provided", async () => {
  const { RootNode } = await import("./index.js");
  let observedUrl = "";
  const fakeFetch = (async (url: string) => {
    observedUrl = url;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const root = new RootNode({
    id: "root-url-default", host: "127.0.0.1", port: 0, secret: "s",
    httpClient: fakeFetch,
    peers: [{ id: "edge-1", role: "edge", host: "192.168.1.42", port: 9090 }]
  });
  root.issueEnvelope({
    envelope_id: "env-url-default", mae_id: "mae-x", ward_id: "ward-x",
    subject: "agent:x", allowed_action_types: ["x.do"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), version: 1
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(observedUrl, "http://192.168.1.42:9090/");
});

// --- Persistence durability roundtrip -------------------------------------

test("InMemoryMeshPersistence: durability roundtrip — save envelopes + revocations and restore them under a new instance after JSON serialization", () => {
  const before = new InMemoryMeshPersistence();
  const env: AuthorityEnvelope = {
    envelope_id: "env-d1", mae_id: "mae-d", ward_id: "ward-d", subject: "agent:d",
    allowed_action_types: ["d.do"], expires_at: "2099-01-01T00:00:00.000Z",
    issued_at: "2026-05-26T15:00:00.000Z", issued_by: "root-d", version: 1,
    signature: "demo-signature"
  };
  const rev: Revocation = {
    revocation_id: "rev-d1", target_id: "env-d1", kind: "envelope",
    reason: "test-revoke", revoked_at: "2026-05-26T15:01:00.000Z",
    issued_by: "root-d", signature: "demo-signature"
  };
  before.saveEnvelope(env);
  before.saveRevocation(rev);

  // Serialize to a JSON snapshot a durable store would persist.
  const snapshot = JSON.stringify({
    envelopes: before.loadEnvelopes(),
    revocations: before.loadRevocations()
  });

  // Crash + restart: load into a brand-new persistence instance.
  const after = new InMemoryMeshPersistence();
  const parsed = JSON.parse(snapshot) as { envelopes: AuthorityEnvelope[]; revocations: Revocation[] };
  for (const e of parsed.envelopes) after.saveEnvelope(e);
  for (const r of parsed.revocations) after.saveRevocation(r);

  assert.deepEqual(after.loadEnvelopes(), [env]);
  assert.deepEqual(after.loadRevocations(), [rev]);

  // Subsequent saves still idempotent on the restored instance.
  after.saveEnvelope(env);
  after.saveRevocation(rev);
  assert.equal(after.loadEnvelopes().length, 1);
  assert.equal(after.loadRevocations().length, 1);
});

test("InMemoryMeshPersistence: monotonic envelope versioning — a v2 save replaces v1 under the same envelope_id", () => {
  const p = new InMemoryMeshPersistence();
  const v1: AuthorityEnvelope = {
    envelope_id: "env-mono", mae_id: "m", ward_id: "w", subject: "agent:a",
    allowed_action_types: ["a.do", "a.dangerous"], expires_at: "2099-01-01T00:00:00.000Z",
    issued_at: "2026-05-26T15:00:00.000Z", issued_by: "root", version: 1, signature: "sig1"
  };
  const v2: AuthorityEnvelope = { ...v1, allowed_action_types: ["a.do"], version: 2, signature: "sig2" };
  p.saveEnvelope(v1);
  p.saveEnvelope(v2);
  const loaded = p.loadEnvelopes();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].version, 2);
  assert.deepEqual(loaded[0].allowed_action_types, ["a.do"]);
});
