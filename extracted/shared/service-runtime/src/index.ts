/**
 * @aristotle/service-runtime
 *
 * Service-runtime helpers for AristotleOS services. Ships consistent
 * /healthz (liveness) + /readyz (readiness) + /health (legacy)
 * endpoints with structured response bodies, plus a small
 * ReadinessChecks builder for composing per-service readiness
 * conditions.
 *
 * Why: every AristotleOS service used to define its own /health route
 * by hand. The hardening batch added /healthz + /readyz to one service
 * (meta-authority-registry) as a reference; this package generalizes
 * that so every service ships consistent k8s-friendly probes without
 * duplicating boilerplate.
 *
 * Usage in a service:
 *
 *   import { mountHealthEndpoints, ReadinessChecks } from "@aristotle/service-runtime";
 *
 *   mountHealthEndpoints(app, {
 *     service: "meta-authority-registry",
 *     readiness: () => ReadinessChecks
 *       .start()
 *       .add("mesh_signer", typeof root.getId() === "string")
 *       .add("peers_configured", peers.length > 0, peers.length === 0 ? "no peers" : `${peers.length} peers`)
 *       .addDemoSecretCheck(meshSecret)
 *       .build()
 *   });
 *
 * /healthz always returns 200; /readyz returns 503 if any check fails.
 * Both responses are structured JSON with `service`, `status`,
 * `uptime_s`, `timestamp`, and (readyz only) `checks`.
 */

// The Express type surface we depend on. We only need .get(); declaring
// the minimum here avoids a hard dep on @types/express in this shared
// package — every service already has express + its types.
export interface ExpressLikeApp {
  get(path: string, handler: (req: unknown, res: ExpressLikeResponse) => void): unknown;
}

export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  json(body: unknown): unknown;
}

// ---------------------------------------------------------------------------
// Readiness check builder
// ---------------------------------------------------------------------------

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * Builder for composing readiness checks. Fluent API; build() returns
 * the array of ReadinessCheck objects that mountHealthEndpoints expects.
 */
export class ReadinessChecksBuilder {
  private readonly checks: ReadinessCheck[] = [];

  /** Add a check by hand. */
  add(name: string, ok: boolean, detail?: string): this {
    this.checks.push(detail !== undefined ? { name, ok, detail } : { name, ok });
    return this;
  }

  /**
   * Add a check that runs a closure; any thrown error counts as a
   * failed check with the error message in `detail`.
   */
  addTry(name: string, probe: () => boolean | { ok: boolean; detail?: string }): this {
    try {
      const result = probe();
      if (typeof result === "boolean") this.add(name, result);
      else this.add(name, result.ok, result.detail);
    } catch (err) {
      this.add(name, false, err instanceof Error ? err.message : String(err));
    }
    return this;
  }

  /**
   * Convenience: flag known demo HMAC secrets as a failed readiness
   * check unless ARISTOTLE_ALLOW_DEMO_SECRET=1 is set. Catches the
   * "operator deployed with the demo secret env var" failure mode.
   */
  addDemoSecretCheck(
    secret: string | undefined,
    overrideEnvVar: string = "ARISTOTLE_ALLOW_DEMO_SECRET"
  ): this {
    if (!secret) {
      this.add("secret_present", false, "no mesh secret configured");
      return this;
    }
    const usingDemo = KNOWN_DEMO_SECRETS.has(secret);
    const allowOverride = process.env[overrideEnvVar] === "1";
    this.add(
      "secret_not_demo",
      !usingDemo || allowOverride,
      usingDemo
        ? (allowOverride
            ? `demo secret in use (${overrideEnvVar}=1 overrides)`
            : `mesh secret equals a known demo string and ${overrideEnvVar} is not set`)
        : "operator-supplied secret"
    );
    return this;
  }

  /**
   * Convenience: flag a missing-peers case. Pass the peer count and
   * an optional context string for the detail message.
   */
  addPeersConfiguredCheck(peerCount: number, envHint = "MESH_PEERS"): this {
    this.add(
      "peers_configured",
      peerCount > 0,
      peerCount === 0
        ? `${envHint} produced no peers`
        : `${peerCount} peer(s) configured`
    );
    return this;
  }

  build(): ReadinessCheck[] {
    return this.checks.slice();
  }
}

export const ReadinessChecks = {
  /** Start a new builder. */
  start(): ReadinessChecksBuilder {
    return new ReadinessChecksBuilder();
  }
};

/** The set of HMAC secret strings shipped as defaults in this repo. */
export const KNOWN_DEMO_SECRETS: ReadonlySet<string> = new Set([
  "demo-mesh-secret",
  "aos-demo-mesh-secret",
  "aristotle-demo-secret",
  "test-secret",
  "live-secret"
]);

// ---------------------------------------------------------------------------
// Endpoint mounting
// ---------------------------------------------------------------------------

export interface MountHealthEndpointsOptions {
  /** Service name to surface in responses. Required. */
  service: string;
  /**
   * Closure that produces the readiness checks at probe-time. Called
   * on every /readyz request — late binding lets the service report
   * up-to-date state instead of the state at boot.
   *
   * If omitted, /readyz reports `ok: true` with an empty checks array
   * (liveness-equivalent).
   */
  readiness?: () => ReadinessCheck[];
  /**
   * If true (default), also mount the legacy /health endpoint with the
   * `{ ok: true, service }` shape every existing service ships. Set
   * false to leave /health to the service's own handler (e.g. when the
   * service already returns extra fields like `tick`).
   */
  mountLegacyHealth?: boolean;
  /**
   * Clock for tests. Defaults to Date.now.
   */
  now?: () => number;
}

export interface MountHealthEndpointsResult {
  /** Wall-clock the service started, ms epoch. */
  startedAtMs: number;
  /** The check names actually configured. Useful for tests. */
  configuredChecks: string[];
}

/**
 * Mount /healthz, /readyz, and (optionally) the legacy /health on an
 * Express-shaped app. Idempotent in the sense that the closure is
 * safe to call once per service boot; it does not re-register if
 * Express is configured to disallow that (operators using
 * `app.disable("x-powered-by")` style hardening are unaffected).
 */
export function mountHealthEndpoints(
  app: ExpressLikeApp,
  opts: MountHealthEndpointsOptions
): MountHealthEndpointsResult {
  const now = opts.now ?? Date.now;
  const startedAtMs = now();
  const service = opts.service;

  if (opts.mountLegacyHealth !== false) {
    app.get("/health", (_req, res) => {
      res.json({ ok: true, service });
    });
  }

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service,
      status: "alive",
      uptime_s: Math.round((now() - startedAtMs) / 1000),
      timestamp: new Date(now()).toISOString()
    });
  });

  app.get("/readyz", (_req, res) => {
    const checks = opts.readiness ? opts.readiness() : [];
    const allOk = checks.every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({
      ok: allOk,
      service,
      status: allOk ? "ready" : "not-ready",
      uptime_s: Math.round((now() - startedAtMs) / 1000),
      timestamp: new Date(now()).toISOString(),
      checks
    });
  });

  // Tally the names the readiness closure would produce at boot —
  // useful diagnostic for tests + startup logs.
  let configuredChecks: string[] = [];
  if (opts.readiness) {
    try { configuredChecks = opts.readiness().map((c) => c.name); }
    catch { configuredChecks = []; }
  }
  return { startedAtMs, configuredChecks };
}
