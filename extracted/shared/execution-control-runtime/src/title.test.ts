import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type TitleRuntimeSnapshot,
  type WardManifest,
  ApprovalStore,
  digitalSignatureToAction,
  dmvSubmissionToAction,
  evaluateExecutionControl,
  evaluateTitleSafetyInvariants,
  exportTitleEvidenceBundle,
  fraudCheckToAction,
  lienReleaseToAction,
  lenderWorkflowToAction,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  nmvtisToAction,
  registrationToAction,
  titleAdapterToAction,
  titleHistorianWriteToAction,
  titleSnapshotToRuntimeRegister,
  titleTransactionToAction,
  verifyEvidenceBundle,
  verifyTitleEvidenceBundle
} from "./index.js";

const now = "2026-05-25T15:00:00.000Z";

const snapshot: TitleRuntimeSnapshot = {
  asset_id: "TX-LIEN-MT-2026-05-25-001",
  asset_type: "lien-transaction",
  transaction_id: "TX-LIEN-MT-2026-05-25-001",
  transaction_type: "lien-release",
  jurisdiction: "MT",
  state_rule_version: "demo-2026.05.25",
  vin: "1HGCM82633A123456",
  year: 2023,
  make: "Ford",
  model: "F-150",
  odometer: 25430,
  title_state: "MT",
  title_number: "MT-T-2024-998877",
  title_status: "active",
  brand_status: "clean",
  actor_id: "actor:lender-signer-jane",
  organization_id: "lender-prairie-credit",
  organization_kind: "lender",
  lender_id: "lender-prairie-credit",
  lender_active: true,
  lender_elt_participant: true,
  signer_authorized: true,
  authority_envelope_unrevoked: true,
  warrant_unused: true,
  warrant_age_ms: 1000,
  nmvtis_passed: true,
  theft_flag_clear: true,
  odometer_disclosed: true,
  identity_verified: true,
  identity_confidence_score: 0.92,
  fraud_risk_score: 0.15,
  lien_exists: true,
  lien_release_authority_active: true,
  required_forms_present: true,
  required_forms_list: ["lien-release-statement"],
  vin_inspection_present: true,
  state_supports_elt: true,
  state_supports_digital_signature: true,
  digital_signature_accepted: true,
  operator_qualified: true,
  telemetry_age_ms: 800,
  policy_version: "0.1.0"
};

const ward: WardManifest = {
  ward_id: "ward-title-mt-lender-ops",
  name: "Montana Lender Title Operations (DEMO)",
  sovereignty_context: "state-mt-mvd-authority",
  authority_domain: "title-transaction-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:title-orchestrator"],
  physical_bounds: {
    permitted_jurisdictions: ["MT", "OR", "CA", "TX", "FL"],
    permitted_transaction_types: ["lien-release", "lien-perfection", "title-transfer", "title-correction", "registration-renewal", "registration-interstate", "digital-signature-execute", "dmv-submission"],
    permitted_organization_kinds: ["dealer", "lender", "dmv", "title-agent"],
    max_fraud_risk_score: 0.7,
    min_identity_confidence_score: 0.8,
    max_warrant_age_ms: 600000,
    max_telemetry_age_ms: 60000,
    require_signer_authorized: true,
    require_nmvtis_passed: true,
    require_theft_flag_clear: true,
    require_odometer_disclosed: true,
    require_identity_verified: true,
    require_authority_envelope_unrevoked: true,
    require_warrant_unused: true,
    require_required_forms_present: true,
    require_state_supports_elt: true,
    require_lien_exists: true,
    require_lien_release_authority_active: true,
    require_lender_active: true,
    require_lender_elt_participant: true,
    require_operator_qualified: true
  },
  criticality: "safety_critical",
  classification: { level: "CUI", caveats: ["TITLE_OPS"] }
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-title-operations-001",
  ward_id: ward.ward_id,
  subject: "agent:title-orchestrator",
  allowed_actions: [
    "lien.release.submit",
    "lien.perfection.submit",
    "title.transfer.submit",
    "title.correction.submit",
    "registration.renewal.submit",
    "registration.interstate.submit",
    "digital_signature.execute",
    "dmv.submit",
    "nmvtis.check.run",
    "fraud.check.run",
    "historian.record.write"
  ],
  denied_actions: [
    "title.override_lien_release",
    "title.bypass_nmvtis",
    "title.bypass_theft_check",
    "title.bypass_state_rules",
    "title.override_dealer_license",
    "title.override_odometer_disclosure",
    "title.disable_identity_verification",
    "warrant.reuse_attempt"
  ],
  constraints: {
    required_runtime_registers: [
      "telemetry.transaction_id",
      "telemetry.transaction_type",
      "telemetry.jurisdiction",
      "telemetry.signer_authorized",
      "telemetry.nmvtis_passed",
      "telemetry.theft_flag_clear",
      "telemetry.odometer_disclosed",
      "telemetry.identity_verified",
      "telemetry.authority_envelope_unrevoked",
      "telemetry.warrant_unused",
      "telemetry.required_forms_present",
      "telemetry.state_supports_elt",
      "telemetry.operator_qualified"
    ],
    dual_control: {
      actions: ["title.transfer.submit", "title.correction.submit", "registration.interstate.submit", "dmv.submit"],
      required: 2,
      ttl_ms: 600000
    },
    budget: { maxCallsPerWindow: 5000, windowMs: 3600000 }
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-title-ops-root",
  classification: { level: "CUI", caveats: ["TITLE_OPS"] }
};

