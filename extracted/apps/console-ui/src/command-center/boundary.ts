import type { CommitDecision, LedgerRecord, SystemSnapshot } from "./types.js";

/**
 * Live client for the AristotleOS execution-control boundary.
 *
 * The console is served by server.mjs, which proxies `/v1`, `/operator`, `/health`,
 * and `/metrics` to the gateway/boundary — so these relative-path fetches hit the
 * real, hardened runtime when one is deployed, and resolve to null (→ mock fallback)
 * when it isn't. This is the seam that makes the operator console real without
 * changing a single layout: the store maps these responses into the same domain
 * types the mock data uses.
 */

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(path, { signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface PostResult<T> {
  /** false when the boundary is unreachable (network error). */
  reachable: boolean;
  ok: boolean;
  status: number;
  data: T | null;
}

async function postJson<T>(path: string, body: unknown): Promise<PostResult<T>> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as T | null;
    return { reachable: true, ok: res.ok, status: res.status, data };
  } catch {
    return { reachable: false, ok: false, status: 0, data: null };
  }
}

export interface BoundaryMetrics {
  total_records?: number;
  decisions?: Record<string, number>;
  reason_codes?: Record<string, number>;
  ledger_ok?: boolean;
  kill_switch_engaged?: boolean;
  runtime?: Record<string, unknown>;
}

export interface GelRecordLike {
  record_id: string;
  timestamp: string;
  subject: string;
  ward_id: string;
  decision: "ALLOW" | "REFUSE" | "ESCALATE";
  reason_codes: string[];
  warrant_id?: string;
  policy_version?: string;
  canonical_action_hash: string;
  record_hash: string;
  previous_hash: string;
}

export function decisionToUi(decision: string): CommitDecision {
  if (decision === "ALLOW") return "allow";
  if (decision === "ESCALATE") return "escalate";
  return "refuse";
}

/** Pure: map the boundary's /metrics into the snapshot fields the header renders. */
export function mapMetricsToSnapshot(metrics: BoundaryMetrics, verified: boolean): Partial<SystemSnapshot> {
  const decisions = metrics.decisions ?? {};
  const latency = readLatencyP50(metrics.runtime);
  return {
    source: "live",
    warrantsToday: decisions.ALLOW ?? 0,
    refusalsToday: decisions.REFUSE ?? 0,
    escalationsToday: decisions.ESCALATE ?? 0,
    ledgerHeight: metrics.total_records ?? 0,
    ledgerIntact: metrics.ledger_ok ?? verified,
    killSwitchArmed: Boolean(metrics.kill_switch_engaged),
    posture: metrics.kill_switch_engaged ? "red" : (metrics.ledger_ok ?? verified) ? "green" : "amber",
    ...(latency !== undefined ? { gateLatencyMs: latency } : {})
  };
}

function readLatencyP50(runtime: Record<string, unknown> | undefined): number | undefined {
  if (!runtime) return undefined;
  const latency = (runtime as { latency_ms?: Record<string, unknown>; latency?: Record<string, unknown> }).latency_ms ?? (runtime as { latency?: Record<string, unknown> }).latency;
  const p50 = latency && typeof latency === "object" ? (latency as { p50?: unknown }).p50 : undefined;
  return typeof p50 === "number" ? p50 : undefined;
}

/** Pure: map signed GEL records into the LedgerRecord rows the explorer renders. */
export function mapGelToLedger(records: GelRecordLike[]): LedgerRecord[] {
  return records.map((record, index) => ({
    seq: index + 1,
    timestamp: record.timestamp,
    eventType: `decision.${String(record.decision ?? "").toLowerCase()}`,
    agent: record.subject,
    ward: record.ward_id,
    domain: "—",
    decision: decisionToUi(record.decision),
    warrantId: record.warrant_id,
    policyHash: record.policy_version ?? "—",
    registerHash: (record.canonical_action_hash ?? "").slice(0, 16) || "—",
    recordHash: record.record_hash,
    previousHash: record.previous_hash,
    intact: true,
    anchored: Boolean(record.warrant_id)
  }));
}

export interface LiveState {
  snapshot: Partial<SystemSnapshot>;
  ledger: LedgerRecord[];
}

/** Probe the execution-control boundary; returns mapped live state, or null when unreachable. */
export async function fetchLiveState(signal?: AbortSignal): Promise<LiveState | null> {
  const metrics = await getJson<BoundaryMetrics>("/v1/execution-control/metrics", signal);
  if (!metrics) return null;
  const [tail, verify] = await Promise.all([
    getJson<{ items: GelRecordLike[] }>("/v1/execution-control/audit/tail?limit=40", signal),
    getJson<{ ok: boolean; count: number }>("/v1/execution-control/audit/verify", signal)
  ]);
  return {
    snapshot: mapMetricsToSnapshot(metrics, verify?.ok ?? Boolean(metrics.ledger_ok)),
    ledger: tail?.items?.length ? mapGelToLedger(tail.items) : []
  };
}

export interface GovernanceDraftBody {
  ward?: unknown;
  authority_envelope?: unknown;
}

/** Real governance compile against the boundary. `reachable:false` ⇒ caller shows the local preview. */
export async function boundaryCompile(body: GovernanceDraftBody): Promise<PostResult<{ hashes?: { manifest_hash?: string }; validation?: { ok: boolean } }>> {
  return postJson("/v1/execution-control/governance/compile", body);
}

export interface EvaluateBody {
  action: Record<string, unknown>;
  now?: string;
}

export async function boundaryEvaluate(body: EvaluateBody): Promise<PostResult<{ decision: string; reason_codes: string[]; warrant?: { warrant_id: string }; gel_record?: { record_id: string } }>> {
  return postJson("/v1/execution-control/evaluate", body);
}
