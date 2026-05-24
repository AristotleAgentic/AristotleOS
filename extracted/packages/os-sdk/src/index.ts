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

export type ExecutionControlDecision = "ALLOW" | "REFUSE" | "ESCALATE";

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
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
