/**
 * publish-replay-artifact.ts — produce a signed, verifiable replay
 * artifact for the 40-asset disconnected-swarm scenario, then write
 * it to disk as `published.replay.json`.
 *
 * Substrate audit #12 asks for "reconstructable authority state": a
 * third party can take what we publish and verify it actually
 * happened by re-running the scenario locally. This script produces
 * that artifact.
 *
 * Usage:
 *   node --import tsx examples/mesh/publish-replay-artifact.ts
 *
 * Output:
 *   examples/mesh/published.replay.json
 *
 * The accompanying test file `published.replay.test.ts` re-loads the
 * artifact and verifies it by re-running the scenario — this is the
 * full proof of reproducibility.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildReplayArtifact } from "../../shared/replay-artifact/src/index.js";
import { runSwarmPartitionScenario, type ScenarioReport } from "./swarm-partition-40-asset.js";

export const SCENARIO_VERSION = "1.0.0";

export interface SwarmScenarioInputs {
  assetCount: number;
  fluidityTtlMs: number;
}

export async function buildSwarmReplayArtifact(opts: {
  inputs: SwarmScenarioInputs;
  producer: string;
  produced_at?: string;
  source_ref?: string;
  notes?: string;
}) {
  const report = await runSwarmPartitionScenario(opts.inputs);
  return buildReplayArtifact<SwarmScenarioInputs, ScenarioReport>({
    scenario_id: "swarm-partition-40-asset",
    scenario_version: SCENARIO_VERSION,
    inputs: opts.inputs,
    report,
    provenance: {
      producer: opts.producer,
      produced_at: opts.produced_at ?? new Date().toISOString(),
      source_ref: opts.source_ref,
      notes: opts.notes
    }
  });
}

// Direct invocation: produce + write the artifact.
const isMain = (() => {
  try {
    const url = (import.meta as { url?: string }).url;
    return url && process.argv[1] && url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
  } catch {
    return false;
  }
})();

if (isMain) {
  (async () => {
    const artifact = await buildSwarmReplayArtifact({
      inputs: { assetCount: 40, fluidityTtlMs: 1500 },
      producer: "aristotle-os.release.publish",
      notes: "v0.1.63 published replay artifact: 40-asset disconnected-swarm partition scenario"
    });
    const here = dirname(fileURLToPath(import.meta.url));
    const out = join(here, "published.replay.json");
    writeFileSync(out, JSON.stringify(artifact, null, 2), "utf8");
    console.log(`wrote ${out}`);
    console.log(`scenario_id: ${artifact.scenario_id}@${artifact.scenario_version}`);
    console.log(`report_hash: ${artifact.report_hash}`);
    console.log(`artifact_hash: ${artifact.artifact_hash}`);
    console.log(`report:`, JSON.stringify(artifact.report, null, 2));
  })().catch((e) => { console.error(e); process.exit(1); });
}
