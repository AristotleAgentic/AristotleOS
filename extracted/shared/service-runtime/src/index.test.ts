import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_DEMO_SECRETS,
  ReadinessChecks,
  type ExpressLikeApp,
  type ExpressLikeResponse,
  mountHealthEndpoints
} from "./index.js";

// ---------------------------------------------------------------------------
// Express stub — captures routes + invokes handlers on demand
// ---------------------------------------------------------------------------

type Handler = (req: unknown, res: ExpressLikeResponse) => void;

function stubApp(): { app: ExpressLikeApp; routes: Map<string, Handler> } {
  const routes: Map<string, Handler> = new Map();
  const app: ExpressLikeApp = {
    get(path: string, handler: Handler): unknown {
      routes.set(path, handler);
      return undefined;
    }
  };
  return { app, routes };
}

function stubRes(): { res: ExpressLikeResponse; statusCode: number; body: unknown } {
  const state = { statusCode: 200, body: null as unknown };
  const res: ExpressLikeResponse = {
    status(code: number): ExpressLikeResponse {
      state.statusCode = code;
      return res;
    },
    json(body: unknown): unknown {
      state.body = body;
      return body;
    }
  };
  return Object.assign(state, { res });
}

function call(routes: Map<string, Handler>, path: string): { statusCode: number; body: unknown } {
  const handler = routes.get(path);
  if (!handler) throw new Error(`no route registered for ${path}`);
  const r = stubRes();
  handler({}, r.res);
  return { statusCode: r.statusCode, body: r.body };
}

// ---------------------------------------------------------------------------
// mountHealthEndpoints
// ---------------------------------------------------------------------------

test("mountHealthEndpoints: registers /health, /healthz, /readyz by default", () => {
  const { app, routes } = stubApp();
  mountHealthEndpoints(app, { service: "test-svc" });
  assert.equal(routes.has("/health"), true);
  assert.equal(routes.has("/healthz"), true);
  assert.equal(routes.has("/readyz"), true);
});

test("mountHealthEndpoints: /health returns { ok, service } envelope", () => {
  const { app, routes } = stubApp();
  mountHealthEndpoints(app, { service: "test-svc" });
  const { statusCode, body } = call(routes, "/health");
  assert.equal(statusCode, 200);
  assert.deepEqual(body, { ok: true, service: "test-svc" });
});

test("mountHealthEndpoints: mountLegacyHealth: false skips /health", () => {
  const { app, routes } = stubApp();
  mountHealthEndpoints(app, { service: "test-svc", mountLegacyHealth: false });
  assert.equal(routes.has("/health"), false);
});

test("mountHealthEndpoints: /healthz always 200 with structured body", () => {
  let clock = 1_000_000;
  const { app, routes } = stubApp();
  mountHealthEndpoints(app, { service: "test-svc", now: () => clock });
  clock += 5_000;
  const { statusCode, body } = call(routes, "/healthz");
  assert.equal(statusCode, 200);
  const b = body as { ok: boolean; service: string; status: string; uptime_s: number };
  assert.equal(b.ok, true);
  assert.equal(b.service, "test-svc");
  assert.equal(b.status, "alive");
  assert.equal(b.uptime_s, 5);
});

test("mountHealthEndpoints: /readyz returns 200 + ok=true when no readiness closure", () => {
  const { app, routes } = stubApp();
  mountHealthEndpoints(app, { service: "test-svc" });
  const { statusCode, body } = call(routes, "/readyz");
  assert.equal(statusCode, 200);
  const b = body as { ok: boolean; status: string; checks: unknown[] };
  assert.equal(b.ok, true);
  assert.equal(b.status, "ready");
  assert.deepEqual(b.checks, []);
});

test("mountHealthEndpoints: /readyz returns 200 when all checks ok", () => {
  const { app, routes } = stubApp();
  mountHealthEndpoints(app, {
    service: "test-svc",
    readiness: () => [
      { name: "db", ok: true, detail: "connected" },
      { name: "queue", ok: true }
    ]
  });
  const { statusCode, body } = call(routes, "/readyz");
  assert.equal(statusCode, 200);
  const b = body as { ok: boolean; checks: { name: string; ok: boolean }[] };
  assert.equal(b.ok, true);
  assert.equal(b.checks.length, 2);
});

