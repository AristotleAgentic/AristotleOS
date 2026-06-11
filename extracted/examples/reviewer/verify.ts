#!/usr/bin/env node
/**
 * AristotleOS — reviewer's single entry point.
 *
 * Runs four independent stages and emits a structured ReviewerReport.
 * Each stage performs the same check a skeptical technical reviewer
 * would perform by hand, but does it programmatically against the
 * actual published source.
 *
 *   Stage 1  Commit Gate              ALLOW + REFUSE + Warrant binds to action hash
 *   Stage 2  Public Warrant Verifier  signature + tamper detection + HTTP handler
 *   Stage 3  40-asset swarm scenario  deterministic counters + report hash
 *   Stage 4  Replay artifact          end-to-end: load published.replay.json,
 *                                     re-run scenario, confirm hashes line up
 *
 * Exit code: 0 if every check passes, 1 otherwise.
 * Run time:  ~10 seconds on a 2024-class laptop.
 *
 * Usage:
 *   node --import tsx examples/reviewer/verify.ts
 *
 * Output is written as pretty JSON to stdout. Human-readable summary
 * lines go to stderr. The JSON is meant to be redirected:
 *
 *   node --import tsx examples/reviewer/verify.ts > reviewer-report.json
 */

import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  createEd25519Signer,
  evaluateCommitGate,
  issueWarrant,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type Warrant,
  type WardManifest
} from "../../shared/execution-control-runtime/src/index.js";

import {
  createVerifierHandler,
  verifyWarrantPublic,
  REQUEST_FORMAT,
  RESPONSE_FORMAT
} from "../../shared/warrant-verifier/src/index.js";

import { runSwarmPartitionScenario, type ScenarioReport } from "../mesh/swarm-partition-40-asset.js";
import {
  loadReplayArtifact,
  verifyReplayArtifact
} from "../../shared/replay-artifact/src/index.js";
import { SCENARIO_VERSION, type SwarmScenarioInputs } from "../mesh/publish-replay-artifact.js";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

const REVIEWER_FORMAT = "aristotle.reviewer-report.v1";

interface Check {
  name: string;
  ok: boolean;
  /** What the check observed. Reviewer should be able to redo this in
   *  isolation from the source code. */
  evidence: Record<string, unknown>;
  /** When ok=false, free-form detail. */
  failure?: string;
}

interface Stage {
  stage: number;
  name: string;
  checks: Check[];
}

