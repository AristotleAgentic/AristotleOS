import test from "node:test";
import assert from "node:assert/strict";
import { startService, freePort } from "../../../tests/_harness.mjs";

/**
 * Governance-kernel kill-switch + warrant-issuance behavioral tests.
 *
 * Each test spawns a fresh governance-kernel as a child process on
 * an auto-allocated port. The module's top-level state (envelopes,
 * warrants, killSwitchState, killEvents) is therefore reset per
 * test — no shared-state flakes.
 *
 * Why we override PORT_META_AUTHORITY_REGISTRY in every test:
 *   /validate-envelope calls the meta-authority-registry to resolve
 *   issuer chains. In normal local dev that registry may be running
 *   on its default port (7004) and will reject test-fixture issuers
 *   like "agent-test" with HTTP 200 + { allowed: false }. The test
 *   would then be coupled to whatever the dev-stack registry's
 *   delegation table happens to contain — exactly the wrong kind of
 *   flake.
 *
 *   We point the kernel at a known-unused port. The fetch fails
 *   fast (ECONNREFUSED), the handler's
 *     .catch(() => ({ allowed: true, chain: [...], explanation: "local fallback" }))
 *   fires, and the envelope is admitted. This is the production
 *   "registry unreachable" fallback path and is the kernel's
 *   documented behavior; testing against that path gives
 *   environment-independent results, and the other tests that
 *   don't seed envelopes (the kill-switch toggles) are unaffected.
 *
 * Companion to governance-chain.test.ts, which covers the
 * GOVERNANCE_CHAIN_V2 routes; this file covers the legacy
 * /kill-switch + /validate-envelope + /issue-warrant surface.
 *
 * No production code is modified by this suite. The service is
 * exercised exactly as it runs in the local control plane, via
 * real HTTP, against the real Express handlers.
 *
 * Coverage:
 *   (1) /health surfaces killSwitchState and activeKillScopes
 *   (2) POST /kill-switch global sets state + records event
 *   (3) Mission-scope kill-switch records event but doesn't toggle
 *       the global state field (only the global scope does)
 *   (4) POST /issue-warrant fails with 423 when global kill-switch
 *       is active
 *   (5) POST /issue-warrant returns the warrant when no kill-switch
 *       is active and an envelope exists
 *   (6) Mission-scope kill-switch denies warrant issuance for the
 *       matching mission only, not for other missions
 */

/**
 * startKernel — spawn governance-kernel with a known-unreachable
 * registry port so /validate-envelope's local fallback path fires.
 */
async function startKernel() {
  const unreachableRegistryPort = String(await freePort());
  return await startService("governance-kernel", {
    env: { PORT_META_AUTHORITY_REGISTRY: unreachableRegistryPort }
  });
}

/**
 * Helper: stand up a pre-stuffed envelope via /validate-envelope,
 * relying on the registry-unreachable permissive fallback (see top
 * comment).
 */
async function seedEnvelope(svc, overrides = {}) {
  const r = await svc.post("/validate-envelope", {
    issuer: "agent-test",
    domain: "test",
    subject: "subject:test",
    action: "do.test",
    permittedEffects: ["write"],
    ...overrides
  });
  assert.equal(r.status, 200, `seedEnvelope expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.envelope.id;
}

test("/health reports killSwitchState and activeKillScopes", async () => {
  const svc = await startKernel();
  try {
    const { status, body } = await svc.get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "governance-kernel");
    assert.equal(body.killSwitchState, "inactive");
    assert.deepEqual(body.activeKillScopes, []);
  } finally { await svc.stop(); }
});

test("POST /kill-switch global sets killSwitchState and records event", async () => {
  const svc = await startKernel();
  try {
    const { status, body } = await svc.post("/kill-switch", {
      state: "active",
      scope: "global",
      actor: "test-operator",
      reason: "drill"
    });
    assert.equal(status, 200);
    assert.equal(body.state, "active");
    assert.equal(body.scope, "global");
    assert.equal(body.actor, "test-operator");
    const health = await svc.get("/health");
    assert.equal(health.body.killSwitchState, "active");
    assert.equal(health.body.activeKillScopes.length, 1);
    assert.equal(health.body.activeKillScopes[0].scope, "global");
  } finally { await svc.stop(); }
});

test("Mission-scope kill-switch records event without toggling the global field", async () => {
  const svc = await startKernel();
  try {
    // Mission-scope kill: the global killSwitchState field stays inactive
    // because the kill is scope-restricted; the event is recorded so
    // appliesKillSwitch() will return true for matching mission contexts.
    const r = await svc.post("/kill-switch", {
      state: "active",
      scope: "mission",
      scopeRef: "mission-alpha",
      actor: "test",
      reason: "drill"
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.scope, "mission");
    assert.equal(r.body.scopeRef, "mission-alpha");
    const health = await svc.get("/health");
    assert.equal(health.body.killSwitchState, "inactive", "mission-scope kill must not toggle the global field");
    assert.equal(health.body.activeKillScopes.length, 1);
    assert.equal(health.body.activeKillScopes[0].scopeRef, "mission-alpha");
  } finally { await svc.stop(); }
});

test("/issue-warrant fails closed with 423 when global kill-switch is active", async () => {
  const svc = await startKernel();
  try {
    const envelopeId = await seedEnvelope(svc);
    await svc.post("/kill-switch", { state: "active", scope: "global" });
    const r = await svc.post("/issue-warrant", {
      envelopeId,
      missionId: "mission-x",
      targetNode: "node-1"
    });
    assert.equal(r.status, 423);
    assert.equal(r.body.error, "kill_switch_active");
  } finally { await svc.stop(); }
});

test("/issue-warrant returns a warrant when no kill-switch is active", async () => {
  const svc = await startKernel();
  try {
    const envelopeId = await seedEnvelope(svc);
    const r = await svc.post("/issue-warrant", {
      envelopeId,
      missionId: "mission-x",
      targetNode: "node-1",
      witnessRequired: true
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.artifactType, "execution-warrant");
    assert.equal(r.body.envelopeId, envelopeId);
    assert.equal(r.body.missionId, "mission-x");
    assert.equal(r.body.targetNode, "node-1");
    assert.equal(r.body.obligations.witnessRequired, true);
    assert.ok(r.body.obligations.minQuorum >= 1);
    assert.equal(r.body.verification.status, "verified");
  } finally { await svc.stop(); }
});

test("Mission-scope kill-switch denies its mission only — other missions still issue", async () => {
  const svc = await startKernel();
  try {
    const envelopeId = await seedEnvelope(svc);
    await svc.post("/kill-switch", {
      state: "active",
      scope: "mission",
      scopeRef: "mission-killed"
    });
    // Killed mission: refused.
    const killed = await svc.post("/issue-warrant", {
      envelopeId,
      missionId: "mission-killed",
      targetNode: "node-1"
    });
    assert.equal(killed.status, 423, "killed mission must be refused");
    // Other mission: still allowed (envelope domain matches, but the
    // kill-switch scope doesn't match this mission).
    const other = await svc.post("/issue-warrant", {
      envelopeId,
      missionId: "mission-other",
      targetNode: "node-2"
    });
    assert.equal(other.status, 201, "non-killed mission must still issue");
    assert.equal(other.body.missionId, "mission-other");
  } finally { await svc.stop(); }
});
