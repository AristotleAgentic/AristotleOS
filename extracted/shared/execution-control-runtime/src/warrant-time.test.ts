import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  type Warrant,
  createEd25519Signer,
  evaluateCommitGate,
  issueWarrant,
  stableStringify,
  verifyWarrant
} from "./index.js";

const NOW = "2026-05-24T12:00:00.000Z";
function signer() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({ privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() });
}

const ward: WardManifest = { ward_id: "w", name: "w", sovereignty_context: "t", authority_domain: "d", policy_version: "1.0.0", permitted_subjects: ["agent:a"] };
const envelope: AuthorityEnvelope = { envelope_id: "ae", ward_id: "w", subject: "agent:a", allowed_actions: ["x.do"], denied_actions: [], constraints: {}, expires_at: "2099-12-31T23:59:59Z", issuer: "root" };
const action: CanonicalActionInput = { action_id: "a1", ward_id: "w", subject: "agent:a", action_type: "x.do", target: "t", params: {}, requested_at: NOW, request_id: "r1" };

function freshWarrant(s = signer(), now = NOW, ttl = 60) {
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now, s, ttl)!;
  return { warrant, hash: decision.canonical_action_hash, signer: s };
}

test("issued warrants carry a signed nonce; tampering the nonce breaks the signature", () => {
  const { warrant, hash } = freshWarrant();
  assert.ok(warrant.nonce && warrant.nonce.length > 0, "warrant has a nonce");
  assert.equal(verifyWarrant(warrant, hash, NOW).ok, true);
  const tampered: Warrant = { ...warrant, nonce: "00000000-0000-0000-0000-000000000000" };
  assert.equal(verifyWarrant(tampered, hash, NOW).reason, "SIGNATURE_MISMATCH");
});

test("a warrant issued in the future (skewed issuer) is WARRANT_NOT_YET_VALID at an earlier verify time", () => {
  const future = "2026-05-24T12:10:00.000Z"; // issuer 10 min ahead
  const { warrant, hash } = freshWarrant(signer(), future, 600);
  assert.equal(verifyWarrant(warrant, hash, NOW).reason, "WARRANT_NOT_YET_VALID");
  // within the default 60s skew it is accepted
  const slightly = "2026-05-24T12:10:30.000Z";
  const w2 = freshWarrant(signer(), slightly, 600);
  assert.equal(verifyWarrant(w2.warrant, w2.hash, "2026-05-24T12:10:00.000Z").ok, true);
});

test("a verifier enforces its own lifetime ceiling regardless of the signed TTL", () => {
  const { warrant, hash } = freshWarrant(signer(), NOW, 3600); // issuer minted a 1h warrant
  assert.equal(verifyWarrant(warrant, hash, NOW, { maxLifetimeMs: 60_000 }).reason, "WARRANT_LIFETIME_EXCEEDED");
  assert.equal(verifyWarrant(warrant, hash, NOW, { maxLifetimeMs: 7_200_000 }).ok, true);
});

test("a verifier with a seen-nonce set rejects replay of the warrant artifact", () => {
  const { warrant, hash } = freshWarrant();
  const seen = new Set<string>([warrant.nonce!]);
  assert.equal(verifyWarrant(warrant, hash, NOW, { seenNonces: seen }).reason, "WARRANT_REPLAYED");
  assert.equal(verifyWarrant(warrant, hash, NOW, { seenNonces: new Set<string>() }).ok, true);
});

test("backward compatible: a pre-nonce warrant still verifies (undefined nonce drops from material)", () => {
  const s = signer();
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now: NOW });
  const expires_at = new Date(Date.parse(NOW) + 60_000).toISOString();
  const fields = {
    action_type: action.action_type,
    authority_envelope_id: envelope.envelope_id,
    canonical_action_hash: decision.canonical_action_hash,
    expires_at,
    issued_at: NOW,
    issuer: envelope.issuer,
    subject: action.subject,
    ward_id: action.ward_id
  };
  // reproduce the legacy (no-nonce) signed material exactly
  const legacyMaterial = stableStringify({ ...fields, decision: "ALLOW", single_use: true });
  const legacyWarrant: Warrant = {
    warrant_id: "wrn-legacy",
    ward_id: action.ward_id,
    authority_envelope_id: envelope.envelope_id,
    canonical_action_hash: decision.canonical_action_hash,
    subject: action.subject,
    action_type: action.action_type,
    decision: "ALLOW",
    issued_at: NOW,
    expires_at,
    single_use: true,
    consumed: false,
    issuer: envelope.issuer,
    signature: s.sign(legacyMaterial),
    signature_algorithm: s.algorithm,
    signing_key_id: s.key_id,
    signing_public_key: s.public_key_pem
    // no `nonce`
  };
  assert.equal(verifyWarrant(legacyWarrant, decision.canonical_action_hash, NOW).ok, true);
});
