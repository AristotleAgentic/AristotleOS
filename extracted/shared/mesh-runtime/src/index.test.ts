import test from "node:test";
import assert from "node:assert/strict";
import { bindRegistry, EdgeNode, RootNode, WitnessNode, type CommitRequest, type NodeId } from "./index.js";

// All tests run in-process via the bindRegistry registry — deterministic,
// no flaky network setup. The HTTP path is exercised by the same code path
// inside `sendTo` when no registry is bound (covered by the live-port test
// at the bottom).

function setupCluster() {
  const secret = "demo-mesh-secret";
  const root = new RootNode({ id: "root-1", host: "127.0.0.1", port: 0, secret });
  const w1 = new WitnessNode({ id: "witness-1", host: "127.0.0.1", port: 0, secret });
  const w2 = new WitnessNode({ id: "witness-2", host: "127.0.0.1", port: 0, secret });
  const edges = [1, 2, 3].map((i) => new EdgeNode({ id: `edge-${i}`, host: "127.0.0.1", port: 0, secret, maxWarrantsWhileDisconnected: 5 }));

  const all = [root, w1, w2, ...edges];
  const ids: NodeId[] = all.map((n) => n.asNodeId());
  for (const n of all) n.setPeers(ids.filter((p) => p.id !== n.getId()));
  const unbind = bindRegistry(all);
  return { root, witnesses: [w1, w2], edges, unbind };
}

const ENVELOPE_ID = "env-demo-001";
function makeEnvelope(root: RootNode, expiresAt: string, version = 1) {
  return root.issueEnvelope({
    envelope_id: ENVELOPE_ID,
    mae_id: "mae-demo",
    ward_id: "ward-demo",
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

test("envelope propagates from root through witnesses to all edges", async () => {
  const { root, witnesses, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    // Allow the gossip to land (root -> witnesses -> edges).
    await new Promise((r) => setTimeout(r, 30));
    for (const w of witnesses) assert.equal(w.cachedEnvelopeCount(), 1);
    for (const e of edges) assert.equal(e.cachedEnvelopeCount(), 1);
  } finally { unbind(); }
});

test("edge issues warrant on ALLOW under valid Fluidity Token", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 30_000 });
    edges[0].receiveFluidityToken(token);
    const decision = await edges[0].evaluate(commitReq("a1"));
    assert.equal(decision.decision, "ALLOW");
    if (decision.decision === "ALLOW") {
      assert.equal(decision.warrant.envelope_id, ENVELOPE_ID);
      assert.equal(decision.warrant.under_fluidity_token, token.token_id);
      assert.equal(decision.warrant.root_reachable_at_issue, true);
    }
  } finally { unbind(); }
});

test("edge REFUSES when revocation has propagated", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 30_000 });
    edges[0].receiveFluidityToken(token);
    await root.revoke(ENVELOPE_ID, "envelope", "demo-revoke");
    await new Promise((r) => setTimeout(r, 30));
    const decision = await edges[0].evaluate(commitReq("a2"));
    assert.equal(decision.decision, "REFUSE");
    if (decision.decision === "REFUSE") {
      assert.ok(decision.reason_codes.includes("ENVELOPE_REVOKED"));
    }
  } finally { unbind(); }
});

test("partition: edge keeps issuing under Fluidity Token TTL, then EXPIRES on TTL expiry", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60 });
    edges[0].receiveFluidityToken(token);
    // Partition the edge from root + witnesses.
    edges[0].partitionFrom("root-1"); edges[0].partitionFrom("witness-1"); edges[0].partitionFrom("witness-2");

    // Within TTL: still ALLOW.
    const d1 = await edges[0].evaluate(commitReq("a1"));
    assert.equal(d1.decision, "ALLOW");
    if (d1.decision === "ALLOW") {
      assert.equal(d1.warrant.root_reachable_at_issue, false);
    }

    // After TTL: EXPIRE.
    await new Promise((r) => setTimeout(r, 80));
    const d2 = await edges[0].evaluate(commitReq("a2"));
    assert.equal(d2.decision, "EXPIRE");
    if (d2.decision === "EXPIRE") {
      assert.ok(d2.reason_codes.includes("FLUIDITY_TOKEN_EXPIRED"));
    }
  } finally { unbind(); }
});

test("partition: revocation issued during split is detected via surviving witness", async () => {
  const { root, witnesses, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edges[0].receiveFluidityToken(token);

    // Partition the edge from ROOT but NOT from witnesses.
    edges[0].partitionFrom("root-1");
    // Edge still has direct revocation path from witnesses because the root
    // gossips revocations to witnesses, and witnesses gossip to edges.
    await root.revoke(ENVELOPE_ID, "envelope", "compromise");
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(witnesses[0].cachedRevocationCount() >= 1);
    assert.ok(edges[0].cachedRevocationCount() >= 1, "edge must learn the revocation via the witness gossip path");
    const d = await edges[0].evaluate(commitReq("a1"));
    assert.equal(d.decision, "REFUSE");
  } finally { unbind(); }
});