const ctx = {
  action_id: "act-title-001",
  ward_id: ward.ward_id,
  subject: envelope.subject,
  requested_at: now,
  request_id: "req-title-001",
  snapshot,
  classification: { level: "CUI" as const, caveats: ["TITLE_OPS"] }
};

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-title-")), "gel.jsonl");
}

function expectRefuse(snapshotOverride: Partial<TitleRuntimeSnapshot>, label: string) {
  const action = lienReleaseToAction(
    { lender_id: "lender-prairie-credit", vin: snapshot.vin, operation: "release" },
    { ...ctx, action_id: `act-${Math.random().toString(36).slice(2)}`, snapshot: { ...snapshot, ...snapshotOverride } }
  );
  const r = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(r.decision, "REFUSE", `${label} should REFUSE`);
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"), `${label} should fail a physical invariant`);
}

test("title adapter builders produce Canonical Governed Actions", () => {
  const lien = lienReleaseToAction({ lender_id: "lender-prairie-credit", vin: snapshot.vin, operation: "release" }, ctx);
  assert.equal(lien.action_type, "lien.release.submit");
  assert.equal(lien.params.adapter, "elt-lien");
  assert.equal(lien.params.jurisdiction, "MT");

  const transfer = titleTransactionToAction({ transaction_id: "TX-1", operation: "transfer" }, { ...ctx, action_id: "act-title-002" });
  assert.equal(transfer.action_type, "title.transfer.submit");

  const renewal = registrationToAction({ transaction_id: "TX-2", operation: "renewal" }, { ...ctx, action_id: "act-title-003" });
  assert.equal(renewal.action_type, "registration.renewal.submit");

  const sig = digitalSignatureToAction({ document_id: "DOC-1", document_type: "title-application", operation: "execute" }, { ...ctx, action_id: "act-title-004" });
  assert.equal(sig.action_type, "digital_signature.execute");

  const lender = lenderWorkflowToAction({ lender_id: "lender-prairie-credit", operation: "lien-release" }, { ...ctx, action_id: "act-title-005" });
  assert.equal(lender.action_type, "lender.lien-release");

  const dmv = dmvSubmissionToAction({ endpoint_id: "MT-MVD-PROD", operation: "submit", packet_ref: "PKT-1" }, { ...ctx, action_id: "act-title-006" });
  assert.equal(dmv.action_type, "dmv.submit");

  const fraud = fraudCheckToAction({ check_id: "FC-1", operation: "run-fraud-check" }, { ...ctx, action_id: "act-title-007" });
  assert.equal(fraud.action_type, "fraud.check.run");

  const nmvtis = nmvtisToAction({ vin: snapshot.vin, operation: "check" }, { ...ctx, action_id: "act-title-008" });
  assert.equal(nmvtis.action_type, "nmvtis.check.run");

  const historian = titleHistorianWriteToAction({ historian_id: "HIST-T", stream: "title", record_type: "audit-marker", payload: { note: "warrant issued" } }, { ...ctx, action_id: "act-title-009" });
  assert.equal(historian.action_type, "historian.record.write");

  const viaDispatcher = titleAdapterToAction({ kind: "elt-lien", request: { lender_id: "lender-prairie-credit", vin: snapshot.vin, operation: "release" } }, { ...ctx, action_id: "act-title-010" });
  assert.equal(viaDispatcher.action_type, "lien.release.submit");
});

