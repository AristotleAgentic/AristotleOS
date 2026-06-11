/**
 * @aristotle/reviewer
 *
 * Reviewer CLI for AristotleOS. Verifies any of the three substrate
 * artifact families a third-party reviewer would receive:
 *
 *   1. Evidence Bundle      — packaged GEL slice + Ward + Authority Envelope
 *                              + Warrant. Verifies the ledger chain, the
 *                              selected record, hash consistency, and the
 *                              optional bundle signature.
 *   2. Warrant              — single Warrant artifact. Verifies signature,
 *                              action-hash binding, and trust-anchor
 *                              membership.
 *   3. Replay Artifact      — ReplayArtifact<I, R>. Verifies internal
 *                              consistency (artifact_hash, report_hash)
 *                              without needing to re-execute the scenario.
 *                              For full reproducibility (`scenario_reproducible`)
 *                              callers should still use the in-repo
 *                              `verifyReplayArtifact` with the matching
 *                              scenario runner — the CLI's job is the
 *                              hash-only verification a reviewer can do
 *                              without the source tree.
 *
 * This module exports a pure `run(argv, env)` dispatcher so the test
 * suite can exercise every subcommand without spawning a subprocess.
 * The bundled bin (`./cli.ts`) is a thin wrapper around it.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import {
  loadEvidenceBundle,
  verifyEvidenceBundle,
  type EvidenceBundle,
  type EvidenceBundleVerification,
  type Warrant
} from "@aristotle/execution-control-runtime";
import {
  REQUEST_FORMAT,
  verifyWarrantPublic,
  type VerifyWarrantResponse
} from "@aristotle/warrant-verifier";
import {
  ARTIFACT_FORMAT,
  loadReplayArtifact,
  type ReplayArtifact
} from "@aristotle/replay-artifact";

// ---------------------------------------------------------------------------
// Pure dispatcher
// ---------------------------------------------------------------------------

export interface RunEnv {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  cwd: string;
}

/** Synchronously read package.json next to the source so --version works
 *  in both `tsx` (source) and the esbuild bundle (file paths in the
 *  bundled bin may differ). We embed the version at build time via a
 *  fallback constant. */
const PACKAGE_VERSION = "0.1.0";

const USAGE = `aristotle-reviewer — AristotleOS reviewer CLI

Usage:
  aristotle-reviewer verify         <bundle.json>
  aristotle-reviewer verify-warrant <warrant.json> <canonical-action-hash> [--trusted-key <keyid>] [--now <iso>]
  aristotle-reviewer verify-replay  <replay-artifact.json>
  aristotle-reviewer help
  aristotle-reviewer --version | -v

Exit code: 0 on PASS, 1 on FAIL or invalid input, 2 on unknown subcommand.

Each subcommand reads the supplied JSON file and emits a structured JSON
report to stdout. A one-line PASS/FAIL summary goes to stderr.
`;

export async function run(argv: string[], env: RunEnv): Promise<number> {
  const [sub, ...rest] = argv;

  if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
    env.stdout.write(USAGE);
    return sub ? 0 : 1;
  }

  if (sub === "--version" || sub === "-v" || sub === "version") {
    env.stdout.write(`${PACKAGE_VERSION}\n`);
    return 0;
  }

  if (sub === "verify") {
    return runVerifyEvidenceBundle(rest, env);
  }
  if (sub === "verify-warrant") {
    return runVerifyWarrant(rest, env);
  }
  if (sub === "verify-replay") {
    return runVerifyReplay(rest, env);
  }

  env.stderr.write(`aristotle-reviewer: unknown subcommand '${sub}'\n${USAGE}`);
  return 2;
}

// ---------------------------------------------------------------------------
// Subcommand: verify (Evidence Bundle)
// ---------------------------------------------------------------------------

interface VerifyEvidenceReport {
  command: "verify";
  file: string;
  ok: boolean;
  verification: EvidenceBundleVerification;
}

