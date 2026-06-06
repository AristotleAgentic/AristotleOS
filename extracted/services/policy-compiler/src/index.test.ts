import test from "node:test";
import assert from "node:assert/strict";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Policy-compiler /compile + /diff behavioral tests.
 *
 * The policy-compiler runs the real Aristotle Policy Language (APL)
 * compiler — same one in shared/execution-control-runtime — and
 * surfaces it through an HTTP contract the UI + http-gateway use.
 * APL syntax samples (mirrored from the library's policy-dsl.test.ts
 * to stay in lock-step with the compiler's input expectations):
 *
 *   Valid:  ward "X" { subject agent:y\n allow t1 }
 *   Valid:  ward "A" { id a\n subject agent:x\n allow t1 }
 *           ward "B" { id b\n subject agent:y\n deny t2 }
 *   Invalid: ward "x" {\n subject agent:x\n allow\n }   // 'allow' needs an action
 *
 * Coverage:
 *   (1) /health ok
 *   (2) /compile on empty source → valid=true, no drafts, no graph nodes
 *       beyond meta-authority
 *   (3) /compile on valid single-ward APL → valid=true, ward_count=1,
 *       manifest_hashes populated, admissibilityRules include the
 *       allow rule, graph has ward + envelope nodes
 *   (4) /compile on valid two-ward APL → ward_count=2, two manifest_hashes
 *   (5) /compile on malformed APL → valid=false, errors populated,
 *       no substrate block, graph trimmed
 *   (6) /diff between two identical valid policies → total_changes=0
 *   (7) /diff between two policies where one adds a ward →
 *       total_changes >= 1, the added ward is reported as added,
 *       weakening_changes >= 1 (an added ward weakens the prior posture)
 *   (8) /diff with one malformed side → 400 + per-side errors
 *
 * No production code is modified.
 */

const VALID_SINGLE = `ward "Payments Refund Ward" { id ward-refund\n subject agent:refunder\n allow stripe.refund }`;
const VALID_TWO    = `ward "A" { id ward-a\n subject agent:x\n allow t1 }\nward "B" { id ward-b\n subject agent:y\n deny t2 }`;
const MALFORMED    = `ward "x" {\n  subject agent:x\n  allow\n}`; // 'allow' missing an action

test("/health ok", async () => {
  const svc = await startService("policy-compiler");
  try {
    const { status, body } = await svc.get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "policy-compiler");
  } finally { await svc.stop(); }
});

test("/compile on empty source returns valid=false with a diagnostic, no substrate, trimmed graph", async () => {
  // The APL compiler refuses empty input — it requires at least one
  // `ward "..." { ... }` block. This is a deliberate compiler choice
  // (fail-closed on accidentally-blank policy uploads) — testing it
  // here pins it so a future "be permissive on empty" change can't
  // sneak through without a deliberate test update.
  const svc = await startService("policy-compiler");
  try {
    const r = await svc.post("/compile", { policyName: "empty", policyText: "" });
    assert.equal(r.status, 200, "compiler always 200s; valid=false signals refusal");
    assert.equal(r.body.valid, false, "empty source must be rejected");
    assert.ok(r.body.errors.length > 0, "rejection must carry at least one diagnostic");
    assert.equal(r.body.policyName, "empty");
    assert.ok(r.body.compileId.startsWith("compile-"));
    assert.equal(typeof r.body.timestamp, "string");
    // Graph is trimmed to just the meta-authority node when compilation fails.
    assert.deepEqual(r.body.graph.nodes, ["meta-authority"]);
    assert.deepEqual(r.body.graph.edges, []);
    assert.deepEqual(r.body.admissibilityRules, []);
    assert.equal(r.body.substrate, undefined, "no substrate block when compilation failed");
  } finally { await svc.stop(); }
});

