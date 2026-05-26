import test from "node:test";
import assert from "node:assert/strict";
import { HmacKeyring, scopeSnapshot, tenantSummaries } from "@aristotle/governance-core";
import { bootstrapTenant, bootstrapTenantWithLocalKeyring } from "./index.js";

test("bootstrapTenant: produces a MAE/Ward/Envelope, all tagged with tenant_id", () => {
  const keyring = new HmacKeyring({ "key-acme": "acme-secret" });
  const result = bootstrapTenant({
    tenant_id: "acme",
    organization_name: "Acme Robotics",
    issuer: "acme.constitution",
    bootstrap_subject: "agent:bootstrap.acme",
    keyring, keyId: "key-acme"
  });
  assert.equal(result.mae.tenant_id, "acme");
  assert.ok(result.mae.mae_id);
  assert.ok(result.ward.ward_id);
  assert.equal(result.ward.mae_id, result.mae.mae_id);
  assert.equal(result.envelope.mae_id, result.mae.mae_id);
  assert.equal(result.envelope.ward_id, result.ward.ward_id);
  assert.equal(result.envelope.subject, "agent:bootstrap.acme");
  assert.equal(result.summary.artifacts_signed, 3);
});

test("bootstrapTenant: MAE signing_keys contains the supplied keyId — closes cross-tenant forge gap", () => {
  const keyring = new HmacKeyring({ "key-tenantA": "secretA" });
  const result = bootstrapTenant({
    tenant_id: "tenantA", organization_name: "Tenant A", issuer: "tenantA.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-tenantA"
  });
  assert.equal(result.mae.signing_keys.length, 1);
  assert.equal(result.mae.signing_keys[0].key_id, "key-tenantA");
});

test("bootstrapTenant: appoints governor when accountable_party != sovereign_root", () => {
  const keyring = new HmacKeyring({ "key-acme": "acme-secret" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a",
    sovereign_root: "acme.board",
    accountable_party: "acme.steward",
    keyring, keyId: "key-acme"
  });
  assert.ok(result.governor);
  assert.equal(result.governor?.subject, "acme.steward");
  assert.equal(result.governor?.ward_id, result.ward.ward_id);
});

test("bootstrapTenant: no governor minted when accountable_party === sovereign_root", () => {
  const keyring = new HmacKeyring({ "key-acme": "acme-secret" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a",
    sovereign_root: "acme.board",
    accountable_party: "acme.board",
    keyring, keyId: "key-acme"
  });
  assert.equal(result.governor, undefined);
});

test("bootstrapTenant: warns under HmacKeyring (demonstration only)", () => {
  const keyring = new HmacKeyring({ "key-acme": "acme-secret" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme"
  });
  assert.ok(result.summary.warning);
  assert.match(result.summary.warning ?? "", /demonstration/i);
});

test("two tenants bootstrapped into the same store are isolated by scopeSnapshot", () => {
  const keyring = new HmacKeyring({ "key-a": "secret-a", "key-b": "secret-b" });
  const a = bootstrapTenant({
    tenant_id: "alpha", organization_name: "Alpha", issuer: "alpha.constitution",
    bootstrap_subject: "agent:alpha.boot", keyring, keyId: "key-a"
  });
  const b = bootstrapTenant({
    tenant_id: "beta", organization_name: "Beta", issuer: "beta.constitution",
    bootstrap_subject: "agent:beta.boot", keyring, keyId: "key-b",
    store: a.store // share the store
  });
  const snap = a.store.toSnapshot();
  // Both tenants visible in raw snapshot
  assert.equal(snap.maes.length, 2);
  // Scoped to alpha: only one MAE, one Ward, one Envelope.
  const alphaOnly = scopeSnapshot(snap, { tenantId: "alpha" });
  assert.equal(alphaOnly.maes.length, 1);
  assert.equal(alphaOnly.maes[0].tenant_id, "alpha");
  assert.equal(alphaOnly.wards.length, 1);
  assert.equal(alphaOnly.envelopes.length, 1);
  // Scoped to beta: same.
  const betaOnly = scopeSnapshot(snap, { tenantId: "beta" });
  assert.equal(betaOnly.maes.length, 1);
  assert.equal(betaOnly.maes[0].tenant_id, "beta");
  // Sanity: tenant summaries report both
  const summaries = tenantSummaries(snap);
  const ids = summaries.map((s) => s.tenant_id).sort();
  assert.deepEqual(ids, ["alpha", "beta"]);
  assert.notEqual(a.mae.mae_id, b.mae.mae_id);
});

test("bootstrapTenantWithLocalKeyring: spins up a fresh tenant in one call", () => {
  const r = bootstrapTenantWithLocalKeyring({
    tenant_id: "demo",
    organization_name: "Demo Co",
    issuer: "demo.constitution",
    bootstrap_subject: "agent:demo.boot"
  });
  assert.ok(r.mae.mae_id);
  assert.ok(r.ward.ward_id);
  assert.ok(r.envelope.authority_envelope_id);
  assert.equal(r.keyId, "key-demo");
});

test("bootstrapTenant: prohibited action classes default to a safe sentinel set", () => {
  const r = bootstrapTenantWithLocalKeyring({
    tenant_id: "x", organization_name: "X", issuer: "x.c", bootstrap_subject: "agent:x"
  });
  assert.ok(r.mae.authority_envelope_rules.prohibited_action_classes.includes("payment.wire.external"));
  assert.ok(r.envelope.prohibited_action_classes.includes("payment.wire.external"));
});

test("bootstrapTenant: federation disabled by default", () => {
  const r = bootstrapTenantWithLocalKeyring({
    tenant_id: "x", organization_name: "X", issuer: "x.c", bootstrap_subject: "agent:x"
  });
  assert.equal(r.mae.federation_rules.federation_allowed, false);
  assert.deepEqual(r.mae.federation_rules.trusted_mae_ids, []);
});

test("bootstrapTenant: federation enabled honors trusted_mae_ids and exportable_evidence", () => {
  const r = bootstrapTenantWithLocalKeyring({
    tenant_id: "x", organization_name: "X", issuer: "x.c", bootstrap_subject: "agent:x",
    federation: { enable: true, trusted_mae_ids: ["mae-partner"], exportable_evidence: true }
  });
  assert.equal(r.mae.federation_rules.federation_allowed, true);
  assert.deepEqual(r.mae.federation_rules.trusted_mae_ids, ["mae-partner"]);
  assert.equal(r.mae.federation_rules.exportable_evidence, true);
});