function runVerifyEvidenceBundle(rest: string[], env: RunEnv): number {
  if (rest.length < 1) {
    env.stderr.write("aristotle-reviewer verify: requires <bundle.json>\n");
    return 1;
  }
  const file = resolvePath(env.cwd, rest[0]);
  let bundle: EvidenceBundle;
  try {
    bundle = loadEvidenceBundle(file);
  } catch (err) {
    env.stderr.write(`aristotle-reviewer verify: cannot read bundle: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  const verification = verifyEvidenceBundle(bundle);
  const report: VerifyEvidenceReport = {
    command: "verify",
    file,
    ok: verification.ok,
    verification
  };
  env.stdout.write(JSON.stringify(report, null, 2) + "\n");
  env.stderr.write(`evidence-bundle ${verification.ok ? "PASS" : "FAIL"}${verification.ok ? "" : `: ${verification.failures.join("; ")}`}\n`);
  return verification.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Subcommand: verify-warrant
// ---------------------------------------------------------------------------

interface VerifyWarrantReport {
  command: "verify-warrant";
  file: string;
  canonical_action_hash: string;
  trusted_key_ids: string[];
  now: string;
  result: VerifyWarrantResponse;
}

function runVerifyWarrant(rest: string[], env: RunEnv): number {
  if (rest.length < 2) {
    env.stderr.write("aristotle-reviewer verify-warrant: requires <warrant.json> <canonical-action-hash>\n");
    return 1;
  }
  const [fileArg, canonicalActionHash, ...flags] = rest;
  const file = resolvePath(env.cwd, fileArg);

  const trustedKeyIds: string[] = [];
  let now: string | undefined;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === "--trusted-key") {
      const v = flags[i + 1];
      if (!v) {
        env.stderr.write("aristotle-reviewer verify-warrant: --trusted-key requires a value\n");
        return 1;
      }
      trustedKeyIds.push(v);
      i++;
    } else if (f === "--now") {
      const v = flags[i + 1];
      if (!v) {
        env.stderr.write("aristotle-reviewer verify-warrant: --now requires an ISO timestamp\n");
        return 1;
      }
      now = v;
      i++;
    } else {
      env.stderr.write(`aristotle-reviewer verify-warrant: unknown flag '${f}'\n`);
      return 1;
    }
  }

  let warrant: Warrant;
  try {
    warrant = JSON.parse(readFileSync(file, "utf8")) as Warrant;
  } catch (err) {
    env.stderr.write(`aristotle-reviewer verify-warrant: cannot read warrant: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const evaluatedAt = now ?? new Date().toISOString();
  const result = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: canonicalActionHash, now: evaluatedAt },
    { trustedKeyIds }
  );

  const report: VerifyWarrantReport = {
    command: "verify-warrant",
    file,
    canonical_action_hash: canonicalActionHash,
    trusted_key_ids: trustedKeyIds,
    now: evaluatedAt,
    result
  };
  env.stdout.write(JSON.stringify(report, null, 2) + "\n");
  env.stderr.write(`warrant ${result.ok ? "PASS" : "FAIL"}${result.ok ? "" : `: ${result.reason ?? "no reason given"}`}\n`);
  return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Subcommand: verify-replay
// ---------------------------------------------------------------------------

interface VerifyReplayReport {
  command: "verify-replay";
  file: string;
  ok: boolean;
  artifact_hash_ok: boolean;
  report_hash_ok: boolean;
  scenario_id: string;
  scenario_version: string;
  expected_artifact_hash: string;
  computed_artifact_hash: string;
  expected_report_hash: string;
  computed_report_hash: string;
  failures: string[];
}

function runVerifyReplay(rest: string[], env: RunEnv): number {
  if (rest.length < 1) {
    env.stderr.write("aristotle-reviewer verify-replay: requires <replay-artifact.json>\n");
    return 1;
  }
  const file = resolvePath(env.cwd, rest[0]);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    env.stderr.write(`aristotle-reviewer verify-replay: cannot read artifact: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  let artifact: ReplayArtifact<unknown, unknown>;
  try {
    artifact = loadReplayArtifact<unknown, unknown>(raw);
  } catch (err) {
    env.stderr.write(`aristotle-reviewer verify-replay: invalid artifact: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (artifact.format !== ARTIFACT_FORMAT) {
    env.stderr.write(`aristotle-reviewer verify-replay: unexpected artifact format: ${artifact.format}\n`);
    return 1;
  }

  // We can verify the two structural hashes locally without re-executing
  // the scenario (which we can't generically — every scenario is its own
  // runner). For reproducibility, callers should use the in-repo
  // verifyReplayArtifact with the matching scenario runner.
  const { artifact_hash: expectedHash, ...rest2 } = artifact;
  const computedArtifactHash = "sha256:" + sha256(stableStringify(rest2));
  const artifact_hash_ok = computedArtifactHash === expectedHash;

  const computedReportHash = "sha256:" + sha256(stableStringify(artifact.report));
  const report_hash_ok = computedReportHash === artifact.report_hash;

  const failures: string[] = [];
  if (!artifact_hash_ok) failures.push(`artifact_hash mismatch: expected ${expectedHash}, computed ${computedArtifactHash}`);
  if (!report_hash_ok) failures.push(`report_hash mismatch: expected ${artifact.report_hash}, computed ${computedReportHash}`);

  const ok = artifact_hash_ok && report_hash_ok;

  const report: VerifyReplayReport = {
    command: "verify-replay",
    file,
    ok,
    artifact_hash_ok,
    report_hash_ok,
    scenario_id: artifact.scenario_id,
    scenario_version: artifact.scenario_version,
    expected_artifact_hash: expectedHash,
    computed_artifact_hash: computedArtifactHash,
    expected_report_hash: artifact.report_hash,
    computed_report_hash: computedReportHash,
    failures
  };
  env.stdout.write(JSON.stringify(report, null, 2) + "\n");
  env.stderr.write(`replay-artifact ${ok ? "PASS" : "FAIL"}${ok ? "" : `: ${failures.join("; ")}`}\n`);
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Shared helpers — deterministic hashing of artifact payloads
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Test surface re-exports
// ---------------------------------------------------------------------------

export { PACKAGE_VERSION };
