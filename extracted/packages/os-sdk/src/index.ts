/**
 * @aristotle/os-sdk — typed client for the AristotleOS execution-control boundary.
 *
 * Zero dependencies, isomorphic (Node 18+/Deno/edge/browser): you inject `fetch`
 * or it uses the global. It speaks the same HTTP contract the runtime serves
 * (`/v1/execution-control/*`) so agents and services can govern actions, author
 * policy, and read evidence without hand-rolling requests.
 *
 *   const aos = new AristotleClient({ baseUrl: "https://gate.internal", token });
 *   const decision = await aos.evaluate(action);
 *   if (decision.decision !== "ALLOW") throw new Error("not authorized");
 */

export type ExecutionControlDecision = "ALLOW" | "REFUSE" | "ESCALATE" | "EXPIRE";

export interface CanonicalAction {
  action_id: string;
  ward_id: string;
  subject: string;
  action_type: string;
  target?: string;
  params?: Record<string, unknown>;
  requested_at?: string;
  request_id?: string;
  telemetry?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EvaluateResponse {
  decision: ExecutionControlDecision;
  reason_codes: string[];
  canonical_action_hash: string;
  warrant?: { warrant_id: string;[key: string]: unknown };
  gel_record: { record_id: string; record_hash: string;[key: string]: unknown };
  [key: string]: unknown;
}

export interface GovernanceManifest {
  manifest_version: string;
  hashes: { ward_hash: string; authority_envelope_hash: string; manifest_hash: string };
  validation: { ok: boolean; errors: string[] };
  [key: string]: unknown;
}

export interface GovernanceDiffResult {
  entries: Array<{ path: string; kind: string; weakening: boolean; note: string;[key: string]: unknown }>;
  summary: { total: number; weakening: number; requires_review: boolean };
}

export interface PolicyExplanation {
  ward_id: string;
  authority_envelope_id: string;
  allowed_actions: string[];
  denied_actions: string[];
  samples: Array<{ action_id: string; action_type: string; decision: ExecutionControlDecision; reason_codes: string[] }>;
  [key: string]: unknown;
}

export interface ShadowReport {
  ward_id: string;
  authority_envelope_id: string;
  count: number;
  decisions: Record<string, number>;
  rollout: { ready: boolean; allow_rate: number };
  [key: string]: unknown;
}

export interface ReconciliationReport {
  ward_id: string;
  count: number;
  agreements: number;
  conflicts: number;
  items: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ConflictSummary {
  total: number;
  open: number;
  conflicts: number;
  by_status: Record<string, number>;
}

export type DegradationCondition = "ledger_unavailable" | "control_plane_stale" | "quorum_lost" | "dependency_timeout";

export interface DegradationStatus {
  ward_id: string;
  criticality: "safety_critical" | "mission_critical" | "routine" | "best_effort";
  healthy: boolean;
  conditions: DegradationCondition[];
  fail_action: "allow" | "allow_degraded" | "escalate" | "refuse";
  binding_condition: DegradationCondition | null;
  probes: number;
}

export interface AuditVerifyResult {
  ok: boolean;
  count: number;
  failure?: string;
}

export interface ApprovalItem {
  request_id: string;
  action_id: string;
  action_type: string;
  ward_id: string;
  required: number;
  votes: Array<{ operator_id: string; decision: "approve" | "reject"; reason?: string; voted_at: string }>;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  [key: string]: unknown;
}

export interface ApprovalDecisionResult {
  ok: boolean;
  status: "pending" | "approved" | "rejected";
  votes: ApprovalItem["votes"];
  [key: string]: unknown;
}

export interface KillSwitchResult {
  ok: boolean;
  scope: string;
  action: "arm" | "disarm" | "pause";
  applied_at: string;
  [key: string]: unknown;
}

export interface RevokeEnvelopeResult {
  ok: boolean;
  envelope_id: string;
  revoked_at: string;
  [key: string]: unknown;
}

export interface MetricsSnapshot {
  warrants_today?: number;
  refusals_today?: number;
  escalations_today?: number;
  gate_latency_ms?: number;
  ledger_height?: number;
  [key: string]: unknown;
}

/** Generic title canonical action — the runtime accepts action_type "title.*". */
export interface TitleCanonicalAction extends CanonicalAction {
  action_type: `title.${string}`;
}

/** Hash-bound submission receipt mirroring the runtime's TitleSubmissionReceipt. */
export interface TitleSubmissionReceipt {
  packet_id: string;
  jurisdiction: string;
  transport: string;
  channel: string;
  remote_receipt_id: string;
  ack_at: string;
  ack_kind: "accepted" | "queued" | "pending-review";
  warrant_id: string;
  action_hash: string;
  receipt_hash: string;
  production_validated: boolean;
}

/** Thrown on any non-2xx response; carries the HTTP status and parsed body. */
export class AristotleApiError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
    this.name = "AristotleApiError";
  }
}

