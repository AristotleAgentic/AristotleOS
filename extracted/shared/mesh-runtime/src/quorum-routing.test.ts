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
