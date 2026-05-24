import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ShadowAction,
  type WardManifest,
  createEd25519Signer,
  profileShadowMode,
  verifyShadowEvidence
} from "./index.js";

function testSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

const ward: WardManifest = {
  ward_id: "shadow-ward", name: "Shadow Ward", sovereignty_context: "test",
  authority_domain: "drone-ops", policy_version: "0.1.0", permitted_subjects: ["agent:s"],
  physical_bounds: { max_altitude_m: 120, permitted_boundary_id: "zone", battery_minimum_pct: 20 }
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-shadow-001", ward_id: "shadow-ward", subject: "agent:s",
  allowed_actions: ["drone.takeoff"], denied_actions: ["drone.disable_geofence"],
  constraints: { required_runtime_registers: ["registers.dual_control"] },
  expires_at: "2099-12-31T23:59:59Z", issuer: "shadow-root"
};

const REG = { registers: { dual_control: true } };
function action(id: string, params: Record<string, unknown>, actionType = "drone.takeoff"): CanonicalActionInput {
  return {
    action_id: id, ward_id: "shadow-ward", subject: "agent:s", action_type: actionType,
    target: "unit-1", params: params as CanonicalActionInput["params"],
    requested_at: "2026-05-23T12:00:00.000Z", request_id: `req-${id}`, telemetry: { gps_lock: true }
  };
}

test("shadow mode profiles a mixed batch without touching live state", () => {
  const before = JSON.stringify({ ward, envelope });
  const actions: ShadowAction[] = [
    { action: action("a-allow", { altitude_m: 80, boundary_id: "zone", battery_pct: 90 }), runtimeRegister: REG },          // ALLOW
    { action: action("a-escalate", { altitude_m: 80, boundary_id: "zone", battery_pct: 90 }) },                              // ESCALATE (missing register)
    { action: action("a-denied", {}, "drone.disable_geofence"), runtimeRegister: REG },                                     // REFUSE (denied)
    { action: action("a-physical", { altitude_m: 400, boundary_id: "zone", battery_pct: 90 }), runtimeRegister: REG },      // REFUSE (physical)
    { action: action("a-nearmiss", { altitude_m: 115, boundary_id: "zone", battery_pct: 90 }), runtimeRegister: REG }       // ALLOW (near miss)
  ];

  const report = profileShadowMode({ ward, authorityEnvelope: envelope, actions, signer: testSigner(), now: "2026-05-23T12:00:00.000Z" });

  assert.equal(report.count, 5);
  assert.equal(report.decisions.ALLOW, 2);
  assert.equal(report.decisions.ESCALATE, 1);
  assert.equal(report.decisions.REFUSE, 2);
  assert.equal(report.would_block.length, 2);
  assert.equal(report.would_escalate.length, 1);

  // reason codes present
  assert.ok(report.reason_codes.ACTION_DENIED >= 1);
  assert.ok(report.reason_codes.PHYSICAL_INVARIANT_FAILED >= 1);
  assert.ok(report.reason_codes.RUNTIME_STATE_MISSING >= 1);

  // findings
  const missing = report.findings.missing_runtime_registers.find((m) => m.action_id === "a-escalate");
  assert.deepEqual(missing?.registers, ["registers.dual_control"]);
  assert.ok(report.findings.physical_near_misses.some((n) => n.action_id === "a-nearmiss"));

  // warrant eligibility
  assert.equal(report.traces.find((t) => t.action_id === "a-allow")?.warrant_eligible, true);
  assert.equal(report.traces.find((t) => t.action_id === "a-denied")?.warrant_eligible, false);

  // rollout: not ready (an escalation is unresolved); blockers ranked
  assert.equal(report.rollout.ready, false);
  assert.equal(report.rollout.allow_rate, 0.4);
  assert.ok(report.rollout.blockers.length >= 3);

  // evidence is real, signed GEL material and verifies
  assert.equal(report.evidence.length, 5);
  assert.equal(verifyShadowEvidence(report).ok, true);

  // doctrine: shadow mode never weakens or mutates policy
  assert.equal(JSON.stringify({ ward, envelope }), before);
});

test("shadow mode reports rollout-ready when nothing would escalate", () => {
  const actions: ShadowAction[] = [
    { action: action("ok-1", { altitude_m: 60, boundary_id: "zone", battery_pct: 95 }), runtimeRegister: REG },
    { action: action("ok-2", { altitude_m: 70, boundary_id: "zone", battery_pct: 88 }), runtimeRegister: REG }
  ];
  const report = profileShadowMode({ ward, authorityEnvelope: envelope, actions, signer: testSigner() });
  assert.equal(report.decisions.ALLOW, 2);
  assert.equal(report.rollout.ready, true);
  assert.equal(report.rollout.allow_rate, 1);
  assert.equal(report.would_block.length, 0);
});
