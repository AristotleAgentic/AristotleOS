import test from "node:test";
import assert from "node:assert/strict";
import {
  AristotleClient,
  AristotleApiError,
  OPENAPI_YAML,
  OPENAPI_SPEC,
  OPENAPI_VERSION,
  OPENAPI_TITLE,
  OPENAPI_API_VERSION,
  OPENAPI_PATHS
} from "./index.js";

test("OPENAPI_YAML is a non-empty string that parses as JSON", () => {
  assert.equal(typeof OPENAPI_YAML, "string");
  assert.ok(OPENAPI_YAML.length > 1000, "spec should be substantive");
  const parsed = JSON.parse(OPENAPI_YAML);
  assert.equal(typeof parsed, "object");
  assert.equal(parsed.openapi, "3.1.0");
});

test("OPENAPI_SPEC is a frozen object matching OPENAPI_YAML", () => {
  assert.equal(typeof OPENAPI_SPEC, "object");
  assert.ok(Object.isFrozen(OPENAPI_SPEC), "spec must be frozen so consumers cannot mutate it in-place");
  const reparsed = JSON.parse(OPENAPI_YAML);
  // Deep compare — top-level openapi version and paths should match.
  assert.equal(OPENAPI_SPEC.openapi, reparsed.openapi);
  const specPaths = Object.keys(OPENAPI_SPEC.paths as Record<string, unknown>).sort();
  const reparsedPaths = Object.keys(reparsed.paths as Record<string, unknown>).sort();
  assert.deepEqual(specPaths, reparsedPaths);
});

test("OPENAPI_VERSION reports OpenAPI 3.1.0", () => {
  assert.equal(OPENAPI_VERSION, "3.1.0");
});

test("OPENAPI_TITLE / OPENAPI_API_VERSION are non-empty", () => {
  assert.ok(OPENAPI_TITLE.length > 0);
  assert.ok(OPENAPI_API_VERSION.length > 0);
});

test("OPENAPI_PATHS includes the core commit-gate endpoint", () => {
  assert.ok(Array.isArray(OPENAPI_PATHS));
  assert.ok(OPENAPI_PATHS.includes("/v1/execution-control/evaluate"));
  assert.ok(OPENAPI_PATHS.includes("/health"));
});

test("OPENAPI_PATHS contains every route AristotleClient calls on the substrate", () => {
  // Hand-curated list of routes the os-sdk AristotleClient invokes today.
  // The published spec must cover every one of them — if it doesn't, the
  // client and the spec have drifted and operators using openapi-generator
  // against the spec will not be able to mirror the SDK's behavior.
  const sdkPaths = [
    "/health",
    "/v1/execution-control/evaluate",
    "/v1/execution-control/proxy",
    "/v1/execution-control/replay",
    "/v1/execution-control/evidence/export",
    "/v1/execution-control/warrant/verify",
    "/v1/execution-control/warrant/inspect-chain",
    "/v1/execution-control/context",
    "/v1/execution-control/audit/tail",
    "/v1/execution-control/audit/verify",
    "/v1/execution-control/metrics",
    "/v1/execution-control/degradation",
    "/v1/execution-control/governance/compile",
    "/v1/execution-control/governance/diff",
    "/v1/execution-control/governance/explain",
    "/v1/execution-control/shadow",
    "/v1/execution-control/reconcile",
    "/v1/execution-control/conflicts/ingest",
    "/v1/execution-control/conflicts",
    "/v1/execution-control/conflicts/resolve",
    "/v1/execution-control/approvals",
    "/v1/execution-control/approvals/decide",
    "/v1/execution-control/marshal/census",
    "/v1/execution-control/marshal/behavior",
    "/v1/execution-control/admin/kill",
    "/v1/execution-control/admin/revoke"
  ];
  for (const p of sdkPaths) {
    assert.ok(OPENAPI_PATHS.includes(p), `OPENAPI_PATHS missing ${p}`);
  }
});

test("OPENAPI_SPEC declares the bearerAuth and apiKeyAuth security schemes", () => {
  const schemes = (OPENAPI_SPEC.components as Record<string, unknown>).securitySchemes as Record<string, unknown>;
  assert.ok(schemes.bearerAuth, "bearerAuth security scheme must be declared");
  assert.ok(schemes.apiKeyAuth, "apiKeyAuth security scheme must be declared");
});

test("OPENAPI_SPEC declares the CanonicalAction and EvaluateResponse schemas", () => {
  const schemas = (OPENAPI_SPEC.components as Record<string, unknown>).schemas as Record<string, unknown>;
  assert.ok(schemas.CanonicalAction, "CanonicalAction schema must be declared");
  assert.ok(schemas.EvaluateResponse, "EvaluateResponse schema must be declared");
  assert.ok(schemas.EvaluateRequest, "EvaluateRequest schema must be declared");
});

test("AristotleClient is constructible (the re-export path works)", () => {
  const client = new AristotleClient({
    baseUrl: "https://gate.internal",
    token: "test-token",
    fetch: (async () => ({ ok: true, status: 200, text: async () => "{}" })) as unknown as typeof fetch
  });
  assert.ok(client instanceof AristotleClient);
});

test("AristotleApiError carries the HTTP status it was constructed with", () => {
  const err = new AristotleApiError(429, "rate limited", { retry_after: 30 });
  assert.equal(err.status, 429);
  assert.equal(err.message, "rate limited");
  assert.equal(err.name, "AristotleApiError");
});
