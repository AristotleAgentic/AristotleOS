/**
 * Per-node Ed25519 mesh trust — hardening test.
 *
 * Closes ROADMAP_TO_100.md Category 1 item: "Replace shared-HMAC mesh
 * trust with per-node Ed25519 keypairs gated by MAE signing-key
 * allowlist".
 *
 * The existing HMAC path stays as the default for backwards compat
 * (verified by the rest of index.test.ts continuing to pass with
 * { secret }). This file proves the Ed25519 path:
 *
 *   1. A mesh wired with per-node Ed25519 signers + matching trust
 *      anchors propagates envelopes and revocations end-to-end exactly
 *      like the HMAC mesh does.
 *
 *   2. A mesh whose verifier DOES NOT include the issuer's trust anchor
 *      refuses the envelope as bad-signature — proving the allowlist
 *      actually filters.
 *
 *   3. A mesh whose verifier HAS a trust anchor for the issuer's id but
 *      bound to the WRONG public key (key-substitution / impersonation)
 *      refuses the envelope — proving the signature math actually runs,
 *      not just the id lookup.
 *
 *   4. MeshNode constructor fails fast on misconfiguration: only signer,
 *      or only verifier, or neither secret nor signer+verifier.
 *
 * No HMAC fallback is used in this file. Every node holds an explicit
 * keypair and an explicit allowlist.
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
  createEd25519MeshSigner,
  createEd25519MeshVerifier,
  type CommitRequest,
  type NodeId
} from "./index.js";

interface KeyPairPem { signerId: string; privateKeyPem: string; publicKeyPem: string; }

function genKeyPair(signerId: string): KeyPairPem {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    signerId,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

function setupEd25519Cluster(rootKp: KeyPairPem, witnessKps: KeyPairPem[], edgeKps: KeyPairPem[]) {
  // Every node's verifier trusts every other node's public key — this is
  // the "happy-path" allowlist. The tests below tweak this allowlist
  // explicitly to prove rejection.
  const allKps = [rootKp, ...witnessKps, ...edgeKps];
  const fullAllowlist: Record<string, string> = {};
  for (const kp of allKps) fullAllowlist[kp.signerId] = kp.publicKeyPem;

  const root = new RootNode({
    id: rootKp.signerId, host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: rootKp.signerId, privateKeyPem: rootKp.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: fullAllowlist })
  });
  const witnesses = witnessKps.map((kp) => new WitnessNode({
    id: kp.signerId, host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: kp.signerId, privateKeyPem: kp.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: fullAllowlist })
  }));
  const edges = edgeKps.map((kp) => new EdgeNode({
    id: kp.signerId, host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: kp.signerId, privateKeyPem: kp.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: fullAllowlist }),
    maxWarrantsWhileDisconnected: 5
  }));

  const all: MeshNode[] = [root, ...witnesses, ...edges];
  const ids: NodeId[] = all.map((n) => n.asNodeId());
  for (const n of all) n.setPeers(ids.filter((p) => p.id !== n.getId()));
  const unbind = bindRegistry(all);
  return { root, witnesses, edges, unbind };
}

const ENVELOPE_ID = "env-ed25519-001";
function makeEnvelope(root: RootNode, expiresAt: string, version = 1) {
  return root.issueEnvelope({
    envelope_id: ENVELOPE_ID,
    mae_id: "mae-ed25519",
    ward_id: "ward-ed25519",
    subject: "agent:demo",
    allowed_action_types: ["demo.run"],
    expires_at: expiresAt,
    version
  });
}

function commitReq(actionId: string): CommitRequest {
  return {
    action_id: actionId,
    action_type: "demo.run",
    envelope_id: ENVELOPE_ID,
    subject: "agent:demo",
    params: { x: 1 },
    presented_at: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// (1) Happy path: full Ed25519 mesh propagates envelopes + revocations
// ---------------------------------------------------------------------------

test("Ed25519 mesh: envelope propagates root -> witnesses -> edges with per-node keys", async () => {
  const rootKp = genKeyPair("root-ed25519-1");
  const witnessKps = [genKeyPair("witness-ed25519-1"), genKeyPair("witness-ed25519-2")];
  const edgeKps = [genKeyPair("edge-ed25519-1"), genKeyPair("edge-ed25519-2")];
  const { root, witnesses, edges, unbind } = setupEd25519Cluster(rootKp, witnessKps, edgeKps);
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    for (const w of witnesses) assert.equal(w.cachedEnvelopeCount(), 1, `witness ${w.getId()} must cache envelope`);
    for (const e of edges) assert.equal(e.cachedEnvelopeCount(), 1, `edge ${e.getId()} must cache envelope`);
  } finally { unbind(); }
});

test("Ed25519 mesh: revocation gossips end-to-end and edge refuses", async () => {
  const rootKp = genKeyPair("root-ed25519-1");
  const witnessKps = [genKeyPair("witness-ed25519-1")];
  const edgeKps = [genKeyPair("edge-ed25519-1")];
  const { root, edges, unbind } = setupEd25519Cluster(rootKp, witnessKps, edgeKps);
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edges[0].receiveFluidityToken(token);
    await root.revoke(ENVELOPE_ID, "envelope", "ed25519-revoke-test");
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(edges[0].cachedRevocationCount() >= 1, "edge must learn revocation under Ed25519");
    const d = await edges[0].evaluate(commitReq("post-revoke"));
    assert.equal(d.decision, "REFUSE");
  } finally { unbind(); }
});

test("Ed25519 mesh: edge issues warrant signed by its own private key under valid token", async () => {
  const rootKp = genKeyPair("root-ed25519-1");
  const edgeKps = [genKeyPair("edge-ed25519-1")];
  const { root, edges, unbind } = setupEd25519Cluster(rootKp, [], edgeKps);
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edges[0].receiveFluidityToken(token);
    const d = await edges[0].evaluate(commitReq("ed25519-warrant"));
    assert.equal(d.decision, "ALLOW");
    if (d.decision === "ALLOW") {
      assert.equal(d.warrant.issued_by_edge, edges[0].getId());
      assert.ok(d.warrant.signature.startsWith("ed25519:"),
        "warrant signature must be tagged ed25519 when edge uses Ed25519 signer");
    }
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// (2) Allowlist enforcement: rotating the issuer's trust anchor out
//     causes downstream verification to reject the envelope.
// ---------------------------------------------------------------------------

test("Ed25519 allowlist: witness without root's trust anchor REFUSES the envelope", async () => {
  const rootKp = genKeyPair("root-ed25519-1");
  const witnessKp = genKeyPair("witness-ed25519-1");
  // Build the witness's verifier WITHOUT root's public key.
  const allowlistWithoutRoot = { [witnessKp.signerId]: witnessKp.publicKeyPem };
  const root = new RootNode({
    id: rootKp.signerId, host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: rootKp.signerId, privateKeyPem: rootKp.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: { [rootKp.signerId]: rootKp.publicKeyPem, [witnessKp.signerId]: witnessKp.publicKeyPem } })
  });
  const witness = new WitnessNode({
    id: witnessKp.signerId, host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: witnessKp.signerId, privateKeyPem: witnessKp.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: allowlistWithoutRoot })
  });
  const all: MeshNode[] = [root, witness];
  const ids = all.map((n) => n.asNodeId());
  for (const n of all) n.setPeers(ids.filter((p) => p.id !== n.getId()));
  const unbind = bindRegistry(all);
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(witness.cachedEnvelopeCount(), 0,
      "witness without root in its allowlist must NOT cache the envelope (signature rejected)");
  } finally { unbind(); }
});

test("Ed25519 impersonation defense: trust anchor bound to wrong key REFUSES envelope", async () => {
  const realRoot = genKeyPair("root-ed25519-1");
  const witnessKp = genKeyPair("witness-ed25519-1");
  // Build a different keypair under the SAME signerId — simulates an
  // attacker who knows the legitimate root's id but used their own
  // private key to sign. The witness has an allowlist entry for that
  // signerId, but bound to the REAL root's public key.
  const attackerKey = genKeyPair("root-ed25519-1");
  assert.notEqual(attackerKey.publicKeyPem, realRoot.publicKeyPem,
    "test setup: attacker keypair must differ from real root");

  const attackerRoot = new RootNode({
    id: "root-ed25519-1", host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: "root-ed25519-1", privateKeyPem: attackerKey.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: { [witnessKp.signerId]: witnessKp.publicKeyPem } })
  });
  const witness = new WitnessNode({
    id: witnessKp.signerId, host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: witnessKp.signerId, privateKeyPem: witnessKp.privateKeyPem }),
    verifier: createEd25519MeshVerifier({ trustedKeys: { "root-ed25519-1": realRoot.publicKeyPem, [witnessKp.signerId]: witnessKp.publicKeyPem } })
  });
  const all: MeshNode[] = [attackerRoot, witness];
  const ids = all.map((n) => n.asNodeId());
  for (const n of all) n.setPeers(ids.filter((p) => p.id !== n.getId()));
  const unbind = bindRegistry(all);
  try {
    makeEnvelope(attackerRoot, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(witness.cachedEnvelopeCount(), 0,
      "witness must reject envelope signed by attacker's key under impersonated id");
  } finally { unbind(); }
});

// ---------------------------------------------------------------------------
// (3) Constructor misconfiguration: fail fast.
// ---------------------------------------------------------------------------

test("MeshNode constructor: only signer (no verifier) throws", () => {
  const kp = genKeyPair("a");
  assert.throws(() => new RootNode({
    id: "a", host: "127.0.0.1", port: 0,
    signer: createEd25519MeshSigner({ signerId: "a", privateKeyPem: kp.privateKeyPem })
  } as never), /signer and verifier must be provided together/);
});

test("MeshNode constructor: only verifier (no signer) throws", () => {
  assert.throws(() => new RootNode({
    id: "a", host: "127.0.0.1", port: 0,
    verifier: createEd25519MeshVerifier({ trustedKeys: {} })
  } as never), /signer and verifier must be provided together/);
});

test("MeshNode constructor: no secret AND no signer/verifier throws", () => {
  assert.throws(() => new RootNode({
    id: "a", host: "127.0.0.1", port: 0
  } as never), /must provide either/);
});
