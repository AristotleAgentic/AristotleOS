import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { evaluateCommit } from "../shared/governance-core/src/commit-gate.js";
import { buildPayments } from "../shared/governance-core/src/fixtures.js";
import { verifyGelChain } from "../shared/governance-core/src/gel.js";
import { chainMetrics } from "../shared/governance-core/src/metrics.js";
import type { CommitDecisionKind } from "../shared/governance-core/src/types.js";

type ScenarioName = "payments";

interface BenchmarkConfig {
  scenario: ScenarioName;
  iterations: number;
  warmup: number;
  outputPath: string;
}

interface LatencyStats {
  count: number;
  minMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  throughputPerSecond: number;
}

interface BenchmarkPhase {
  name: string;
  objective: string;
  outcome: Record<string, unknown>;
  latency: LatencyStats;
}

interface BenchmarkReport {
  generatedAt: string;
  doctrine: string;
  config: BenchmarkConfig;
  phases: BenchmarkPhase[];
  decisionCounts: Record<CommitDecisionKind, number>;
  ledger: {
    records: number;
    integrityOk: boolean;
    verificationMs: number;
    verificationThroughputRecordsPerSecond: number;
    headHash: string;
  };
  storeMetrics: ReturnType<typeof chainMetrics>;
}

const DEFAULT_OUTPUT = "reports/runtime-benchmark.json";

