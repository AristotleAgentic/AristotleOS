/**
 * Reviewer verification, as a node:test runner so CI can assert on
 * every individual check.
 *
 * Run with:
 *   node --import tsx --test examples/reviewer/verify.test.ts
 *
 * If you only want the structured JSON report (no test-runner
 * scaffolding), use the bare verify.ts instead:
 *   node --import tsx examples/reviewer/verify.ts
 */

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { produceReport, type ReviewerReport } from "./verify.js";

// We run produceReport() exactly once for the whole test file, then
// have each test assert against the captured report. This keeps
// tests fast and removes any cross-test ordering risk.
let cached: ReviewerReport | null = null;
async function reportOnce(): Promise<ReviewerReport> {
  if (cached) return cached;
  cached = await produceReport();
  return cached;
}
before(async () => { await reportOnce(); });

test("reviewer verify: every stage / check passes", async () => {
  const report = await reportOnce();
  assert.equal(
    report.totals.failed, 0,
    `failed checks: ${report.stages.flatMap((s) => s.checks.filter((c) => !c.ok).map((c) => `${s.name}/${c.name}: ${c.failure ?? ""}`)).join("; ")}`
  );
  // 4 stages.
  assert.equal(report.stages.length, 4);
  for (const s of report.stages) {
    assert.ok(s.checks.length > 0, `stage ${s.stage} (${s.name}) had no checks`);
  }
});

test("reviewer verify: Stage 1 — Commit Gate produces the 4 expected checks", async () => {
  const report = await reportOnce();
  const s1 = report.stages.find((s) => s.stage === 1)!;
  const names = s1.checks.map((c) => c.name).sort();
  assert.deepEqual(names, [
    "1a.allow-path",
    "1b.refuse-action-not-allowed",
    "1c.refuse-subject-not-in-ward",
    "1d.warrant-issued"
  ]);
  // The warrant binds to the same canonical_action_hash the ALLOW decision returned.
  const allow = s1.checks.find((c) => c.name === "1a.allow-path")!;
  const warrant = s1.checks.find((c) => c.name === "1d.warrant-issued")!;
  assert.equal((allow.evidence as { canonical_action_hash: string }).canonical_action_hash,
               (warrant.evidence as { canonical_action_hash: string }).canonical_action_hash);
});

test("reviewer verify: Stage 2 — Warrant Verifier hits five paths", async () => {
  const report = await reportOnce();
  const s2 = report.stages.find((s) => s.stage === 2)!;
  const names = s2.checks.map((c) => c.name).sort();
  assert.deepEqual(names, [
    "2a.verify-happy",
    "2b.verify-tamper-detected",
    "2c.untrusted-signing-key",
    "2d.action-hash-mismatch",
    "2e.http-handler-200"
  ]);
});

test("reviewer verify: Stage 3 — 40-asset scenario hash is a stable sha256", async () => {
  const report = await reportOnce();
  const s3 = report.stages.find((s) => s.stage === 3)!;
  const stable = s3.checks.find((c) => c.name === "3e.report-hash-is-stable-sha256")!;
  assert.equal(stable.ok, true);
  const { report_hash } = stable.evidence as { report_hash: string };
  assert.match(report_hash, /^sha256:[0-9a-f]{64}$/);
});

test("reviewer verify: Stage 4 — replay artifact passes all four reproducibility gates", async () => {
  const report = await reportOnce();
  const s4 = report.stages.find((s) => s.stage === 4)!;
  const gates = s4.checks.find((c) => c.name === "4c.verify-replay-artifact-all-gates")!;
  const ev = gates.evidence as {
    artifact_hash_ok: boolean;
    report_hash_ok: boolean;
    scenario_reproducible: boolean;
    version_ok: boolean;
  };
  assert.equal(ev.artifact_hash_ok, true);
  assert.equal(ev.report_hash_ok, true);
  assert.equal(ev.scenario_reproducible, true);
  assert.equal(ev.version_ok, true);
});

test("reviewer verify: completes inside 60 seconds", async () => {
  const report = await reportOnce();
  assert.ok(report.total_time_ms < 60_000, `verify took ${report.total_time_ms} ms`);
});

test("reviewer verify: report carries the stable format tag", async () => {
  const report = await reportOnce();
  assert.equal(report.format, "aristotle.reviewer-report.v1");
});

test("reviewer verify: Stage 4 local + published report_hash equality", async () => {
  const report = await reportOnce();
  const s4 = report.stages.find((s) => s.stage === 4)!;
  const equality = s4.checks.find((c) => c.name === "4b.local-report-hash-matches-published-report-hash")!;
  assert.equal(equality.ok, true);
});
