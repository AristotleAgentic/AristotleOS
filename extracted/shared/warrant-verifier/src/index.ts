/**
 * @aristotle/warrant-verifier — public, standalone Warrant verifier.
 *
 * Substrate audit #3 was at 95%; the last 5% was a public verifier
 * service — a third party (insurance carrier, claim auditor, mutual-
 * aid counterparty) who holds only the Warrant artifact + the
 * canonical action hash + the issuer's trust anchors should be able
 * to verify a Warrant WITHOUT needing access to the Commit Gate or
 * any private state.
 *
 * This package wraps the existing `verifyWarrant()` primitive from
 * `@aristotle/execution-control-runtime` (which is already pure)
 * with:
 *   - a stable wire format (`VerifyWarrantRequest` /
 *     `VerifyWarrantResponse`) that doesn't depend on the runtime's
 *     internal types,
 *   - a Node http handler factory (`createVerifierHandler`) suitable
 *     for any HTTP server / serverless / lambda target,
 *   - explicit trust-anchor configuration (key id allowlist +
 *     optional revocation list).
 *
 * The verifier IS stateless except for an optional caller-supplied
 * NonceSeenSet (for artifact-replay detection). Deploy N replicas
 * behind a load balancer; correctness doesn't depend on state.
 */

import { verifyWarrant, type Warrant, type WarrantVerification, type WarrantVerifyOptions, type NonceSeenSet } from "@aristotle/execution-control-runtime";

export const REQUEST_FORMAT = "aristotle.warrant-verify-request.v1";
export const RESPONSE_FORMAT = "aristotle.warrant-verify-response.v1";

export interface VerifyWarrantRequest {
  format: typeof REQUEST_FORMAT;
  /** The Warrant artifact, as issued by the gate. */
  warrant: Warrant;
  /** The canonical action hash the Warrant is supposed to bind. */
  canonical_action_hash: string;
  /** Optional ISO timestamp to evaluate `now` at (defaults to current time). */
  now?: string;
}

export interface VerifyWarrantResponse {
  format: typeof RESPONSE_FORMAT;
  ok: boolean;
  /** When ok=false, the verifier's reason. */
  reason?: string;
  /** Warrant identifier echoed back for correlation. */
  warrant_id: string;
  /** ISO timestamp the verifier evaluated at. */
  verified_at: string;
}

export interface VerifierConfig {
  /** Allowlist of trusted signing key ids for issued Warrants. */
  trustedKeyIds: string[];
  /** Optional revocation list (key ids / envelope ids / warrant ids). */
  revocations?: WarrantVerifyOptions["revocations"];
  /** Clock-skew tolerance (default 60000 ms). */
  maxClockSkewMs?: number;
  /** Verifier-policy lifetime ceiling (overrides issuer's expires_at). */
  maxLifetimeMs?: number;
  /** Optional nonce-seen set for artifact-replay protection. */
  seenNonces?: NonceSeenSet;
}

/**
 * The single pure function. No I/O, no globals; same inputs → same
 * output every time.
 */
export function verifyWarrantPublic(request: VerifyWarrantRequest, config: VerifierConfig): VerifyWarrantResponse {
  const verifyOpts: WarrantVerifyOptions = {
    trustedKeyIds: config.trustedKeyIds,
    revocations: config.revocations,
    maxClockSkewMs: config.maxClockSkewMs,
    maxLifetimeMs: config.maxLifetimeMs,
    seenNonces: config.seenNonces
  };
  const now = request.now ?? new Date().toISOString();
  const result: WarrantVerification = verifyWarrant(request.warrant, request.canonical_action_hash, now, verifyOpts);
  return {
    format: RESPONSE_FORMAT,
    ok: result.ok,
    reason: result.reason,
    warrant_id: request.warrant.warrant_id,
    verified_at: now
  };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

export interface VerifierHttpRequest {
  method: string;
  url: string;
  rawBody: string;
}

export interface VerifierHttpResponse {
  status: number;
  contentType: string;
  body: string;
}

export interface VerifierHandler {
  handle(req: VerifierHttpRequest): Promise<VerifierHttpResponse>;
}

export function createVerifierHandler(config: VerifierConfig): VerifierHandler {
  return {
    async handle(req: VerifierHttpRequest): Promise<VerifierHttpResponse> {
      if (req.method !== "POST") {
        return badRequest(405, "MethodNotAllowed", "only POST is accepted");
      }
      let parsed: unknown;
      try { parsed = JSON.parse(req.rawBody); }
      catch (err) {
        return badRequest(400, "MalformedJson", err instanceof Error ? err.message : "invalid JSON");
      }
      if (!parsed || typeof parsed !== "object") {
        return badRequest(400, "MalformedRequest", "request body is not a JSON object");
      }
      const obj = parsed as Record<string, unknown>;
      if (obj.format !== REQUEST_FORMAT) {
        return badRequest(400, "UnsupportedFormat", `expected format=${REQUEST_FORMAT}, got ${String(obj.format)}`);
      }
      if (!obj.warrant || typeof obj.warrant !== "object") {
        return badRequest(400, "MissingWarrant", "request.warrant is required");
      }
      if (typeof obj.canonical_action_hash !== "string") {
        return badRequest(400, "MissingActionHash", "request.canonical_action_hash is required");
      }
      const result = verifyWarrantPublic(obj as unknown as VerifyWarrantRequest, config);
      return {
        status: result.ok ? 200 : 422,
        contentType: "application/json",
        body: JSON.stringify(result)
      };
    }
  };
}

function badRequest(status: number, code: string, message: string): VerifierHttpResponse {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({
      format: RESPONSE_FORMAT,
      ok: false,
      reason: code,
      warrant_id: "",
      verified_at: new Date().toISOString(),
      message
    })
  };
}

// ---------------------------------------------------------------------------
// SimpleNonceSeenSet — caller-supplied state for replay detection.
// ---------------------------------------------------------------------------

export class SimpleNonceSeenSet implements NonceSeenSet {
  private seen = new Set<string>();
  add(nonce: string): void { this.seen.add(nonce); }
  has(nonce: string): boolean { return this.seen.has(nonce); }
  size(): number { return this.seen.size; }
}

export { verifyWarrant };
export type { Warrant, WarrantVerification, WarrantVerifyOptions, NonceSeenSet };
