import type { CommitDecision, ConflictInboxItem, LedgerRecord, ShadowProfileSummary, SystemSnapshot, WardMarshalFinding } from "./types.js";

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

// --- Shadow Mode (observe-only profiling) -----------------------------------

export interface BoundaryContext {
  ward_id: string;
  subject: string;
  allowed_actions: string[];
  denied_actions: string[];
  boundary_id: string;
  signing_key_id?: string;
}

/** The configured Ward + Authority the boundary is enforcing, for profiling. */
export async function boundaryContext(signal?: AbortSignal): Promise<BoundaryContext | null> {
  return getJson<BoundaryContext>("/v1/execution-control/context", signal);
}

interface ProfileAction {
  action: Record<string, unknown>;
}

/**
 * Pure: build a representative action batch from the live Authority Envelope.
 * One action per allowed and per denied action type — a genuine, deterministic
 * probe of the configured policy (not synthetic UI numbers). Telemetry/params are
 * populated so allowed paths can clear runtime-register and boundary checks.
 */
export function buildRepresentativeActions(context: BoundaryContext, now: string): ProfileAction[] {
  const base = (type: string, idx: number) => ({
    action: {
      action_id: `shadow-${idx.toString().padStart(3, "0")}`,
      ward_id: context.ward_id,
      subject: context.subject,
      action_type: type,
      target: `${context.ward_id}/probe-${idx}`,
      params: context.boundary_id ? { boundary_id: context.boundary_id } : {},
      requested_at: now,
      request_id: `shadow-req-${idx}`,
      telemetry: { gps_lock: true }
    }
  });
  let idx = 0;
  return [
    ...(context.allowed_actions ?? []).map((type) => base(type, idx++)),
    ...(context.denied_actions ?? []).map((type) => base(type, idx++))
  ];
}

export interface ShadowReportLike {
  ward_id: string;
  authority_envelope_id: string;
  count: number;
  decisions: Record<string, number>;
  rollout: { ready: boolean; allow_rate: number };
  findings: {
    missing_runtime_registers?: Array<{ action_id: string; registers: string[] }>;
    revoked_authority?: Array<{ action_id: string; reason: string }>;
    physical_near_misses?: Array<{ action_id: string; detail: string }>;
  };
}

/** Pure: map a live ShadowReport into the console's profile summary shape. */
export function mapShadowReport(report: ShadowReportLike): ShadowProfileSummary {
  const decisions = report.decisions ?? {};
  const f = report.findings ?? {};
  const findings: ShadowProfileSummary["findings"] = [
    ...(f.missing_runtime_registers ?? []).map((x) => ({ kind: "missing-register" as const, actionId: x.action_id, detail: `Missing runtime registers: ${x.registers.join(", ")}` })),
    ...(f.physical_near_misses ?? []).map((x) => ({ kind: "near-miss" as const, actionId: x.action_id, detail: x.detail })),
    ...(f.revoked_authority ?? []).map((x) => ({ kind: "revoked-authority" as const, actionId: x.action_id, detail: `Authority issue: ${x.reason}` }))
  ];
  return {
    wardId: report.ward_id,
    envelopeId: report.authority_envelope_id,
    evaluatedActions: report.count ?? 0,
    wouldAllow: decisions.ALLOW ?? 0,
    wouldRefuse: decisions.REFUSE ?? 0,
    wouldEscalate: decisions.ESCALATE ?? 0,
    rolloutReady: Boolean(report.rollout?.ready),
    allowRate: report.rollout?.allow_rate ?? 0,
    findings
  };
}

export async function boundaryShadow(body: { actions: ProfileAction[]; now?: string }): Promise<PostResult<ShadowReportLike>> {
  return postJson("/v1/execution-control/shadow", body);
}

/**
 * Run a real Shadow profile against the live boundary: read the configured
 * authority, profile a representative batch through the real Commit Gate, map the
 * report. Returns null when the boundary is unreachable (caller keeps sample data).
 */
export async function runLiveShadowProfile(now: string): Promise<ShadowProfileSummary | null> {
  const context = await boundaryContext();
  if (!context) return null;
  const actions = buildRepresentativeActions(context, now);
  if (actions.length === 0) return null;
  const result = await boundaryShadow({ actions, now });
  if (!result.reachable || !result.ok || !result.data) return null;
  return mapShadowReport(result.data);
}

// --- Ward Marshal census ----------------------------------------------------

export interface MarshalFindingLike {
  finding_id: string;
  agent_id: string;
  subject: string;
  ward_id?: string;
  status: WardMarshalFinding["status"];
  risk_score: number;
  risk_band: WardMarshalFinding["riskBand"];
  owner?: string;
  observed_locations: string[];
  observed_tools: string[];
  credential_refs: string[];
  last_seen: string;
  signals: Array<{ code: string; weight: number; detail: string }>;
  recommended_disposition: WardMarshalFinding["recommendedDisposition"];
  evidence_hash: string;
}

export interface MarshalReportLike {
  findings: MarshalFindingLike[];
}

