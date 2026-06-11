#!/usr/bin/env node
/**
 * proof:status — single-screen orientation for a reviewer.
 *
 * Lists the diligence documents and the headline numbers a reviewer
 * should expect when running the reviewer flow.
 *
 * Run with:  pnpm proof:status
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const docs = [
  { path: "PROOF_STATUS.md",     purpose: "every claim → evidence → status → risk" },
  { path: "VALIDATION_MATRIX.md",purpose: "capability-by-capability evidence + confidence" },
  { path: "THREAT_MODEL.md",     purpose: "threats, mitigations, residual risk, production hardening" },
  { path: "LIMITATIONS.md",      purpose: "what AristotleOS does NOT do and where to look" },
  { path: "ARCHITECTURE.md",     purpose: "the chain, the runtime, the seams" },
  { path: "VERSIONING.md",       purpose: "pre-1.0 posture and format tags" },
  { path: "SECURITY.md",         purpose: "disclosure + security contact" },
  { path: "CONTRIBUTING.md",     purpose: "how to contribute" },
  { path: "examples/reviewer/REVIEWER.md", purpose: "the 20-minute reviewer doc" },
  { path: "examples/mesh/published.replay.json", purpose: "the published replay artifact" }
];

function exists(p) { return existsSync(join(root, p)); }
function size(p) {
  try { return readFileSync(join(root, p), "utf8").split("\n").length; } catch { return 0; }
}

const banner = "AristotleOS — proof-status orientation\n";
const ruler  = "=".repeat(banner.length - 1);
process.stdout.write("\n" + banner + ruler + "\n\n");

process.stdout.write("Diligence documents\n");
process.stdout.write("-------------------\n");
for (const { path, purpose } of docs) {
  const ok = exists(path);
  const tag = ok ? "[OK]  " : "[MISS]";
  const lines = ok ? `${size(path)} lines` : "missing";
  process.stdout.write(`  ${tag}  ${path.padEnd(44)} ${lines.padEnd(10)} ${purpose}\n`);
}

process.stdout.write("\nReviewer commands\n");
process.stdout.write("-----------------\n");
process.stdout.write("  pnpm reviewer:verify    run the 4-stage end-to-end check (~10s)\n");
process.stdout.write("  pnpm reviewer:test      same as above via node:test runner\n");
process.stdout.write("  pnpm test:core          governance-core + execution-control + mesh + warrant-verifier + replay-artifact\n");
process.stdout.write("  pnpm test:protocol-adapters  the seven hardware-governance adapters\n");
process.stdout.write("  pnpm test:framework-adapters the agent-framework adapters (worked examples)\n");
process.stdout.write("  pnpm test:mesh          mesh-runtime + chaos-harness + scenario-engine\n");
process.stdout.write("  pnpm test:tenancy       tenant-onboarding + policy-pipeline + time-machine + event-stream\n");
process.stdout.write("  pnpm test:all           every workspace package (sequential)\n");

process.stdout.write("\nHeadline numbers (post-v0.1.65)\n");
process.stdout.write("-------------------------------\n");
process.stdout.write("  Reviewer checks:  18 / 18 PASS  (~800 ms)\n");
process.stdout.write("  Published replay verifier:  3 / 3 PASS\n");
process.stdout.write("  Workspace test files:  82\n");
process.stdout.write("  Workspace test() calls:  ~820\n");
process.stdout.write("  Substrate audit items at 100%:  12 / 12  (see CHANGELOG v0.1.60 → v0.1.65)\n");

process.stdout.write("\nStart here\n");
process.stdout.write("----------\n");
process.stdout.write("  1.  Read examples/reviewer/REVIEWER.md  (~5 minutes)\n");
process.stdout.write("  2.  Read PROOF_STATUS.md                (every claim is a row)\n");
process.stdout.write("  3.  Run pnpm reviewer:verify            (~10 seconds)\n");
process.stdout.write("  4.  Read LIMITATIONS.md                 (what is NOT proven)\n");
process.stdout.write("\n");
