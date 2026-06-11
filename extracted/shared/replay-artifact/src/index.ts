/**
 * @aristotle/replay-artifact — published replay artifact format.
 *
 * The substrate audit's #12 ("one ruthlessly real operational
 * scenario") asks for "reconstructable authority state": a third
 * party can take what we publish and verify it actually happened,
 * not by trusting our claim, but by re-running the scenario locally
 * and observing the same result.
 *
 * This package defines the artifact format and the verifier. It is
 * intentionally agnostic to the SHAPE of the scenario report — the
 * artifact stores whatever the producer chose to emit. The contract
 * is: same scenario_id + same inputs + same code yields the same
 * report.
 *
 * A `ReplayArtifact<I, R>` carries:
 *   - `format` — wire format tag (`aristotle.replay-artifact.v1`)
 *   - `scenario_id` — stable identifier (e.g.,
 *     `swarm-partition-40-asset`)
 *   - `scenario_version` — producer-controlled version of the
 *     scenario code; the verifier asserts this matches its local
 *     code's stated version.
 *   - `inputs` — the inputs that were fed to the scenario.
 *   - `report` — the produced report.
 *   - `report_hash` — sha-256 over the canonical stable
 *     stringification of `report`.
 *   - `artifact_hash` — sha-256 over the whole artifact minus
 *     `artifact_hash`.
 *   - `provenance` — when, where, by whom.
 *
 * Producers call `buildReplayArtifact(opts)`.
 * Verifiers call `verifyReplayArtifact(artifact, opts)` with a local
 * runner that re-runs the scenario.
 */

import { createHash } from "node:crypto";

export const ARTIFACT_FORMAT = "aristotle.replay-artifact.v1";

export interface ReplayProvenance {
  /** Who produced this artifact (CI pipeline, developer email, etc.). */
  producer: string;
  /** Timestamp the artifact was produced. */
  produced_at: string;
  /** Optional pointer to the source code (git commit / OCI digest). */
  source_ref?: string;
  /** Optional human-readable notes. */
  notes?: string;
}

export interface ReplayArtifact<I, R> {
  format: typeof ARTIFACT_FORMAT;
  scenario_id: string;
  scenario_version: string;
  inputs: I;
  report: R;
  report_hash: string;
  artifact_hash: string;
  provenance: ReplayProvenance;
}