interface ReviewerReport {
  format: typeof REVIEWER_FORMAT;
  generated_at: string;
  total_time_ms: number;
  totals: { checks: number; passed: number; failed: number };
  stages: Stage[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function check(name: string, observed: Record<string, unknown>, predicate: () => boolean, failureDetail?: string): Check {
  const ok = predicate();
  return { name, ok, evidence: observed, ...(ok ? {} : { failure: failureDetail ?? "predicate returned false" }) };
}

// ---------------------------------------------------------------------------
// Stage 1 — Commit Gate
// ---------------------------------------------------------------------------

const NOW = "2026-05-26T15:00:00.000Z";

function makeSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

const WARD: WardManifest = {
  ward_id: "ward-reviewer", name: "Reviewer Demo Ward",
  sovereignty_context: "reviewer-eval", authority_domain: "demo.local",
  policy_version: "1.0.0",
  permitted_subjects: ["agent:demo"],
  physical_bounds: { max_altitude_m: 120 }
};

const ENVELOPE: AuthorityEnvelope = {
  envelope_id: "ae-reviewer", ward_id: "ward-reviewer", subject: "agent:demo",
  allowed_actions: ["demo.read", "demo.actuate"], denied_actions: ["demo.destruct"],
  constraints: {}, expires_at: "2099-01-01T00:00:00.000Z", issuer: "reviewer-root"
};

function actionFor(action_type: string): CanonicalActionInput {
  return {
    action_id: `act-${action_type}`,
    ward_id: "ward-reviewer", subject: "agent:demo",
    action_type, target: "device:1", params: { altitude_m: 50 },
    requested_at: NOW, request_id: `req-${action_type}`
  };
}

function stageOne(signer: ReturnType<typeof makeSigner>): { stage: Stage; allowedWarrant: Warrant; canonicalActionHash: string } {
  const checks: Check[] = [];

  // 1a) ALLOW path
  const allowAction = actionFor("demo.actuate");
  const allowDecision = evaluateCommitGate({ ward: WARD, authorityEnvelope: ENVELOPE, action: allowAction, now: NOW });
  checks.push(check(
    "1a.allow-path",
    {
      decision: allowDecision.decision,
      reason_codes: allowDecision.reason_codes,
      canonical_action_hash: allowDecision.canonical_action_hash,
      policy_version: allowDecision.policy_version
    },
    () => allowDecision.decision === "ALLOW" && allowDecision.reason_codes[0] === "ALLOWED"
  ));

  // 1b) REFUSE path — action not in allowed_actions
  const refuseAction = actionFor("demo.unauthorized");
  const refuseDecision = evaluateCommitGate({ ward: WARD, authorityEnvelope: ENVELOPE, action: refuseAction, now: NOW });
  checks.push(check(
    "1b.refuse-action-not-allowed",
    {
      decision: refuseDecision.decision,
      reason_codes: refuseDecision.reason_codes
    },
    () => refuseDecision.decision === "REFUSE" && refuseDecision.reason_codes.includes("ACTION_NOT_ALLOWED")
  ));

  // 1c) REFUSE path — subject not in ward
  const wrongSubject: CanonicalActionInput = { ...allowAction, subject: "agent:imposter" };
  const wrongSubjectDecision = evaluateCommitGate({ ward: WARD, authorityEnvelope: ENVELOPE, action: wrongSubject, now: NOW });
  checks.push(check(
    "1c.refuse-subject-not-in-ward",
    {
      decision: wrongSubjectDecision.decision,
      reason_codes: wrongSubjectDecision.reason_codes
    },
    () => wrongSubjectDecision.decision === "REFUSE" && wrongSubjectDecision.reason_codes.includes("SUBJECT_NOT_IN_WARD")
  ));

  // 1d) Warrant issued and bound to canonical_action_hash
  const warrant = issueWarrant(allowDecision, allowAction, ENVELOPE, NOW, signer, 60);
  checks.push(check(
    "1d.warrant-issued",
    {
      warrant_id: warrant?.warrant_id,
      canonical_action_hash: warrant?.canonical_action_hash,
      signing_key_id: warrant?.signing_key_id,
      single_use: warrant?.single_use,
      nonce_present: !!warrant?.nonce
    },
    () => !!warrant && warrant.canonical_action_hash === allowDecision.canonical_action_hash && warrant.single_use === true && !!warrant.nonce
  ));

  return {
    stage: { stage: 1, name: "Commit Gate", checks },
    allowedWarrant: warrant!,
    canonicalActionHash: allowDecision.canonical_action_hash
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — Public Warrant Verifier
// ---------------------------------------------------------------------------

async function stageTwo(warrant: Warrant, canonicalActionHash: string, signerKeyId: string): Promise<Stage> {
  const checks: Check[] = [];

  // 2a) Happy path: trusted key, matching action hash, current time
  const ok = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: canonicalActionHash, now: NOW },
    { trustedKeyIds: [signerKeyId] }
  );
  checks.push(check(
    "2a.verify-happy",
    { ok: ok.ok, reason: ok.reason, warrant_id: ok.warrant_id, format: ok.format },
    () => ok.ok === true && ok.format === RESPONSE_FORMAT
  ));

  // 2b) Tamper detection: change the nonce
  const tampered: Warrant = { ...warrant, nonce: "00000000-0000-0000-0000-000000000000" };
  const tamperResult = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant: tampered, canonical_action_hash: canonicalActionHash, now: NOW },
    { trustedKeyIds: [signerKeyId] }
  );
  checks.push(check(
    "2b.verify-tamper-detected",
    { ok: tamperResult.ok, reason: tamperResult.reason },
    () => tamperResult.ok === false && tamperResult.reason === "SIGNATURE_MISMATCH"
  ));

