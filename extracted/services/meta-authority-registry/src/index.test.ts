import test from "node:test";
import assert from "node:assert/strict";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Meta-authority-registry delegation + resolution tests.
 *
 * The registry holds Meta-Authority Artifacts (MAAs): a root MAA
 * (coalition.core) plus delegated subjects (mission.command,
 * safety.council, evidence.steward) with per-subject domain lists.
 * /resolve is the substrate's authority-lookup primitive — it
 * answers "does issuer X have delegated authority for domain Y?".
 *
 * The governance-kernel's /validate-envelope calls this. Getting
 * the resolution logic right is load-bearing for the whole
 * authority chain. These tests pin:
 *
 *   (1) /artifacts returns the four bootstrap seeds
 *   (2) /artifacts/:id roundtrips a specific seed; 404 on unknown
 *   (3) POST /artifacts creates and returns 201
 *   (4) /resolve allowed=true when subject is delegated for domain
 *       (mission.command → mission; evidence.steward → ledger;
 *        safety.council → safety)
 *   (5) /resolve allowed=false when subject lacks the domain
 *       (mission.command → safety)
 *   (6) /resolve allowed=false when the issuer isn't a known subject
 *   (7) /v1/mesh/envelope returns 400 on missing required fields
 *   (8) /v1/mesh/envelope returns 201 + envelope on a valid body
 *
 * No production code is modified.
 */

test("/artifacts returns the four bootstrap seeds with the expected delegation classes", async () => {
  const svc = await startService("meta-authority-registry");
  try {
    const { status, body } = await svc.get("/artifacts");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.items));
    const bySubject = Object.fromEntries(body.items.map((a) => [a.subject, a]));

    assert.equal(bySubject["coalition.core"]?.delegationClass, "root");
    assert.equal(bySubject["coalition.core"]?.id, "maa-root-001");

    assert.equal(bySubject["mission.command"]?.delegationClass, "delegated");
    assert.equal(bySubject["mission.command"]?.parentAuthorityId, "maa-root-001");
    assert.ok((bySubject["mission.command"]?.domains ?? []).includes("mission"));

    assert.equal(bySubject["safety.council"]?.delegationClass, "delegated");
    assert.deepEqual(bySubject["safety.council"]?.domains, ["safety"]);

    assert.equal(bySubject["evidence.steward"]?.delegationClass, "delegated");
    assert.deepEqual(bySubject["evidence.steward"]?.domains, ["ledger"]);
  } finally { await svc.stop(); }
});

test("/artifacts/:id returns a specific seed; 404 for unknown id", async () => {
  const svc = await startService("meta-authority-registry");
  try {
    const ok = await svc.get("/artifacts/maa-root-001");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.id, "maa-root-001");
    assert.equal(ok.body.subject, "coalition.core");

    const missing = await svc.get("/artifacts/maa-does-not-exist");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "not_found");
  } finally { await svc.stop(); }
});

test("POST /artifacts creates a new delegated MAA and returns 201", async () => {
  const svc = await startService("meta-authority-registry");
  try {
    const r = await svc.post("/artifacts", {
      issuer: "coalition.core",
      subject: "test.subject",
      domains: ["test-domain"],
      delegationClass: "delegated",
      parentAuthorityId: "maa-root-001"
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.subject, "test.subject");
    assert.equal(r.body.delegationClass, "delegated");
    assert.ok(r.body.id.startsWith("maa-"), "new artifact must get a generated id");
    // Round-trip: it shows up in the list now
    const list = await svc.get("/artifacts");
    assert.ok(list.body.items.some((a) => a.id === r.body.id));
  } finally { await svc.stop(); }
});

test("/resolve returns allowed=true for delegated (subject, domain) pairs", async () => {
  const svc = await startService("meta-authority-registry");
  try {
    const mission = await svc.post("/resolve", { issuer: "mission.command", domain: "mission" });
    assert.equal(mission.status, 200);
    assert.equal(mission.body.allowed, true);
    assert.ok(mission.body.chain.includes("maa-mission-command-001"));
    assert.match(mission.body.explanation, /is delegated for mission/);

    const ledger = await svc.post("/resolve", { issuer: "evidence.steward", domain: "ledger" });
    assert.equal(ledger.body.allowed, true);

    const safety = await svc.post("/resolve", { issuer: "safety.council", domain: "safety" });
    assert.equal(safety.body.allowed, true);
  } finally { await svc.stop(); }
});

test("/resolve returns allowed=false when subject lacks the requested domain", async () => {
  const svc = await startService("meta-authority-registry");
  try {
    // mission.command's domains are mission/workspace/repo/logistics — NOT safety
    const r = await svc.post("/resolve", { issuer: "mission.command", domain: "safety" });
    assert.equal(r.status, 200);
    assert.equal(r.body.allowed, false);
    assert.match(r.body.explanation, /lacks delegated authority for safety/);
  } finally { await svc.stop(); }
});

test("/resolve returns allowed=false when the issuer is not a known subject", async () => {
  const svc = await startService("meta-authority-registry");
  try {
    const r = await svc.post("/resolve", { issuer: "agent.unknown", domain: "mission" });
    assert.equal(r.status, 200);
    assert.equal(r.body.allowed, false);
    assert.deepEqual(r.body.chain, []);
  } finally { await svc.stop(); }
});

test("/v1/mesh/envelope returns 400 on missing required fields", async () => {
  const svc = await startService("meta-authority-registry");
  try {
    const r = await svc.post("/v1/mesh/envelope", { envelope_id: "only-this" });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "missing_required_fields");
  } finally { await svc.stop(); }
});

test("/v1/mesh/envelope returns 201 + envelope on a valid body", async () => {
  const svc = await startService("meta-authority-registry");
  try {
    const r = await svc.post("/v1/mesh/envelope", {
      envelope_id: "env-test-001",
      mae_id: "mae.local.coalition",
      ward_id: "ward-test",
      subject: "agent:test",
      allowed_action_types: ["test.do"]
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.envelope, "envelope must be returned on success");
    assert.equal(r.body.envelope.envelope_id, "env-test-001");
    assert.equal(r.body.envelope.subject, "agent:test");
    assert.deepEqual(r.body.envelope.allowed_action_types, ["test.do"]);
  } finally { await svc.stop(); }
});
