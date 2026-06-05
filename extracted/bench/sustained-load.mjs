#!/usr/bin/env node
/**
 * Sustained-load benchmark for the AristotleOS Commit Gate.
 *
 * Closes the shippable portion of ROADMAP_TO_100.md Category 1
 * "benchmarks under sustained concurrent load". Drives
 * evaluateCommitGate (the pure decision function) for N seconds at a
 * target req/s and reports p50 / p95 / p99 / p99.9 latency in
 * microseconds plus the achieved throughput.
 *
 * USAGE
 *   node bench/sustained-load.mjs                 # defaults
 *   node bench/sustained-load.mjs --rps 5000 --secs 10
 *   node bench/sustained-load.mjs --json          # machine-readable
 *
 * NOT IN CI. Run locally as a baseline before performance work; commit
 * the JSON output as a snapshot in PROOF_STATUS.md or similar when you
 * want to track regressions over time.
 *
 * SCOPE
 *   This benchmark exercises the in-process decision function only —
 *   no HTTP, no ledger I/O, no remote calls. It measures the cost of
 *   the gate's pure evaluation path: substrate signature math is the
 *   dominant cost for the warrant-issuing variant (evaluateExecutionControl
 *   plus issueWarrant) and gate-decision math dominates the
 *   evaluateCommitGate-only variant. Add HTTP / ledger benchmarks
 *   separately if you need end-to-end numbers.
 */

import { performance } from "node:perf_hooks";
import { generateKeyPairSync } from "node:crypto";
import {
  LedgerStore,
  createEd25519Signer,
  evaluateCommitGate,
  evaluateExecutionControl
} from "../shared/execution-control-runtime/src/index.ts";

function parseArgs(argv) {
  const args = {
    rps: 1000,
    secs: 5,
    mode: "gate-only",  // "gate-only" | "full"
    warmup: 500,
    json: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rps") args.rps = Number(argv[++i]);
    else if (a === "--secs") args.secs = Number(argv[++i]);
    else if (a === "--mode") args.mode = argv[++i];
    else if (a === "--warmup") args.warmup = Number(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (a === "-h" || a === "--help") {
      console.log(`usage: node bench/sustained-load.mjs [--rps N] [--secs N] [--mode gate-only|full] [--warmup N] [--json]`);
      process.exit(0);
    }
  }
  if (!["gate-only", "full"].includes(args.mode)) {
    console.error(`--mode must be "gate-only" or "full"; got ${args.mode}`);
    process.exit(2);
  }
  return args;
}

const NOW = "2026-05-24T12:00:00.000Z";

const ward = {
  ward_id: "w-bench", name: "Bench Ward", sovereignty_context: "test",
  authority_domain: "test-ops", policy_version: "1.0.0",
  permitted_subjects: ["agent:a"]
};
const envelope = {
  envelope_id: "ae-bench", ward_id: "w-bench", subject: "agent:a",
  allowed_actions: ["x.do"], denied_actions: [], constraints: {},
  expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};

function freshAction(i) {
  return {
    action_id: `a-bench-${i}`, ward_id: "w-bench", subject: "agent:a",
    action_type: "x.do", target: `t-${i}`, params: { i },
    requested_at: NOW, request_id: `r-bench-${i}`
  };
}

function makeSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

function pct(sortedUs, p) {
  if (sortedUs.length === 0) return 0;
  const idx = Math.min(sortedUs.length - 1, Math.floor(p * sortedUs.length));
  return sortedUs[idx];
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const signer = makeSigner();
  const ledger = LedgerStore.memory();

  const tick = () => {
    const a = freshAction(0);
    if (args.mode === "gate-only") {
      return evaluateCommitGate({ ward, authorityEnvelope: envelope, action: a, now: NOW });
    }
    return evaluateExecutionControl({
      ward, authorityEnvelope: envelope, action: a,
      now: NOW, ledger, ledgerPath: "unused", signer,
      replayProtection: false
    });
  };

  // Warmup: prime caches, JIT, etc.
  for (let i = 0; i < args.warmup; i++) tick();

  // Sustained pacing: target req/s. We compute the next deadline as
  // start + (n / rps) seconds so jitter doesn't accumulate; if we fall
  // behind we don't sleep, we just keep going.
  const start = performance.now();
  const endByMs = start + args.secs * 1000;
  const intervalUs = 1_000_000 / args.rps;
  const latenciesUs = [];
  let n = 0;
  let lastReport = start;

  while (performance.now() < endByMs) {
    const targetMs = start + (n * intervalUs) / 1000;
    const nowMs = performance.now();
    if (targetMs > nowMs) {
      const waitMs = targetMs - nowMs;
      if (waitMs > 1) await new Promise((r) => setTimeout(r, waitMs));
    }
    const t0 = performance.now();
    tick();
    const t1 = performance.now();
    latenciesUs.push((t1 - t0) * 1000);
    n++;
    if (!args.json && performance.now() - lastReport > 1000) {
      const elapsedSec = (performance.now() - start) / 1000;
      const achievedRps = Math.round(n / elapsedSec);
      process.stderr.write(`  [${elapsedSec.toFixed(1)}s] n=${n}  achieved=${achievedRps} rps\n`);
      lastReport = performance.now();
    }
  }

  const total = performance.now() - start;
  latenciesUs.sort((a, b) => a - b);
  const result = {
    mode: args.mode,
    target_rps: args.rps,
    duration_s: total / 1000,
    sample_count: latenciesUs.length,
    achieved_rps: latenciesUs.length / (total / 1000),
    latency_us: {
      min: latenciesUs[0] ?? 0,
      p50: pct(latenciesUs, 0.50),
      p95: pct(latenciesUs, 0.95),
      p99: pct(latenciesUs, 0.99),
      p999: pct(latenciesUs, 0.999),
      max: latenciesUs[latenciesUs.length - 1] ?? 0,
      mean: latenciesUs.reduce((a, b) => a + b, 0) / latenciesUs.length
    },
    node_version: process.version,
    timestamp_iso: new Date().toISOString()
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("");
    console.log("AristotleOS Commit Gate sustained-load benchmark");
    console.log("------------------------------------------------");
    console.log(`mode:           ${result.mode}`);
    console.log(`target rps:     ${result.target_rps}`);
    console.log(`achieved rps:   ${result.achieved_rps.toFixed(0)}`);
    console.log(`duration:       ${result.duration_s.toFixed(2)} s`);
    console.log(`samples:        ${result.sample_count}`);
    console.log(`latency µs      min=${result.latency_us.min.toFixed(1)}  p50=${result.latency_us.p50.toFixed(1)}  p95=${result.latency_us.p95.toFixed(1)}  p99=${result.latency_us.p99.toFixed(1)}  p99.9=${result.latency_us.p999.toFixed(1)}  max=${result.latency_us.max.toFixed(1)}  mean=${result.latency_us.mean.toFixed(1)}`);
    console.log(`node:           ${result.node_version}`);
    console.log(`timestamp:      ${result.timestamp_iso}`);
    console.log("");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