  // 2c) Untrusted key
  const untrusted = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: canonicalActionHash, now: NOW },
    { trustedKeyIds: ["unknown-key"] }
  );
  checks.push(check(
    "2c.untrusted-signing-key",
    { ok: untrusted.ok, reason: untrusted.reason },
    () => untrusted.ok === false && untrusted.reason === "UNTRUSTED_SIGNING_KEY"
  ));

  // 2d) Action hash mismatch
  const wrongHash = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: "sha256:wrong", now: NOW },
    { trustedKeyIds: [signerKeyId] }
  );
  checks.push(check(
    "2d.action-hash-mismatch",
    { ok: wrongHash.ok, reason: wrongHash.reason },
    () => wrongHash.ok === false && wrongHash.reason === "ACTION_HASH_MISMATCH"
  ));

  // 2e) HTTP handler path: same warrant via createVerifierHandler returns 200 + ok body
  const handler = createVerifierHandler({ trustedKeyIds: [signerKeyId] });
  const httpRes = await handler.handle({
    method: "POST", url: "/v1/warrant/verify",
    rawBody: JSON.stringify({ format: REQUEST_FORMAT, warrant, canonical_action_hash: canonicalActionHash, now: NOW })
  });
  const httpBody = JSON.parse(httpRes.body) as { ok: boolean; warrant_id: string; format: string };
  checks.push(check(
    "2e.http-handler-200",
    { status: httpRes.status, body_ok: httpBody.ok, body_warrant_id: httpBody.warrant_id, body_format: httpBody.format },
    () => httpRes.status === 200 && httpBody.ok === true && httpBody.warrant_id === warrant.warrant_id
  ));

  return { stage: 2, name: "Public Warrant Verifier", checks };
}

// ---------------------------------------------------------------------------
// Stage 3 — 40-asset swarm scenario
// ---------------------------------------------------------------------------

async function stageThree(): Promise<{ stage: Stage; report: ScenarioReport; reportHash: string }> {
  const checks: Check[] = [];

  const report = await runSwarmPartitionScenario({ assetCount: 40, fluidityTtlMs: 1500 });
  const reportHash = "sha256:" + sha256Hex(stableStringify(report));

  // 3a) Deterministic counters — every phase resolves cleanly
  checks.push(check(
    "3a.phase1-allowed-all-40",
    { phase1_allow: report.phase1_allow, phase1_other: report.phase1_other },
    () => report.phase1_allow === 40 && report.phase1_other === 0
  ));

  checks.push(check(
    "3b.phase2-no-losses",
    {
      phase2_allow: report.phase2_allow,
      phase2_refuse: report.phase2_refuse,
      phase2_expire: report.phase2_expire,
      total: report.phase2_allow + report.phase2_refuse + report.phase2_expire
    },
    () => (report.phase2_allow + report.phase2_refuse + report.phase2_expire) === 40
  ));

  checks.push(check(
    "3c.phase3-revoked-10-resolve-into-witness-or-isolated",
    {
      phase3_witness_half_refused: report.phase3_witness_half_refused,
      phase3_isolated_half_allowed: report.phase3_isolated_half_allowed,
      total_revocations: report.total_revocations
    },
    () =>
      report.phase3_isolated_half_allowed + report.phase3_witness_half_refused === 10 &&
      report.total_revocations === 10
  ));

  checks.push(check(
    "3d.phase4-reconciliation-accounting",
    {
      phase4_reconciled_clean: report.phase4_reconciled_clean,
      phase4_reconciled_conflicts: report.phase4_reconciled_conflicts
    },
    () => (report.phase4_reconciled_clean + report.phase4_reconciled_conflicts) >= 10
  ));

  checks.push(check(
    "3e.report-hash-is-stable-sha256",
    { report_hash: reportHash },
    () => /^sha256:[0-9a-f]{64}$/.test(reportHash)
  ));

  return { stage: { stage: 3, name: "40-Asset Swarm Scenario", checks }, report, reportHash };
}

// ---------------------------------------------------------------------------
// Stage 4 — Replay artifact (cross-check)
// ---------------------------------------------------------------------------

