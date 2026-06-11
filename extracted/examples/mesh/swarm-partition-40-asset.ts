/**
 * 40-asset disconnected-swarm partition demo.
 *
 * Spins up a real Aristotle governance mesh:
 *
 *   1 root authority (signs envelopes + revocations)
 *   2 witness nodes (replicate state, gossip revocations)
 *   40 edge gates (one per autonomous asset, each runs a Disconnected
 *                  Commit Gate locally and issues Warrants under a
 *                  Fluidity Token while disconnected from the root)
 *
 * Then it runs a 4-phase scenario:
 *
 *   PHASE 1 - Nominal: all nodes connected. Each of the 40 assets evaluates
 *             one action and receives a Warrant from its local edge gate.
 *
 *   PHASE 2 - Partition: half the swarm is severed from the root authority
 *             (but NOT from at least one witness). Each asset evaluates
 *             another action under disconnect; the still-witness-connected
 *             half receives revocations via gossip; the fully-isolated
 *             half continues until Fluidity Token TTL.
 *
 *   PHASE 3 - Revocation under partition: root revokes 5 envelopes. The
 *             witness-reachable half blocks immediately; the fully-isolated
 *             half does not see the revocation until reconciliation.
 *
 *   PHASE 4 - Heal + reconcile: all partitions heal. Edges submit their
 *             disconnected decisions. The root flags conflicts where a
 *             warrant was issued AFTER its envelope was revoked at the
 *             root authority.
 *
 * The scenario produces a deterministic stdout report. Run with:
 *
 *   node --import tsx examples/mesh/swarm-partition-40-asset.ts
 *
 * For the test sweep, run:
 *
 *   node --import tsx --test examples/mesh/swarm-partition-40-asset.test.ts
 */

import {
  bindRegistry,
  EdgeNode,
  RootNode,
  WitnessNode,
  type CommitDecision,
  type CommitRequest,
  type NodeId
} from "../../shared/mesh-runtime/src/index.js";

export interface ScenarioReport {
  total_assets: number;
  phase1_allow: number;
  phase1_other: number;
  phase2_allow: number;
  phase2_refuse: number;
  phase2_expire: number;
  phase3_witness_half_refused: number;
  phase3_isolated_half_allowed: number;
  phase4_reconciled_clean: number;
  phase4_reconciled_conflicts: number;
  total_warrants_issued: number;
  total_revocations: number;
}

const SECRET = "aos-demo-swarm-secret";

