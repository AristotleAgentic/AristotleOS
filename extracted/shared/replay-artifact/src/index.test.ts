import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReplayArtifact,
  verifyReplayArtifact,
  loadReplayArtifact,
  summarizeReplayArtifact,
  ARTIFACT_FORMAT,
  type ReplayArtifact
} from "./index.js";

interface Inputs { n: number; threshold: number }
interface Report { allowed: number; refused: number }

// A trivial deterministic scenario: count how many integers from 0..n-1
// are below threshold ("allowed") vs at-or-above ("refused").
async function deterministicScenario(inputs: Inputs): Promise<Report> {
  let allowed = 0, refused = 0;
  for (let i = 0; i < inputs.n; i++) {
    if (i < inputs.threshold) allowed++;
    else refused++;
  }
  return { allowed, refused };
}

const PROVENANCE = {
  producer: "ci.example.bot",
  produced_at: "2026-05-26T12:00:00.000Z",
  source_ref: "git:abcd1234",
  notes: "deterministic counter for tests"
};

test("buildReplayArtifact: emits an artifact with format tag, report hash, and artifact hash", async () => {
  const report = await deterministicScenario({ n: 10, threshold: 7 });
  const artifact = buildReplayArtifact({
    scenario_id: "count-below-threshold",
    scenario_version: "1.0.0",
    inputs: { n: 10, threshold: 7 },
    report,
    provenance: PROVENANCE
  });
  assert.equal(artifact.format, ARTIFACT_FORMAT);
  assert.equal(artifact.scenario_id, "count-below-threshold");
  assert.equal(artifact.scenario_version, "1.0.0");
  assert.match(artifact.report_hash, /^sha256:[0-9a-f]{64}$/);
  assert.match(artifact.artifact_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(artifact.report.allowed, 7);
  assert.equal(artifact.report.refused, 3);
});

test("buildReplayArtifact: reproducible — same inputs + report yields identical artifact_hash", async () => {
  const report = await deterministicScenario({ n: 10, threshold: 7 });
  const a = buildReplayArtifact({
    scenario_id: "x", scenario_version: "1.0.0",
    inputs: { n: 10, threshold: 7 }, report, provenance: PROVENANCE
  });
  const b = buildReplayArtifact({
    scenario_id: "x", scenario_version: "1.0.0",
    inputs: { n: 10, threshold: 7 }, report, provenance: PROVENANCE
  });
  assert.equal(a.artifact_hash, b.artifact_hash);
  assert.equal(a.report_hash, b.report_hash);
});

test("verifyReplayArtifact: happy path — all four gates pass", async () => {
  const inputs = { n: 100, threshold: 65 };
  const report = await deterministicScenario(inputs);
  const artifact = buildReplayArtifact({
    scenario_id: "count", scenario_version: "1.0.0",
    inputs, report, provenance: PROVENANCE
  });
  const v = await verifyReplayArtifact(artifact, {
    rerun: deterministicScenario,
    localScenarioVersion: "1.0.0"
  });
  assert.equal(v.ok, true, `failures: ${v.failures.join("; ")}`);
  assert.equal(v.artifact_hash_ok, true);
  assert.equal(v.report_hash_ok, true);
  assert.equal(v.scenario_reproducible, true);
  assert.equal(v.version_ok, true);
});

test("verifyReplayArtifact: tampered report breaks report_hash check", async () => {
  const inputs = { n: 100, threshold: 65 };
  const report = await deterministicScenario(inputs);
  const artifact = buildReplayArtifact({
    scenario_id: "count", scenario_version: "1.0.0",
    inputs, report, provenance: PROVENANCE
  });
  const tampered: typeof artifact = {
    ...artifact,
    report: { allowed: 999, refused: 0 } // lie about the counts
  };
  const v = await verifyReplayArtifact(tampered, {
    rerun: deterministicScenario,
    localScenarioVersion: "1.0.0"
  });
  assert.equal(v.ok, false);
  assert.equal(v.report_hash_ok, false);
});

test("verifyReplayArtifact: tampered inputs break artifact_hash check (and reproducibility)", async () => {
  const inputs = { n: 100, threshold: 65 };
  const report = await deterministicScenario(inputs);
  const artifact = buildReplayArtifact({
    scenario_id: "count", scenario_version: "1.0.0",
    inputs, report, provenance: PROVENANCE
  });
  const tampered: typeof artifact = {
    ...artifact,
    inputs: { n: 100, threshold: 99 } // change inputs; report no longer matches
  };
  const v = await verifyReplayArtifact(tampered, {
    rerun: deterministicScenario,
    localScenarioVersion: "1.0.0"
  });
  assert.equal(v.ok, false);
  assert.equal(v.artifact_hash_ok, false);
  // The re-run with the tampered inputs produces a different report
  // than the original, so reproducibility also fails.
  assert.equal(v.scenario_reproducible, false);
});

test("verifyReplayArtifact: version mismatch flags version_ok=false", async () => {
  const inputs = { n: 10, threshold: 5 };
  const report = await deterministicScenario(inputs);
  const artifact = buildReplayArtifact({
    scenario_id: "count", scenario_version: "1.0.0",
    inputs, report, provenance: PROVENANCE
  });
  const v = await verifyReplayArtifact(artifact, {
    rerun: deterministicScenario,
    localScenarioVersion: "2.0.0"
  });
  assert.equal(v.ok, false);
  assert.equal(v.version_ok, false);
  // Everything else still holds.
  assert.equal(v.artifact_hash_ok, true);
  assert.equal(v.report_hash_ok, true);
  assert.equal(v.scenario_reproducible, true);
});

test("verifyReplayArtifact: non-deterministic local code breaks reproducibility", async () => {
  const inputs = { n: 10, threshold: 5 };
  const report = await deterministicScenario(inputs);
  const artifact = buildReplayArtifact({
    scenario_id: "count", scenario_version: "1.0.0",
    inputs, report, provenance: PROVENANCE
  });
  let callCount = 0;
  const nonDeterministic = async (_i: Inputs): Promise<Report> => {
    callCount++;
    return { allowed: callCount, refused: 0 };
  };
  const v = await verifyReplayArtifact(artifact, {
    rerun: nonDeterministic,
    localScenarioVersion: "1.0.0"
  });
  assert.equal(v.ok, false);
  assert.equal(v.scenario_reproducible, false);
});

test("loadReplayArtifact: parses JSON string + raw object; rejects bad format / missing fields", async () => {
  const inputs = { n: 5, threshold: 3 };
  const report = await deterministicScenario(inputs);
  const artifact = buildReplayArtifact({
    scenario_id: "load-test", scenario_version: "1.0.0",
    inputs, report, provenance: PROVENANCE
  });
  // JSON string round-trip
  const json = JSON.stringify(artifact);
  const parsed = loadReplayArtifact<Inputs, Report>(json);
  assert.equal(parsed.scenario_id, "load-test");
  // Bad format
  assert.throws(() => loadReplayArtifact({ format: "wrong" }), /unexpected artifact format/);
  // Missing field
  assert.throws(() => loadReplayArtifact({ format: ARTIFACT_FORMAT }), /missing required field/);
  assert.throws(() => loadReplayArtifact(null), /not an object/);
});

test("summarizeReplayArtifact: produces a CI-friendly single-line summary", async () => {
  const inputs = { n: 10, threshold: 5 };
  const report = await deterministicScenario(inputs);
  const artifact: ReplayArtifact<Inputs, Report> = buildReplayArtifact({
    scenario_id: "summary-test", scenario_version: "1.0.0",
    inputs, report, provenance: PROVENANCE
  });
  const line = summarizeReplayArtifact(artifact);
  assert.match(line, /scenario=summary-test@1\.0\.0/);
  assert.match(line, /by=ci\.example\.bot/);
  assert.match(line, /produced_at=2026-05-26T12:00:00\.000Z/);
});

test("verifyReplayArtifact: skip version check by passing undefined localScenarioVersion", async () => {
  const inputs = { n: 10, threshold: 5 };
  const report = await deterministicScenario(inputs);
  const artifact = buildReplayArtifact({
    scenario_id: "count", scenario_version: "1.0.0",
    inputs, report, provenance: PROVENANCE
  });
  const v = await verifyReplayArtifact(artifact, { rerun: deterministicScenario });
  assert.equal(v.version_ok, true);
  assert.equal(v.ok, true);
});
