/**
 * Multi-witness quorum on revocations — hardening test.
 *
 * The threat closed: a single compromised root authority could
 * previously issue arbitrary revocations under its own signature.
 * Edges had no cryptographic way to demand that other witnesses also
 * attest to the revocation. With `requireRevocationQuorum: N` on the
 * edge, a revocation only takes effect after N distinct witnesses
 * (drawn from the edge's MeshVerifier trust anchors) have co-signed
 * the (revocation_id, target_id, root_signature) tuple.
 *
 * Asserts:
 *
 *   Q1. Backwards compat — root.revoke() without quorum still works
 *       for edges that don't set requireRevocationQuorum.
 *
 *   Q2. root.revokeWithQuorum() populates signing_quorum and
 *       gossips a revocation with N witness signatures.
 *
 *   Q3. An edge with requireRevocationQuorum: 2 accepts a revocation
 *       with 2 valid signatures and refuses subsequent commits.
 *
 *   Q4. An edge with requireRevocationQuorum: 2 REJECTS a revocation
 *       with only 1 valid signature (single compromised root can't
 *       push it through). The revocation is dropped from cache and
 *       the edge's quorumRejectedCount increments.
 *
 *   Q5. Duplicate witness signatures (same witness_id signing twice)
 *       are deduplicated — an attacker can't pad the count by replaying
 *       a single witness's sig.
 *
 *   Q6. Signatures from non-trusted witness ids are rejected
 *       (verifier's trust anchor allowlist filters them out).
 *
 *   Q7. Substitution defense — swapping the signing_quorum from one
 *       revocation onto a different revocation under the same
 *       revocation_id is rejected (witnesses sign root_signature, not
 *       just revocation_id, so swap breaks the binding).
 *
 *   Q8. pullRevocations honors quorum: a revocation that fails the
 *       quorum check during auto-pull is rejected (rejected++) and
 *       never cached.
 *
 *   Q9. revokeWithQuorum throws fast if fewer witnesses provided than
 *       requiredQuorum.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  EdgeNode,
  MeshNode,
  RootNode,
  WitnessNode,
  bindRegistry,
  countValidRevocationQuorum,
  createEd25519MeshSigner,
  createEd25519MeshVerifier,
  type CommitRequest,
  type NodeId,
  type QuorumSignature,
  type Revocation
} from "./index.js";

function genKeyPair(signerId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    signerId,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

interface ClusterOptions {
  edgeRequireQuorum?: number;
  numWitnesses?: number;
}

function setupEd25519ClusterWithQuorum(opts: ClusterOptions = {}) {
  const rootKp = genKeyPair("root-q");
  const witnessKps = Array.from({ length: opts.numWitnesses ?? 3 }, (_, i) => genKeyPair(`witness-q-${i + 1}`));
  const edgeKp = genKeyPair("edge-q-1");
  const allKps = [rootKp, ...witnessKps, edgeKp];
  const allowlist: Record<string, string> = {};
  for (const kp of allKps) allowlist[kp.signerId] = kp.publicKeyPem;

  const root = new RootNode({
    id: rootKp.signerId, host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: rootKp.signerId, privateKeyPem: rootKp.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: allowlist })
  });
  const witnesses = witnessKps.map((kp) => new WitnessNode({
    id: kp.signerId, host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: kp.signerId, privateKeyPem: kp.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: allowlist })
  }));
  const edge = new EdgeNode({
    id: edgeKp.signerId, host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: edgeKp.signerId, privateKeyPem: edgeKp.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: allowlist }),
    maxWarrantsWhileDisconnected: 5,
    requireRevocationQuorum: opts.edgeRequireQuorum
  });
  const witnessSigners = witnessKps.map((kp) =>
    createEd25519MeshSigner({ signerId: kp.signerId, privateKeyPem: kp.privateKeyPem })
  );

  const all: MeshNode[] = [root, ...witnesses, edge];
  const ids: NodeId[] = all.map((n) => n.asNodeId());
  for (const n of all) n.setPeers(ids.filter((p) => p.id !== n.getId()));
  const unbind = bindRegistry(all);
  return { root, witnesses, edge, witnessSigners, unbind, allowlist };
}

const ENVELOPE_ID = "env-quorum-001";
function makeEnvelope(root: RootNode) {
  return root.issueEnvelope({
    envelope_id: ENVELOPE_ID, mae_id: "mae-q", ward_id: "ward-q", subject: "agent:demo",
    allowed_action_types: ["demo.run"], expires_at: new Date(Date.now() + 60_000).toISOString(), version: 1
  });
}
function commitReq(actionId: string): CommitRequest {
  return {
    action_id: actionId, action_type: "demo.run", envelope_id: ENVELOPE_ID,
    subject: "agent:demo", params: { x: 1 }, presented_at: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Q1. Backwards compat
// ---------------------------------------------------------------------------

test("Q1: existing root.revoke() works for edges that don't require quorum", async () => {
  const { root, edge, unbind } = setupEd25519ClusterWithQuorum({ numWitnesses: 1 });
  try {
    makeEnvelope(root);
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edge.getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edge.receiveFluidityToken(token);
    await root.revoke(ENVELOPE_ID, "envelope", "compromise");
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(edge.cachedRevocationCount() >= 1, "edge with no quorum requirement caches the revocation");
    const d = await edge.evaluate(commitReq("post"));
    assert.equal(d.decision, "REFUSE");
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// Q2. revokeWithQuorum populates signing_quorum
// ---------------------------------------------------------------------------

test("Q2: revokeWithQuorum() produces a revocation with signing_quorum populated", async () => {
  const { root, witnessSigners, unbind } = setupEd25519ClusterWithQuorum({ numWitnesses: 3 });
  try {
    makeEnvelope(root);
    await new Promise((r) => setTimeout(r, 30));
    const rev = await root.revokeWithQuorum({
      target_id: ENVELOPE_ID, kind: "envelope", reason: "quorum-compromise",
      witnesses: witnessSigners.slice(0, 2), requiredQuorum: 2
    });
    assert.ok(rev.signing_quorum, "revocation must have signing_quorum");
    assert.equal(rev.signing_quorum!.length, 2, "exactly the required number of sigs collected");
    for (const sig of rev.signing_quorum!) {
      assert.equal(sig.artifact_kind, "revocation");
    }
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// Q3. Edge with quorum accepts properly-signed revocation
// ---------------------------------------------------------------------------

test("Q3: edge requireRevocationQuorum=2 accepts revocation with 2 valid sigs and refuses subsequent commits", async () => {
  const { root, edge, witnessSigners, unbind } = setupEd25519ClusterWithQuorum({ edgeRequireQuorum: 2, numWitnesses: 3 });
  try {
    makeEnvelope(root);
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edge.getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edge.receiveFluidityToken(token);
    await root.revokeWithQuorum({
      target_id: ENVELOPE_ID, kind: "envelope", reason: "ok",
      witnesses: witnessSigners.slice(0, 2), requiredQuorum: 2
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(edge.cachedRevocationCount() >= 1, "edge caches quorum-backed revocation");
    const d = await edge.evaluate(commitReq("post-quorum"));
    assert.equal(d.decision, "REFUSE");
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// Q4. Edge with quorum REJECTS single-root revocation
// ---------------------------------------------------------------------------

test("Q4: edge requireRevocationQuorum=2 REJECTS a single-signature revocation (no witness sigs)", async () => {
  const { root, edge, unbind } = setupEd25519ClusterWithQuorum({ edgeRequireQuorum: 2, numWitnesses: 3 });
  try {
    makeEnvelope(root);
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edge.getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edge.receiveFluidityToken(token);
    // root.revoke() is the legacy path; it produces a revocation with
    // NO signing_quorum. An edge that requires quorum must drop it.
    await root.revoke(ENVELOPE_ID, "envelope", "single-root-attack");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(edge.cachedRevocationCount(), 0,
      "edge requiring quorum must NOT cache a revocation lacking quorum");
    assert.ok(edge.getQuorumRejectedCount() >= 1, "quorum-rejected counter must advance");
    // Subsequent evaluate must still ALLOW (revocation was dropped).
    const d = await edge.evaluate(commitReq("post-attack"));
    assert.equal(d.decision, "ALLOW", "edge must NOT refuse the action — the malicious revocation was dropped");
  } finally { unbind(); }
});

test("Q4b: edge requireRevocationQuorum=2 REJECTS a revocation with only 1 valid sig (one witness short)", async () => {
  const { root, edge, witnessSigners, unbind } = setupEd25519ClusterWithQuorum({ edgeRequireQuorum: 2, numWitnesses: 3 });
  try {
    makeEnvelope(root);
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edge.getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edge.receiveFluidityToken(token);
    await root.revokeWithQuorum({
      target_id: ENVELOPE_ID, kind: "envelope", reason: "insufficient-quorum",
      witnesses: witnessSigners.slice(0, 1), requiredQuorum: 1   // root locally OK with 1
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(edge.cachedRevocationCount(), 0,
      "edge requiring 2 must NOT cache a 1-signature revocation");
    assert.ok(edge.getQuorumRejectedCount() >= 1);
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// Q5. Duplicate-witness sig padding is detected
// ---------------------------------------------------------------------------

test("Q5: duplicate witness signatures from the same witness_id are deduplicated", async () => {
  const { root, edge, witnessSigners, unbind } = setupEd25519ClusterWithQuorum({ edgeRequireQuorum: 2, numWitnesses: 3 });
  try {
    makeEnvelope(root);
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edge.getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edge.receiveFluidityToken(token);

    // Build a revocation by hand: 2 sigs but both from the SAME witness.
    const rev = await root.revokeWithQuorum({
      target_id: ENVELOPE_ID, kind: "envelope", reason: "pad-attack",
      witnesses: witnessSigners.slice(0, 1), requiredQuorum: 1
    });
    // Forge a "second" sig by re-using the only sig with a tweaked
    // signed_at (but same witness_id + same signature material).
    const dupedRev: Revocation = {
      ...rev,
      signing_quorum: [...(rev.signing_quorum ?? []), { ...rev.signing_quorum![0], signed_at: new Date().toISOString() }]
    };
    // Direct-send the padded revocation via gossip path.
    const result = await edge.direct({ kind: "GOSSIP_REVOCATION", revocation: dupedRev }) as { ok: boolean; reason?: string };
    assert.equal(result.ok, false);
    assert.equal(result.reason, "quorum-insufficient");
    assert.equal(edge.cachedRevocationCount(), 0);
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// Q6. Sigs from non-trusted witnesses are rejected
// ---------------------------------------------------------------------------

test("Q6: signatures from witnesses NOT in the verifier's allowlist are rejected", async () => {
  const { root, edge, witnessSigners, unbind } = setupEd25519ClusterWithQuorum({ edgeRequireQuorum: 2, numWitnesses: 3 });
  try {
    makeEnvelope(root);
    await new Promise((r) => setTimeout(r, 30));
    // Forge a sig under a witness id the edge's verifier doesn't trust.
    const attackerKp = genKeyPair("witness-attacker");
    const attackerSigner = createEd25519MeshSigner({ signerId: attackerKp.signerId, privateKeyPem: attackerKp.privateKeyPem });
    const rev = await root.revokeWithQuorum({
      target_id: ENVELOPE_ID, kind: "envelope", reason: "mixed",
      witnesses: [witnessSigners[0], attackerSigner], requiredQuorum: 2
    });
    // Verify that locally root accepted (it sees its own verifier trust the attacker —
    // we have to override). For this test, force edge to handle directly.
    const result = await edge.direct({ kind: "GOSSIP_REVOCATION", revocation: rev }) as { ok: boolean; reason?: string; observed?: number };
    assert.equal(result.ok, false, "edge must reject because only 1 sig (the trusted one) verifies");
    assert.equal(result.reason, "quorum-insufficient");
    assert.equal(result.observed, 1, "exactly one sig (the trusted witness's) verified");
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// Q7. Substitution defense — swap signing_quorum between revs
// ---------------------------------------------------------------------------

test("Q7: signing_quorum from rev-A is NOT valid on rev-B (witnesses bind to root_signature)", async () => {
  const { root, edge, witnessSigners, unbind } = setupEd25519ClusterWithQuorum({ edgeRequireQuorum: 2, numWitnesses: 3 });
  try {
    makeEnvelope(root);
    await new Promise((r) => setTimeout(r, 30));
    // Create two independently-quorumed revocations against different targets.
    const revA = await root.revokeWithQuorum({
      target_id: ENVELOPE_ID, kind: "envelope", reason: "real-A",
      witnesses: witnessSigners.slice(0, 2), requiredQuorum: 2
    });
    const otherEnvelope = "env-quorum-other";
    root.issueEnvelope({
      envelope_id: otherEnvelope, mae_id: "mae-q", ward_id: "ward-q", subject: "agent:demo",
      allowed_action_types: ["demo.run"], expires_at: new Date(Date.now() + 60_000).toISOString(), version: 1
    });
    const revB = await root.revokeWithQuorum({
      target_id: otherEnvelope, kind: "envelope", reason: "real-B",
      witnesses: witnessSigners.slice(0, 2), requiredQuorum: 2
    });
    // Forge: take revA's structure but graft revB's signing_quorum.
    const forged: Revocation = { ...revA, signing_quorum: revB.signing_quorum };
    const result = await edge.direct({ kind: "GOSSIP_REVOCATION", revocation: forged }) as { ok: boolean; reason?: string; observed?: number };
    assert.equal(result.ok, false, "swapped signing_quorum must be rejected");
    assert.equal(result.reason, "quorum-insufficient");
    assert.equal(result.observed, 0, "zero sigs verify against the substituted revocation");
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// Q8. pullRevocations honors quorum
// ---------------------------------------------------------------------------

test("Q8: pullRevocations skips revocations that fail the quorum check", async () => {
  const { root, edge, unbind } = setupEd25519ClusterWithQuorum({ edgeRequireQuorum: 2, numWitnesses: 3 });
  try {
    makeEnvelope(root);
    await new Promise((r) => setTimeout(r, 30));
    // Partition edge from gossip, then issue a legacy (no-quorum) revocation.
    edge.partitionFrom("root-q");
    edge.partitionFrom("witness-q-1");
    edge.partitionFrom("witness-q-2");
    edge.partitionFrom("witness-q-3");
    await root.revoke(ENVELOPE_ID, "envelope", "stale-attack");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(edge.cachedRevocationCount(), 0);
    // Heal root; pullRevocations runs.
    edge.healPartition("root-q");
    const { pulled, rejected } = await edge.pullRevocations(0);
    assert.equal(pulled, 0, "no-quorum revocation must not be pulled");
    assert.ok(rejected >= 1, "must be counted as rejected");
    assert.equal(edge.cachedRevocationCount(), 0);
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// Q9. revokeWithQuorum fails fast
// ---------------------------------------------------------------------------

test("Q9: revokeWithQuorum throws when fewer witnesses provided than requiredQuorum", async () => {
  const { root, witnessSigners, unbind } = setupEd25519ClusterWithQuorum({ numWitnesses: 3 });
  try {
    await assert.rejects(
      () => root.revokeWithQuorum({
        target_id: ENVELOPE_ID, kind: "envelope", reason: "x",
        witnesses: witnessSigners.slice(0, 1), requiredQuorum: 2
      }),
      /only 1 witnesses provided, need 2/
    );
  } finally { unbind(); }
});

test("Q9b: revokeWithQuorum throws when requiredQuorum < 1", async () => {
  const { root, witnessSigners, unbind } = setupEd25519ClusterWithQuorum({ numWitnesses: 3 });
  try {
    await assert.rejects(
      () => root.revokeWithQuorum({
        target_id: ENVELOPE_ID, kind: "envelope", reason: "x",
        witnesses: witnessSigners, requiredQuorum: 0
      }),
      /requiredQuorum must be >= 1/
    );
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// Unit test for countValidRevocationQuorum
// ---------------------------------------------------------------------------

test("countValidRevocationQuorum: returns 0 for revocation without signing_quorum", () => {
  // Verifier with no trust anchors — irrelevant; revocation has no sigs.
  const verifier = createEd25519MeshVerifier({ trustedKeys: {} });
  const rev: Revocation = {
    revocation_id: "rev-x", target_id: "t", kind: "envelope", reason: "r",
    revoked_at: new Date().toISOString(), issued_by: "root-q", signature: ""
  };
  assert.equal(countValidRevocationQuorum(verifier, rev), 0);
  const rev2: Revocation = { ...rev, signing_quorum: [] };
  assert.equal(countValidRevocationQuorum(verifier, rev2), 0);
});
