/**
 * @aristotle/gateway-client
 *
 * Slim, dependency-free TypeScript client for the AristotleOS HTTP
 * execution-control boundary (the "Commit Gate" + Evidence Ledger + Operator
 * routes). This package is the OpenAPI-3.1-derived shipping artifact: it
 * re-exports `AristotleClient` from `@aristotle/os-sdk` (which IS the
 * OpenAPI-conforming client) AND ships the spec itself as both a published
 * `openapi.json` and an embedded `OPENAPI_YAML` / `OPENAPI_SPEC` constant.
 *
 * Why two packages? `@aristotle/os-sdk` is the full TypeScript SDK with
 * helpers (`requestWarrant`, `governAndExecute`, `titleAction`, etc.) and
 * carries an opinion. `@aristotle/gateway-client` is the wire-contract
 * package — its single job is to be the OpenAPI artifact + the smallest
 * typed surface that matches it. Operators who want to wire the substrate
 * into their own tooling (openapi-generator, Stoplight, Insomnia, Postman,
 * Speakeasy, etc.) install this package and consume the spec; they never
 * have to clone the substrate repo.
 *
 * Three things ship here:
 *
 *   1. The OpenAPI spec, embedded as a JS string and a frozen object:
 *
 *        import { OPENAPI_YAML, OPENAPI_SPEC, OPENAPI_VERSION,
 *                 OPENAPI_PATHS } from "@aristotle/gateway-client";
 *
 *      The spec is OpenAPI 3.1 (not 3.0); the `OPENAPI_YAML` string is
 *      JSON, which is valid YAML. Name kept for stability.
 *
 *   2. The published `openapi.json` artifact, importable directly:
 *
 *        import spec from "@aristotle/gateway-client/openapi.json";
 *
 *      Operators can also point openapi-generator at the file under
 *      node_modules/@aristotle/gateway-client/openapi.json — no JS import
 *      required.
 *
 *   3. The canonical typed client, re-exported from os-sdk:
 *
 *        import { AristotleClient } from "@aristotle/gateway-client";
 *        const aos = new AristotleClient({ baseUrl, token });
 *        const decision = await aos.evaluate(action);
 *
 *      `AristotleClient` and the spec are kept in lockstep by the substrate's
 *      own test suite — the methods on the client correspond 1:1 with the
 *      routes in `OPENAPI_PATHS`.
 */

export {
  OPENAPI_YAML,
  OPENAPI_SPEC,
  OPENAPI_VERSION,
  OPENAPI_TITLE,
  OPENAPI_API_VERSION,
  OPENAPI_PATHS
} from "./openapi-spec.gen.js";

// Typed-route helper — fluent wrapper over AristotleClient whose method
// names mirror the OpenAPI operation set. Use when you want IDE-suggested
// route names + auto-typed body/response without juggling URL paths.
//
//   import { AristotleClient, createTypedRoutes } from "@aristotle/gateway-client";
//   const routes = createTypedRoutes(new AristotleClient({ baseUrl, token }));
//   const decision = await routes.evaluate(action);
export {
  createTypedRoutes,
  type TypedRoutes,
  type EvaluateOptions,
  type ReplayInput
} from "./routes.js";

// Re-export the canonical typed client + every public type from os-sdk so
// installing only this package gives the operator a complete TypeScript
// surface for the boundary.
export {
  AristotleClient,
  AristotleApiError
} from "@aristotle/os-sdk";

export type {
  AristotleClientOptions,
  ExecutionControlDecision,
  CanonicalAction,
  EvaluateResponse,
  GovernanceManifest,
  GovernanceDiffResult,
  PolicyExplanation,
  ShadowReport,
  ReconciliationReport,
  ConflictSummary,
  DegradationCondition,
  DegradationStatus,
  AuditVerifyResult,
  ApprovalItem,
  ApprovalDecisionResult,
  KillSwitchResult,
  RevokeEnvelopeResult,
  MetricsSnapshot,
  TitleCanonicalAction,
  TitleSubmissionReceipt
} from "@aristotle/os-sdk";
