import test from "node:test";
import assert from "node:assert/strict";
import { freePort, startService } from "../../../tests/_harness.mjs";

/**
 * http-gateway operator-RBAC fail-closed tests.
 *
 * The gateway exposes:
 *   - /v1/* — the public trial API surface
 *   - /operator/* — the privileged operator surface, gated by the
 *     OPERATOR_API_KEY + OPERATOR_SESSION_SECRET middleware
 *
 * When OPERATOR_API_KEY is set, the /operator middleware MUST refuse
 * unauthenticated and badly-authenticated requests before any
 * downstream proxy call. These tests pin that gate; the downstream
 * services (governance-kernel, agent-os, …) are deliberately NOT
 * started, so any request that slipped past the gate would fail with
 * a downstream-unreachable 502/500 — explicit assertion-failure
 * signal that the gate is broken.
 *
 * Why we don't test the "happy" downstream-proxy path here: it would
 * require standing up 5+ downstream services or a coordinated mock
 * server, which is a stage-3 piece. The fail-closed assertions are
 * the security-critical guarantee.
 *
 * No production code is modified.
 */

const TEST_API_KEY = "test-operator-api-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEST_SESSION_SECRET = "test-session-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/**
 * Spawn http-gateway with operator auth enabled. The gateway lives
 * under adapters/, not services/, and uses PORT_GATEWAY (not PORT_*)
 * as its primary port var — both quirks accommodated here.
 */
async function startGateway(extraEnv = {}) {
  const port = await freePort();
  return await startService("http-gateway", {
    port,
    entryPath: "adapters/http-gateway/src/index.ts",
    env: {
      PORT_GATEWAY: String(port),
      OPERATOR_API_KEY: TEST_API_KEY,
      OPERATOR_SESSION_SECRET: TEST_SESSION_SECRET,
      ...extraEnv
    },
    readyTimeoutMs: 15_000
  });
}

test("/health reports ok", async () => {
  const svc = await startGateway();
  try {
    const { status, body } = await svc.get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  } finally { await svc.stop(); }
});

test("/operator/* refuses with 401 when no credential is presented", async () => {
  const svc = await startGateway();
  try {
    // /operator/os/state would, if it slipped past, try to proxy to
    // agent-os (not running in this test). A 401 here proves the gate
    // refused BEFORE the downstream call.
    const { status, body } = await svc.get("/operator/os/state");
    assert.equal(status, 401, "gateway must refuse unauthenticated /operator/* with 401");
    assert.equal(body.error, "operator_auth_required");
  } finally { await svc.stop(); }
});

test("/operator/* refuses with 401 when bearer session token is malformed", async () => {
  const svc = await startGateway();
  try {
    // Session tokens start with "ost." — anything else is invalid.
    const { status, body } = await svc.get("/operator/os/state", {
      authorization: "Bearer ost.this-is-not-a-real-token"
    });
    assert.equal(status, 401, "gateway must refuse invalid session tokens");
    assert.equal(body.error, "operator_session_invalid");
  } finally { await svc.stop(); }
});

test("/operator/auth/session refuses with 401 when x-operator-key is wrong", async () => {
  const svc = await startGateway();
  try {
    const { status, body } = await svc.post("/operator/auth/session", {}, {
      "x-operator-key": "wrong-key-cccccccccccccccccccccccccccccccccccccccc"
    });
    assert.equal(status, 401);
    assert.equal(body.error, "operator_auth_required");
  } finally { await svc.stop(); }
});

test("/operator/auth/session returns a Bearer token when x-operator-key matches", async () => {
  const svc = await startGateway();
  try {
    const { status, body } = await svc.post("/operator/auth/session", {}, {
      "x-operator-key": TEST_API_KEY,
      "x-operator-actor": "test-operator",
      "x-operator-role": "admin"
    });
    assert.equal(status, 200);
    assert.equal(body.tokenType, "Bearer");
    assert.ok(body.token?.startsWith("ost."), "session token must use ost. prefix");
    assert.equal(body.actor, "test-operator");
    assert.equal(body.role, "admin");
    assert.equal(typeof body.expiresAt, "string");
    assert.equal(typeof body.sessionId, "string");
  } finally { await svc.stop(); }
});

test("/operator/auth/session is 503 when OPERATOR_SESSION_SECRET is missing while OPERATOR_API_KEY is set", async () => {
  // OPERATOR_API_KEY set but OPERATOR_SESSION_SECRET deliberately omitted
  // (we override with empty string to clear any inherited value).
  const port = await freePort();
  const svc = await startService("http-gateway", {
    port,
    entryPath: "adapters/http-gateway/src/index.ts",
    env: {
      PORT_GATEWAY: String(port),
      OPERATOR_API_KEY: TEST_API_KEY,
      OPERATOR_SESSION_SECRET: ""
    },
    readyTimeoutMs: 15_000
  });
  try {
    const { status, body } = await svc.post("/operator/auth/session", {}, {
      "x-operator-key": TEST_API_KEY
    });
    assert.equal(status, 503, "session endpoint must refuse when signing secret is unconfigured");
    assert.equal(body.error, "operator_session_disabled");
  } finally { await svc.stop(); }
});
