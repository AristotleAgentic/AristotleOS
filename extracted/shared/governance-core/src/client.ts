/**
 * Thin typed HTTP client for the governance chain — the commercial integration
 * surface. Talks to the kernel /v2 routes directly (basePath "/v2") or through the
 * gateway (default basePath "/operator/governance-chain"). Uses global fetch; a
 * custom fetch can be injected for tests/Node-without-fetch.
 *
 * A governed "no" (Deny/Escalate/FailClosed) is returned as a CommitDecision, not
 * thrown — only genuine transport/4xx errors throw.
 */

import type { ValidationResult } from "./errors.js";
import type { ChainMetrics } from "./metrics.js";
import type { EvidenceBundle } from "./evidence.js";
import type { ScopeFilter, TenantSummary } from "./tenancy.js";
import type {
  AuthorityEnvelope,
  CommitDecision,
  CommitGate,
  CommitRequest,
  FederationAgreement,
  GELRecord,
  Governor,
  MetaAuthorityEnvelope,
  Warrant,
  Ward,
} from "./types.js";

export interface GovernanceChainClientConfig {
  /** Origin, e.g. "http://localhost:8080". */
  baseUrl: string;
  /** Route prefix. Default "/operator/governance-chain" (gateway); use "/v2" for the kernel. */
  basePath?: string;
  /** Extra headers (e.g. operator auth) sent on every request. */
  headers?: Record<string, string>;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

export interface GelView {
  count: number;
  scoped: boolean;
  integrity: ValidationResult;
  records: GELRecord[];
}

export class GovernanceChainClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly doFetch: typeof fetch;

  constructor(config: GovernanceChainClientConfig) {
    this.base = `${config.baseUrl}${config.basePath ?? "/operator/governance-chain"}`;
    this.headers = { "content-type": "application/json", ...(config.headers ?? {}) };
    this.doFetch = config.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.doFetch(`${this.base}${path}`, {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`governance-chain ${method} ${path} -> ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  private scopeQuery(filter?: ScopeFilter): string {
    const params = new URLSearchParams();
    if (filter?.maeId) params.set("mae", filter.maeId);
    if (filter?.tenantId) params.set("tenant", filter.tenantId);
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  // --- authoring ----------------------------------------------------------
  createMetaAuthorityEnvelope(input: Record<string, unknown>): Promise<MetaAuthorityEnvelope> {
    return this.request("POST", "/meta-authority-envelope", input);
  }
  constituteWard(input: Record<string, unknown>): Promise<Ward> {
    return this.request("POST", "/ward", input);
  }
  createAuthorityEnvelope(input: Record<string, unknown>): Promise<AuthorityEnvelope> {
    return this.request("POST", "/authority-envelope", input);
  }
  appointGovernor(input: Record<string, unknown>): Promise<Governor> {
    return this.request("POST", "/governor", input);
  }
  issueWarrant(input: Record<string, unknown>): Promise<Warrant> {
    return this.request("POST", "/warrant", input);
  }

  // --- commit / federation ------------------------------------------------
  commit(request: CommitRequest): Promise<CommitDecision> {
    return this.request("POST", "/commit", request);
  }
  federatedCommit(request: CommitRequest): Promise<CommitDecision> {
    return this.request("POST", "/federated-commit", request);
  }
  createFederationAgreement(input: Record<string, unknown>): Promise<FederationAgreement> {
    return this.request("POST", "/federation-agreement", input);
  }

  // --- reads / observability / evidence ----------------------------------
  commitGate(): Promise<CommitGate> {
    return this.request("GET", "/commit-gate");
  }
  gel(filter?: ScopeFilter): Promise<GelView> {
    return this.request("GET", `/gel${this.scopeQuery(filter)}`);
  }
  metrics(filter?: ScopeFilter): Promise<ChainMetrics> {
    return this.request("GET", `/metrics${this.scopeQuery(filter)}`);
  }
  tenants(): Promise<{ tenants: TenantSummary[] }> {
    return this.request("GET", "/tenants");
  }
  exportEvidence(filter?: ScopeFilter): Promise<EvidenceBundle> {
    return this.request("GET", `/gel/export${this.scopeQuery(filter)}`);
  }
  openapi(): Promise<Record<string, unknown>> {
    return this.request("GET", "/openapi.json");
  }

  // --- admin --------------------------------------------------------------
  rotateSigningKey(input: { keyId: string; secret?: string; privatePem?: string; publicPem?: string }): Promise<{ active: string; signing_mode: string }> {
    return this.request("POST", "/rotate-signing-key", input);
  }
}