export async function runSwarmPartitionScenario(opts: {
  assetCount?: number;
  fluidityTtlMs?: number;
  printReport?: boolean;
} = {}): Promise<ScenarioReport> {
  const assetCount = opts.assetCount ?? 40;
  const fluidityTtlMs = opts.fluidityTtlMs ?? 1500;
  const print = opts.printReport ?? false;

  // --- Bring up the mesh ---------------------------------------------------
  const root = new RootNode({ id: "root-cmd", host: "127.0.0.1", port: 0, secret: SECRET });
  const witnessA = new WitnessNode({ id: "witness-A", host: "127.0.0.1", port: 0, secret: SECRET });
  const witnessB = new WitnessNode({ id: "witness-B", host: "127.0.0.1", port: 0, secret: SECRET });
  const edges: EdgeNode[] = [];
  for (let i = 0; i < assetCount; i++) {
    edges.push(new EdgeNode({
      id: `asset-${String(i).padStart(2, "0")}`,
      host: "127.0.0.1", port: 0, secret: SECRET,
      maxWarrantsWhileDisconnected: 50
    }));
  }
  const all = [root, witnessA, witnessB, ...edges];
  const ids: NodeId[] = all.map((n) => n.asNodeId());
  for (const n of all) n.setPeers(ids.filter((p) => p.id !== n.getId()));
  const unbind = bindRegistry(all);

  // --- Provision envelopes + Fluidity Tokens -------------------------------
  // Per-asset envelope so revocations can target individual assets.
  for (let i = 0; i < assetCount; i++) {
    root.issueEnvelope({
      envelope_id: `env-${edges[i].getId()}`,
      mae_id: "mae-swarm-cmd",
      ward_id: "ward-swarm-ops",
      subject: `agent:${edges[i].getId()}`,
      allowed_action_types: ["swarm.fly", "swarm.deploy"],
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      version: 1
    });
  }
  // Let gossip settle.
  await new Promise((r) => setTimeout(r, 30));

  for (let i = 0; i < assetCount; i++) {
    const tok = root.issueFluidityToken({
      edge_id: edges[i].getId(),
      envelope_id: `env-${edges[i].getId()}`,
      ttl_ms: fluidityTtlMs
    });
    edges[i].receiveFluidityToken(tok);
  }

  const report: ScenarioReport = {
    total_assets: assetCount,
    phase1_allow: 0, phase1_other: 0,
    phase2_allow: 0, phase2_refuse: 0, phase2_expire: 0,
    phase3_witness_half_refused: 0, phase3_isolated_half_allowed: 0,
    phase4_reconciled_clean: 0, phase4_reconciled_conflicts: 0,
    total_warrants_issued: 0, total_revocations: 0
  };

  function req(edgeId: string, n: number): CommitRequest {
    return {
      action_id: `act-${edgeId}-${n}`,
      action_type: "swarm.fly",
      envelope_id: `env-${edgeId}`,
      subject: `agent:${edgeId}`,
      params: { sortie: n, area: "demo-grid-A" },
      presented_at: new Date().toISOString()
    };
  }

  function tally(phase: "1" | "2", d: CommitDecision): void {
    if (phase === "1") {
      if (d.decision === "ALLOW") { report.phase1_allow++; report.total_warrants_issued++; }
      else report.phase1_other++;
    } else {
      if (d.decision === "ALLOW") { report.phase2_allow++; report.total_warrants_issued++; }
      else if (d.decision === "REFUSE") report.phase2_refuse++;
      else if (d.decision === "EXPIRE") report.phase2_expire++;
    }
  }

  // --- PHASE 1: nominal flight ---------------------------------------------
  for (let i = 0; i < assetCount; i++) {
    const d = await edges[i].evaluate(req(edges[i].getId(), 1));
    tally("1", d);
  }

  // --- PHASE 2: partition half from root + witnessA, leave witness B path --
  const partitionedHalf = edges.slice(0, assetCount / 2);
  for (const e of partitionedHalf) {
    e.partitionFrom("root-cmd");
    e.partitionFrom("witness-A");
    // witness-B path still open
  }
  // Also partition the "fully isolated" subset of the partitioned half from witnessB.
  const isolatedBoundary = Math.floor(assetCount / 4);
  const fullyIsolated = partitionedHalf.slice(0, isolatedBoundary);
  for (const e of fullyIsolated) {
    e.partitionFrom("witness-B");
  }
  // Each asset evaluates one more action under the partition.
  for (let i = 0; i < assetCount; i++) {
    const d = await edges[i].evaluate(req(edges[i].getId(), 2));
    tally("2", d);
  }

  // --- PHASE 3: root revokes envelopes for first 10 assets ----------------
  for (let i = 0; i < 10; i++) {
    await root.revoke(`env-${edges[i].getId()}`, "envelope", "compromise-suspected");
    report.total_revocations++;
  }
  // Wait for gossip to propagate through witnessB to the witness-reachable
  // subset of the partitioned half. fullyIsolated will NOT see it.
  await new Promise((r) => setTimeout(r, 60));

  // Each revoked asset evaluates again.
  for (let i = 0; i < 10; i++) {
    const d = await edges[i].evaluate(req(edges[i].getId(), 3));
    if (i < isolatedBoundary) {
      // Fully isolated -> still ALLOW until TTL
      if (d.decision === "ALLOW") {
        report.phase3_isolated_half_allowed++;
        report.total_warrants_issued++;
      }
    } else {
      // Witness-reachable -> REFUSE (revocation gossiped via witnessB)
      if (d.decision === "REFUSE") report.phase3_witness_half_refused++;
    }
  }

  // --- PHASE 4: heal + reconcile ------------------------------------------
  for (const e of partitionedHalf) {
    e.healPartition("root-cmd");
    e.healPartition("witness-A");
    e.healPartition("witness-B");
  }
  // Reconciliation: each previously-isolated edge submits its local decisions
  // to root. Root flags conflicts.
  for (let i = 0; i < assetCount; i++) {
    const conflicts = await edges[i].reconcile();
    if (conflicts.length === 0) report.phase4_reconciled_clean++;
    else report.phase4_reconciled_conflicts += conflicts.length;
  }

  unbind();

  if (print) {
    console.log("=== AristotleOS Mesh Scenario: 40-asset disconnected swarm ===");
    console.log(JSON.stringify(report, null, 2));
  }

  return report;
}

// Direct-invocation entry point.
const isMain = (() => {
  try {
    const url = (import.meta as { url?: string }).url;
    return url && process.argv[1] && url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
  } catch {
    return false;
  }
})();

if (isMain) {
  runSwarmPartitionScenario({ printReport: true }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
