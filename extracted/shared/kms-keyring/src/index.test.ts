import test from "node:test";
import assert from "node:assert/strict";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  evaluateCommitGate,
  issueWarrant,
  verifyWarrant
} from "@aristotle/execution-control-runtime";
import {
  AwsKmsKeyringStub,
  InMemoryKmsKeyring,
  VaultKeyringStub,
  resolveSigner
} from "./index.js";

// ---------------------------------------------------------------------------
// InMemoryKmsKeyring — full implementation
// ---------------------------------------------------------------------------

test("InMemoryKmsKeyring: addKey + getKey round-trip; produces a working signer", () => {
  const kr = new InMemoryKmsKeyring();
  assert.deepEqual(kr.listKeys(), []);
  const h1 = kr.addKey("warrant-signer");
  assert.equal(h1.name, "warrant-signer");
  assert.equal(h1.algorithm, "ed25519");
  assert.equal(h1.ephemeral, true);
  assert.ok(h1.keyId.startsWith("ed25519:"));
  assert.ok(h1.publicKeyPem.includes("PUBLIC KEY"));
  assert.deepEqual(kr.listKeys(), ["warrant-signer"]);
  const fetched = kr.getKey("warrant-signer");
  assert.equal(fetched.keyId, h1.keyId);
  const signer = fetched.signer();
  assert.equal(signer.key_id, h1.keyId);
  const sig = signer.sign("hello world");
  assert.ok(typeof sig === "string" && sig.length > 0);
});

test("InMemoryKmsKeyring: addKey twice with the same name throws", () => {
  const kr = new InMemoryKmsKeyring();
  kr.addKey("x");
  assert.throws(() => kr.addKey("x"), /already exists/);
});

test("InMemoryKmsKeyring: getKey for unknown name throws", () => {
  const kr = new InMemoryKmsKeyring();
  assert.throws(() => kr.getKey("nope"), /no key named 'nope'/);
});

test("InMemoryKmsKeyring: removeKey then getKey throws", () => {
  const kr = new InMemoryKmsKeyring();
  kr.addKey("doomed");
  kr.removeKey("doomed");
  assert.throws(() => kr.getKey("doomed"), /no key named 'doomed'/);
});

test("InMemoryKmsKeyring: two adds produce two distinct keyIds", () => {
  const kr = new InMemoryKmsKeyring();
  const a = kr.addKey("a");
  const b = kr.addKey("b");
  assert.notEqual(a.keyId, b.keyId);
  assert.notEqual(a.publicKeyPem, b.publicKeyPem);
});

// ---------------------------------------------------------------------------
// End-to-end: KMS-resolved signer drives a full evaluateCommitGate +
// issueWarrant + verifyWarrant cycle. Proves the keyring is wire-
// compatible with the substrate.
// ---------------------------------------------------------------------------

const NOW = "2026-05-24T12:00:00.000Z";
const ward: WardManifest = {
  ward_id: "w-kms", name: "KMS Ward", sovereignty_context: "test",
  authority_domain: "test-ops", policy_version: "1.0.0",
  permitted_subjects: ["agent:a"]
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-kms", ward_id: "w-kms", subject: "agent:a",
  allowed_actions: ["x.do"], denied_actions: [], constraints: {},
  expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};
const action: CanonicalActionInput = {
  action_id: "a-kms", ward_id: "w-kms", subject: "agent:a",
  action_type: "x.do", target: "t", params: {},
  requested_at: NOW, request_id: "r-kms"
};

test("Integration: InMemoryKmsKeyring signs a Warrant that verifyWarrant accepts", () => {
  const kr = new InMemoryKmsKeyring();
  kr.addKey("test-warrant-signer");
  const signer = resolveSigner(kr, "test-warrant-signer");
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now: NOW });
  const warrant = issueWarrant(decision, action, envelope, NOW, signer, 60);
  assert.ok(warrant, "ALLOW must produce a Warrant");
  const result = verifyWarrant(warrant!, decision.canonical_action_hash, NOW, {
    trustedKeyIds: [signer.key_id]
  });
  assert.equal(result.ok, true, "KMS-signed warrant must verify");
});

// ---------------------------------------------------------------------------
// AwsKmsKeyringStub — interface contract; sign() throws with a useful message
// ---------------------------------------------------------------------------

test("AwsKmsKeyringStub: getKey returns a handle; signer().sign() throws a documented error", () => {
  const kr = new AwsKmsKeyringStub({
    region: "us-east-1",
    keys: { "prod-signer": "arn:aws:kms:us-east-1:123456789012:key/abcd-1234" }
  });
  assert.deepEqual(kr.listKeys(), ["prod-signer"]);
  const handle = kr.getKey("prod-signer");
  assert.equal(handle.algorithm, "ed25519");
  assert.equal(handle.ephemeral, false);
  assert.ok(handle.keyId.startsWith("aws-kms:us-east-1:arn:aws:kms"));
  const signer = handle.signer();
  assert.throws(() => signer.sign("anything"), /aws-kms signer for 'prod-signer' is a stub/);
});

test("AwsKmsKeyringStub: addKey without externalKeyRef throws", () => {
  const kr = new AwsKmsKeyringStub({ region: "us-east-1" });
  assert.throws(() => kr.addKey("k"), /externalKeyRef: <KMS-key-ARN>/);
});

test("AwsKmsKeyringStub: addKey + removeKey lifecycle works", () => {
  const kr = new AwsKmsKeyringStub({ region: "us-east-1" });
  kr.addKey("a", { externalKeyRef: "arn:aws:kms:us-east-1:000000000000:key/x" });
  assert.deepEqual(kr.listKeys(), ["a"]);
  kr.removeKey("a");
  assert.deepEqual(kr.listKeys(), []);
});

// ---------------------------------------------------------------------------
// VaultKeyringStub — same contract
// ---------------------------------------------------------------------------

test("VaultKeyringStub: getKey returns a handle; signer().sign() throws documented error", () => {
  const kr = new VaultKeyringStub({
    endpoint: "https://vault.internal:8200",
    token: "s.fake-token-for-test",
    keys: { "edge-signer": "warrant-key" }
  });
  const handle = kr.getKey("edge-signer");
  assert.equal(handle.keyId, "vault-transit:transit/warrant-key");
  assert.equal(handle.ephemeral, false);
  const signer = handle.signer();
  assert.throws(() => signer.sign("x"), /vault-transit signer for 'edge-signer' is a stub/);
});

test("VaultKeyringStub: custom mountPath threads through the key_id", () => {
  const kr = new VaultKeyringStub({
    endpoint: "https://vault.internal:8200",
    token: "t",
    mountPath: "alt-transit",
    keys: { k: "k-name" }
  });
  assert.equal(kr.getKey("k").keyId, "vault-transit:alt-transit/k-name");
});