test("disconnected-quota cap: edge fails closed after exceeding maxWarrantsWhileDisconnected", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edges[0].receiveFluidityToken(token);
    // Partition from root only.
    edges[0].partitionFrom("root-1");
    for (let i = 0; i < 5; i++) {
      const d = await edges[0].evaluate(commitReq(`a${i}`));
      assert.equal(d.decision, "ALLOW", `i=${i}`);
    }
    const sixth = await edges[0].evaluate(commitReq("a6"));
    assert.equal(sixth.decision, "REFUSE");
    if (sixth.decision === "REFUSE") {
      assert.ok(sixth.reason_codes.includes("DISCONNECTED_QUOTA_EXCEEDED"));
    }
  } finally { unbind(); }
});

test("reconciliation: edge submits local decisions to root after partition heal", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edges[0].receiveFluidityToken(token);
    edges[0].partitionFrom("root-1");

    // Issue a few warrants while disconnected.
    for (let i = 0; i < 3; i++) await edges[0].evaluate(commitReq(`a${i}`));
    assert.equal(edges[0].localDecisionCount(), 3);

    // Heal and reconcile.
    edges[0].healPartition("root-1");
    const conflicts = await edges[0].reconcile();
    assert.equal(conflicts.length, 0);
    assert.equal(edges[0].localDecisionCount(), 0);
    assert.equal(root.getSubmittedEdgeDecisions().length, 3);
  } finally { unbind(); }
});

test("reconciliation: edge submitted-after-revocation decisions surface as conflicts", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edges[0].receiveFluidityToken(token);

    // Partition fully and revoke at root.
    edges[0].partitionFrom("root-1"); edges[0].partitionFrom("witness-1"); edges[0].partitionFrom("witness-2");
    await root.revoke(ENVELOPE_ID, "envelope", "compromise");

    // Edge doesn't see the revocation, issues a warrant.
    await new Promise((r) => setTimeout(r, 5));
    const d = await edges[0].evaluate(commitReq("a-bad"));
    assert.equal(d.decision, "ALLOW");

    // Heal partition; reconcile should produce a conflict.
    edges[0].healPartition("root-1"); edges[0].healPartition("witness-1"); edges[0].healPartition("witness-2");
    const conflicts = await edges[0].reconcile();
    assert.equal(conflicts.length, 1);
    assert.match(JSON.stringify(conflicts[0].conflict), /warrant_issued_after_revocation/);
  } finally { unbind(); }
});

test("envelope versioning: a higher-version envelope replaces a lower one", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString(), 1);
    await new Promise((r) => setTimeout(r, 30));
    root.issueEnvelope({
      envelope_id: ENVELOPE_ID,
      mae_id: "mae-demo",
      ward_id: "ward-demo",
      subject: "agent:demo",
      allowed_action_types: ["demo.run", "demo.scoped_more"], // wider
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      version: 2
    });
    await new Promise((r) => setTimeout(r, 30));
    // Edge should now know about demo.scoped_more.
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edges[0].receiveFluidityToken(token);
    const widerReq: CommitRequest = { ...commitReq("a"), action_type: "demo.scoped_more" };
    const d = await edges[0].evaluate(widerReq);
    assert.equal(d.decision, "ALLOW");
  } finally { unbind(); }
});

test("envelope EXPIRED returns the distinct EXPIRE decision (not REFUSE)", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() - 1000).toISOString()); // already expired
    await new Promise((r) => setTimeout(r, 30));
    const token = root.issueFluidityToken({ edge_id: edges[0].getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edges[0].receiveFluidityToken(token);
    const d = await edges[0].evaluate(commitReq("a1"));
    assert.equal(d.decision, "EXPIRE");
    if (d.decision === "EXPIRE") {
      assert.ok(d.reason_codes.includes("ENVELOPE_EXPIRED"));
    }
  } finally { unbind(); }
});

test("live HTTP transport: root and edge can talk over real TCP sockets", async () => {
  const secret = "live-secret";
  const root = new RootNode({ id: "root-live", host: "127.0.0.1", port: 21041, secret });
  const edge = new EdgeNode({ id: "edge-live", host: "127.0.0.1", port: 21042, secret });
  const ids: NodeId[] = [root.asNodeId(), edge.asNodeId()];
  root.setPeers([edge.asNodeId()]);
  edge.setPeers([root.asNodeId()]);
  await root.start();
  await edge.start();
  try {
    // Use HTTP path explicitly (no registry binding).
    const env = root.issueEnvelope({
      envelope_id: ENVELOPE_ID,
      mae_id: "mae-live",
      ward_id: "ward-live",
      subject: "agent:demo",
      allowed_action_types: ["demo.run"],
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      version: 1
    });
    // Wait for propagation over real HTTP.
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(edge.cachedEnvelopeCount(), 1);
    const token = root.issueFluidityToken({ edge_id: edge.getId(), envelope_id: ENVELOPE_ID, ttl_ms: 30_000 });
    edge.receiveFluidityToken(token);
    const d = await edge.evaluate(commitReq("a-live"));
    assert.equal(d.decision, "ALLOW");
    // Suppress unused warning.
    void env;
    void ids;
  } finally {
    await root.stop();
    await edge.stop();
  }
});