export interface AristotleClientOptions {
  /** Base URL of the execution-control boundary, e.g. https://gate.internal:8181 */
  baseUrl: string;
  /** Bearer token (operator/OIDC). */
  token?: string;
  /** Static API key (X-API-Key). */
  apiKey?: string;
  /** Injected fetch (defaults to the global). */
  fetch?: typeof fetch;
}

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class AristotleClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly authHeaders: Record<string, string>;

  constructor(options: AristotleClientOptions) {
    if (!options.baseUrl) throw new Error("AristotleClient requires a baseUrl");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = (options.fetch ?? globalThis.fetch) as unknown as FetchLike;
    if (!this.fetchImpl) throw new Error("no fetch available; pass options.fetch");
    this.authHeaders = {};
    if (options.token) this.authHeaders["authorization"] = `Bearer ${options.token}`;
    if (options.apiKey) this.authHeaders["x-api-key"] = options.apiKey;
  }

  private async request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", ...this.authHeaders };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const raw = await res.text();
    const parsed = raw ? safeJsonParse(raw) : undefined;
    if (!res.ok) {
      throw new AristotleApiError(res.status, `AristotleOS ${method} ${pathname} -> ${res.status}`, parsed ?? raw);
    }
    return parsed as T;
  }

  // --- Commit Gate ---
  /** Evaluate an action at the Commit Gate; ALLOW carries a signed Warrant. */
  evaluate(action: CanonicalAction, options: { runtime_register?: Record<string, unknown>; now?: string } = {}): Promise<EvaluateResponse> {
    return this.request<EvaluateResponse>("POST", "/v1/execution-control/evaluate", { action, ...options });
  }

  /**
   * Ergonomic warrant-request helper.
   *
   *   const warrant = await aos.requestWarrant({
   *     action: "release_funds",
   *     authority: "treasury_ops",
   *     subject: "agent:payments",
   *     ward: "ward-finance",
   *     params: { amount: 5000, currency: "USD" },
   *     jurisdiction: "US-MT",
   *     risk: "medium"
   *   });
   *
   * Internally builds a CanonicalAction and calls evaluate(). On non-ALLOW
   * throws AristotleApiError with the gate's reason codes so callers can
   * use a try/catch flow rather than a discriminated-union check.
   * Returns the warrant on ALLOW. Use evaluate() directly when you need
   * the full EvaluateResponse + gel_record on every decision.
   */
  async requestWarrant(req: {
    action: string;
    /** Subject the action runs as (envelope subject). */
    subject: string;
    /** Ward id the action falls under. */
    ward: string;
    /** Optional human-readable authority hint -- carried as telemetry. */
    authority?: string;
    /** Optional action params bound into the warrant via parameters_hash. */
    params?: Record<string, unknown>;
    /** Optional jurisdiction / region / scope hints carried as params. */
    jurisdiction?: string;
    risk?: "low" | "medium" | "high" | "critical";
    /** Optional action id; one is generated otherwise. */
    actionId?: string;
    runtime_register?: Record<string, unknown>;
    now?: string;
  }): Promise<{ warrant_id: string; canonical_action_hash: string; gel_record_id: string; full: EvaluateResponse }> {
    const params: Record<string, unknown> = { ...(req.params ?? {}) };
    if (req.jurisdiction) params.jurisdiction = req.jurisdiction;
    if (req.risk) params.risk = req.risk;
    const action: CanonicalAction = {
      action_id: req.actionId ?? `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ward_id: req.ward,
      subject: req.subject,
      action_type: req.action,
      params,
      requested_at: new Date().toISOString(),
      telemetry: req.authority ? { authority: req.authority } : undefined
    };
    const verdict = await this.evaluate(action, { runtime_register: req.runtime_register, now: req.now });
    if (verdict.decision === "ALLOW") {
      const wid = verdict.warrant?.warrant_id;
      if (!wid) throw new AristotleApiError(500, "AristotleOS ALLOW returned without warrant", verdict);
      return {
        warrant_id: wid,
        canonical_action_hash: verdict.canonical_action_hash,
        gel_record_id: verdict.gel_record?.record_id ?? "",
        full: verdict
      };
    }
    throw new AristotleApiError(
      verdict.decision === "REFUSE" ? 403 : verdict.decision === "EXPIRE" ? 410 : 202,
      `AristotleOS ${verdict.decision}: ${verdict.reason_codes.join(", ")}`,
      verdict
    );
  }

  /** Replay a historical decision against current policy (counterfactual).
   *  Returns the same EvaluateResponse shape but with `replay: true`. */
  replay(input: { record_id: string; now?: string }): Promise<EvaluateResponse & { replay: true }> {
    return this.request<EvaluateResponse & { replay: true }>("POST", "/v1/execution-control/replay", input);
  }

  /** Export a signed Evidence Bundle for the given record range. */
  exportEvidence(input: { from_seq?: number; to_seq?: number; format?: "json" | "bundle"; exportedAt?: string }): Promise<{ bundle: unknown; bundle_hash: string }> {
    return this.request<{ bundle: unknown; bundle_hash: string }>("POST", "/v1/execution-control/evidence/export", input);
  }

  /** Govern-and-forward: only proxies the upstream call on ALLOW + verified Warrant. */
  proxy(action: CanonicalAction): Promise<unknown> {
    return this.request<unknown>("POST", "/v1/execution-control/proxy", { action });
  }

  /** The boundary's current Ward/Authority context (viewer). */
  context(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/v1/execution-control/context");
  }

  health(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/health");
  }

  // --- Evidence ---
  auditTail(limit = 20): Promise<{ items: Array<Record<string, unknown>> }> {
    return this.request<{ items: Array<Record<string, unknown>> }>("GET", `/v1/execution-control/audit/tail?limit=${encodeURIComponent(String(limit))}`);
  }

  auditVerify(): Promise<AuditVerifyResult> {
    return this.request<AuditVerifyResult>("GET", "/v1/execution-control/audit/verify");
  }

  // --- Governance Builder (operator) ---
  compileGovernance(draft: { ward?: unknown; authority_envelope?: unknown; now?: string }): Promise<GovernanceManifest> {
    return this.request<GovernanceManifest>("POST", "/v1/execution-control/governance/compile", draft);
  }

  diffGovernance(input: { before: { ward?: unknown; authority_envelope?: unknown }; after: { ward?: unknown; authority_envelope?: unknown } }): Promise<GovernanceDiffResult> {
    return this.request<GovernanceDiffResult>("POST", "/v1/execution-control/governance/diff", input);
  }

  explainGovernance(input: { ward?: unknown; authority_envelope?: unknown; sample_actions?: unknown[] }): Promise<PolicyExplanation> {
    return this.request<PolicyExplanation>("POST", "/v1/execution-control/governance/explain", input);
  }

  // --- Shadow Mode (operator) ---
  /** Observe-only profiling of proposed actions; never mutates the live system. */
  shadow(input: { actions: unknown[]; ward?: unknown; authority_envelope?: unknown; now?: string }): Promise<ShadowReport> {
    return this.request<ShadowReport>("POST", "/v1/execution-control/shadow", input);
  }

  // --- Edge reconciliation + Conflict Inbox (operator/viewer) ---
  /** Reconcile offline edge decisions against current/execution-time policy. */
  reconcile(input: { records: unknown[]; ward?: unknown; authority_envelope?: unknown; now?: string }): Promise<ReconciliationReport> {
    return this.request<ReconciliationReport>("POST", "/v1/execution-control/reconcile", input);
  }

  /** Ingest edge records into the durable Conflict Inbox (idempotent). */
  ingestConflicts(input: { records: unknown[]; ward?: unknown; authority_envelope?: unknown; now?: string }): Promise<{ report: ReconciliationReport; summary: ConflictSummary }> {
    return this.request("POST", "/v1/execution-control/conflicts/ingest", input);
  }

  /** List current Conflict Inbox items + summary (viewer). */
  conflicts(): Promise<{ items: Array<Record<string, unknown>>; summary: ConflictSummary }> {
    return this.request("GET", "/v1/execution-control/conflicts");
  }

  /** Apply an attributed operator resolution to a conflict. */
  resolveConflict(input: { action_id: string; action: "accept" | "reject" | "escalate" | "reconcile"; reason?: string }): Promise<{ item: Record<string, unknown>; summary: ConflictSummary }> {
    return this.request("POST", "/v1/execution-control/conflicts/resolve", input);
  }

  // --- Ward Marshal (operator) ---
  /** Risk-score observed agents against the approved registry. */
  marshalCensus(input: { observations: unknown[]; registry?: unknown; now?: string }): Promise<Record<string, unknown>> {
    return this.request("POST", "/v1/execution-control/marshal/census", input);
  }

  /** Behavioral analysis over a governance event stream. */
  marshalBehavior(input: { events: unknown[]; config?: unknown; now?: string }): Promise<Record<string, unknown>> {
    return this.request("POST", "/v1/execution-control/marshal/behavior", input);
  }

  // --- Degradation health (viewer) ---
  /** Live degradation status + the fail action it implies for this Ward. */
  degradation(): Promise<DegradationStatus> {
    return this.request<DegradationStatus>("GET", "/v1/execution-control/degradation");
  }

  // --- Metrics (viewer) ---
  /** Aggregate gate metrics: warrants/refusals/escalations counters + latency. */
  metrics(): Promise<MetricsSnapshot> {
    return this.request<MetricsSnapshot>("GET", "/v1/execution-control/metrics");
  }

  // --- Dual-control Approvals (operator + admin) ---
  /** List pending and resolved dual-control (M-of-N) approval requests. */
  approvals(): Promise<{ items: ApprovalItem[] }> {
    return this.request<{ items: ApprovalItem[] }>("GET", "/v1/execution-control/approvals");
  }

  /** Cast an attributed approve/reject vote on a pending approval. */
  decideApproval(input: { request_id: string; decision: "approve" | "reject"; reason?: string }): Promise<ApprovalDecisionResult> {
    return this.request<ApprovalDecisionResult>("POST", "/v1/execution-control/approvals/decide", input);
  }

  // --- Admin actions (admin role required) ---
  /** Arm or disarm the kill switch for a given scope (ward, global). */
  killSwitch(input: { scope: string; action: "arm" | "disarm" | "pause"; reason?: string }): Promise<KillSwitchResult> {
    return this.request<KillSwitchResult>("POST", "/v1/execution-control/admin/kill", input);
  }

  /** Revoke an Authority Envelope. Cascades per Ward.delegation_rules. */
  revokeEnvelope(input: { envelope_id: string; reason?: string }): Promise<RevokeEnvelopeResult> {
    return this.request<RevokeEnvelopeResult>("POST", "/v1/execution-control/admin/revoke", input);
  }

  // ----------------------------------------------------------------------
  // High-level helpers
  // ----------------------------------------------------------------------

  /**
   * Govern-and-execute: evaluate the action at the Commit Gate; on ALLOW run
   * `executor(decision)` and return its result; on REFUSE throw an
   * AristotleApiError-like exception carrying the reason codes; on ESCALATE
   * return an escalation handle the caller can poll or surface to a human.
   *
   * This is the recommended pattern for agent integrations — the agent
   * proposes the action, the gate authorizes, the executor performs the
   * actuator call, and the warrant is consumed before any external side effect.
   */
  async governAndExecute<T>(
    action: CanonicalAction,
    executor: (decision: EvaluateResponse) => Promise<T>,
    options: { runtime_register?: Record<string, unknown>; now?: string } = {}
  ): Promise<
    | { decision: "ALLOW"; result: T; warrant: EvaluateResponse["warrant"]; record: EvaluateResponse["gel_record"] }
    | { decision: "ESCALATE"; reason_codes: string[]; record: EvaluateResponse["gel_record"] }
  > {
    const verdict = await this.evaluate(action, options);
    if (verdict.decision === "REFUSE") {
      throw new AristotleApiError(403, `AristotleOS REFUSED ${action.action_type}: ${verdict.reason_codes.join(", ")}`, verdict);
    }
    if (verdict.decision === "ESCALATE") {
      return { decision: "ESCALATE", reason_codes: verdict.reason_codes, record: verdict.gel_record };
    }
    const result = await executor(verdict);
    return { decision: "ALLOW", result, warrant: verdict.warrant, record: verdict.gel_record };
  }

  /**
   * Build a canonical title action with the action_type already namespaced.
   * Convenience for title-vertical integrations; equivalent to constructing
   * the object literal yourself.
   */
  static titleAction(input: {
    action_id: string;
    ward_id: string;
    subject: string;
    action_type: TitleCanonicalAction["action_type"];
    vin: string;
    jurisdiction: string;
    transaction_type: string;
    params?: Record<string, unknown>;
    telemetry?: Record<string, unknown>;
  }): TitleCanonicalAction {
    const { vin, jurisdiction, transaction_type, params, ...rest } = input;
    return {
      ...rest,
      params: { vin, jurisdiction, transaction_type, ...(params ?? {}) },
      telemetry: input.telemetry
    };
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
