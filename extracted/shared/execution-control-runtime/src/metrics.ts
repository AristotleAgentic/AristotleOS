import type { ExecutionControlDecision, ExecutionControlReasonCode } from "./index.js";

/**
 * In-process runtime metrics for the execution-control boundary. Counts what the
 * ledger alone cannot cheaply express on the hot path: decision/reason-code rates,
 * decision latency (as a Prometheus histogram), and failure counters (warrant
 * verification, ledger append) plus replay refusals. Exposed at `/metrics`
 * (Prometheus text) and `/v1/execution-control/metrics` (JSON).
 */

const DEFAULT_LATENCY_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500];

export class RuntimeMetrics {
  readonly decisions: Record<ExecutionControlDecision, number> = { ALLOW: 0, REFUSE: 0, ESCALATE: 0, EXPIRE: 0 };
  readonly reasonCodes: Record<string, number> = {};
  warrantsIssued = 0;
  warrantFailures = 0;
  replayRefusals = 0;
  ledgerAppendFailures = 0;

  private readonly buckets: number[];
  private readonly bucketCounts: number[];
  private latencySumMs = 0;
  private latencyCount = 0;

  constructor(buckets: number[] = DEFAULT_LATENCY_BUCKETS_MS) {
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.bucketCounts = new Array(this.buckets.length + 1).fill(0); // last cell = +Inf
  }

  /** Record a completed decision: counts, reason codes, replay refusals, and latency. */
  recordDecision(decision: ExecutionControlDecision, reasonCodes: ExecutionControlReasonCode[], latencyMs: number, warrantIssued: boolean): void {
    this.decisions[decision] = (this.decisions[decision] ?? 0) + 1;
    for (const code of reasonCodes) {
      this.reasonCodes[code] = (this.reasonCodes[code] ?? 0) + 1;
      if (code === "REPLAY_DETECTED") this.replayRefusals += 1;
    }
    if (warrantIssued) this.warrantsIssued += 1;
    this.observeLatency(latencyMs);
  }

  recordWarrantFailure(): void { this.warrantFailures += 1; }
  recordLedgerAppendFailure(): void { this.ledgerAppendFailures += 1; }

  private observeLatency(latencyMs: number): void {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    this.latencySumMs += latencyMs;
    this.latencyCount += 1;
    let placed = false;
    for (let i = 0; i < this.buckets.length; i++) {
      if (latencyMs <= this.buckets[i]) { this.bucketCounts[i] += 1; placed = true; break; }
    }
    if (!placed) this.bucketCounts[this.buckets.length] += 1;
  }

  /** JSON snapshot for the /v1 metrics route. */
  snapshot(): {
    decisions: Record<string, number>;
    reason_codes: Record<string, number>;
    warrants_issued: number;
    warrant_failures: number;
    replay_refusals: number;
    ledger_append_failures: number;
    decision_latency_ms: { count: number; sum: number; buckets: Record<string, number> };
  } {
    const buckets: Record<string, number> = {};
    let cumulative = 0;
    for (let i = 0; i < this.buckets.length; i++) { cumulative += this.bucketCounts[i]; buckets[String(this.buckets[i])] = cumulative; }
    cumulative += this.bucketCounts[this.buckets.length];
    buckets["+Inf"] = cumulative;
    return {
      decisions: { ...this.decisions },
      reason_codes: { ...this.reasonCodes },
      warrants_issued: this.warrantsIssued,
      warrant_failures: this.warrantFailures,
      replay_refusals: this.replayRefusals,
      ledger_append_failures: this.ledgerAppendFailures,
      decision_latency_ms: { count: this.latencyCount, sum: this.latencySumMs, buckets }
    };
  }

  /** Prometheus exposition-format lines for the in-process counters + histogram. */
  prometheus(): string[] {
    const lines: string[] = [];
    lines.push("# HELP aristotle_decisions_total Governance decisions by outcome", "# TYPE aristotle_decisions_total counter");
    for (const decision of ["ALLOW", "REFUSE", "ESCALATE"] as ExecutionControlDecision[]) {
      lines.push(`aristotle_decisions_total{decision="${decision}"} ${this.decisions[decision]}`);
    }
    lines.push("# HELP aristotle_reason_codes_total Decisions by reason code", "# TYPE aristotle_reason_codes_total counter");
    for (const [code, count] of Object.entries(this.reasonCodes)) {
      lines.push(`aristotle_reason_codes_total{reason_code="${code}"} ${count}`);
    }
    lines.push(
      "# HELP aristotle_warrants_issued_total Warrants issued on ALLOW", "# TYPE aristotle_warrants_issued_total counter",
      `aristotle_warrants_issued_total ${this.warrantsIssued}`,
      "# HELP aristotle_warrant_failures_total Warrant verification failures", "# TYPE aristotle_warrant_failures_total counter",
      `aristotle_warrant_failures_total ${this.warrantFailures}`,
      "# HELP aristotle_replay_refusals_total Actions refused as replays", "# TYPE aristotle_replay_refusals_total counter",
      `aristotle_replay_refusals_total ${this.replayRefusals}`,
      "# HELP aristotle_ledger_append_failures_total GEL append failures", "# TYPE aristotle_ledger_append_failures_total counter",
      `aristotle_ledger_append_failures_total ${this.ledgerAppendFailures}`
    );
    lines.push("# HELP aristotle_decision_latency_ms Decision latency in milliseconds", "# TYPE aristotle_decision_latency_ms histogram");
    let cumulative = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      cumulative += this.bucketCounts[i];
      lines.push(`aristotle_decision_latency_ms_bucket{le="${this.buckets[i]}"} ${cumulative}`);
    }
    cumulative += this.bucketCounts[this.buckets.length];
    lines.push(
      `aristotle_decision_latency_ms_bucket{le="+Inf"} ${cumulative}`,
      `aristotle_decision_latency_ms_sum ${this.latencySumMs}`,
      `aristotle_decision_latency_ms_count ${this.latencyCount}`
    );
    return lines;
  }
}
