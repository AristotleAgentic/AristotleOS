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
import type { AuthorityEnvelope, CommitDecision, CommitGate, CommitRequest, FederationAgreement, GELRecord, Governor, MetaAuthorityEnvelope, Warrant, Ward } from "./types.js";
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
export declare class GovernanceChainClient {
    private readonly base;
    private readonly headers;
    private readonly doFetch;
    constructor(config: GovernanceChainClientConfig);
    private request;
    private scopeQuery;
    createMetaAuthorityEnvelope(input: Record<string, unknown>): Promise<MetaAuthorityEnvelope>;
    constituteWard(input: Record<string, unknown>): Promise<Ward>;
    createAuthorityEnvelope(input: Record<string, unknown>): Promise<AuthorityEnvelope>;
    appointGovernor(input: Record<string, unknown>): Promise<Governor>;
    issueWarrant(input: Record<string, unknown>): Promise<Warrant>;
    commit(request: CommitRequest): Promise<CommitDecision>;
    federatedCommit(request: CommitRequest): Promise<CommitDecision>;
    createFederationAgreement(input: Record<string, unknown>): Promise<FederationAgreement>;
    commitGate(): Promise<CommitGate>;
    gel(filter?: ScopeFilter): Promise<GelView>;
    metrics(filter?: ScopeFilter): Promise<ChainMetrics>;
    tenants(): Promise<{
        tenants: TenantSummary[];
    }>;
    exportEvidence(filter?: ScopeFilter): Promise<EvidenceBundle>;
    openapi(): Promise<Record<string, unknown>>;
    rotateSigningKey(input: {
        keyId: string;
        secret?: string;
        privatePem?: string;
        publicPem?: string;
    }): Promise<{
        active: string;
        signing_mode: string;
    }>;
}