export interface BuildReplayArtifactOptions<I, R> {
  scenario_id: string;
  scenario_version: string;
  inputs: I;
  report: R;
  provenance: ReplayProvenance;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null"; // match JSON.stringify drop-then-restore semantics
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  // Skip keys whose value is undefined — JSON.stringify drops them,
  // so we must too to survive a write/parse roundtrip.
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function buildReplayArtifact<I, R>(opts: BuildReplayArtifactOptions<I, R>): ReplayArtifact<I, R> {
  const report_hash = "sha256:" + sha256Hex(stableStringify(opts.report));
  const partial: Omit<ReplayArtifact<I, R>, "artifact_hash"> = {
    format: ARTIFACT_FORMAT,
    scenario_id: opts.scenario_id,
    scenario_version: opts.scenario_version,
    inputs: opts.inputs,
    report: opts.report,
    report_hash,
    provenance: opts.provenance
  };
  const artifact_hash = "sha256:" + sha256Hex(stableStringify(partial));
  return { ...partial, artifact_hash };
}

export interface VerifyReplayArtifactOptions<I, R> {
  /** Local runner the verifier supplies. Must be deterministic for the
   *  same inputs (the scenario's own contract). */
  rerun: (inputs: I) => Promise<R>;
  /** Local scenario version. Verifier confirms the artifact was built
   *  against the same code version. Pass undefined to skip this check
   *  (verifier accepts any version — discouraged for production use). */
  localScenarioVersion?: string;
}

export interface ReplayVerification {
  ok: boolean;
  failures: string[];
  /** True when the locally-recomputed artifact_hash matches the one
   *  stored in the artifact (i.e., the artifact body has not been
   *  tampered with). */
  artifact_hash_ok: boolean;
  /** True when the locally-recomputed report_hash matches the one
   *  stored in the artifact (i.e., the report hash field itself is
   *  internally consistent with the report body). */
  report_hash_ok: boolean;
  /** True when the locally-re-run scenario produced a report whose
   *  stable hash matches the artifact's report_hash. The strongest
   *  signal — proves the scenario is reproducible under your local
   *  code. */
  scenario_reproducible: boolean;
  /** True when scenario_version matches the verifier's local version
   *  (or when the verifier explicitly skipped the check). */
  version_ok: boolean;
}

export async function verifyReplayArtifact<I, R>(
  artifact: ReplayArtifact<I, R>,
  opts: VerifyReplayArtifactOptions<I, R>
): Promise<ReplayVerification> {
  const failures: string[] = [];

  // 1) artifact_hash internal consistency
  const { artifact_hash: expectedHash, ...rest } = artifact;
  const computedArtifactHash = "sha256:" + sha256Hex(stableStringify(rest));
  const artifact_hash_ok = computedArtifactHash === expectedHash;
  if (!artifact_hash_ok) {
    failures.push(`artifact_hash mismatch: expected ${expectedHash}, got ${computedArtifactHash}`);
  }

  // 2) report_hash internal consistency
  const computedReportHash = "sha256:" + sha256Hex(stableStringify(artifact.report));
  const report_hash_ok = computedReportHash === artifact.report_hash;
  if (!report_hash_ok) {
    failures.push(`report_hash mismatch: expected ${artifact.report_hash}, got ${computedReportHash}`);
  }

  // 3) version check
  let version_ok = true;
  if (opts.localScenarioVersion !== undefined && opts.localScenarioVersion !== artifact.scenario_version) {
    version_ok = false;
    failures.push(`scenario_version mismatch: artifact=${artifact.scenario_version}, local=${opts.localScenarioVersion}`);
  }

  // 4) reproducibility — re-run the scenario locally and compare report hashes.
  let scenario_reproducible = false;
  try {
    const localReport = await opts.rerun(artifact.inputs);
    const localReportHash = "sha256:" + sha256Hex(stableStringify(localReport));
    scenario_reproducible = localReportHash === artifact.report_hash;
    if (!scenario_reproducible) {
      failures.push(`scenario re-run produced different report_hash: expected ${artifact.report_hash}, got ${localReportHash}`);
    }
  } catch (err) {
    scenario_reproducible = false;
    failures.push(`scenario re-run threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ok: artifact_hash_ok && report_hash_ok && version_ok && scenario_reproducible,
    failures,
    artifact_hash_ok,
    report_hash_ok,
    scenario_reproducible,
    version_ok
  };
}

/** Human-readable single-line summary for an artifact. */
export function summarizeReplayArtifact<I, R>(artifact: ReplayArtifact<I, R>): string {
  return `${ARTIFACT_FORMAT} scenario=${artifact.scenario_id}@${artifact.scenario_version} report_hash=${artifact.report_hash.slice(0, 14)}... produced_at=${artifact.provenance.produced_at} by=${artifact.provenance.producer}`;
}

/** Parse / validate a serialized artifact (raw object or JSON string). */
export function loadReplayArtifact<I, R>(input: unknown): ReplayArtifact<I, R> {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  if (!value || typeof value !== "object") throw new Error("replay artifact is not an object");
  const o = value as Record<string, unknown>;
  if (o.format !== ARTIFACT_FORMAT) {
    throw new Error(`unexpected artifact format: ${String(o.format)} (expected ${ARTIFACT_FORMAT})`);
  }
  for (const key of ["scenario_id", "scenario_version", "inputs", "report", "report_hash", "artifact_hash", "provenance"]) {
    if (!(key in o)) throw new Error(`replay artifact missing required field: ${key}`);
  }
  return o as unknown as ReplayArtifact<I, R>;
}
