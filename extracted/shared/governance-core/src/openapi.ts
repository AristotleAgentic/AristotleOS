/**
 * OpenAPI 3.0 description of the governance chain's HTTP surface (the kernel /v2
 * routes, also reachable through the gateway at /operator/governance-chain/*).
 * Served at /v2/openapi.json so partners can generate clients and explore the API
 * in Swagger UI. Schemas are intentionally permissive objects — the authoritative
 * shapes are the exported TypeScript types / the @aristotle/governance-core SDK.
 */

const obj = { type: "object", additionalProperties: true } as const;

function body(): unknown {
  return { required: true, content: { "application/json": { schema: obj } } };
}
function ok(description: string): unknown {
  return { [200]: { description, content: { "application/json": { schema: obj } } } };
}
function created(description: string): unknown {
  return { [201]: { description, content: { "application/json": { schema: obj } } } };
}
const idParam = [{ name: "id", in: "path", required: true, schema: { type: "string" } }];
const scopeParams = [
  { name: "mae", in: "query", required: false, schema: { type: "string" }, description: "Scope to one MAE." },
  { name: "tenant", in: "query", required: false, schema: { type: "string" }, description: "Scope to one tenant." },
];

export function openApiSpec(version = "0.1.0"): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "AristotleOS Governance Chain (GOVERNANCE_CHAIN_V2)",
      version,
      description:
        "Meta Authority Envelope -> Ward -> Authority Envelope -> single-use Warrant -> Commit Gate -> hash-chained GEL. No consequential act reaches execution unless the chain is complete and valid at commit time.",
    },
    tags: [
      { name: "authoring" },
      { name: "commit" },
      { name: "federation" },
      { name: "evidence" },
      { name: "observability" },
      { name: "admin" },
    ],
    paths: {
      "/v2/meta-authority-envelope": { post: { tags: ["authoring"], summary: "Create a Meta Authority Envelope (constitution).", requestBody: body(), responses: created("MAE created") } },
      "/v2/ward": { post: { tags: ["authoring"], summary: "Constitute a Ward (requires a human/institutional origin act).", requestBody: body(), responses: created("Ward created") } },
      "/v2/authority-envelope": { post: { tags: ["authoring"], summary: "Create an Authority Envelope inside a Ward.", requestBody: body(), responses: created("Envelope created") } },
      "/v2/governor": { post: { tags: ["authoring"], summary: "Appoint a Governor (delegated author) inside a Ward.", requestBody: body(), responses: created("Governor created") } },
      "/v2/warrant": { post: { tags: ["authoring"], summary: "Issue a single-use Warrant bound to one proposed act.", requestBody: body(), responses: created("Warrant issued") } },
      "/v2/commit": { post: { tags: ["commit"], summary: "Evaluate a commit at the Warden. Returns Allow/Deny/Escalate/FailClosed; consumes the warrant on Allow.", requestBody: body(), responses: ok("Commit decision") } },
      "/v2/federation-agreement": { post: { tags: ["federation"], summary: "Author a cross-Ward/cross-org trust bridge.", requestBody: body(), responses: created("Agreement created") } },
      "/v2/federated-commit": { post: { tags: ["federation"], summary: "Commit across a federation trust bridge.", requestBody: body(), responses: ok("Commit decision") } },
      "/v2/federation-agreements/{id}": { get: { tags: ["federation"], summary: "Read a federation agreement.", parameters: idParam, responses: ok("Agreement") } },
      "/v2/commit-gate": { get: { tags: ["commit"], summary: "The Commit Gate (Warden) descriptor.", responses: ok("Commit gate") } },
      "/v2/gel": { get: { tags: ["evidence"], summary: "Hash-chained GEL ledger (optionally tenant/MAE-scoped).", parameters: scopeParams, responses: ok("GEL records + integrity") } },
      "/v2/gel/export": { get: { tags: ["evidence"], summary: "Signed, offline-verifiable evidence bundle (optionally scoped).", parameters: scopeParams, responses: ok("Evidence bundle") } },
      "/v2/metrics": { get: { tags: ["observability"], summary: "Aggregate chain metrics (optionally scoped).", parameters: scopeParams, responses: ok("Metrics") } },
      "/v2/tenants": { get: { tags: ["observability"], summary: "Per-tenant rollup.", responses: ok("Tenant summaries") } },
      "/v2/wards/{id}": { get: { tags: ["authoring"], summary: "Read a Ward.", parameters: idParam, responses: ok("Ward") } },
      "/v2/authority-envelopes/{id}": { get: { tags: ["authoring"], summary: "Read an Authority Envelope.", parameters: idParam, responses: ok("Envelope") } },
      "/v2/warrants/{id}": { get: { tags: ["authoring"], summary: "Read a Warrant.", parameters: idParam, responses: ok("Warrant") } },
      "/v2/rotate-signing-key": { post: { tags: ["admin"], summary: "Rotate the active signing key (prior keys still verify).", requestBody: body(), responses: ok("Active key") } },
      "/v2/openapi.json": { get: { tags: ["observability"], summary: "This document.", responses: ok("OpenAPI document") } },
    },
    components: { schemas: { GovernanceObject: obj } },
  };
}
