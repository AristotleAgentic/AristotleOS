import test from "node:test";
import assert from "node:assert/strict";
import {
  runRevocationLagScenario,
  runMaliciousEnvelopeScenario,
  runHallucinatedCommandScenario,
  runFluidityTtlExpiryScenario,
  runQuotaExhaustionScenario,
  runAllChaosScenarios
} from "./index.js";

test("revocation_lag: witness-reachable half refuses; isolated half still allows", async () => {
  const sc = await runRevocationLagScenario({ edgeCount: 4 });
  assert.equal(sc.scenario, "revocation_lag");
  assert.equal(sc.passed, true, `expectations: ${JSON.stringify(sc.expectations.filter((e) => !e.ok), null, 2)}`);
  assert.equal(sc.counters.revocations_issued, 4);
  assert.equal(sc.counters.witness_half_refused, 2);
  assert.equal(sc.counters.isolated_half_allowed, 2);
});

test("malicious_envelope: forged envelope is rejected; subsequent evaluate refuses with UNKNOWN_ENVELOPE", async () => {
  const sc = await runMaliciousEnvelopeScenario();
  assert.equal(sc.passed, true, `expectations: ${JSON.stringify(sc.expectations.filter((e) => !e.ok), null, 2)}`);
  assert.equal(sc.counters.forged_envelopes_attempted, 1);
});

test("hallucinated_command: every out-of-envelope action refused (50 attempts)", async () => {
  const sc = await runHallucinatedCommandScenario({ attempts: 50 });
  assert.equal(sc.passed, true, `expectations: ${JSON.stringify(sc.expectations.filter((e) => !e.ok), null, 2)}`);
  assert.equal(sc.counters.hallucinated_refused, 50);
  assert.equal(sc.counters.hallucinated_other ?? 0, 0);
});

test("fluidity_ttl_expiry: ALLOW before TTL, EXPIRE after TTL", async () => {
  const sc = await runFluidityTtlExpiryScenario({ ttlMs: 120, sleepBufferMs: 40 });
  assert.equal(sc.passed, true, `expectations: ${JSON.stringify(sc.expectations.filter((e) => !e.ok), null, 2)}`);
  assert.equal(sc.counters.before_ttl_allowed, 1);
  assert.equal(sc.counters.after_ttl_expired, 1);
});

test("quota_exhaustion: first N allowed; overshoot returns DISCONNECTED_QUOTA_EXCEEDED", async () => {
  const sc = await runQuotaExhaustionScenario({ quota: 5, overshoot: 3 });
  assert.equal(sc.passed, true, `expectations: ${JSON.stringify(sc.expectations.filter((e) => !e.ok), null, 2)}`);
  assert.equal(sc.counters.allowed_under_quota, 5);
  assert.equal(sc.counters.refused_quota_exceeded, 3);
});

test("runAllChaosScenarios: every scenario in the deck passes", async () => {
  const { scorecards, passed, failed } = await runAllChaosScenarios();
  assert.equal(scorecards.length, 5);
  assert.equal(failed, 0, `failed scenarios: ${scorecards.filter((s) => !s.passed).map((s) => s.scenario).join(", ")}`);
  assert.equal(passed, 5);
});
