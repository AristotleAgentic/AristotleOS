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
  issueWarrant
} from "@aristotle/execution-control-runtime";
import {
  verifyWarrantPublic,
  createVerifierHandler,
  SimpleNonceSeenSet,
  REQUEST_FORMAT,
  RESPONSE_FORMAT,
  type VerifyWarrantRequest
} from "./index.js";

const NOW = "2026-05-24T12:00:00.000Z";

function signer() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

const ward: WardManifest = {
  ward_id: "w", name: "w", sovereignty_context: "t", authority_domain: "d",
  policy_version: "1.0.0", permitted_subjects: ["agent:a"]
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae", ward_id: "w", subject: "agent:a",
  allowed_actions: ["x.do"], denied_actions: [], constraints: {},
  expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};
const action: CanonicalActionInput = {
  action_id: "a1", ward_id: "w", subject: "agent:a", action_type: "x.do",
  target: "t", params: {}, requested_at: NOW, request_id: "r1"
};

function freshWarrant(s = signer(), now = NOW, ttl = 60) {
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
  const warrant = issueWarrant(decision, action, envelope, now, s, ttl)!;
  return { warrant, hash: decision.canonical_action_hash, signer: s };
}

test("verifyWarrantPublic: ALLOWs a fresh warrant with the issuer's key in trustedKeyIds", () => {
  const { warrant, hash, signer: s } = freshWarrant();
  const result = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: hash, now: NOW },
    { trustedKeyIds: [s.key_id] }
  );
  assert.equal(result.ok, true, `reason: ${result.reason}`);
  assert.equal(result.format, RESPONSE_FORMAT);
  assert.equal(result.warrant_id, warrant.warrant_id);
});

test("verifyWarrantPublic: REFUSEs when the warrant's signing key is not in trustedKeyIds", () => {
  const { warrant, hash } = freshWarrant();
  const result = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: hash, now: NOW },
    { trustedKeyIds: ["totally-different-key"] }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "UNTRUSTED_SIGNING_KEY");
});

test("verifyWarrantPublic: REFUSEs when canonical_action_hash doesn't match the warrant", () => {
  const { warrant, signer: s } = freshWarrant();
  const result = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: "sha256:wrong-hash", now: NOW },
    { trustedKeyIds: [s.key_id] }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ACTION_HASH_MISMATCH");
});

test("verifyWarrantPublic: REFUSEs an expired warrant (now > expires_at)", () => {
  const { warrant, hash, signer: s } = freshWarrant();
  const result = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: hash, now: "2030-01-01T00:00:00.000Z" },
    { trustedKeyIds: [s.key_id] }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "WARRANT_EXPIRED");
});

test("verifyWarrantPublic: replay-protection — second verify of the same nonce returns WARRANT_REPLAYED", () => {
  const { warrant, hash, signer: s } = freshWarrant();
  const seen = new SimpleNonceSeenSet();
  const r1 = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: hash, now: NOW },
    { trustedKeyIds: [s.key_id], seenNonces: seen }
  );
  assert.equal(r1.ok, true);
  // Mark consumed so the second attempt's nonce is "seen"
  if (warrant.nonce) seen.add(warrant.nonce);
  const r2 = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant, canonical_action_hash: hash, now: NOW },
    { trustedKeyIds: [s.key_id], seenNonces: seen }
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "WARRANT_REPLAYED");
});

test("createVerifierHandler: POST /verify ALLOWs and returns 200 with the verification body", async () => {
  const { warrant, hash, signer: s } = freshWarrant();
  const handler = createVerifierHandler({ trustedKeyIds: [s.key_id] });
  const req: VerifyWarrantRequest = { format: REQUEST_FORMAT, warrant, canonical_action_hash: hash, now: NOW };
  const res = await handler.handle({ method: "POST", url: "/verify", rawBody: JSON.stringify(req) });
  assert.equal(res.status, 200);
  assert.equal(res.contentType, "application/json");
  const body = JSON.parse(res.body) as { ok: boolean; warrant_id: string; format: string };
  assert.equal(body.ok, true);
  assert.equal(body.format, RESPONSE_FORMAT);
  assert.equal(body.warrant_id, warrant.warrant_id);
});

test("createVerifierHandler: refused warrant returns 422 with reason in body", async () => {
  const { warrant, hash } = freshWarrant();
  const handler = createVerifierHandler({ trustedKeyIds: ["wrong-key"] });
  const req: VerifyWarrantRequest = { format: REQUEST_FORMAT, warrant, canonical_action_hash: hash, now: NOW };
  const res = await handler.handle({ method: "POST", url: "/verify", rawBody: JSON.stringify(req) });
  assert.equal(res.status, 422);
  const body = JSON.parse(res.body) as { ok: boolean; reason: string };
  assert.equal(body.ok, false);
  assert.equal(body.reason, "UNTRUSTED_SIGNING_KEY");
});

test("createVerifierHandler: non-POST returns 405", async () => {
  const handler = createVerifierHandler({ trustedKeyIds: [] });
  const res = await handler.handle({ method: "GET", url: "/verify", rawBody: "" });
  assert.equal(res.status, 405);
  const body = JSON.parse(res.body) as { reason: string };
  assert.equal(body.reason, "MethodNotAllowed");
});

test("createVerifierHandler: malformed JSON returns 400 / MalformedJson", async () => {
  const handler = createVerifierHandler({ trustedKeyIds: [] });
  const res = await handler.handle({ method: "POST", url: "/verify", rawBody: "{ broken" });
  assert.equal(res.status, 400);
  const body = JSON.parse(res.body) as { reason: string };
  assert.equal(body.reason, "MalformedJson");
});

test("createVerifierHandler: unsupported format returns 400 / UnsupportedFormat", async () => {
  const handler = createVerifierHandler({ trustedKeyIds: [] });
  const res = await handler.handle({
    method: "POST", url: "/verify",
    rawBody: JSON.stringify({ format: "totally.different.v9", warrant: {}, canonical_action_hash: "x" })
  });
  assert.equal(res.status, 400);
  const body = JSON.parse(res.body) as { reason: string };
  assert.equal(body.reason, "UnsupportedFormat");
});

test("verifyWarrantPublic: signature tamper -> SIGNATURE_MISMATCH", () => {
  const { warrant, hash, signer: s } = freshWarrant();
  const tampered: Warrant = { ...warrant, nonce: "00000000-0000-0000-0000-000000000000" };
  const result = verifyWarrantPublic(
    { format: REQUEST_FORMAT, warrant: tampered, canonical_action_hash: hash, now: NOW },
    { trustedKeyIds: [s.key_id] }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "SIGNATURE_MISMATCH");
});