test("mountHealthEndpoints: /readyz returns 503 when any check fails", () => {
  const { app, routes } = stubApp();
  mountHealthEndpoints(app, {
    service: "test-svc",
    readiness: () => [
      { name: "db", ok: true },
      { name: "trust_anchors", ok: false, detail: "no anchors loaded" }
    ]
  });
  const { statusCode, body } = call(routes, "/readyz");
  assert.equal(statusCode, 503);
  const b = body as { ok: boolean; status: string; checks: { name: string; ok: boolean; detail?: string }[] };
  assert.equal(b.ok, false);
  assert.equal(b.status, "not-ready");
  const failing = b.checks.find((c) => !c.ok);
  assert.equal(failing?.name, "trust_anchors");
  assert.equal(failing?.detail, "no anchors loaded");
});

test("mountHealthEndpoints: readiness closure runs on every /readyz call (late binding)", () => {
  const { app, routes } = stubApp();
  let ready = false;
  mountHealthEndpoints(app, {
    service: "test-svc",
    readiness: () => [{ name: "warmup", ok: ready }]
  });
  // First probe: not ready.
  assert.equal(call(routes, "/readyz").statusCode, 503);
  ready = true;
  // Second probe: ready (closure re-evaluated).
  assert.equal(call(routes, "/readyz").statusCode, 200);
});

// ---------------------------------------------------------------------------
// ReadinessChecksBuilder
// ---------------------------------------------------------------------------

test("ReadinessChecks: builder fluent API produces the expected array", () => {
  const checks = ReadinessChecks
    .start()
    .add("a", true)
    .add("b", false, "broken")
    .build();
  assert.deepEqual(checks, [
    { name: "a", ok: true },
    { name: "b", ok: false, detail: "broken" }
  ]);
});

test("ReadinessChecks: addTry catches thrown errors", () => {
  const checks = ReadinessChecks
    .start()
    .addTry("ok-bool", () => true)
    .addTry("ok-obj", () => ({ ok: true, detail: "all good" }))
    .addTry("throws", () => { throw new Error("oops"); })
    .build();
  assert.equal(checks[0].ok, true);
  assert.equal(checks[1].ok, true);
  assert.equal(checks[1].detail, "all good");
  assert.equal(checks[2].ok, false);
  assert.equal(checks[2].detail, "oops");
});

test("ReadinessChecks: addDemoSecretCheck flags known demo secrets", () => {
  for (const demo of KNOWN_DEMO_SECRETS) {
    delete process.env.ARISTOTLE_ALLOW_DEMO_SECRET;
    const c = ReadinessChecks.start().addDemoSecretCheck(demo).build();
    assert.equal(c[0].ok, false, `demo secret ${demo} must fail readiness`);
    assert.ok(c[0].detail?.includes("ARISTOTLE_ALLOW_DEMO_SECRET"));
  }
});

test("ReadinessChecks: addDemoSecretCheck honors override env var", () => {
  process.env.ARISTOTLE_ALLOW_DEMO_SECRET = "1";
  try {
    const c = ReadinessChecks.start().addDemoSecretCheck("demo-mesh-secret").build();
    assert.equal(c[0].ok, true);
    assert.ok(c[0].detail?.includes("overrides"));
  } finally {
    delete process.env.ARISTOTLE_ALLOW_DEMO_SECRET;
  }
});

test("ReadinessChecks: addDemoSecretCheck passes for a real-looking secret", () => {
  delete process.env.ARISTOTLE_ALLOW_DEMO_SECRET;
  const c = ReadinessChecks.start().addDemoSecretCheck("operator-secret-fb23ac98").build();
  assert.equal(c[0].ok, true);
  assert.equal(c[0].detail, "operator-supplied secret");
});

test("ReadinessChecks: addDemoSecretCheck fails when no secret provided", () => {
  const c = ReadinessChecks.start().addDemoSecretCheck(undefined).build();
  assert.equal(c[0].ok, false);
  assert.equal(c[0].name, "secret_present");
});

test("ReadinessChecks: addPeersConfiguredCheck reflects peer count", () => {
  const empty = ReadinessChecks.start().addPeersConfiguredCheck(0).build();
  assert.equal(empty[0].ok, false);
  assert.ok(empty[0].detail?.includes("MESH_PEERS"));
  const some = ReadinessChecks.start().addPeersConfiguredCheck(3).build();
  assert.equal(some[0].ok, true);
  assert.ok(some[0].detail?.includes("3"));
});
