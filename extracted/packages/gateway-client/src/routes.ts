/**
 * Typed-route helper for @aristotle/gateway-client.
 *
 * `createTypedRoutes(client)` returns a fluent object whose method names
 * mirror the OpenAPI operation set. Each method is fully typed (request
 * body / query / path-param shape on input, response shape on output)
 * so consumers don't have to remember URL paths or hand-construct
 * request bodies.
 *
 * The implementation is a thin wrapper over `AristotleClient` — every
 * method delegates to the corresponding client method that already
 * exists. The value the typed-routes wrapper adds is:
 *
 *   - one stable object surface (`routes.evaluate(...)`) instead of
 *     juggling whichever os-sdk method name is current
 *   - IDE autocomplete shows the available operations directly
 *   - one place to extend when a new route ships (instead of every
 *     consumer rediscovering the os-sdk method)
 *
 * If the underlying client doesn't expose a method that maps to an
 * OpenAPI operation, the typed-route returns a typed `notImplemented`
 * error rather than throwing at the binding site — operators see the
 * gap clearly, and the gateway-client's test suite catches it.
 *
 * This is the substrate's answer to "how do I call the gateway from
 * TypeScript without remembering URL paths and body shapes?".
 */

import type {
  AristotleClient,
  CanonicalAction,
  EvaluateResponse,
  GovernanceManifest,
  GovernanceDiffResult,
  PolicyExplanation,
  ShadowReport
} from "@aristotle/os-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Typed routes object. Method names mirror the OpenAPI operationId
 * (post_v1_executionControl_evaluate -> evaluate, etc.).
 *
 * The methods correspond 1:1 with `AristotleClient`'s public surface;
 * the typed-routes wrapper is an alternate fluent surface, not a
 * separate transport.
 */
export interface TypedRoutes {
  /**
   * POST /v1/execution-control/evaluate
   * Evaluate an action against the Commit Gate; returns ALLOW + Warrant
   * or REFUSE/ESCALATE/EXPIRE + reason codes + a signed GEL record.
   */
  evaluate(action: CanonicalAction, options?: EvaluateOptions): Promise<EvaluateResponse>;

  /**
   * POST /v1/execution-control/replay
   * Re-evaluate a previously-recorded action against current policy.
   */
  replay(input: ReplayInput): Promise<EvaluateResponse & { replay: true }>;

  /**
   * POST /v1/execution-control/governance/compile
   * Compile a GovernanceDraft into a canonicalized GovernanceManifest.
   * Lifts the in-process compiler over the network.
   */
  compileGovernance(draft: unknown): Promise<GovernanceManifest>;

  /**
   * POST /v1/execution-control/governance/diff
   * Compute a structured diff between two GovernanceManifests.
   */
  diffGovernance(input: { base: unknown; target: unknown }): Promise<GovernanceDiffResult>;

  /**
   * POST /v1/execution-control/governance/explain
   * Explain a Ward/Envelope/Action under a manifest — surfaces every
   * predicate the gate would have evaluated.
   */
  explainPolicy(input: { ward: unknown; envelope: unknown; samples?: unknown[] }): Promise<PolicyExplanation>;

  /**
   * POST /v1/execution-control/shadow
   * Run a batch of actions in shadow mode (no GEL append, no Warrant
   * issuance); returns the decision histogram.
   */
  shadowReplay(actions: CanonicalAction[]): Promise<ShadowReport>;

  /**
   * GET /health
   * Liveness probe. Returns 200 + the service identifier when alive.
   */
  health(): Promise<{ ok: boolean; service?: string }>;
}

export interface EvaluateOptions {
  runtime_register?: Record<string, unknown>;
  now?: string;
}

export interface ReplayInput {
  record_id: string;
  now?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Build the typed-routes wrapper over an existing AristotleClient.
 * Cheap (no HTTP setup) — the wrapper is just method bindings.
 *
 * Usage:
 *
 *   const client = new AristotleClient({ baseUrl, token });
 *   const routes = createTypedRoutes(client);
 *   const decision = await routes.evaluate(myAction);
 *   const report  = await routes.shadowReplay([action1, action2]);
 */
export function createTypedRoutes(client: AristotleClient): TypedRoutes {
  // Bind reads of the client's methods through a guard so that if a
  // future os-sdk version removes one (semver-breaking on the client
  // side), the typed-routes wrapper surfaces a clean error instead of
  // a confusing TypeError at the call site.
  function pick<K extends keyof AristotleClient>(name: K): AristotleClient[K] {
    const fn = client[name];
    if (typeof fn !== "function") {
      throw new Error(
        `@aristotle/gateway-client: AristotleClient.${String(name)} is not a function; ` +
        `os-sdk version mismatch — upgrade @aristotle/os-sdk or pin the gateway-client to a compatible version`
      );
    }
    return fn;
  }

  return {
    evaluate(action, options) {
      let fn: AristotleClient["evaluate"];
      try { fn = pick("evaluate"); }
      catch (err) { return Promise.reject(err); }
      return fn.call(client, action, options ?? {}) as Promise<EvaluateResponse>;
    },
    replay(input) {
      let fn: AristotleClient["replay"];
      try { fn = pick("replay"); }
      catch (err) { return Promise.reject(err); }
      return fn.call(client, input) as Promise<EvaluateResponse & { replay: true }>;
    },
    compileGovernance(draft) {
      const fn = (client as unknown as Record<string, unknown>)["compileGovernance"];
      if (typeof fn !== "function") {
        return Promise.reject(new Error(
          "@aristotle/gateway-client: AristotleClient.compileGovernance is not available in this os-sdk version"
        ));
      }
      return (fn as (d: unknown) => Promise<GovernanceManifest>).call(client, draft);
    },
    diffGovernance(input) {
      const fn = (client as unknown as Record<string, unknown>)["diffGovernance"];
      if (typeof fn !== "function") {
        return Promise.reject(new Error(
          "@aristotle/gateway-client: AristotleClient.diffGovernance is not available in this os-sdk version"
        ));
      }
      return (fn as (i: unknown) => Promise<GovernanceDiffResult>).call(client, input);
    },
    explainPolicy(input) {
      const fn = (client as unknown as Record<string, unknown>)["explainPolicy"];
      if (typeof fn !== "function") {
        return Promise.reject(new Error(
          "@aristotle/gateway-client: AristotleClient.explainPolicy is not available in this os-sdk version"
        ));
      }
      return (fn as (i: unknown) => Promise<PolicyExplanation>).call(client, input);
    },
    shadowReplay(actions) {
      const fn = (client as unknown as Record<string, unknown>)["shadowReplay"];
      if (typeof fn !== "function") {
        return Promise.reject(new Error(
          "@aristotle/gateway-client: AristotleClient.shadowReplay is not available in this os-sdk version"
        ));
      }
      return (fn as (a: CanonicalAction[]) => Promise<ShadowReport>).call(client, actions);
    },
    async health() {
      // Health is intentionally NOT on AristotleClient (it's a transport-
      // level probe, not a substrate decision). We send the request
      // directly via the same baseUrl the client was constructed with.
      const baseUrl = (client as unknown as { baseUrl?: string }).baseUrl;
      if (!baseUrl) {
        throw new Error("@aristotle/gateway-client: cannot derive baseUrl from the supplied client");
      }
      const fetchImpl = (client as unknown as { fetch?: typeof fetch }).fetch ?? fetch;
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/health`);
      if (!res.ok) {
        return { ok: false };
      }
      try {
        const body = await res.json() as { ok?: boolean; service?: string };
        return { ok: body.ok !== false, service: body.service };
      } catch {
        return { ok: true };
      }
    }
  };
}
