import test from "node:test";
import assert from "node:assert/strict";
import { freePort, startService } from "../../../tests/_harness.mjs";

/**
 * http-gateway /v1/* trial-API behavioral tests.
 *
 * The /v1/* routes are public, self-contained — they don't fan out
 * to any backend service. They drive @aristotle/trial-engine for
 * policy validation, trial action evaluation, and the in-memory
 * GEL record store the gateway maintains for its trial surface.
 *
 * Stage 2 covered operator RBAC on /operator/*. Stage 16 covers
 * the /v1/* trial-API. Goal: pin the envelope shapes so a future
 * stage can extract these handlers into adapters/http-gateway/src/
 * routes/trial-api.ts the same way stage-6 extracted operator-auth.
 *
 * Coverage:
 *   (1) /v1/status: ok=true, governance posture, scenarios list
 *       (the TRIAL_SCENARIOS catalog), activePolicyHash present
 *   (2) /v1/policy/check on a valid policy: 200 + policyHash
 *   (3) /v1/policy/check on an obviously-invalid policy: 422 +
 *       ok=false + error diagnostic
 *   (4) /v1/policy/plan: 200 + ok=true on a policy that compiles
 *   (5) /v1/audit/tail: { items: [...] } envelope, never errors
 *       on a fresh gateway
 *   (6) /v1/audit/<unknown>: 404 record_not_found
 *
 * No operator credentials needed — these routes are deliberately
 * public (they're the trial surface). The gateway is started with
 * OPERATOR_API_KEY unset so the /operator middleware short-circuits
 * to next() and doesn't interfere.
 *
 * No production code is modified.
 */

// Deliberately-garbage source for the malformed check. The trial-engine
// DSL is independent of the agent-os APL DSL — we don't need to match
// the exact grammar; any string that fails validation suffices.
const MALFORMED_POLICY = "this is not valid policy DSL of any flavor {{{{";

async function startGatewayPublic() {
  const port = await freePort();
  return await startService("http-gateway", {
    port,
    entryPath: "adapters/http-gateway/src/index.ts",
    env: { PORT_GATEWAY: String(port) },
    // 25s ready timeout: the gateway loads multiple workspace packages
    // at startup (trial-engine, governance-chain-proxy, etc.) and under
    // umbrella contention (many subprocess spawns back-to-back), tsx's
    // cold-start can climb past 15s. The matching test in
    // adapters/http-gateway/src/index.test.ts uses 15s and was fine when
    // it ran in isolation; under the 90+-test umbrella we need headroom.
    readyTimeoutMs: 25_000
  });
}

test("/v1/status returns ok=true, the doctrine string, scenarios catalog, and policy hash", async () => {
  const svc = await startGatewayPublic();
  try {
    const { status, body } = await svc.get("/v1/status");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.runtime, "aristotle-trial");
    assert.equal(body.governanceMode, "deterministic-trial");
    assert.equal(typeof body.doctrine, "string");
    assert.match(body.doctrine, /Governance must bind at the execution boundary/);
    assert.ok(Array.isArray(body.scenarios) && body.scenarios.length > 0,
      "scenarios catalog must be non-empty (TRIAL_SCENARIOS in @aristotle/trial-engine)");
    for (const scenario of body.scenarios) {
      assert.equal(typeof scenario.id, "string");
      assert.equal(typeof scenario.title, "string");
      assert.equal(typeof scenario.summary, "string");
    }
    assert.equal(typeof body.activePolicyHash, "string",
      "the default trial policy (PAYMENTS_GOVERNANCE_SOURCE) must hash to a string");
  } finally { await svc.stop(); }
});

test("/v1/policy/check returns 200 + policyHash when validating the trial default", async () => {
  // When the body omits `policy`, the handler falls back to
  // trialPolicySource (initialized to PAYMENTS_GOVERNANCE_SOURCE from
  // @aristotle/trial-engine). That's guaranteed to validate. The test
  // uses this path rather than passing our own source so we don't
  // couple to whichever DSL flavor the trial engine consumes.
  const svc = await startGatewayPublic();
  try {
    const r = await svc.post("/v1/policy/check", {});
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(typeof r.body.policyHash, "string");
  } finally { await svc.stop(); }
});

test("/v1/policy/check returns 422 + ok=false on a malformed APL source", async () => {
  const svc = await startGatewayPublic();
  try {
    const r = await svc.post("/v1/policy/check", { policy: MALFORMED_POLICY });
    assert.equal(r.status, 422);
    assert.equal(r.body.ok, false);
  } finally { await svc.stop(); }
});

test("/v1/policy/plan returns 200 + ok=true when planning the trial default against itself", async () => {
  // Same trick as /v1/policy/check above — pass no body so the
  // handler diffs the current trialPolicySource against itself,
  // which trivially compiles + plans without needing us to ship a
  // valid trial-DSL policy text.
  const svc = await startGatewayPublic();
  try {
    const r = await svc.post("/v1/policy/plan", {});
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  } finally { await svc.stop(); }
});

test("/v1/audit/tail returns { items: [...] } on a fresh gateway (never errors)", async () => {
  const svc = await startGatewayPublic();
  try {
    const r = await svc.get("/v1/audit/tail");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.items),
      `items must be an array, got ${JSON.stringify(r.body)}`);
    // On a freshly-started gateway, no trial actions have been replayed
    // yet, so items is empty. The envelope itself is what matters.
  } finally { await svc.stop(); }
});

test("/v1/audit/<unknown> returns 404 record_not_found", async () => {
  const svc = await startGatewayPublic();
  try {
    const r = await svc.get("/v1/audit/this-record-does-not-exist");
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "record_not_found");
  } finally { await svc.stop(); }
});