test("/compile on valid single-ward APL produces ward_count=1 with manifest hashes and admissibility rules", async () => {
  const svc = await startService("policy-compiler");
  try {
    const r = await svc.post("/compile", {
      policyName: "single",
      policyText: VALID_SINGLE
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.valid, true, `expected valid=true, errors=${JSON.stringify(r.body.errors)}`);
    assert.equal(r.body.substrate?.ward_count, 1);
    assert.equal(r.body.substrate?.manifest_hashes.length, 1);
    assert.equal(r.body.substrate?.manifest_version, "aristotle.governance-manifest.v1");
    // Allowed-action rule must appear in admissibilityRules
    assert.ok(
      r.body.admissibilityRules.some((rule) => rule.includes("stripe.refund")),
      `expected admissibilityRules to include the allow rule, got ${JSON.stringify(r.body.admissibilityRules)}`
    );
    // Graph nodes: meta-authority + ward:* + envelope:* (+ actions:*)
    assert.ok(r.body.graph.nodes.includes("meta-authority"));
    assert.ok(r.body.graph.nodes.some((n) => n.startsWith("ward:")));
    assert.ok(r.body.graph.nodes.some((n) => n.startsWith("envelope:")));
  } finally { await svc.stop(); }
});

test("/compile on valid two-ward APL produces ward_count=2 and two manifest hashes", async () => {
  const svc = await startService("policy-compiler");
  try {
    const r = await svc.post("/compile", { policyName: "two", policyText: VALID_TWO });
    assert.equal(r.body.valid, true);
    assert.equal(r.body.substrate?.ward_count, 2);
    assert.equal(r.body.substrate?.manifest_hashes.length, 2);
    // Two distinct manifest hashes (different ward ids must produce different hashes)
    assert.notEqual(r.body.substrate?.manifest_hashes[0], r.body.substrate?.manifest_hashes[1]);
  } finally { await svc.stop(); }
});

test("/compile on malformed APL returns valid=false with errors and no substrate block", async () => {
  const svc = await startService("policy-compiler");
  try {
    const r = await svc.post("/compile", { policyName: "bad", policyText: MALFORMED });
    assert.equal(r.body.valid, false);
    assert.ok(r.body.errors.length > 0, "malformed APL must produce at least one error");
    assert.equal(r.body.substrate, undefined, "no substrate block when compilation failed");
    assert.deepEqual(r.body.admissibilityRules, []);
  } finally { await svc.stop(); }
});

test("/diff between two identical policies reports total_changes=0", async () => {
  const svc = await startService("policy-compiler");
  try {
    const r = await svc.post("/diff", { before: VALID_SINGLE, after: VALID_SINGLE });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.total_changes, 0);
    assert.equal(r.body.weakening_changes, 0);
  } finally { await svc.stop(); }
});

test("/diff reports an added ward as added + weakening", async () => {
  const svc = await startService("policy-compiler");
  try {
    const r = await svc.post("/diff", { before: VALID_SINGLE, after: VALID_TWO });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.total_changes >= 1,
      `expected at least one change, got ${JSON.stringify(r.body)}`);
    assert.ok(r.body.weakening_changes >= 1,
      "adding a ward expands surface area — must count as a weakening change");
    const added = r.body.per_ward.find((w) => w.state === "added");
    assert.ok(added, `expected at least one per_ward entry with state=\"added\", got ${JSON.stringify(r.body.per_ward)}`);
  } finally { await svc.stop(); }
});

test("/diff returns 400 with per-side errors when one side is malformed", async () => {
  const svc = await startService("policy-compiler");
  try {
    const r = await svc.post("/diff", { before: VALID_SINGLE, after: MALFORMED });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.ok(Array.isArray(r.body.errors) && r.body.errors.length > 0);
    assert.ok(r.body.errors.some((e) => e.startsWith("after:")),
      `expected per-side prefix on errors, got ${JSON.stringify(r.body.errors)}`);
  } finally { await svc.stop(); }
});
