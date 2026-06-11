/**
 * Issuer→key binding (multi-tenant forge resistance).
 *
 * Before the fix in this change, `verifyObjectSignatures` accepted ANY
 * signature whose `keyId` lived in the global keyring. In a multi-tenant
 * deployment where tenant A and tenant B share a keyring (which is the
 * realistic shape of a `HmacKeyring`-backed gate or a JWKS that aggregates
 * trust anchors), tenant B's key could be used to sign tenant A's Ward,
 * Authority Envelope, or Warrant — and validation would pass.
 *
 * The fix derives an `allowedKeyIds` set from `mae.signing_keys` and passes
 * it down to every validator. Each of these tests stages exactly that
 * cross-tenant forge attack and asserts that validation now refuses.
 *
 * The fix is opt-in by configuration: if `mae.signing_keys` is empty, the
 * legacy behavior ("any keyring-known key is acceptable") is preserved so
 * fixtures that never declared a key set keep working. Operators close the
 * gap by populating `signing_keys`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HmacKeyring,
  fixtures,
  signObject,
  validateMae,
  validateWardUnderMae,
  validateEnvelopeUnderWard,
  validateWarrant,
  verifyObjectSignatures,
  context,
  type AuthorityEnvelope,
  type MetaAuthorityEnvelope,
  type Signature,
  type Warrant,
  type Ward
} from "./index.js";

const FOREIGN_KEY = "foreign-tenant-key";
const FOREIGN_SECRET = "foreign-tenant-secret";

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function withForgedSignature<T extends { signatures: Signature[] }>(artifact: T, keyring: HmacKeyring, foreignKeyId: string): T {
  const clone = deepClone(artifact);
  // signObject canonicalizes over everything except the signatures field, so the
  // mint produces a structurally valid signature — only the keyId is foreign.
  const forged = signObject(keyring, foreignKeyId, clone as unknown as Record<string, unknown>);
  clone.signatures = [forged];
  return clone;
}

test("verifyObjectSignatures rejects a signature whose keyId is not in allowedKeyIds", () => {
  const keyring = new HmacKeyring({ "tenant-a": "a-secret", [FOREIGN_KEY]: FOREIGN_SECRET });
  const artifact = { kind: "demo", payload: 1, signatures: [] as Signature[] };
  const ownSig = signObject(keyring, "tenant-a", artifact);
  const forgedSig = signObject(keyring, FOREIGN_KEY, artifact);

  // No constraint -> both signatures verify.
  assert.equal(verifyObjectSignatures(keyring, { ...artifact, signatures: [ownSig] }), true);
  assert.equal(verifyObjectSignatures(keyring, { ...artifact, signatures: [forgedSig] }), true);

  // With allowedKeyIds = {tenant-a} -> own verifies, foreign refuses.
  const allowed = new Set(["tenant-a"]);
  assert.equal(verifyObjectSignatures(keyring, { ...artifact, signatures: [ownSig] }, allowed), true);
  assert.equal(verifyObjectSignatures(keyring, { ...artifact, signatures: [forgedSig] }, allowed), false);

  // A mixed signature set with even one foreign signature refuses (all-or-nothing).
  assert.equal(verifyObjectSignatures(keyring, { ...artifact, signatures: [ownSig, forgedSig] }, allowed), false);
});

test("MAE cross-tenant forge: a foreign key cannot sign an MAE for someone else's tenant", () => {
  const world = fixtures.buildPayments();
  (world.keyring as HmacKeyring).addKey(FOREIGN_KEY, FOREIGN_SECRET);

  // The genuine MAE validates.
  const ok = validateMae(world.mae, context({ keyring: world.keyring }));
  assert.equal(ok.ok, true, `genuine MAE should validate, got ${JSON.stringify(ok)}`);

  // Now stage the forge: replace the MAE's signature with a structurally valid
  // signature minted by the foreign key. The MAE itself still declares only
  // its own signing_keys, so the issuer→key binding refuses the forgery.
  const forgedMae = withForgedSignature(world.mae, world.keyring as HmacKeyring, FOREIGN_KEY);
  const result = validateMae(forgedMae as MetaAuthorityEnvelope, context({ keyring: world.keyring }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    const names = result.violations.map((v) => v.invariant);
    assert.ok(names.includes("mae-signature-invalid"), `expected mae-signature-invalid, got ${names.join(",")}`);
  }
});

test("Ward cross-tenant forge: a foreign key cannot sign a Ward under another tenant's MAE", () => {
  const world = fixtures.buildPayments();
  (world.keyring as HmacKeyring).addKey(FOREIGN_KEY, FOREIGN_SECRET);

  // Sanity: the genuine Ward validates.
  const ok = validateWardUnderMae(world.ward, world.mae, context({ keyring: world.keyring }));
  assert.equal(ok.ok, true, `genuine Ward should validate, got ${JSON.stringify(ok)}`);

  const forgedWard = withForgedSignature(world.ward, world.keyring as HmacKeyring, FOREIGN_KEY);
  const result = validateWardUnderMae(forgedWard as Ward, world.mae, context({ keyring: world.keyring }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    const names = result.violations.map((v) => v.invariant);
    assert.ok(names.includes("ward-signature-invalid"), `expected ward-signature-invalid, got ${names.join(",")}`);
  }
});

test("Envelope cross-tenant forge: a foreign key cannot sign an Authority Envelope under another tenant's MAE", () => {
  const world = fixtures.buildPayments();
  (world.keyring as HmacKeyring).addKey(FOREIGN_KEY, FOREIGN_SECRET);

  const ok = validateEnvelopeUnderWard(world.envelope, world.ward, world.mae, context({ keyring: world.keyring }));
  assert.equal(ok.ok, true, `genuine Envelope should validate, got ${JSON.stringify(ok)}`);

  const forgedEnv = withForgedSignature(world.envelope, world.keyring as HmacKeyring, FOREIGN_KEY);
  const result = validateEnvelopeUnderWard(forgedEnv as AuthorityEnvelope, world.ward, world.mae, context({ keyring: world.keyring }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    const names = result.violations.map((v) => v.invariant);
    assert.ok(names.includes("envelope-signature-invalid"), `expected envelope-signature-invalid, got ${names.join(",")}`);
  }
});

test("Warrant cross-tenant forge: a foreign key cannot sign a Warrant under another tenant's MAE", () => {
  const world = fixtures.buildPayments();
  (world.keyring as HmacKeyring).addKey(FOREIGN_KEY, FOREIGN_SECRET);

  const proposed = world.propose();
  const ok = validateWarrant(proposed.warrant, world.envelope, world.ward, world.mae, proposed.request, context({ keyring: world.keyring }));
  assert.equal(ok.ok, true, `genuine Warrant should validate, got ${JSON.stringify(ok)}`);

  // Forge: same Warrant content, but signed with the foreign key. Every other
  // binding (mae_id, ward_id, envelope_id, parameters_hash) is correct — only
  // the signing key is wrong. Before the fix this passed; now it refuses.
  const forgedWarrant = withForgedSignature(proposed.warrant, world.keyring as HmacKeyring, FOREIGN_KEY);
  const result = validateWarrant(forgedWarrant as Warrant, world.envelope, world.ward, world.mae, proposed.request, context({ keyring: world.keyring }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    const names = result.violations.map((v) => v.invariant);
    assert.ok(names.includes("warrant-signature-invalid"), `expected warrant-signature-invalid, got ${names.join(",")}`);
  }
});

test("Empty mae.signing_keys preserves the legacy 'any-key' behavior (backward compat)", () => {
  const world = fixtures.buildPayments();
  (world.keyring as HmacKeyring).addKey(FOREIGN_KEY, FOREIGN_SECRET);

  // Construct a non-tenant-bound MAE shape: mae with signing_keys=[] keeps the
  // legacy permissive behavior so existing fixtures/deployments that never
  // declared a key set still work. (Operators close the gap by populating
  // signing_keys; this branch only documents the migration affordance.)
  const permissiveMae = { ...deepClone(world.mae), signing_keys: [] } as MetaAuthorityEnvelope;

  // Forge a Ward sig under the permissive MAE: with no allowed-key set
  // declared, the binding is not enforced and the forgery passes verifyObjectSignatures.
  // (The Ward still fails other validators — mae-traces, policy-hash mismatch —
  // because we mutated the MAE; this test is scoped to demonstrate that the
  // signature-binding step itself defers to legacy behavior when unconfigured.)
  const forgedWard = withForgedSignature(world.ward, world.keyring as HmacKeyring, FOREIGN_KEY);
  assert.equal(
    verifyObjectSignatures(world.keyring, forgedWard as unknown as Record<string, unknown> & { signatures: Signature[] }),
    true,
    "with allowedKeyIds undefined, any keyring-known key is acceptable (legacy behavior)"
  );
  // And with allowedKeyIds set derived from permissiveMae (empty), verifyObjectSignatures
  // is called without a constraint by the validators path. The unit assertion:
  // a Set-with-zero-members would be strict (rejecting everything); the validators
  // helper specifically returns undefined when signing_keys is empty to avoid that
  // brick-wall behavior on legacy deployments. So validateWardUnderMae against the
  // permissive MAE does NOT raise ward-signature-invalid on the forged ward.
  const result = validateWardUnderMae(forgedWard as Ward, permissiveMae, context({ keyring: world.keyring }));
  if (!result.ok) {
    const names = result.violations.map((v) => v.invariant);
    assert.ok(!names.includes("ward-signature-invalid"), `legacy mode should NOT raise ward-signature-invalid, got ${names.join(",")}`);
  }
});
