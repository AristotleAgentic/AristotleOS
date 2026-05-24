import test from "node:test";
import assert from "node:assert/strict";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  compileGovernanceManifest,
  diffGovernanceManifests,
  explainPolicy
} from "./index.js";

const ward: WardManifest = {
  ward_id: "build-ward", name: "Build Ward", sovereignty_context: "test",
  authority_domain: "ops", policy_version: "0.1.0", permitted_subjects: ["agent:b"]
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-build-001", ward_id: "build-ward", subject: "agent:b",
  allowed_actions: ["do.thing"], denied_actions: ["do.harm"],
  constraints: { max_amount: 1000, required_runtime_registers: ["registers.dual_control"] },
  expires_at: "2099-12-31T23:59:59Z", issuer: "build-root"
};

test("compileGovernanceManifest validates, hashes, and is content-addressed", () => {
  const a = compileGovernanceManifest({ ward, authorityEnvelope: envelope, now: "2026-05-24T00:00:00.000Z" });
  const b = compileGovernanceManifest({ ward, authorityEnvelope: envelope, now: "2030-01-01T00:00:00.000Z" });
  assert.equal(a.validation.ok, true);
  assert.match(a.hashes.manifest_hash, /^[0-9a-f]{64}$/);
  // manifest hash is over content, not compile time → stable across compiles
  assert.equal(a.hashes.manifest_hash, b.hashes.manifest_hash);
  assert.equal(a.manifest_version, "aristotle.governance-manifest.v1");
});

test("compileGovernanceManifest surfaces cross-artifact incoherence", () => {
  const mismatch = compileGovernanceManifest({ ward, authorityEnvelope: { ...envelope, ward_id: "other-ward" } });
  assert.equal(mismatch.validation.ok, false);
  assert.ok(mismatch.validation.errors.some((e) => /ward_id/.test(e)));

  const notPermitted = compileGovernanceManifest({ ward, authorityEnvelope: { ...envelope, subject: "agent:stranger" } });
  assert.equal(notPermitted.validation.ok, false);
  assert.ok(notPermitted.validation.errors.some((e) => /permitted_subjects/.test(e)));
});

test("diff flags weakening vs tightening changes", () => {
  const before = { ward, authorityEnvelope: envelope };
  const after = {
    ward,
    authorityEnvelope: {
      ...envelope,
      allowed_actions: ["do.thing", "do.more"],          // added → weakening
      denied_actions: [],                                  // removed deny → weakening
      constraints: { max_amount: 5000, required_runtime_registers: ["registers.dual_control"] }, // raised cap → weakening
      expires_at: "2100-12-31T23:59:59Z"                   // extended → weakening
    }
  };
  const diff = diffGovernanceManifests(before, after);
  const weakenings = diff.filter((d) => d.weakening);
  assert.ok(weakenings.some((d) => d.path.includes("allowed_actions[+do.more]")));
  assert.ok(weakenings.some((d) => d.path.includes("denied_actions[-do.harm]")));
  assert.ok(weakenings.some((d) => d.path.includes("constraints.max_amount")));
  assert.ok(weakenings.some((d) => d.path.includes("expires_at")));

  // tightening: removing an allowed action is NOT weakening
  const tightened = diffGovernanceManifests(before, { ward, authorityEnvelope: { ...envelope, allowed_actions: [] } });
  const removed = tightened.find((d) => d.path.includes("allowed_actions[-do.thing]"));
  assert.equal(removed?.weakening, false);
});

test("explainPolicy reports the gate decision for sample actions", () => {
  const mk = (id: string, type: string): CanonicalActionInput => ({
    action_id: id, ward_id: "build-ward", subject: "agent:b", action_type: type,
    target: "t", params: {}, requested_at: "2026-05-24T00:00:00.000Z", request_id: id
  });
  const explanation = explainPolicy({
    ward, authorityEnvelope: envelope,
    runtimeRegister: { registers: { dual_control: true } },
    sampleActions: [mk("s1", "do.thing"), mk("s2", "do.harm"), mk("s3", "unknown.action")]
  });
  assert.deepEqual(explanation.allowed_actions, ["do.thing"]);
  assert.equal(explanation.samples.find((s) => s.action_id === "s1")?.decision, "ALLOW");
  assert.equal(explanation.samples.find((s) => s.action_id === "s2")?.decision, "REFUSE");
  assert.equal(explanation.samples.find((s) => s.action_id === "s3")?.decision, "REFUSE");
});
