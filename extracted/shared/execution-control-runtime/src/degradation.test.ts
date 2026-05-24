import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectDegradation,
  controlPlaneStaleProbe,
  ledgerUnavailableProbe,
  predicateProbe,
  probeLedgerWritable,
  runWithTimeout
} from "./degradation.js";
import { EdgeContainmentTracker } from "./edge-containment.js";

function tmp() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-degradation-")), "gel.jsonl");
}

// A ledger path whose parent directory is actually a *file*, so the canary write
// genuinely fails (mkdir cannot create a directory under a regular file).
function unwritableLedgerPath() {
  const dir = mkdtempSync(path.join(tmpdir(), "aos-degradation-"));
  const asFile = path.join(dir, "not-a-dir");
  writeFileSync(asFile, "i am a file", "utf8");
  return path.join(asFile, "gel.jsonl");
}

test("probeLedgerWritable is true for a writable directory", () => {
  assert.equal(probeLedgerWritable(tmp()), true);
});

test("probeLedgerWritable is false when the parent path is a file, not a directory", () => {
  assert.equal(probeLedgerWritable(unwritableLedgerPath()), false);
});

test("ledgerUnavailableProbe reports the condition only when unwritable", () => {
  assert.equal(ledgerUnavailableProbe(tmp())(), null);
  assert.equal(ledgerUnavailableProbe(unwritableLedgerPath())(), "ledger_unavailable");
});

test("controlPlaneStaleProbe fires when the edge node is stale, clears after sync", () => {
  const stateFile = path.join(mkdtempSync(path.join(tmpdir(), "aos-edge-")), "edge.json");
  const tracker = new EdgeContainmentTracker(stateFile, { maxRevocationStalenessMs: 60_000 });
  // Never synced ⇒ stale by default.
  assert.equal(controlPlaneStaleProbe(tracker)(), "control_plane_stale");
  tracker.recordSync();
  assert.equal(controlPlaneStaleProbe(tracker)(), null);
});

test("predicateProbe maps a health predicate (and a throw) to a condition", () => {
  assert.equal(predicateProbe("quorum_lost", () => true)(), null);
  assert.equal(predicateProbe("quorum_lost", () => false)(), "quorum_lost");
  assert.equal(predicateProbe("quorum_lost", () => { throw new Error("unreachable"); })(), "quorum_lost");
});

test("collectDegradation runs probes and de-duplicates", () => {
  const conditions = collectDegradation([
    () => "ledger_unavailable",
    () => "ledger_unavailable", // duplicate collapses
    () => null,
    () => "quorum_lost"
  ]);
  assert.deepEqual([...conditions].sort(), ["ledger_unavailable", "quorum_lost"]);
});

test("collectDegradation is clean when all probes are healthy", () => {
  assert.deepEqual(collectDegradation([() => null, ledgerUnavailableProbe(tmp())]), []);
});

test("runWithTimeout returns the value when fast, timedOut when slow", async () => {
  const fast = await runWithTimeout(async () => 42, 1000);
  assert.equal(fast.timedOut, false);
  assert.equal(fast.value, 42);

  const slow = await runWithTimeout(() => new Promise((r) => setTimeout(() => r("late"), 50)), 5);
  assert.equal(slow.timedOut, true);
});
