import test from "node:test";
import assert from "node:assert/strict";
import { compilePolicy, tokenize } from "./policy-dsl.js";
import { compileGovernanceManifest, evaluateCommitGate } from "./index.js";

const SAMPLE = `
# Montana drone test range
ward "Montana Drone Range" {
  id montana-drone-range
  domain drone-swarm-ops
  sovereignty "private-ranch-field-test"
  version 0.1.0
  subject agent:survey-planner
  criticality safety_critical
  classification CUI caveats "NOFORN"
  allow drone.takeoff, drone.scan_area when telemetry.gps_lock
  deny  drone.disable_geofence, drone.leave_boundary
  bound altitude_m <= 120
  bound battery_pct >= 20
  within ranch-test-grid-a
}
`;

test("tokenize handles strings, idents with dots/colons, numbers, comparison ops, comments", () => {
  const toks = tokenize(`ward "x" { allow a.b.c when telemetry.gps_lock\nbound altitude_m <= 120 } # tail`);
  const kinds = toks.map((t) => `${t.type}:${t.value}`);
  assert.ok(kinds.includes("ident:allow"));
  assert.ok(kinds.includes("ident:a.b.c"));
  assert.ok(kinds.includes("ident:telemetry.gps_lock"));
  assert.ok(kinds.includes("punct:<="));
  assert.ok(kinds.includes("number:120"));
  assert.equal(toks[toks.length - 1].type, "eof");
});

test("compilePolicy compiles a ward block into a valid Ward + Authority draft", () => {
  const result = compilePolicy(SAMPLE);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.drafts.length, 1);
  const { ward, authorityEnvelope } = result.drafts[0];

  assert.equal(ward.ward_id, "montana-drone-range");
  assert.equal(ward.authority_domain, "drone-swarm-ops");
  assert.equal(ward.criticality, "safety_critical");
  assert.equal(ward.classification?.level, "CUI");
  assert.deepEqual(ward.classification?.caveats, ["NOFORN"]);
  assert.equal(ward.physical_bounds?.max_altitude_m, 120);
  assert.equal(ward.physical_bounds?.battery_minimum_pct, 20);
  assert.equal(ward.physical_bounds?.permitted_boundary_id, "ranch-test-grid-a");
  assert.deepEqual(ward.permitted_subjects, ["agent:survey-planner"]);

  assert.equal(authorityEnvelope.envelope_id, "ae-montana-drone-range");
  assert.deepEqual(authorityEnvelope.allowed_actions, ["drone.takeoff", "drone.scan_area"]);
  assert.deepEqual(authorityEnvelope.denied_actions, ["drone.disable_geofence", "drone.leave_boundary"]);
  assert.deepEqual(authorityEnvelope.constraints.required_runtime_registers, ["telemetry.gps_lock"]);
  assert.equal(authorityEnvelope.constraints.permitted_boundary_id, "ranch-test-grid-a");
});

test("the compiled draft is accepted by the governance builder and drives the real gate", () => {
  const { drafts } = compilePolicy(SAMPLE);
  const manifest = compileGovernanceManifest(drafts[0]);
  assert.equal(manifest.validation.ok, true, manifest.validation.errors.join(", "));
  assert.match(manifest.hashes.manifest_hash, /^[a-f0-9]{64}$/);

  const ward = drafts[0].ward;
  const envelope = drafts[0].authorityEnvelope;
  const now = "2026-05-24T14:00:00.000Z";
  const base = { action_id: "a1", ward_id: ward.ward_id, subject: "agent:survey-planner", target: "drone/unit-7", requested_at: now, telemetry: { gps_lock: true } };

  // An allowed, in-bounds action with the required register passes.
  const allow = evaluateCommitGate({ ward, authorityEnvelope: envelope, action: { ...base, action_type: "drone.takeoff", params: { altitude_m: 80, boundary_id: "ranch-test-grid-a", battery_pct: 87 } }, now });
  assert.equal(allow.decision, "ALLOW");
  // A denied action is refused.
  const deny = evaluateCommitGate({ ward, authorityEnvelope: envelope, action: { ...base, action_type: "drone.disable_geofence", params: {} }, now });
  assert.equal(deny.decision, "REFUSE");
});

test("defaults: id slugged from name, envelope/issuer/expires defaulted", () => {
  const { drafts } = compilePolicy(`ward "Payments Refund Ward" { subject agent:refunder\n allow stripe.refund }`);
  assert.equal(drafts[0].ward.ward_id, "payments-refund-ward");
  assert.equal(drafts[0].authorityEnvelope.envelope_id, "ae-payments-refund-ward");
  assert.equal(drafts[0].authorityEnvelope.issuer, "aristotle-root");
  assert.match(drafts[0].authorityEnvelope.expires_at, /2099/);
});

test("multiple ward blocks compile to multiple drafts", () => {
  const { drafts, ok } = compilePolicy(`ward "A" { id a\n subject agent:x\n allow t1 }\nward "B" { id b\n subject agent:y\n deny t2 }`);
  assert.equal(ok, true);
  assert.deepEqual(drafts.map((d) => d.ward.ward_id), ["a", "b"]);
});

test("diagnostics carry line:column for a syntax error", () => {
  const result = compilePolicy(`ward "x" {\n  subject agent:x\n  allow\n}`); // 'allow' needs an action
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].line, 4); // the '}' is where the ident was expected
  assert.match(result.diagnostics[0].message, /expected ident/);
});

test("invalid enum values are rejected with a helpful message + position", () => {
  const crit = compilePolicy(`ward "x" { subject agent:x\n criticality ultra }`);
  assert.equal(crit.ok, false);
  assert.match(crit.diagnostics[0].message, /unknown criticality 'ultra'/);
  assert.equal(crit.diagnostics[0].line, 2);

  const cls = compilePolicy(`ward "x" { subject agent:x\n classification COSMIC }`);
  assert.equal(cls.ok, false);
  assert.match(cls.diagnostics[0].message, /unknown classification 'COSMIC'/);
});

test("a missing subject and duplicate ward ids are rejected", () => {
  assert.equal(compilePolicy(`ward "x" { allow t1 }`).ok, false);
  const dup = compilePolicy(`ward "A" { id same\n subject agent:x }\nward "B" { id same\n subject agent:y }`);
  assert.equal(dup.ok, false);
  assert.match(dup.diagnostics[0].message, /duplicate ward id 'same'/);
});