/** Pure: map live census findings into the console's finding shape. */
export function mapCensusReport(report: MarshalReportLike): WardMarshalFinding[] {
  return (report.findings ?? []).map((finding) => ({
    id: finding.finding_id,
    subject: finding.subject,
    wardId: finding.ward_id ?? "—",
    status: finding.status,
    riskScore: finding.risk_score,
    riskBand: finding.risk_band,
    owner: finding.owner ?? "unknown",
    observedLocations: finding.observed_locations ?? [],
    observedTools: finding.observed_tools ?? [],
    credentialRefs: finding.credential_refs ?? [],
    signals: finding.signals ?? [],
    recommendedDisposition: finding.recommended_disposition,
    evidenceHash: finding.evidence_hash,
    lastSeen: finding.last_seen
  }));
}

export interface MarshalCensusBody {
  observations: unknown[];
  registry?: { registry_version: string; agents: unknown[] };
  now?: string;
}

export async function boundaryMarshalCensus(body: MarshalCensusBody): Promise<PostResult<MarshalReportLike>> {
  return postJson("/v1/execution-control/marshal/census", body);
}

/**
 * Run a real Ward Marshal census against the live boundary over a representative
 * observation seed, returning the engine-scored findings. Returns null when the
 * boundary is unreachable (caller keeps sample findings).
 */
export async function runLiveMarshalCensus(body: MarshalCensusBody): Promise<WardMarshalFinding[] | null> {
  const result = await boundaryMarshalCensus(body);
  if (!result.reachable || !result.ok || !result.data) return null;
  return mapCensusReport(result.data);
}

// --- Conflict Inbox ---------------------------------------------------------

export interface ConflictRecordLike {
  action_id: string;
  action_type: string;
  ward_id: string;
  edge_decision: string;
  current_decision: string;
  current_reason_codes?: string[];
  agrees: boolean;
  conflict_kind?: "edge_more_permissive" | "edge_more_restrictive" | "reason_divergence";
  status: ConflictInboxItem["status"];
  occurred_at?: string;
  first_seen_at?: string;
  gel_record_id?: string;
  replay?: { against_execution_time?: { decision: string } };
  resolved_by?: string;
  resolution_action?: string;
}

export interface ConflictListLike {
  items: ConflictRecordLike[];
}

function conflictNextStep(item: ConflictRecordLike): string {
  if (item.resolved_by && item.resolution_action) return `Resolved: ${item.resolution_action} by ${item.resolved_by}.`;
  if (item.agrees) return "Edge and central decisions agree — no operator action required.";
  switch (item.conflict_kind) {
    case "edge_more_permissive": return "Edge allowed an action central now blocks. Reject to revert, or accept with justification.";
    case "edge_more_restrictive": return "Edge blocked an action central now allows. Reconcile if the edge was correct.";
    default: return "Reason divergence — review the replay evidence and resolve.";
  }
}

/** Pure: map durable Conflict Inbox records into the console's inbox item shape. */
export function mapConflictsToInbox(items: ConflictRecordLike[]): ConflictInboxItem[] {
  return (items ?? []).map((item) => ({
    id: item.action_id,
    wardId: item.ward_id,
    action: item.action_type,
    edgeDecision: decisionToUi(item.edge_decision),
    currentDecision: decisionToUi(item.current_decision),
    executionTimeDecision: decisionToUi(item.replay?.against_execution_time?.decision ?? item.current_decision),
    conflictKind: item.conflict_kind ?? "reason_divergence",
    status: item.status,
    gelRecordId: item.gel_record_id ?? "—",
    occurredAt: item.occurred_at ?? item.first_seen_at ?? new Date().toISOString(),
    operatorNextStep: conflictNextStep(item)
  }));
}

export interface ConflictIngestBody {
  records: unknown[];
  ward?: unknown;
  authority_envelope?: unknown;
  now?: string;
}

export async function boundaryIngestConflicts(body: ConflictIngestBody): Promise<PostResult<unknown>> {
  return postJson("/v1/execution-control/conflicts/ingest", body);
}

export async function boundaryListConflicts(signal?: AbortSignal): Promise<ConflictListLike | null> {
  return getJson<ConflictListLike>("/v1/execution-control/conflicts", signal);
}

export async function boundaryResolveConflict(actionId: string, action: "accept" | "reject" | "escalate" | "reconcile", reason?: string): Promise<PostResult<unknown>> {
  return postJson("/v1/execution-control/conflicts/resolve", { action_id: actionId, action, reason });
}

/**
 * Ingest a representative edge-record seed into the durable inbox, then list the
 * result. Returns mapped inbox items, or null when the boundary is unreachable
 * (caller keeps sample data). Idempotent — re-ingest never reopens a resolution.
 */
export async function runLiveConflicts(seed: ConflictIngestBody): Promise<ConflictInboxItem[] | null> {
  const ingest = await boundaryIngestConflicts(seed);
  if (!ingest.reachable || !ingest.ok) return null;
  const list = await boundaryListConflicts();
  if (!list) return null;
  return mapConflictsToInbox(list.items);
}
