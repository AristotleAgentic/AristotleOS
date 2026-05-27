#!/usr/bin/env node
/**
 * @aristotle/time-machine counterfactual CLI.
 *
 * Usage:
 *   aristotle-counterfactual --plan <path> [--out <path>] [--max-flipped N] [--quiet]
 *
 * The plan file is a JSON document with shape `CounterfactualPlan`
 * (see below). The CLI runs `runCounterfactualSweep` over it, writes
 * the serialized result to `--out` (default: stdout), prints a
 * one-line summary to stderr (unless --quiet), and exits non-zero
 * when `flipped > max-flipped` (default: 0 → any flip fails CI).
 *
 * The plan declares the inputs explicitly because the GEL stores
 * canonical_action_hash, not the action material — the caller is
 * responsible for keeping the action archive alongside the chain
 * and feeding it to the CLI.
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  runCounterfactualSweep,
  serializeSweep,
  summarizeSweep,
  type CounterfactualSweepInput,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type GelRecord,
  type RuntimeRegister,
  type WardManifest
} from "./index.js";

export interface CounterfactualPlan {
  records: GelRecord[];
  /** Action material keyed by GEL record_id (caller's archive). */
  actions: Record<string, CanonicalActionInput>;
  /** Original ward/envelope keyed by GEL record_id. */
  originals: Record<string, { ward?: WardManifest | null; envelope?: AuthorityEnvelope | null }>;
  /** The counterfactual policy world to sweep against. */
  counterfactual: {
    name: string;
    ward?: WardManifest | null;
    envelope?: AuthorityEnvelope | null;
    runtimeRegister?: RuntimeRegister;
  };
}

export interface CliOptions {
  planPath: string;
  outPath?: string;
  maxFlipped: number;
  quiet: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  let planPath: string | undefined;
  let outPath: string | undefined;
  let maxFlipped = 0;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") { planPath = argv[++i]; }
    else if (a === "--out") { outPath = argv[++i]; }
    else if (a === "--max-flipped") { maxFlipped = parseInt(argv[++i], 10); }
    else if (a === "--quiet") { quiet = true; }
    else if (a === "--help" || a === "-h") { printUsage(); process.exit(0); }
    else { throw new Error(`unknown argument: ${a}`); }
  }
  if (!planPath) throw new Error("missing required --plan <path>");
  if (Number.isNaN(maxFlipped) || maxFlipped < 0) throw new Error("--max-flipped must be a non-negative integer");
  return { planPath, outPath, maxFlipped, quiet };
}

function printUsage(): void {
  // Print to stderr so stdout stays clean for piping the artifact JSON.
  process.stderr.write([
    "aristotle-counterfactual --plan <path> [--out <path>] [--max-flipped N] [--quiet]",
    "",
    "  --plan PATH         path to a JSON CounterfactualPlan",
    "  --out PATH          write the SerializedSweep here (default: stdout)",
    "  --max-flipped N     exit 1 when flipped count > N (default 0)",
    "  --quiet             suppress the one-line summary on stderr",
    "  -h, --help          print this message",
    ""
  ].join("\n"));
}

export function runCli(opts: CliOptions): { exitCode: number; summary: string } {
  const raw = readFileSync(opts.planPath, "utf8");
  const plan = JSON.parse(raw) as CounterfactualPlan;
  if (!Array.isArray(plan.records)) throw new Error("plan.records must be an array");
  if (!plan.counterfactual || typeof plan.counterfactual.name !== "string") {
    throw new Error("plan.counterfactual.name is required");
  }
  const sweepInput: CounterfactualSweepInput = {
    records: plan.records,
    resolveAction: (rec) => plan.actions[rec.record_id] ?? null,
    resolveOriginal: (rec) => plan.originals[rec.record_id] ?? {},
    counterfactual: {
      name: plan.counterfactual.name,
      ward: plan.counterfactual.ward,
      envelope: plan.counterfactual.envelope,
      runtimeRegister: plan.counterfactual.runtimeRegister
    }
  };
  const result = runCounterfactualSweep(sweepInput);
  const artifact = serializeSweep(result);
  const out = JSON.stringify(artifact, null, 2);
  if (opts.outPath) writeFileSync(opts.outPath, out, "utf8");
  else process.stdout.write(out + "\n");
  const summary = summarizeSweep(result);
  const exitCode = result.flipped.length > opts.maxFlipped ? 1 : 0;
  return { exitCode, summary };
}

// Direct invocation
const isMain = (() => {
  try {
    const url = (import.meta as { url?: string }).url;
    return url && process.argv[1] && url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const { exitCode, summary } = runCli(opts);
    if (!opts.quiet) process.stderr.write(summary + "\n");
    process.exit(exitCode);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    printUsage();
    process.exit(2);
  }
}
