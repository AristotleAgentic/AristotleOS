import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalizeAction, type WardManifest, type AuthorityEnvelope, type CanonicalActionInput, type GelRecord } from "@aristotle/execution-control-runtime";
import { parseArgs, runCli, type CounterfactualPlan } from "./cli.js";
import { loadSweep } from "./index.js";

const WARD: WardManifest = {
  ward_id: "w", name: "Test Ward", sovereignty_context: "test", authority_domain: "test.local",
  policy_version: "v1", permitted_subjects: ["agent:a"]
};
const ENV_LOOSE: AuthorityEnvelope = {
  envelope_id: "ae", ward_id: "w", subject: "agent:a",
  allowed_actions: ["x.do", "x.danger"], denied_actions: [], constraints: {},
  expires_at: "2099-01-01T00:00:00.000Z", issuer: "root"
};
const ENV_TIGHT: AuthorityEnvelope = { ...ENV_LOOSE, envelope_id: "ae2", allowed_actions: ["x.do"] };

function mkPlan(): CounterfactualPlan {
  const records: GelRecord[] = [];
  const actions: Record<string, CanonicalActionInput> = {};
  const originals: Record<string, { ward: WardManifest; envelope: AuthorityEnvelope }> = {};
  for (let i = 0; i < 3; i++) {
    const action: CanonicalActionInput = {
      action_id: `a-${i}`, ward_id: "w", subject: "agent:a",
      action_type: "x.danger", target: "t", params: { i }, requested_at: "2026-05-26T15:00:00.000Z"
    };
    const canonical = canonicalizeAction(action);
    const r: GelRecord = {
      record_id: `rec-${i}`, previous_hash: "GENESIS", record_hash: "0".repeat(64),
      timestamp: "2026-05-26T15:00:01.000Z", ward_id: "w", subject: "agent:a",
      canonical_action_hash: canonical.canonical_action_hash, decision: "ALLOW",
      reason_codes: ["ALLOWED"], runtime_register_snapshot: {}
    };
    records.push(r);
    actions[r.record_id] = action;
    originals[r.record_id] = { ward: WARD, envelope: ENV_LOOSE };
  }
  return {
    records,
    actions,
    originals,
    counterfactual: { name: "tightened-v2", ward: WARD, envelope: ENV_TIGHT }
  };
}

test("parseArgs: minimal happy path", () => {
  const o = parseArgs(["--plan", "p.json"]);
  assert.equal(o.planPath, "p.json");
  assert.equal(o.maxFlipped, 0);
  assert.equal(o.quiet, false);
  assert.equal(o.outPath, undefined);
});

test("parseArgs: full option set", () => {
  const o = parseArgs(["--plan", "p.json", "--out", "out.json", "--max-flipped", "5", "--quiet"]);
  assert.equal(o.outPath, "out.json");
  assert.equal(o.maxFlipped, 5);
  assert.equal(o.quiet, true);
});

test("parseArgs: rejects --max-flipped that is not a non-negative integer", () => {
  assert.throws(() => parseArgs(["--plan", "p.json", "--max-flipped", "-1"]), /non-negative integer/);
});

test("parseArgs: rejects missing --plan", () => {
  assert.throws(() => parseArgs(["--out", "o.json"]), /--plan/);
});

test("parseArgs: rejects unknown argument", () => {
  assert.throws(() => parseArgs(["--plan", "p.json", "--bogus"]), /unknown argument/);
});

test("runCli: writes serialized sweep to --out; exits 1 when flipped > max-flipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "aristotle-tm-"));
  try {
    const planPath = join(dir, "plan.json");
    const outPath = join(dir, "sweep.json");
    writeFileSync(planPath, JSON.stringify(mkPlan()), "utf8");
    const { exitCode, summary } = runCli({ planPath, outPath, maxFlipped: 0, quiet: true });
    // All 3 actions flip from ALLOW to REFUSE (action_type x.danger
    // removed in the counterfactual envelope) — exceeds max-flipped 0.
    assert.equal(exitCode, 1);
    assert.match(summary, /3\/3 resolved records flipped/);
    const sweep = loadSweep(JSON.parse(readFileSync(outPath, "utf8")));
    assert.equal(sweep.result.name, "tightened-v2");
    assert.equal(sweep.result.flipped.length, 3);
    assert.equal(sweep.result.transitions["ALLOW_to_REFUSE"], 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runCli: exits 0 when flipped <= max-flipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "aristotle-tm-"));
  try {
    const planPath = join(dir, "plan.json");
    const outPath = join(dir, "sweep.json");
    writeFileSync(planPath, JSON.stringify(mkPlan()), "utf8");
    const { exitCode } = runCli({ planPath, outPath, maxFlipped: 10, quiet: true });
    assert.equal(exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runCli: throws on malformed plan (records missing)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aristotle-tm-"));
  try {
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, JSON.stringify({ counterfactual: { name: "x" } }), "utf8");
    assert.throws(() => runCli({ planPath, outPath: join(dir, "o.json"), maxFlipped: 0, quiet: true }), /plan\.records/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runCli: throws on counterfactual missing name", () => {
  const dir = mkdtempSync(join(tmpdir(), "aristotle-tm-"));
  try {
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, JSON.stringify({ records: [], actions: {}, originals: {}, counterfactual: {} }), "utf8");
    assert.throws(() => runCli({ planPath, outPath: join(dir, "o.json"), maxFlipped: 0, quiet: true }), /plan\.counterfactual\.name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