test("Scenario 1: Clean Montana lien release -> ALLOW", () => {
  const action = lienReleaseToAction({ lender_id: "lender-prairie-credit", vin: snapshot.vin, operation: "release" }, ctx);
  const r = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(r.decision, "ALLOW");
  assert.ok(r.warrant, "ALLOW must produce a warrant");
  assert.equal(r.ledger_verification.ok, true, "GEL entry must verify");
});

test("Scenario 2: Unauthorized lender employee attempts lien release -> REFUSE", () => {
  expectRefuse({ signer_authorized: false }, "unauthorized signer");
});

test("Scenario 3: Interstate transfer is dual-controlled -> ESCALATE without approval store", () => {
  const action = titleTransactionToAction(
    { transaction_id: "TX-INTERSTATE-OR-MT-001", operation: "transfer" },
    { ...ctx, action_id: "act-title-scn-3", snapshot: { ...snapshot, transaction_type: "title-transfer", asset_type: "title-transaction", jurisdiction: "MT" } }
  );
  const r = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(r.decision, "ESCALATE");
  assert.deepEqual(r.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
});

test("Scenario 4: Digital signature with revoked authority envelope -> REFUSE", () => {
  const action = digitalSignatureToAction(
    { document_id: "DOC-CA-001", document_type: "title-application", operation: "execute" },
    { ...ctx, action_id: "act-title-scn-4", snapshot: { ...snapshot, transaction_type: "digital-signature-execute", asset_type: "signature-transaction", authority_envelope_unrevoked: false, jurisdiction: "CA" } }
  );
  const r = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("Scenario 5: Dealer transaction with fraud risk over threshold -> REFUSE", () => {
  expectRefuse({ fraud_risk_score: 0.85, organization_kind: "dealer", dealer_id: "DLR-TX-007", dealer_license_active: true, dealer_state: "TX", jurisdiction: "TX" }, "fraud over threshold");
});

test("Scenario 6: Title correction is dual-controlled -> ESCALATE without approval store", () => {
  const correctionWard: WardManifest = {
    ...ward,
    physical_bounds: {
      ...ward.physical_bounds,
      // Title correction in this scenario doesn't require an active lien — relax that constraint
      require_lien_exists: false,
      require_lien_release_authority_active: false,
      require_lender_active: false,
      require_lender_elt_participant: false,
      require_state_supports_elt: false
    }
  };
  const action = titleTransactionToAction(
    { transaction_id: "TX-CORRECTION-FL-001", operation: "correction" },
    { ...ctx, action_id: "act-title-scn-6", snapshot: { ...snapshot, transaction_type: "title-correction", asset_type: "title-transaction", jurisdiction: "FL" } }
  );
  const r = evaluateExecutionControl({ ward: correctionWard, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(r.decision, "ESCALATE");
  assert.deepEqual(r.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
});

test("Scenario 7: Suspended dealer license -> REFUSE", () => {
  const dealerWard: WardManifest = { ...ward, physical_bounds: { ...ward.physical_bounds, require_dealer_license_active: true } };
  const action = titleTransactionToAction(
    { transaction_id: "TX-DEALER-MT-001", operation: "transfer" },
    { ...ctx, action_id: "act-title-scn-7", snapshot: { ...snapshot, transaction_type: "title-transfer", asset_type: "title-transaction", organization_kind: "dealer", dealer_id: "DLR-MT-013", dealer_license_active: false, dealer_state: "MT" } }
  );
  const r = evaluateExecutionControl({ ward: dealerWard, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("title commit gate refuses a broad set of integrity hazards", () => {
  expectRefuse({ nmvtis_passed: false }, "NMVTIS not passed");
  expectRefuse({ theft_flag_clear: false }, "theft flag set");
  expectRefuse({ odometer_disclosed: false }, "odometer not disclosed");
  expectRefuse({ identity_verified: false }, "identity not verified");
  expectRefuse({ identity_confidence_score: 0.5 }, "identity confidence below floor");
  expectRefuse({ fraud_risk_score: 0.9 }, "fraud above max");
  expectRefuse({ authority_envelope_unrevoked: false }, "envelope revoked");
  expectRefuse({ warrant_unused: false }, "warrant already consumed (replay)");
  expectRefuse({ warrant_age_ms: 1200000 }, "warrant stale");
  expectRefuse({ lien_exists: false }, "lien release without an active lien");
  expectRefuse({ lien_release_authority_active: false }, "lien-release authority inactive");
  expectRefuse({ lender_active: false }, "lender inactive");
  expectRefuse({ lender_elt_participant: false }, "lender not ELT participant");
  expectRefuse({ required_forms_present: false }, "required forms missing");
  expectRefuse({ state_supports_elt: false }, "state does not support ELT for this");
  expectRefuse({ operator_qualified: false }, "operator not qualified");
  expectRefuse({ jurisdiction: "ZZ" }, "jurisdiction outside permitted list");
  expectRefuse({ transaction_type: "fictional-type" }, "transaction type outside permitted list");
});

test("title hard interlocks refuse even if mistakenly allowed", () => {
  const unsafeEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "title.bypass_nmvtis"], denied_actions: [] };
  const action = lienReleaseToAction(
    { lender_id: "lender-prairie-credit", vin: snapshot.vin, operation: "release", action_type: "title.bypass_nmvtis" },
    { ...ctx, action_id: "act-title-interlock-001" }
  );
  const direct = evaluateTitleSafetyInvariants(action, ward);
  assert.equal(direct.ok, false);
  assert.ok(direct.detail.includes("hard title-transaction integrity interlock"));

  const r = evaluateExecutionControl({ ward, authorityEnvelope: unsafeEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  assert.equal(r.warrant, undefined);
});

test("warrant.reuse_attempt action type is hard-interlocked", () => {
  const reuseEnvelope = { ...envelope, allowed_actions: [...envelope.allowed_actions, "warrant.reuse_attempt"], denied_actions: [] };
  const action = lienReleaseToAction(
    { lender_id: "lender-prairie-credit", vin: snapshot.vin, operation: "release", action_type: "warrant.reuse_attempt" },
    { ...ctx, action_id: "act-title-reuse-001" }
  );
  const r = evaluateExecutionControl({ ward, authorityEnvelope: reuseEnvelope, action, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(r.decision, "REFUSE");
  assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
});

test("dual-control interstate title transfer issues a Warrant after plural approval", () => {
  const approvalStore = ApprovalStore.memory();
  const action = titleTransactionToAction(
    { transaction_id: "TX-INTERSTATE-OR-MT-002", operation: "transfer" },
    { ...ctx, action_id: "act-title-dc-001", snapshot: { ...snapshot, transaction_type: "title-transfer", asset_type: "title-transaction" } }
  );
  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  const pending = approvalStore.list(now)[0];
  approvalStore.vote(pending.request_id, "operator:title-supervisor", "approve", "OR title clean, MT VIN inspection completed, NMVTIS clear", now);
  approvalStore.vote(pending.request_id, "operator:compliance-officer", "approve", "odometer disclosed, identity verified, no theft flag", now);
  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledgerPath(), now, replayProtection: false, approvalStore });
  assert.equal(second.decision, "ALLOW");
  assert.ok(second.warrant);
});

test("title Evidence Bundle wraps execution evidence with title context and verifies", () => {
  const action = lienReleaseToAction({ lender_id: "lender-prairie-credit", vin: snapshot.vin, operation: "release" }, ctx);
  const ledger = ledgerPath();
  const r = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false, runtimeRegister: titleSnapshotToRuntimeRegister(snapshot) });
  const bundle = exportTitleEvidenceBundle({
    ledgerPath: ledger,
    ward,
    authorityEnvelope: envelope,
    recordId: r.gel_record.record_id,
    warrant: r.warrant,
    exportedAt: now,
    title: {
      actor_id: "actor:lender-signer-jane",
      organization_id: "lender-prairie-credit",
      organization_kind: "lender",
      jurisdiction: "MT",
      state_rule_version: "demo-2026.05.25",
      transaction_id: "TX-LIEN-MT-2026-05-25-001",
      transaction_type: "lien-release",
      vin: snapshot.vin,
      title_state: "MT",
      controller_id: "operator:title-supervisor",
      fraud_risk_score: 0.15,
      identity_confidence_score: 0.92,
      regulatory_evidence_profile: ["STATE_ELT", "STATE_TITLE_STATUTES", "NMVTIS", "ODOMETER_DISCLOSURE", "DLDV", "UCC_ARTICLE_9"],
      rule_validation_state: "demonstration",
      pre_checks: [{ name: "lender ELT participant", ok: true }, { name: "lien exists", ok: true }, { name: "NMVTIS passed", ok: true }, { name: "theft flag clear", ok: true }, { name: "signer authorized", ok: true }],
      post_checks: [{ name: "warrant single-use consumed", ok: true }],
      redacted_fields: ["buyer_phone", "exact_address"]
    }
  });
  assert.equal(bundle.bundle_version, "aristotle.title-evidence.v1");
  assert.equal(bundle.verification.ok, true);
  assert.equal(verifyTitleEvidenceBundle(bundle).ok, true);
});

test("GEL chain integrity: tampering with a ledger entry breaks verification", () => {
  const action = lienReleaseToAction({ lender_id: "lender-prairie-credit", vin: snapshot.vin, operation: "release" }, ctx);
  const ledger = ledgerPath();
  const r1 = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action, ledgerPath: ledger, now, replayProtection: false });
  assert.equal(r1.decision, "ALLOW");
  assert.equal(r1.ledger_verification.ok, true);

  // Tamper: rewrite one line of the JSONL ledger.
  const original = readFileSync(ledger, "utf8");
  const lines = original.split("\n").filter(Boolean);
  const idx = lines.length - 1;
  const rec = JSON.parse(lines[idx]) as { decision_reason?: string };
  rec.decision_reason = "tampered post-hoc — should not validate";
  lines[idx] = JSON.stringify(rec);
  writeFileSync(ledger, lines.join("\n") + "\n", "utf8");

  // Re-evaluate using a fresh action against the SAME (now-tampered) ledger; verification must fail.
  const followup = lienReleaseToAction(
    { lender_id: "lender-prairie-credit", vin: snapshot.vin, operation: "release" },
    { ...ctx, action_id: "act-title-tamper-002" }
  );
  const r2 = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: followup, ledgerPath: ledger, now, replayProtection: false });
  assert.equal(r2.ledger_verification.ok, false, "tampered ledger must not verify");
});

test("sample title Ward and action fixtures load and drive the real gate", () => {
  const base = path.resolve(process.cwd(), "examples", "title");
  const sampleWard = loadWardManifest(path.join(base, "ward.mt_lender_ops.yaml"));
  const sampleEnvelope = loadAuthorityEnvelope(path.join(base, "authority_envelope.title_orchestrator.yaml"));
  const allowed = loadCanonicalAction(path.join(base, "actions", "allow_lien_release_clean_mt.json"));
  const refuseUnauth = loadCanonicalAction(path.join(base, "actions", "refuse_unauthorized_signer.json"));
  const refuseEnvelope = loadCanonicalAction(path.join(base, "actions", "refuse_revoked_envelope.json"));

  const ok = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: allowed, ledgerPath: ledgerPath(), now, replayProtection: false });
  assert.equal(ok.decision, "ALLOW");
  assert.ok(ok.warrant);

  for (const [act, label] of [[refuseUnauth, "unauthorized signer"], [refuseEnvelope, "revoked envelope"]] as const) {
    const r = evaluateExecutionControl({ ward: sampleWard, authorityEnvelope: sampleEnvelope, action: act, ledgerPath: ledgerPath(), now, replayProtection: false });
    assert.equal(r.decision, "REFUSE", `${label} should REFUSE`);
    assert.ok(r.reason_codes.includes("PHYSICAL_INVARIANT_FAILED"));
  }
});
