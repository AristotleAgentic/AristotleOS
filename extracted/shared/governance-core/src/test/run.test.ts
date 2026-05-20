/**
 * Governance-core test suite. Run with `tsx src/test/run.test.ts` (or
 * `corepack pnpm --filter @aristotle/governance-core test`). Uses Node's built-in
 * test runner so the package needs no test-framework dependency.
 *
 * Covers every case enumerated in the implementation brief plus the worked
 * scenario fixtures.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  assertAuthorityChainComplete,
  chainMetrics,
  context,
  createAuthorityEnvelope,
  evaluateCommit,
  evaluateFederatedCommit,
  exportEvidence,
  verifyEvidenceBundle,
  fixtures,
  InMemoryGovernanceStore,
  issueWarrant,
  newId,
  nowIso,
  openApiSpec,
  precedes,
  recordExecutionOutcome,
  scopeSnapshot,
  revokeEnvelope,
  revokeWard,
  validateEnvelopeUnderWard,
  validateGovernorInstrument,
  validateMae,
  validateWardUnderMae,
  validateWarrant,
  verifyGelChain,
  type CommitOptions,
} from "../index.js";

function opts(w: { keyring: CommitOptions["keyring"]; keyId: string }, now?: Date): CommitOptions {
  return { keyring: w.keyring, signKeyId: w.keyId, now };
}

// 1 -------------------------------------------------------------------------
test("a valid MAE constitutes a valid Ward", () => {
  const w = fixtures.buildPayments();
  const ctx = context({ keyring: w.keyring });
  assert.equal(validateMae(w.mae, ctx).ok, true);
  assert.equal(validateWardUnderMae(w.ward, w.mae, ctx).ok, true);
});

// 2 -------------------------------------------------------------------------
test("an invalid (revoked) MAE cannot back a Ward", () => {
  const w = fixtures.buildPayments();
  const ctx = context({ keyring: w.keyring });
  const deadMae = { ...w.mae, revoked_at: nowIso() };
  const r = validateWardUnderMae(w.ward, deadMae, ctx);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.invariant === "ward-requires-valid-mae"));
});

// 3 -------------------------------------------------------------------------
test("a Ward can create an Authority Envelope within bounds", () => {
  const w = fixtures.buildPayments();
  const ctx = context({ keyring: w.keyring });
  assert.equal(validateEnvelopeUnderWard(w.envelope, w.ward, w.mae, ctx).ok, true);
});

// 4 -------------------------------------------------------------------------
test("an Authority Envelope cannot exceed its Ward", () => {
  const w = fixtures.buildPayments();
  const ctx = context({ keyring: w.keyring });
  const overreach = { ...w.envelope, allowed_action_classes: ["payment.refund", "payment.wire.external"] };
  const r = validateEnvelopeUnderWard(overreach, w.ward, w.mae, ctx);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.invariant === "envelope-cannot-exceed-ward"));
});

// 5 -------------------------------------------------------------------------
test("a Warrant cannot exceed its Authority Envelope", () => {
  const w = fixtures.buildPayments();
  const ctx = context({ keyring: w.keyring });
  const { warrant, request } = w.propose();
  const overreach = { ...warrant, action_type: "payment.wire.external" };
  const r = validateWarrant(overreach, w.envelope, w.ward, w.mae, request, ctx);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.invariant === "warrant-cannot-exceed-authority-envelope"));
});

// 6 -------------------------------------------------------------------------
test("a Warrant cannot be reused (single-use)", () => {
  const w = fixtures.buildPayments();
  const { request } = w.propose();
  const d1 = evaluateCommit(w.store, request, opts(w));
  assert.equal(d1.decision, "Allow");
  const d2 = evaluateCommit(w.store, request, opts(w));
  assert.notEqual(d2.decision, "Allow");
  assert.ok(d2.violated_invariants.includes("warrant-non-replayable"));
});

test("the store refuses to consume a Warrant twice", () => {
  const w = fixtures.buildPayments();
  const { warrant } = w.propose();
  w.store.consumeWarrant(warrant.warrant_id, "gate", nowIso());
  assert.throws(() => w.store.consumeWarrant(warrant.warrant_id, "gate", nowIso()));
});

// 7 -------------------------------------------------------------------------
test("an expired Warrant fails", () => {
  const w = fixtures.buildPayments();
  const { request, warrant } = w.propose({ validity_seconds: 60 });
  const future = new Date(Date.parse(warrant.expires_at) + 5000);
  const d = evaluateCommit(w.store, request, opts(w, future));
  assert.notEqual(d.decision, "Allow");
  assert.ok(d.violated_invariants.includes("warrant-expired"));
});

// 8 -------------------------------------------------------------------------
test("revoking a Ward invalidates its Envelope and Warrant", () => {
  const w = fixtures.buildPayments();
  const { request } = w.propose();
  revokeWard(w.store, w.ward.ward_id, nowIso());
  assert.equal(w.store.getEnvelope(w.envelope.authority_envelope_id)!.revocation_state, "revoked");
  assert.equal(w.store.getWarrant(request.warrant_id)!.consumption_state, "Revoked");
  const d = evaluateCommit(w.store, request, opts(w));
  assert.notEqual(d.decision, "Allow");
  assert.ok(d.violated_invariants.includes("ward-revoked"));
});

// 9 -------------------------------------------------------------------------
test("revoking an Authority Envelope invalidates its Warrant", () => {
  const w = fixtures.buildPayments();
  const { request } = w.propose();
  revokeEnvelope(w.store, w.envelope.authority_envelope_id, nowIso());
  assert.equal(w.store.getWarrant(request.warrant_id)!.consumption_state, "Revoked");
  const d = evaluateCommit(w.store, request, opts(w));
  assert.ok(d.violated_invariants.includes("authority-envelope-revoked"));
});

// 10 ------------------------------------------------------------------------
test("the Commit Gate fails closed when the Ward is missing", () => {
  const w = fixtures.buildPayments();
  const { request } = w.propose();
  const d = evaluateCommit(w.store, { ...request, ward_id: "ward-does-not-exist" }, opts(w));
  assert.equal(d.decision, "FailClosed");
  assert.ok(d.reasons.includes("ward-not-found"));
});

// 11 ------------------------------------------------------------------------
test("the Commit Gate fails closed when the Warrant is missing", () => {
  const w = fixtures.buildPayments();
  const { request } = w.propose();
  const d = evaluateCommit(w.store, { ...request, warrant_id: "warrant-does-not-exist" }, opts(w));
  assert.equal(d.decision, "FailClosed");
  assert.ok(d.reasons.includes("warrant-not-found"));
});

// 12 ------------------------------------------------------------------------
test("the Commit Gate consumes the Warrant on allow", () => {
  const w = fixtures.buildPayments();
  const { request, warrant } = w.propose();
  const d = evaluateCommit(w.store, request, opts(w));
  assert.equal(d.decision, "Allow");
  assert.equal(d.warrant_consumed, true);
  assert.equal(w.store.getWarrant(warrant.warrant_id)!.consumption_state, "Consumed");
});

// 13 ------------------------------------------------------------------------
test("the GEL Record carries the complete authority chain and the ledger verifies", () => {
  const w = fixtures.buildPayments();
  const { request } = w.propose();
  const d = evaluateCommit(w.store, request, opts(w));
  const rec = w.store.getGelChain().find((r) => r.gel_record_id === d.gel_record_id)!;
  assert.ok(rec);
  assert.equal(assertAuthorityChainComplete(rec).ok, true);
  assert.equal(verifyGelChain(w.store.getGelChain(), w.keyring).ok, true);
});

test("the GEL chain is tamper-evident", () => {
  const w = fixtures.buildPayments();
  const { request } = w.propose();
  evaluateCommit(w.store, request, opts(w));
  const chain = w.store.getGelChain();
  chain[0].action = "tampered";
  const r = verifyGelChain(chain);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.invariant === "gel-tamper-evident"));
});

// 14 ------------------------------------------------------------------------
test("a ProtectedSpace Ward applies its boundary rules (drone above ceiling denied)", () => {
  const w = fixtures.buildDrone();
  const allow = evaluateCommit(w.store, w.propose().request, opts(w));
  assert.equal(allow.decision, "Allow");

  const over = w.propose({ telemetry: { altitude_ft: 450, geo_cell: "B", weather_ok: true, battery_pct: 80, near_miss: false } });
  const d = evaluateCommit(w.store, over.request, opts(w));
  assert.notEqual(d.decision, "Allow");
  assert.ok(d.violated_invariants.includes("ward-boundary"));
});

// 15 ------------------------------------------------------------------------
test("an Institutional Ward requires an accountable governance origin", () => {
  const w = fixtures.buildPayments();
  const ctx = context({ keyring: w.keyring });
  const noGovOrigin = {
    ...w.ward,
    human_origin_act: { ...w.ward.human_origin_act, actor_kind: "human" as const, method: "key-ceremony" as const, attestation_ref: "" },
  };
  const r = validateWardUnderMae(noGovOrigin, w.mae, ctx);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.invariant === "institutional-ward-requires-governance-origin"));
});

test("a Ward's human origin act signature is verified, not merely present", () => {
  const w = fixtures.buildPayments();
  const ctx = context({ keyring: w.keyring });
  assert.equal(validateWardUnderMae(w.ward, w.mae, ctx).ok, true);
  // Tamper the constituting actor without re-signing — a machine can't forge the act.
  const forged = { ...w.ward, human_origin_act: { ...w.ward.human_origin_act, actor: "impersonator.bot" } };
  const r = validateWardUnderMae(forged, w.mae, ctx);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.invariant === "ward-origin-act-signature-invalid"));
});

test("a Ward without a presence proof is rejected when the MAE requires one", () => {
  const w = fixtures.buildPayments();
  const ctx = context({ keyring: w.keyring });
  const mae = { ...w.mae, ward_creation_rules: { ...w.mae.ward_creation_rules, require_presence_proof: true } };
  const noPresence = { ...w.ward, human_origin_act: { ...w.ward.human_origin_act, presence_proof: undefined } };
  const r = validateWardUnderMae(noPresence, mae, ctx);
  assert.ok(r.violations.some((v) => v.invariant === "ward-requires-presence-proof"));
});

// 16 ------------------------------------------------------------------------
test("a Governor cannot author beyond its delegated scope", () => {
  const w = fixtures.buildPayments();
  const ctx = context({ keyring: w.keyring });
  const gov = w.governor!;
  assert.equal(validateGovernorInstrument(gov, w.ward, { kind: "authority-envelope", action_classes: ["payment.refund"] }, ctx).ok, true);
  const r = validateGovernorInstrument(gov, w.ward, { kind: "authority-envelope", action_classes: ["payment.wire.external"] }, ctx);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.invariant === "governor-cannot-exceed-delegated-scope"));
});

// 17 ------------------------------------------------------------------------
test("cross-Ward federation fails without a trust relationship", () => {
  const untrusted = fixtures.buildFederation(false);
  const d = evaluateFederatedCommit(untrusted.store, untrusted.propose().request, opts(untrusted));
  assert.notEqual(d.decision, "Allow");
  assert.ok(d.violated_invariants.includes("federation-requires-trust-relationship"));
});

test("federation fails closed with no trust bridge at all", () => {
  const w = fixtures.buildFederation(true);
  const d = evaluateFederatedCommit(w.store, w.propose({ withAgreement: false }).request, opts(w));
  assert.equal(d.decision, "FailClosed");
  assert.ok(d.reasons.includes("federation-agreement-not-found"));
});

test("a valid federation trust bridge allows the federated act", () => {
  const w = fixtures.buildFederation(true);
  const d = evaluateFederatedCommit(w.store, w.propose().request, opts(w));
  assert.equal(d.decision, "Allow");
});

// 18 ------------------------------------------------------------------------
test("authority determination occurs before the attribution record", () => {
  // Ontology: authority precedes attribution.
  assert.equal(precedes("authority", "attribution"), true);
  assert.equal(precedes("attribution", "authority"), false);

  const w = fixtures.buildPayments();
  const { request, warrant } = w.propose();
  const d = evaluateCommit(w.store, request, opts(w));
  const rec = w.store.getGelChain().find((r) => r.gel_record_id === d.gel_record_id)!;
  // The warrant is consumed (authority spent) and the proof is embedded in the
  // receipt, with consumption no later than the receipt timestamp.
  assert.equal(w.store.getWarrant(warrant.warrant_id)!.consumption_state, "Consumed");
  assert.ok(rec.warrant_consumption_proof);
  assert.equal(rec.warrant_consumption_proof!.warrant_id, warrant.warrant_id);
  assert.ok(Date.parse(rec.warrant_consumption_proof!.consumed_at) <= Date.parse(rec.timestamp));
});

// scenario coverage -------------------------------------------------------
test("payments: refund within limit allowed; over threshold escalates", () => {
  const w = fixtures.buildPayments();
  assert.equal(evaluateCommit(w.store, w.propose().request, opts(w)).decision, "Allow");
  const esc = w.propose({ parameters: { amount: 480, currency: "USD", customer: "X" } });
  assert.equal(evaluateCommit(w.store, esc.request, opts(w)).decision, "Escalate");
});

test("payments: refund over the envelope monetary limit is denied", () => {
  const w = fixtures.buildPayments();
  const over = w.propose({ parameters: { amount: 750, currency: "USD", customer: "X" } });
  const d = evaluateCommit(w.store, over.request, opts(w));
  assert.notEqual(d.decision, "Allow");
  assert.ok(d.violated_invariants.includes("warrant-cannot-broaden-envelope"));
});

test("payments: a cumulative spend budget is enforced across acts", () => {
  const w = fixtures.buildPayments(); // envelope cumulative budget is 1000 USD; each refund is 412
  const o = opts(w);
  assert.equal(evaluateCommit(w.store, w.propose().request, o).decision, "Allow"); // spent 412
  assert.equal(evaluateCommit(w.store, w.propose().request, o).decision, "Allow"); // spent 824
  const third = evaluateCommit(w.store, w.propose().request, o); // would reach 1236 > 1000
  assert.notEqual(third.decision, "Allow");
  assert.ok(third.violated_invariants.includes("envelope-cumulative-budget-exceeded"));
});

test("warrant issuance quota (max_warrants) is enforced", () => {
  const w = fixtures.buildPayments();
  const env = createAuthorityEnvelope(w.store, w.keyring, w.keyId, {
    ...w.envelope,
    authority_envelope_id: "env-quota-1",
    warrant_issuance_rules: { ...w.envelope.warrant_issuance_rules, max_warrants: 1 },
  });
  const issue = () =>
    issueWarrant(w.store, w.keyring, w.keyId, {
      mae_id: w.mae.mae_id,
      ward_id: w.ward.ward_id,
      authority_envelope_id: env.authority_envelope_id,
      issued_by: "payments.controller",
      action: { proposed_action_id: newId("act"), action_type: "payment.refund", actor: "agent.payments", resource: "customer:X", parameters: { amount: 10, currency: "USD" } },
      context: {},
      telemetry: {},
      validity_seconds: 300,
    });
  issue();
  assert.throws(() => issue(), /warrant-quota-exceeded/);
});

test("healthcare: agent may draft but never submit a medication order", () => {
  const w = fixtures.buildHealthcare();
  assert.equal(evaluateCommit(w.store, w.propose().request, opts(w)).decision, "Allow");
  const submit = w.propose({ action_type: "medication.order.submit", parameters: { drug: "amoxicillin", dose_mg: 500 } });
  const d = evaluateCommit(w.store, submit.request, opts(w));
  assert.notEqual(d.decision, "Allow");
  assert.ok(d.violated_invariants.includes("warrant-cannot-exceed-authority-envelope"));
});

test("denied and escalated commits still leave GEL evidence", () => {
  const w = fixtures.buildHealthcare();
  const before = w.store.gelLength();
  const submit = w.propose({ action_type: "medication.order.submit", parameters: { drug: "x", dose_mg: 1 } });
  const d = evaluateCommit(w.store, submit.request, opts(w));
  assert.equal(d.decision, "Deny");
  assert.equal(w.store.gelLength(), before + 1);
});

test("a store snapshot round-trips, preserving warrant consumption and the GEL chain", () => {
  const w = fixtures.buildPayments();
  const { request } = w.propose();
  const first = evaluateCommit(w.store, request, opts(w));
  assert.equal(first.decision, "Allow");

  // Snapshot -> restore into a fresh store (simulating a process restart).
  const snapshot = JSON.parse(JSON.stringify(w.store.toSnapshot()));
  const restored = new InMemoryGovernanceStore();
  restored.loadSnapshot(snapshot);

  // The GEL chain survived intact...
  assert.equal(verifyGelChain(restored.getGelChain(), w.keyring).ok, true);
  // ...and the consumed warrant cannot be replayed against the restored store.
  const replay = evaluateCommit(restored, request, opts(w));
  assert.notEqual(replay.decision, "Allow");
  assert.ok(replay.violated_invariants.includes("warrant-non-replayable"));
});

test("chainMetrics aggregates the store after a commit", () => {
  const w = fixtures.buildPayments();
  evaluateCommit(w.store, w.propose().request, opts(w));
  const m = chainMetrics(w.store, w.keyring);
  assert.equal(m.maes, 1);
  assert.equal(m.wards, 1);
  assert.equal(m.authority_envelopes, 1);
  assert.equal(m.warrants.consumed, 1);
  assert.equal(m.gel.integrity_ok, true);
  assert.ok(m.gel.by_decision.Allow >= 1);
  assert.ok(m.spend.some((s) => s.currency === "USD" && s.amount === 412));
});

test("openApiSpec is a well-formed OpenAPI 3 document for the chain", () => {
  const spec = openApiSpec() as any;
  assert.equal(spec.openapi, "3.0.3");
  assert.ok(spec.info?.title);
  assert.ok(spec.paths["/v2/commit"]?.post, "missing /v2/commit");
  assert.ok(spec.paths["/v2/gel"]?.get, "missing /v2/gel");
  assert.ok(spec.paths["/v2/federated-commit"]?.post, "missing /v2/federated-commit");
  assert.ok(spec.paths["/v2/rotate-signing-key"]?.post, "missing /v2/rotate-signing-key");
});

test("scopeSnapshot isolates a tenant's primitives", () => {
  const snapshot = {
    maes: [{ mae_id: "mae-a", tenant_id: "acme" }, { mae_id: "mae-b", tenant_id: "globex" }],
    wards: [{ ward_id: "w-a", mae_id: "mae-a" }, { ward_id: "w-b", mae_id: "mae-b" }],
    governors: [{ governor_id: "g-a", ward_id: "w-a" }],
    envelopes: [{ authority_envelope_id: "e-a", mae_id: "mae-a" }, { authority_envelope_id: "e-b", mae_id: "mae-b" }],
    warrants: [{ warrant_id: "wr-a", mae_id: "mae-a" }, { warrant_id: "wr-b", mae_id: "mae-b" }],
    gates: [],
    agreements: [],
    gel: [{ mae_id: "mae-a" }, { mae_id: "mae-b" }],
    consumedNonces: [],
    spend: [{ envelopeId: "e-a", currency: "USD", amount: 100 }, { envelopeId: "e-b", currency: "USD", amount: 200 }],
  } as never;
  const acme = scopeSnapshot(snapshot, { tenantId: "acme" });
  assert.equal(acme.maes.length, 1);
  assert.equal(acme.wards.length, 1);
  assert.equal(acme.envelopes.length, 1);
  assert.equal(acme.gel.length, 1);
  assert.equal(acme.governors.length, 1);
  assert.equal(acme.spend.length, 1);
  assert.equal(acme.spend[0].envelopeId, "e-a");
  const byMae = scopeSnapshot(snapshot, { maeId: "mae-b" });
  assert.equal(byMae.envelopes[0].authority_envelope_id, "e-b");
  assert.equal(byMae.gel.length, 1);
});

test("chainMetrics scopes counts to a single MAE while integrity stays global", () => {
  const w = fixtures.buildPayments();
  evaluateCommit(w.store, w.propose().request, opts(w));
  const mine = chainMetrics(w.store, w.keyring, { maeId: w.mae.mae_id });
  assert.equal(mine.wards, 1);
  assert.ok(mine.gel.records >= 1);
  const other = chainMetrics(w.store, w.keyring, { maeId: "mae-does-not-exist" });
  assert.equal(other.wards, 0);
  assert.equal(other.gel.records, 0);
  assert.equal(other.gel.integrity_ok, true); // integrity is a global ledger property
});

test("an evidence bundle exports and verifies offline; tampering is detected", () => {
  const w = fixtures.buildPayments();
  evaluateCommit(w.store, w.propose().request, opts(w));
  const bundle = exportEvidence(w.store, w.keyring, w.keyId);
  assert.equal(verifyEvidenceBundle(bundle, w.keyring).ok, true);
  // tamper a record after export -> offline verification must fail
  const tampered = { ...bundle, records: bundle.records.map((r, i) => (i === 0 ? { ...r, action: "tampered" } : r)) };
  assert.equal(verifyEvidenceBundle(tampered, w.keyring).ok, false);
});

test("execution outcomes are recorded as a separate ledger entry", () => {
  const w = fixtures.buildPayments();
  const d = evaluateCommit(w.store, w.propose().request, opts(w));
  assert.equal(d.decision, "Allow");
  const exec = recordExecutionOutcome(w.store, opts(w), d, { status: "success", recorded_at: nowIso(), summary: "refund settled" });
  assert.equal(exec.record_kind, "execution");
  assert.equal(verifyGelChain(w.store.getGelChain(), w.keyring).ok, true);
});