// ---------------------------------------------------------------------------
// LIMITATIONS.md § 5 regression: edge auto-pulls missed revocations after
// a partition heal. Pre-fix, the edge had no public path to recover a
// revocation gossiped during its disconnected window — it relied entirely
// on a future re-gossip from the operator. With pullRevocations() and the
// pingRoot reconnect trigger, the edge actively reconciles its revocation
// cache the first time it sees the root again.
// ---------------------------------------------------------------------------

test("auto-pull: pullRevocations() backfills the edge from root after a missed gossip window", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const edge = edges[0];
    const token = root.issueFluidityToken({ edge_id: edge.getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edge.receiveFluidityToken(token);
    assert.equal(edge.cachedRevocationCount(), 0);

    // Full isolation: edge sees neither root nor either witness.
    edge.partitionFrom("root-1");
    edge.partitionFrom("witness-1");
    edge.partitionFrom("witness-2");

    // Root revokes the envelope while the edge is fully blind.
    await root.revoke(ENVELOPE_ID, "envelope", "compromise-during-partition");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(edge.cachedRevocationCount(), 0, "edge must not have learned the revocation while partitioned");

    // Heal only the root link. The witness gossip path stays cold so
    // recovery has to come from the auto-pull (not from witness re-gossip).
    edge.healPartition("root-1");
    const { pulled, rejected } = await edge.pullRevocations(0);
    assert.equal(rejected, 0);
    assert.ok(pulled >= 1, `expected at least one revocation pulled, got ${pulled}`);
    assert.ok(edge.cachedRevocationCount() >= 1, "edge cache must reflect the pulled revocation");

    // The pulled revocation is now visible to the gate.
    const d = await edge.evaluate(commitReq("post-pull"));
    assert.equal(d.decision, "REFUSE");
    if (d.decision === "REFUSE") {
      assert.ok(d.reason_codes.includes("ENVELOPE_REVOKED"));
    }
  } finally { unbind(); }
});

test("auto-pull: pingRoot reconnect transition fires pullRevocations automatically", async () => {
  const { root, edges, unbind } = setupCluster();
  try {
    makeEnvelope(root, new Date(Date.now() + 60_000).toISOString());
    await new Promise((r) => setTimeout(r, 30));
    const edge = edges[0];
    const token = root.issueFluidityToken({ edge_id: edge.getId(), envelope_id: ENVELOPE_ID, ttl_ms: 60_000 });
    edge.receiveFluidityToken(token);

    // First evaluate is ALLOW — pingRoot succeeds, lastRootReachable stays true.
    const d0 = await edge.evaluate(commitReq("pre-partition"));
    assert.equal(d0.decision, "ALLOW");
    const baselinePullCount = edge.getAutoPullCount();

    // Fully isolate the edge.
    edge.partitionFrom("root-1");
    edge.partitionFrom("witness-1");
    edge.partitionFrom("witness-2");

    // Evaluate under partition: pingRoot fails, lastRootReachable -> false.
    // The decision still rides the Fluidity Token; the point is to flip the
    // edge's view of reachability.
    await edge.evaluate(commitReq("during-partition"));
    assert.equal(edge.cachedRevocationCount(), 0);

    // Root revokes while the edge is blind.
    await root.revoke(ENVELOPE_ID, "envelope", "compromise-during-partition-2");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(edge.cachedRevocationCount(), 0, "edge must still be blind to the revocation");

    // Heal only the root link. The next evaluate's pingRoot succeeds and
    // detects the disconnected -> reconnected transition, kicking off
    // pullRevocations as a fire-and-forget side effect.
    edge.healPartition("root-1");
    await edge.evaluate(commitReq("post-heal-trigger"));
    // Give the fire-and-forget pull a tick to land.
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(
      edge.getAutoPullCount() > baselinePullCount,
      `auto-pull counter must advance on reconnect (was ${baselinePullCount}, now ${edge.getAutoPullCount()})`
    );
    assert.ok(
      edge.cachedRevocationCount() >= 1,
      "edge cache must include the revocation that landed at root during the partition"
    );

    // Subsequent evaluate now refuses on the auto-pulled revocation.
    const d2 = await edge.evaluate(commitReq("post-heal-verify"));
    assert.equal(d2.decision, "REFUSE");
    if (d2.decision === "REFUSE") {
      assert.ok(d2.reason_codes.includes("ENVELOPE_REVOKED"));
    }
  } finally { unbind(); }
});
