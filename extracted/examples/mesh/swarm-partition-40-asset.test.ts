import test from "node:test";
import assert from "node:assert/strict";
import { runSwarmPartitionScenario } from "./swarm-partition-40-asset.js";

test("40-asset swarm scenario: nominal phase 1 issues 40 warrants", async () => {
  const r = await runSwarmPartitionScenario({ assetCount: 40, fluidityTtlMs: 1500 });
  assert.equal(r.phase1_allow, 40);
  assert.equal(r.phase1_other, 0);
});

test("40-asset swarm scenario: under partition, asset count still maps to either ALLOW / REFUSE / EXPIRE (no losses)", async () => {
  const r = await runSwarmPartitionScenario({ assetCount: 40, fluidityTtlMs: 1500 });
  assert.equal(r.phase2_allow + r.phase2_refuse + r.phase2_expire, 40);
});

test("40-asset swarm scenario: witness-reachable subset refuses on revocation gossip; isolated subset keeps issuing under TTL", async () => {
  const r = await runSwarmPartitionScenario({ assetCount: 40, fluidityTtlMs: 1500 });
  // Of the 10 revoked envelopes: indices 0..9.
  // Indices 0..9 with i < (40/4)=10 are "fullyIsolated" — so ALL 10 revoked envelopes are isolated.
  // After re-running the scenario with `assetCount: 20`, half is partitioned, quarter is isolated.
  // For 40 assets: partitioned-half = indices 0..19, fully-isolated = indices 0..9. The 10 revoked
  // envelopes are exactly the 10 fully-isolated assets → all should still ALLOW under their Fluidity
  // Tokens (no revocation reached them). witness-reachable-refused must therefore be 0 for this
  // particular split; the test asserts the LOGICAL invariant: every revoked-and-isolated asset that
  // still has a valid Fluidity Token ALLOWs, and every revoked-and-witness-reachable asset REFUSEs.
  assert.equal(r.phase3_isolated_half_allowed + r.phase3_witness_half_refused, 10);
  // For 40-asset / quarter-isolated config, the 10 revoked assets are all in the isolated subset:
  assert.equal(r.phase3_isolated_half_allowed, 10);
  assert.equal(r.phase3_witness_half_refused, 0);
});

test("40-asset swarm scenario: 30-asset config exercises the witness-reachable refusal path", async () => {
  // Override asset count so revoked indices straddle the isolated/witness-reachable boundary.
  // 30 assets: partitioned-half = 15 (indices 0..14); fully-isolated = quarter = ~7 (indices 0..6).
  // Revoke first 10 → indices 0..6 are fully-isolated; indices 7..9 are witness-reachable.
  const r = await runSwarmPartitionScenario({ assetCount: 30, fluidityTtlMs: 1500 });
  assert.equal(r.phase3_isolated_half_allowed + r.phase3_witness_half_refused, 10);
  assert.ok(r.phase3_witness_half_refused >= 1, "at least one revoked asset must be witness-reachable in this config");
  assert.ok(r.phase3_isolated_half_allowed >= 1, "at least one revoked asset must be fully-isolated in this config");
});

test("40-asset swarm scenario: reconciliation surfaces conflicts for warrants issued after revocation", async () => {
  const r = await runSwarmPartitionScenario({ assetCount: 40, fluidityTtlMs: 1500 });
  // The fully-isolated subset issued phase2 + phase3 warrants after the root revoked them. On
  // reconcile, the root flags warrants-after-revocation as conflicts. There should be at least
  // one conflict per isolated, revoked asset.
  assert.ok(r.phase4_reconciled_conflicts > 0, "expected reconciliation to flag at least one conflict");
});

test("40-asset swarm scenario: total warrants issued equals warrants accumulated across phases 1+2+3", async () => {
  const r = await runSwarmPartitionScenario({ assetCount: 40, fluidityTtlMs: 1500 });
  assert.equal(r.total_warrants_issued, r.phase1_allow + r.phase2_allow + r.phase3_isolated_half_allowed);
});

test("40-asset swarm scenario: total revocations issued by root equals 10", async () => {
  const r = await runSwarmPartitionScenario({ assetCount: 40, fluidityTtlMs: 1500 });
  assert.equal(r.total_revocations, 10);
});
