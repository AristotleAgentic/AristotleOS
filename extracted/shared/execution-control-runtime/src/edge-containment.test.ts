import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EdgeContainmentTracker, checkEdgeContainment } from "./index.js";

const NOW = "2026-05-24T12:00:00.000Z";

test("checkEdgeContainment: fresh sync within window is allowed", () => {
  const r = checkEdgeContainment({ maxRevocationStalenessMs: 60_000, offlineWarrantQuota: 10 }, { lastSyncAt: "2026-05-24T11:59:30.000Z", offlineWarrantsIssued: 3 }, NOW);
  assert.equal(r.ok, true);
});

test("checkEdgeContainment: stale control-plane sync fails closed", () => {
  const r = checkEdgeContainment({ maxRevocationStalenessMs: 60_000 }, { lastSyncAt: "2026-05-24T11:58:00.000Z", offlineWarrantsIssued: 0 }, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "REVOCATION_STALE");
});

test("checkEdgeContainment: never-synced node (epoch) fails closed by default", () => {
  const r = checkEdgeContainment({ maxRevocationStalenessMs: 60_000 }, { lastSyncAt: new Date(0).toISOString(), offlineWarrantsIssued: 0 }, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "REVOCATION_STALE");
});

test("checkEdgeContainment: offline warrant quota exhaustion fails closed", () => {
  const r = checkEdgeContainment({ offlineWarrantQuota: 5 }, { lastSyncAt: NOW, offlineWarrantsIssued: 5 }, NOW);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "OFFLINE_QUOTA_EXCEEDED");
});

test("EdgeContainmentTracker persists state across instances (a captured node can't reset by bouncing)", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "aos-edge-")), "edge.json");
  const policy = { maxRevocationStalenessMs: 3_600_000, offlineWarrantQuota: 3 };

  const t1 = new EdgeContainmentTracker(file, policy);
  t1.recordSync(NOW);
  t1.recordWarrantIssued();
  t1.recordWarrantIssued();

  // a fresh instance (process restart) sees the persisted count
  const t2 = new EdgeContainmentTracker(file, policy);
  assert.equal(t2.state().offlineWarrantsIssued, 2);
  assert.equal(t2.check(NOW).ok, true);
  t2.recordWarrantIssued(); // 3rd -> hits quota
  const after = t2.check(NOW);
  assert.equal(after.ok, false);
  if (!after.ok) assert.equal(after.reason, "OFFLINE_QUOTA_EXCEEDED");

  // a successful sync clears the offline window
  t2.recordSync(NOW);
  assert.equal(t2.check(NOW).ok, true);
  assert.equal(t2.state().offlineWarrantsIssued, 0);
});

test("EdgeContainmentTracker: a node that drifts past the staleness window fails closed", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "aos-edge-")), "edge.json");
  const tracker = new EdgeContainmentTracker(file, { maxRevocationStalenessMs: 60_000 });
  tracker.recordSync(NOW);
  assert.equal(tracker.check("2026-05-24T12:00:30.000Z").ok, true);  // 30s later: ok
  assert.equal(tracker.check("2026-05-24T12:02:00.000Z").ok, false); // 2min later: stale
});
