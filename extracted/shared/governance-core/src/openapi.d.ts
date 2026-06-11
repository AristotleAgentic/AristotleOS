/**
 * OpenAPI 3.0 description of the governance chain's HTTP surface (the kernel /v2
 * routes, also reachable through the gateway at /operator/governance-chain/*).
 * Served at /v2/openapi.json so partners can generate clients and explore the API
 * in Swagger UI. Schemas are intentionally permissive objects — the authoritative
 * shapes are the exported TypeScript types / the @aristotle/governance-core SDK.
 */
export declare function openApiSpec(version?: string): Record<string, unknown>;
