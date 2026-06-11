import test from "node:test";
import assert from "node:assert/strict";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type Classification,
  type WardManifest,
  checkClassification,
  crossDomainTransferAllowed,
  dominates,
  enforceClassification,
  evaluateCommitGate
} from "./index.js";

const NOW = "2026-05-24T12:00:00.000Z";

test("dominates: level ordering and caveat superset", () => {
  assert.equal(dominates({ level: "SECRET" }, { level: "CONFIDENTIAL" }), true);
  assert.equal(dominates({ level: "CONFIDENTIAL" }, { level: "SECRET" }), false);
  assert.equal(dominates({ level: "SECRET", caveats: ["NOFORN", "FVEY"] }, { level: "SECRET", caveats: ["noforn"] }), true); // case-insensitive
  assert.equal(dominates({ level: "SECRET" }, { level: "SECRET", caveats: ["NOFORN"] }), false); // missing compartment
});

test("checkClassification reports the reason", () => {
  const low = checkClassification({ level: "CUI" }, { level: "SECRET" });
  assert.equal(low.ok, false);
  if (!low.ok) assert.match(low.detail, /below label/);
  const cav = checkClassification({ level: "SECRET" }, { level: "SECRET", caveats: ["NOFORN"] });
  assert.equal(cav.ok, false);
  if (!cav.ok) assert.match(cav.detail, /missing required caveats/);
});

test("enforceClassification: unlabeled action passes; any failing clearance blocks", () => {
  assert.equal(enforceClassification([{ level: "UNCLASSIFIED" }], undefined).ok, true); // no label => unclassified default
  assert.equal(enforceClassification([{ level: "SECRET" }, { level: "CONFIDENTIAL" }], { level: "SECRET" }).ok, false); // envelope too low
  assert.equal(enforceClassification([{ level: "SECRET" }, { level: "SECRET" }], { level: "CONFIDENTIAL" }).ok, true);
});

const ward = (classification?: Classification): WardManifest => ({
  ward_id: "w", name: "w", sovereignty_context: "t", authority_domain: "d", policy_version: "1.0.0", permitted_subjects: ["agent:a"], classification
});
const envelope = (classification?: Classification): AuthorityEnvelope => ({
  envelope_id: "ae", ward_id: "w", subject: "agent:a", allowed_actions: ["x.do"], denied_actions: [], constraints: {}, expires_at: "2099-12-31T23:59:59Z", issuer: "root", classification
});
const action = (classification?: Classification): CanonicalActionInput => ({
  action_id: "a1", ward_id: "w", subject: "agent:a", action_type: "x.do", target: "t", params: {}, requested_at: NOW, request_id: "r1", classification
});

test("the gate REFUSEs an over-classified action (no read up)", () => {
  const r = evaluateCommitGate({ ward: ward({ level: "UNCLASSIFIED" }), authorityEnvelope: envelope({ level: "UNCLASSIFIED" }), action: action({ level: "SECRET" }), now: NOW });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("CLASSIFICATION_VIOLATION"));
});

test("the gate ALLOWs when the Ward + Envelope clearances dominate the action label", () => {
  const r = evaluateCommitGate({ ward: ward({ level: "SECRET", caveats: ["NOFORN"] }), authorityEnvelope: envelope({ level: "SECRET", caveats: ["NOFORN"] }), action: action({ level: "CONFIDENTIAL", caveats: ["NOFORN"] }), now: NOW });
  assert.equal(r.decision, "ALLOW");
});

test("the gate REFUSEs on a missing compartment even at the same level", () => {
  const r = evaluateCommitGate({ ward: ward({ level: "SECRET" }), authorityEnvelope: envelope({ level: "SECRET" }), action: action({ level: "SECRET", caveats: ["NOFORN"] }), now: NOW });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("CLASSIFICATION_VIOLATION"));
});

test("unlabeled artifacts are unaffected (backward compatible)", () => {
  const r = evaluateCommitGate({ ward: ward(), authorityEnvelope: envelope(), action: action(), now: NOW });
  assert.equal(r.decision, "ALLOW");
});

test("crossDomainTransferAllowed enforces no-write-down and compartment retention", () => {
  assert.equal(crossDomainTransferAllowed({ level: "UNCLASSIFIED" }, { level: "SECRET" }).ok, true); // up is fine
  const down = crossDomainTransferAllowed({ level: "SECRET" }, { level: "UNCLASSIFIED" });
  assert.equal(down.ok, false);
  if (!down.ok) assert.equal(down.reason, "DOWNGRADE_BLOCKED");
  const lost = crossDomainTransferAllowed({ level: "SECRET", caveats: ["NOFORN"] }, { level: "SECRET" });
  assert.equal(lost.ok, false);
  if (!lost.ok) assert.equal(lost.reason, "COMPARTMENT_LOSS");
});
