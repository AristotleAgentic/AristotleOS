import test from "node:test";
import assert from "node:assert/strict";
import { HmacKeyring, InMemoryGovernanceStore, scopeSnapshot, tenantSummaries } from "@aristotle/governance-core";
import {
  bootstrapTenant,
  bootstrapTenantWithLocalKeyring,
  rotateTenantKey,
  pruneRetiredTenantKey,
  suspendTenant,
  revokeTenant,
  exportTenantSnapshot,
  importTenantSnapshot
} from "./index.js";

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

// ---------------------------------------------------------------------------
// Tenant lifecycle primitives
// ---------------------------------------------------------------------------

test("rotateTenantKey: adds new key to signing_keys and re-signs the MAE", () => {
  const keyring = new HmacKeyring({ "key-acme-v1": "secret-v1" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme-v1"
  });
  assert.equal(result.mae.signing_keys.length, 1);
  // Add a new key into the keyring then rotate.
  keyring.addKey("key-acme-v2", "secret-v2");
  const rotation = rotateTenantKey({
    tenant_id: "acme", store: result.store, keyring,
    oldKeyId: "key-acme-v1", newKeyId: "key-acme-v2"
  });
  assert.equal(rotation.mae_id, result.mae.mae_id);
  assert.equal(rotation.added_key_id, "key-acme-v2");
  assert.equal(rotation.old_key_retained, true);
  // Look up the MAE post-rotation
  const post = result.store.getMae(result.mae.mae_id);
  assert.ok(post);
  assert.equal(post?.signing_keys.length, 2);
  assert.ok(post?.signing_keys.some((k) => k.key_id === "key-acme-v1"));
  assert.ok(post?.signing_keys.some((k) => k.key_id === "key-acme-v2"));
});

test("rotateTenantKey: rejects when newKeyId is already in signing_keys", () => {
  const keyring = new HmacKeyring({ "key-acme-v1": "secret-v1" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme-v1"
  });
  keyring.addKey("key-acme-v1-dup", "secret-dup");
  assert.throws(() => rotateTenantKey({
    tenant_id: "acme", store: result.store, keyring,
    oldKeyId: "key-acme-v1", newKeyId: "key-acme-v1"
  }), /already in signing_keys/);
});

test("pruneRetiredTenantKey: removes the retired key and re-signs under active", () => {
  const keyring = new HmacKeyring({ "key-acme-v1": "secret-v1" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme-v1"
  });
  keyring.addKey("key-acme-v2", "secret-v2");
  rotateTenantKey({
    tenant_id: "acme", store: result.store, keyring,
    oldKeyId: "key-acme-v1", newKeyId: "key-acme-v2"
  });
  const pruned = pruneRetiredTenantKey({
    tenant_id: "acme", store: result.store, keyring,
    activeKeyId: "key-acme-v2", retiredKeyId: "key-acme-v1"
  });
  assert.equal(pruned.removed_key_id, "key-acme-v1");
  const post = result.store.getMae(result.mae.mae_id);
  assert.equal(post?.signing_keys.length, 1);
  assert.equal(post?.signing_keys[0].key_id, "key-acme-v2");
});

test("pruneRetiredTenantKey: refuses to prune the active key", () => {
  const keyring = new HmacKeyring({ "key-acme-v1": "secret-v1", "key-acme-v2": "secret-v2" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme-v1"
  });
  rotateTenantKey({
    tenant_id: "acme", store: result.store, keyring,
    oldKeyId: "key-acme-v1", newKeyId: "key-acme-v2"
  });
  assert.throws(() => pruneRetiredTenantKey({
    tenant_id: "acme", store: result.store, keyring,
    activeKeyId: "key-acme-v2", retiredKeyId: "key-acme-v2"
  }), /must differ/);
});

test("suspendTenant: latches suspended_at on Wards and revocation_state on Envelopes", () => {
  const keyring = new HmacKeyring({ "key-acme": "secret" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme"
  });
  const s = suspendTenant({ tenant_id: "acme", store: result.store, reason: "compromise-suspected" });
  assert.ok(s.suspended_at);
  assert.equal(s.affected.wards, 1);
  assert.equal(s.affected.envelopes, 1);
  // Idempotency: re-suspending finds 0 to flip
  const s2 = suspendTenant({ tenant_id: "acme", store: result.store, reason: "x" });
  assert.equal(s2.affected.wards, 0);
  assert.equal(s2.affected.envelopes, 0);
  // Confirm state in the store
  const post = result.store.getWard(result.ward.ward_id);
  assert.ok(post?.suspended_at);
  const postEnv = result.store.getEnvelope(result.envelope.authority_envelope_id);
  assert.equal(postEnv?.revocation_state, "suspended");
});