function parseArgs(argv: string[]): BenchmarkConfig {
  const config: BenchmarkConfig = {
    scenario: "payments",
    iterations: 1000,
    warmup: 100,
    outputPath: DEFAULT_OUTPUT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--iterations" && next) {
      config.iterations = positiveInteger(next, "iterations");
      i++;
    } else if (arg === "--warmup" && next) {
      config.warmup = positiveInteger(next, "warmup");
      i++;
    } else if (arg === "--out" && next) {
      config.outputPath = next;
      i++;
    } else if (arg === "--scenario" && next) {
      if (next !== "payments") throw new Error(`unsupported scenario: ${next}`);
      config.scenario = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--") {
      continue;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (config.warmup >= config.iterations) {
    throw new Error("warmup must be lower than iterations so measured samples remain");
  }
  return config;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function printHelp(): void {
  console.log(`AristotleOS runtime governance benchmark

Usage:
  npm run benchmark:runtime -- [--iterations 1000] [--warmup 100] [--out reports/runtime-benchmark.json]

Measures the real governance-core execution boundary:
  - warrant issuance
  - admissibility commit evaluation
  - fail-closed missing-warrant evaluation
  - revocation blocking
  - GEL append throughput
  - replay/hash-chain verification
`);
}

function measure<T>(samples: number[], fn: () => T): T {
  const start = performance.now();
  const out = fn();
  samples.push(performance.now() - start);
  return out;
}

function stats(samples: number[]): LatencyStats {
  if (samples.length === 0) throw new Error("cannot summarize an empty sample set");
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    minMs: round(sorted[0]),
    meanMs: round(total / sorted.length),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: round(sorted[sorted.length - 1]),
    throughputPerSecond: round((sorted.length / total) * 1000),
  };
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return round(sorted[index]);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildWorld(config: BenchmarkConfig) {
  switch (config.scenario) {
    case "payments":
      return buildPayments();
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const world = buildWorld(config);
  const decisionCounts: Record<CommitDecisionKind, number> = {
    Allow: 0,
    Deny: 0,
    Escalate: 0,
    FailClosed: 0,
  };

  const issueSamples: number[] = [];
  const commitSamples: number[] = [];
  const failClosedSamples: number[] = [];
  const revocationSamples: number[] = [];

  for (let i = 0; i < config.iterations; i++) {
    const measured = i >= config.warmup;
    const issueTarget = measured ? issueSamples : [];
    const commitTarget = measured ? commitSamples : [];

    const proposal = measure(issueTarget, () =>
      world.propose({
        parameters: { amount: 0, currency: "USD", customer: `bench-${i}` },
        context: { ticket: `BENCH-${i}`, reason: "runtime benchmark" },
        telemetry: { fraud_score: 0.01 },
      }),
    );

    const decision = measure(commitTarget, () =>
      evaluateCommit(world.store, proposal.request, {
        keyring: world.keyring,
        signKeyId: world.keyId,
      }),
    );
    if (measured) decisionCounts[decision.decision]++;
  }

  for (let i = 0; i < config.iterations; i++) {
    const measured = i >= config.warmup;
    const target = measured ? failClosedSamples : [];
    const proposal = world.propose({
      parameters: { amount: 0.01, currency: "USD", customer: `failclosed-${i}` },
      context: { ticket: `FC-${i}`, reason: "runtime benchmark" },
      telemetry: { fraud_score: 0.01 },
    });
    const decision = measure(target, () =>
      evaluateCommit(
        world.store,
        { ...proposal.request, warrant_id: `missing-warrant-${i}` },
        { keyring: world.keyring, signKeyId: world.keyId },
      ),
    );
    if (measured) decisionCounts[decision.decision]++;
  }

  world.envelope.revocation_state = "revoked";
  for (let i = 0; i < config.iterations; i++) {
    const measured = i >= config.warmup;
    const target = measured ? revocationSamples : [];
    const proposal = world.propose({
      parameters: { amount: 0.01, currency: "USD", customer: `revoked-${i}` },
      context: { ticket: `REV-${i}`, reason: "runtime benchmark" },
      telemetry: { fraud_score: 0.01 },
    });
    const decision = measure(target, () =>
      evaluateCommit(world.store, proposal.request, {
        keyring: world.keyring,
        signKeyId: world.keyId,
      }),
    );
    if (measured) decisionCounts[decision.decision]++;
  }

  const verificationStart = performance.now();
  const verification = verifyGelChain(world.store.getGelChain(), world.keyring);
  const verificationMs = performance.now() - verificationStart;
  const metrics = chainMetrics(world.store, world.keyring);

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    doctrine: "Governance must bind at the execution boundary before irreversible state mutation or external action occurs.",
    config,
    phases: [
      {
        name: "warrant_issuance",
        objective: "Measure signed single-use warrant materialization before commit-point evaluation.",
        outcome: { scenario: config.scenario },
        latency: stats(issueSamples),
      },
      {
        name: "admissibility_commit_gate",
        objective: "Measure bounded execution-boundary evaluation for allowed governed actions.",
        outcome: { decision: "Allow" },
        latency: stats(commitSamples),
      },
      {
        name: "fail_closed_missing_warrant",
        objective: "Measure incomplete-chain refusal latency when the warrant reference is absent.",
        outcome: { decision: "FailClosed", invariant: "warrant-not-found" },
        latency: stats(failClosedSamples),
      },
      {
        name: "revocation_blocking",
        objective: "Measure deny latency after authority revocation has propagated into the materialized runtime state.",
        outcome: { decision: "Deny", invariant: "authority-envelope-revoked" },
        latency: stats(revocationSamples),
      },
    ],
    decisionCounts,
    ledger: {
      records: world.store.gelLength(),
      integrityOk: verification.ok,
      verificationMs: round(verificationMs),
      verificationThroughputRecordsPerSecond: round((world.store.gelLength() / Math.max(verificationMs, 0.001)) * 1000),
      headHash: world.store.gelHeadHash(),
    },
    storeMetrics: metrics,
  };

  const outputPath = resolve(config.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outputPath.replace(/\.json$/i, ".md"), renderMarkdown(report), "utf8");
  console.log(renderConsole(report, outputPath));
}

function renderConsole(report: BenchmarkReport, outputPath: string): string {
  const lines = [
    "AristotleOS runtime benchmark complete",
    `scenario=${report.config.scenario} iterations=${report.config.iterations} warmup=${report.config.warmup}`,
    `ledger.records=${report.ledger.records} ledger.integrity_ok=${report.ledger.integrityOk}`,
    `report=${outputPath}`,
    "",
  ];
  for (const phase of report.phases) {
    lines.push(
      `${phase.name}: mean=${phase.latency.meanMs}ms p95=${phase.latency.p95Ms}ms p99=${phase.latency.p99Ms}ms throughput=${phase.latency.throughputPerSecond}/s`,
    );
  }
  return lines.join("\n");
}

function renderMarkdown(report: BenchmarkReport): string {
  const rows = report.phases
    .map(
      (phase) =>
        `| ${phase.name} | ${phase.latency.count} | ${phase.latency.meanMs} | ${phase.latency.p95Ms} | ${phase.latency.p99Ms} | ${phase.latency.throughputPerSecond} |`,
    )
    .join("\n");
  return `# AristotleOS Runtime Benchmark

Generated: ${report.generatedAt}

Doctrine: ${report.doctrine}

Scenario: \`${report.config.scenario}\`
Iterations: \`${report.config.iterations}\`
Warmup: \`${report.config.warmup}\`

| Phase | Samples | Mean ms | P95 ms | P99 ms | Throughput/s |
| --- | ---: | ---: | ---: | ---: | ---: |
${rows}

## Decision Counts

\`\`\`json
${JSON.stringify(report.decisionCounts, null, 2)}
\`\`\`

## Ledger

- Records: ${report.ledger.records}
- Integrity OK: ${report.ledger.integrityOk}
- Replay verification ms: ${report.ledger.verificationMs}
- Replay verification throughput records/s: ${report.ledger.verificationThroughputRecordsPerSecond}
- Head hash: \`${report.ledger.headHash}\`
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
