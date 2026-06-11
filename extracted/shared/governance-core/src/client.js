/**
 * Thin typed HTTP client for the governance chain — the commercial integration
 * surface. Talks to the kernel /v2 routes directly (basePath "/v2") or through the
 * gateway (default basePath "/operator/governance-chain"). Uses global fetch; a
 * custom fetch can be injected for tests/Node-without-fetch.
 *
 * A governed "no" (Deny/Escalate/FailClosed) is returned as a CommitDecision, not
 * thrown — only genuine transport/4xx errors throw.
 */
export class GovernanceChainClient {
    base;
    headers;
    doFetch;
    constructor(config) {
        this.base = `${config.baseUrl}${config.basePath ?? "/operator/governance-chain"}`;
        this.headers = { "content-type": "application/json", ...(config.headers ?? {}) };
        this.doFetch = config.fetchImpl ?? fetch;
    }
    async request(method, path, body) {
        const res = await this.doFetch(`${this.base}${path}`, {
            method,
            headers: this.headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok)
            throw new Error(`governance-chain ${method} ${path} -> ${res.status}: ${text}`);
        return (text ? JSON.parse(text) : null);
    }
    scopeQuery(filter) {
        const params = new URLSearchParams();
        if (filter?.maeId)
            params.set("mae", filter.maeId);
        if (filter?.tenantId)
            params.set("tenant", filter.tenantId);
        const s = params.toString();
        return s ? `?${s}` : "";
    }
    // --- authoring ----------------------------------------------------------
    createMetaAuthorityEnvelope(input) {
        return this.request("POST", "/meta-authority-envelope", input);
    }
    constituteWard(input) {
        return this.request("POST", "/ward", input);
    }
    createAuthorityEnvelope(input) {
        return this.request("POST", "/authority-envelope", input);
    }
    appointGovernor(input) {
        return this.request("POST", "/governor", input);
    }
    issueWarrant(input) {
        return this.request("POST", "/warrant", input);
    }
    // --- commit / federation ------------------------------------------------
    commit(request) {
        return this.request("POST", "/commit", request);
    }
    federatedCommit(request) {
        return this.request("POST", "/federated-commit", request);
    }
    createFederationAgreement(input) {
        return this.request("POST", "/federation-agreement", input);
    }
    // --- reads / observability / evidence ----------------------------------
    commitGate() {
        return this.request("GET", "/commit-gate");
    }
    gel(filter) {
        return this.request("GET", `/gel${this.scopeQuery(filter)}`);
    }
    metrics(filter) {
        return this.request("GET", `/metrics${this.scopeQuery(filter)}`);
    }
    tenants() {
        return this.request("GET", "/tenants");
    }
    exportEvidence(filter) {
        return this.request("GET", `/gel/export${this.scopeQuery(filter)}`);
    }
    openapi() {
        return this.request("GET", "/openapi.json");
    }
    // --- admin --------------------------------------------------------------
    rotateSigningKey(input) {
        return this.request("POST", "/rotate-signing-key", input);
    }
}