test("revokeTenant: latches revoked_at on Wards and revocation_state=revoked on Envelopes", () => {
  const keyring = new HmacKeyring({ "key-acme": "secret" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme"
  });
  const r = revokeTenant({ tenant_id: "acme", store: result.store, reason: "tenant-terminated" });
  assert.ok(r.revoked_at);
  assert.equal(r.affected.wards, 1);
  const post = result.store.getWard(result.ward.ward_id);
  assert.ok(post?.revoked_at);
});

test("exportTenantSnapshot + importTenantSnapshot: tenant migrates between stores", () => {
  const keyring = new HmacKeyring({ "key-acme": "secret" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme"
  });
  const snapshot = exportTenantSnapshot({ tenant_id: "acme", store: result.store });
  assert.equal(snapshot.tenant_id, "acme");
  assert.equal(snapshot.mae.mae_id, result.mae.mae_id);
  assert.equal(snapshot.wards.length, 1);
  assert.equal(snapshot.envelopes.length, 1);
  // Import into a fresh empty store
  const target = new InMemoryGovernanceStore();
  const imp = importTenantSnapshot({ snapshot, store: target });
  assert.equal(imp.tenant_id, "acme");
  assert.equal(imp.imported.wards, 1);
  assert.equal(imp.imported.envelopes, 1);
  // Confirm via scopeSnapshot
  const scoped = scopeSnapshot(target.toSnapshot(), { tenantId: "acme" });
  assert.equal(scoped.maes.length, 1);
  assert.equal(scoped.wards.length, 1);
  assert.equal(scoped.envelopes.length, 1);
});

test("importTenantSnapshot: refuses to overwrite without overwrite:true", () => {
  const keyring = new HmacKeyring({ "key-acme": "secret" });
  const result = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.constitution",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme"
  });
  const snapshot = exportTenantSnapshot({ tenant_id: "acme", store: result.store });
  assert.throws(() => importTenantSnapshot({ snapshot, store: result.store }), /collision/);
  // With overwrite:true it succeeds
  const r = importTenantSnapshot({ snapshot, store: result.store, overwrite: true });
  assert.equal(r.imported.mae, 1);
});

test("revokeTenant: only affects the named tenant (other tenants untouched)", () => {
  const keyring = new HmacKeyring({ "key-a": "sa", "key-b": "sb" });
  const a = bootstrapTenant({
    tenant_id: "alpha", organization_name: "A", issuer: "a.c",
    bootstrap_subject: "agent:a", keyring, keyId: "key-a"
  });
  const b = bootstrapTenant({
    tenant_id: "beta", organization_name: "B", issuer: "b.c",
    bootstrap_subject: "agent:b", keyring, keyId: "key-b",
    store: a.store
  });
  revokeTenant({ tenant_id: "alpha", store: a.store, reason: "x" });
  const aWard = a.store.getWard(a.ward.ward_id);
  const bWard = a.store.getWard(b.ward.ward_id);
  assert.ok(aWard?.revoked_at);
  assert.equal(bWard?.revoked_at, undefined);
});

test("tenant summaries reflect post-import state across stores", () => {
  const keyring = new HmacKeyring({ "key-acme": "secret" });
  const source = bootstrapTenant({
    tenant_id: "acme", organization_name: "Acme", issuer: "acme.c",
    bootstrap_subject: "agent:a", keyring, keyId: "key-acme"
  });
  const snap = exportTenantSnapshot({ tenant_id: "acme", store: source.store });
  const target = new InMemoryGovernanceStore();
  importTenantSnapshot({ snapshot: snap, store: target });
  const summaries = tenantSummaries(target.toSnapshot());
  const acme = summaries.find((s) => s.tenant_id === "acme");
  assert.ok(acme);
  assert.equal(acme?.maes, 1);
  assert.equal(acme?.wards, 1);
  assert.equal(acme?.authority_envelopes, 1);
});