async function stageFour(localReport: ScenarioReport, localReportHash: string): Promise<Stage> {
  const checks: Check[] = [];

  const here = dirname(fileURLToPath(import.meta.url));
  const artifactPath = join(here, "..", "mesh", "published.replay.json");
  const raw = readFileSync(artifactPath, "utf8");
  const artifact = loadReplayArtifact<SwarmScenarioInputs, ScenarioReport>(raw);

  // 4a) Artifact file exists and is well-formed
  checks.push(check(
    "4a.artifact-parses",
    {
      file: "examples/mesh/published.replay.json",
      scenario_id: artifact.scenario_id,
      scenario_version: artifact.scenario_version,
      artifact_hash: artifact.artifact_hash,
      report_hash: artifact.report_hash
    },
    () => artifact.scenario_id === "swarm-partition-40-asset" && artifact.scenario_version === SCENARIO_VERSION
  ));

  // 4b) Locally-re-run report hash matches the artifact's report_hash
  checks.push(check(
    "4b.local-report-hash-matches-published-report-hash",
    { local_report_hash: localReportHash, published_report_hash: artifact.report_hash },
    () => localReportHash === artifact.report_hash,
    "the scenario is supposed to be deterministic; if these differ, either the scenario isn't deterministic or the published artifact was produced under different code"
  ));

  // 4c) Four-gate verifyReplayArtifact — this is the strongest signal
  const v = await verifyReplayArtifact(artifact, {
    rerun: runSwarmPartitionScenario,
    localScenarioVersion: SCENARIO_VERSION
  });
  checks.push(check(
    "4c.verify-replay-artifact-all-gates",
    {
      ok: v.ok,
      artifact_hash_ok: v.artifact_hash_ok,
      report_hash_ok: v.report_hash_ok,
      scenario_reproducible: v.scenario_reproducible,
      version_ok: v.version_ok,
      failures: v.failures
    },
    () => v.ok === true && v.artifact_hash_ok && v.report_hash_ok && v.scenario_reproducible && v.version_ok
  ));

  // 4d) Cross-check: artifact's report matches the locally-produced report by field
  const sameKeys = Object.keys(localReport).sort().every((k) => {
    const a = localReport[k as keyof ScenarioReport];
    const b = (artifact.report as Record<string, unknown>)[k];
    return a === b;
  });
  checks.push(check(
    "4d.field-by-field-equality",
    {
      local: localReport,
      published: artifact.report
    },
    () => sameKeys,
    "report fields differ from the published artifact — non-determinism or version drift"
  ));

  return { stage: 4, name: "Replay Artifact", checks };
}

// ---------------------------------------------------------------------------
// Pure report producer (callable from tests with no I/O monkey-patching)
// ---------------------------------------------------------------------------

export async function produceReport(): Promise<ReviewerReport> {
  const t0 = Date.now();
  const signer = makeSigner();

  const one = stageOne(signer);
  const two = await stageTwo(one.allowedWarrant, one.canonicalActionHash, signer.key_id);
  const three = await stageThree();
  const four = await stageFour(three.report, three.reportHash);

  const stages = [one.stage, two, three.stage, four];
  const allChecks = stages.flatMap((s) => s.checks);
  const passed = allChecks.filter((c) => c.ok).length;
  const failed = allChecks.length - passed;

  return {
    format: REVIEWER_FORMAT,
    generated_at: new Date().toISOString(),
    total_time_ms: Date.now() - t0,
    totals: { checks: allChecks.length, passed, failed },
    stages
  };
}

// ---------------------------------------------------------------------------
// Main — wraps produceReport with stdout/stderr formatting
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const report = await produceReport();
  const { totals, stages } = report;

  // JSON to stdout (machine-readable).
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  // Human summary to stderr.
  const banner = totals.failed === 0 ? "PASS" : "FAIL";
  process.stderr.write([
    "",
    `AristotleOS reviewer verification: ${banner}`,
    `  total checks:  ${totals.checks}`,
    `  passed:        ${totals.passed}`,
    `  failed:        ${totals.failed}`,
    `  duration:      ${report.total_time_ms} ms`,
    "",
    ...stages.map((s) => {
      const sPassed = s.checks.filter((c) => c.ok).length;
      const sTotal = s.checks.length;
      return `  Stage ${s.stage}  ${s.name.padEnd(28)} ${sPassed}/${sTotal}`;
    }),
    ""
  ].join("\n"));

  if (totals.failed > 0) {
    process.stderr.write("Failures:\n");
    for (const stage of stages) {
      for (const c of stage.checks) {
        if (!c.ok) process.stderr.write(`  - Stage ${stage.stage} / ${c.name}: ${c.failure ?? "predicate failed"}\n    evidence: ${JSON.stringify(c.evidence)}\n`);
      }
    }
  }

  return totals.failed === 0 ? 0 : 1;
}

const isMain = (() => {
  try {
    const url = (import.meta as { url?: string }).url;
    return url && process.argv[1] && url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
  } catch {
    return false;
  }
})();

if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    process.stderr.write(`reviewer verify FAILED with uncaught error: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(2);
  });
}

export { main, REVIEWER_FORMAT };
export type { ReviewerReport, Stage, Check };
