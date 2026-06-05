import test from "node:test";
import assert from "node:assert/strict";
import {
  createSign,
  generateKeyPairSync,
  createHash,
  type KeyObject
} from "node:crypto";
import {
  REKOR_ANCHOR_KIND,
  canonicalizeSetPayload,
  verifyRekorAnchor,
  type RekorInclusionProof
} from "./index.js";
import type { RekorAnchorEnvelope } from "@aristotle/sigstore-rekor";
import type { TimestampAnchor } from "@aristotle/gel-timestamp";

// ---------------------------------------------------------------------------
// Fixtures: a Rekor-shaped anchor with a SET we can verify against a
// keypair we generate in the test.
// ---------------------------------------------------------------------------

function mkRekorKeypair() {
  // Rekor uses ECDSA P-256 in production. Tests use the same curve to
  // exercise the real verification path.
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

function signSet(privateKey: KeyObject, payload: string): string {
  const s = createSign("sha256");
  s.update(payload);
  s.end();
  return s.sign(privateKey).toString("base64");
}

function buildAnchor(
  recordHash: string,
  envelopeOverrides: Partial<RekorAnchorEnvelope>,
  privateKey: KeyObject
): TimestampAnchor {
  const envelope: RekorAnchorEnvelope = {
    rekor_url: "https://rekor.example",
    uuid: "deadbeef".repeat(8),
    log_index: 42,
    integrated_time: 1_750_000_000,
    signed_entry_timestamp_b64: "",
    entry_body_b64: Buffer.from(JSON.stringify({ kind: "hashedrekord" })).toString("base64"),
    ...envelopeOverrides
  };
  // Compute the canonical SET payload Rekor would have signed.
  const payload = canonicalizeSetPayload({
    body: envelope.entry_body_b64,
    integratedTime: envelope.integrated_time,
    logIndex: envelope.log_index,
    logID: ""
  });
  envelope.signed_entry_timestamp_b64 = signSet(privateKey, payload);
  return {
    kind: REKOR_ANCHOR_KIND,
    timestamp: new Date(envelope.integrated_time * 1000).toISOString(),
    tsa_key_id: `sigstore-rekor:${envelope.rekor_url}`,
    record_hash: recordHash,
    signature: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64")
  };
}

// ---------------------------------------------------------------------------
// Inspect baseline (delegates to @aristotle/sigstore-rekor)
// ---------------------------------------------------------------------------

test("verifyRekorAnchor: wrong kind -> ok=false with inspect reason", () => {
  const { privateKey, publicKeyPem } = mkRekorKeypair();
  const good = buildAnchor("rh-1", {}, privateKey);
  const wrongKind: TimestampAnchor = { ...good, kind: "rfc3161" };
  const r = verifyRekorAnchor("rh-1", wrongKind, { rekorPublicKeyPem: publicKeyPem });
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes("expected kind 'sigstore-rekor'"));
});

test("verifyRekorAnchor: record_hash mismatch -> ok=false", () => {
  const { privateKey, publicKeyPem } = mkRekorKeypair();
  const anchor = buildAnchor("rh-real", {}, privateKey);
  const r = verifyRekorAnchor("rh-WRONG", anchor, { rekorPublicKeyPem: publicKeyPem });
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes("record_hash mismatch"));
});

test("verifyRekorAnchor: malformed envelope -> ok=false", () => {
  const { publicKeyPem } = mkRekorKeypair();
  const bad: TimestampAnchor = {
    kind: REKOR_ANCHOR_KIND,
    timestamp: new Date().toISOString(),
    tsa_key_id: "sigstore-rekor:x",
    record_hash: "rh",
    signature: "not-base64-or-json"
  };
  const r = verifyRekorAnchor("rh", bad, { rekorPublicKeyPem: publicKeyPem });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// SET signature verification
// ---------------------------------------------------------------------------

test("verifyRekorAnchor: well-formed anchor signed by the supplied key -> ok=true + setVerified", () => {
  const { privateKey, publicKeyPem } = mkRekorKeypair();
  const anchor = buildAnchor("rh-ok", {}, privateKey);
  const r = verifyRekorAnchor("rh-ok", anchor, { rekorPublicKeyPem: publicKeyPem });
  assert.equal(r.ok, true, `expected ok; reason=${r.reason}`);
  assert.equal(r.setVerified, true);
  assert.equal(r.inclusionVerified, undefined);  // no proof supplied
  assert.equal(r.envelope?.log_index, 42);
});

test("verifyRekorAnchor: SET signed by a different key -> ok=false setVerified=false", () => {
  const kpReal = mkRekorKeypair();
  const kpWrong = mkRekorKeypair();
  const anchor = buildAnchor("rh", {}, kpReal.privateKey);
  const r = verifyRekorAnchor("rh", anchor, { rekorPublicKeyPem: kpWrong.publicKeyPem });
  assert.equal(r.ok, false);
  assert.equal(r.setVerified, false);
  assert.ok(r.reason?.includes("SET verification failed"));
});

test("verifyRekorAnchor: tampered envelope after signing -> SET no longer matches", () => {
  const { privateKey, publicKeyPem } = mkRekorKeypair();
  const anchor = buildAnchor("rh", {}, privateKey);
  // Parse envelope, mutate logIndex, re-encode.
  const env = JSON.parse(Buffer.from(anchor.signature, "base64").toString("utf8")) as RekorAnchorEnvelope;
  env.log_index = 9999;
  const tampered: TimestampAnchor = {
    ...anchor,
    signature: Buffer.from(JSON.stringify(env), "utf8").toString("base64")
  };
  const r = verifyRekorAnchor("rh", tampered, { rekorPublicKeyPem: publicKeyPem });
  assert.equal(r.ok, false);
  assert.equal(r.setVerified, false);
});

test("verifyRekorAnchor: missing signed_entry_timestamp -> ok=false", () => {
  const { privateKey, publicKeyPem } = mkRekorKeypair();
  const anchor = buildAnchor("rh", {}, privateKey);
  const env = JSON.parse(Buffer.from(anchor.signature, "base64").toString("utf8")) as RekorAnchorEnvelope;
  env.signed_entry_timestamp_b64 = "";
  const broken: TimestampAnchor = {
    ...anchor,
    signature: Buffer.from(JSON.stringify(env), "utf8").toString("base64")
  };
  const r = verifyRekorAnchor("rh", broken, { rekorPublicKeyPem: publicKeyPem });
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes("signed_entry_timestamp"));
});

test("verifyRekorAnchor: bad PEM -> ok=false with parse reason", () => {
  const { privateKey } = mkRekorKeypair();
  const anchor = buildAnchor("rh", {}, privateKey);
  const r = verifyRekorAnchor("rh", anchor, { rekorPublicKeyPem: "not a PEM" });
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes("rekorPublicKeyPem failed to parse"));
});

// ---------------------------------------------------------------------------
// Inclusion-proof verification (small handcrafted Merkle trees)
// ---------------------------------------------------------------------------

function inner(left: Buffer, right: Buffer): Buffer {
  return createHash("sha256")
    .update(Buffer.from([0x01]))
    .update(left)
    .update(right)
    .digest();
}

test("verifyRekorAnchor: inclusion proof — leaf at index 0 in a 2-leaf tree verifies", () => {
  const { privateKey, publicKeyPem } = mkRekorKeypair();
  const leaf0 = createHash("sha256").update("leaf0").digest();
  const leaf1 = createHash("sha256").update("leaf1").digest();
  const root = inner(leaf0, leaf1);
  const anchor = buildAnchor("rh-proof", { log_index: 0 }, privateKey);
  const proof: RekorInclusionProof = {
    leafHash: leaf0.toString("hex"),
    rootHash: root.toString("hex"),
    hashes: [leaf1.toString("hex")],
    treeIndex: 0,
    treeSize: 2
  };
  const r = verifyRekorAnchor("rh-proof", anchor, {
    rekorPublicKeyPem: publicKeyPem,
    inclusionProof: proof
  });
  assert.equal(r.ok, true, `expected ok; reason=${r.reason}`);
  assert.equal(r.inclusionVerified, true);
});

test("verifyRekorAnchor: inclusion proof — leaf at index 1 in a 2-leaf tree verifies", () => {
  const { privateKey, publicKeyPem } = mkRekorKeypair();
  const leaf0 = createHash("sha256").update("L0").digest();
  const leaf1 = createHash("sha256").update("L1").digest();
  const root = inner(leaf0, leaf1);
  const anchor = buildAnchor("rh-proof-1", { log_index: 1 }, privateKey);
  const proof: RekorInclusionProof = {
    leafHash: leaf1.toString("hex"),
    rootHash: root.toString("hex"),
    hashes: [leaf0.toString("hex")],
    treeIndex: 1,
    treeSize: 2
  };
  const r = verifyRekorAnchor("rh-proof-1", anchor, {
    rekorPublicKeyPem: publicKeyPem,
    inclusionProof: proof
  });
  assert.equal(r.ok, true, `expected ok; reason=${r.reason}`);
  assert.equal(r.inclusionVerified, true);
});

test("verifyRekorAnchor: inclusion proof with wrong root -> ok=false inclusionVerified=false", () => {
  const { privateKey, publicKeyPem } = mkRekorKeypair();
  const leaf0 = createHash("sha256").update("a").digest();
  const leaf1 = createHash("sha256").update("b").digest();
  const fakeRoot = createHash("sha256").update("not-the-real-root").digest();
  const anchor = buildAnchor("rh", {}, privateKey);
  const proof: RekorInclusionProof = {
    leafHash: leaf0.toString("hex"),
    rootHash: fakeRoot.toString("hex"),
    hashes: [leaf1.toString("hex")],
    treeIndex: 0,
    treeSize: 2
  };
  const r = verifyRekorAnchor("rh", anchor, {
    rekorPublicKeyPem: publicKeyPem,
    inclusionProof: proof
  });
  assert.equal(r.ok, false);
  assert.equal(r.inclusionVerified, false);
  assert.ok(r.reason?.includes("inclusion proof failed"));
});

test("verifyRekorAnchor: inclusion proof with out-of-range treeIndex -> ok=false", () => {
  const { privateKey, publicKeyPem } = mkRekorKeypair();
  const anchor = buildAnchor("rh", {}, privateKey);
  const proof: RekorInclusionProof = {
    leafHash: "00".repeat(32),
    rootHash: "11".repeat(32),
    hashes: [],
    treeIndex: 99,
    treeSize: 4
  };
  const r = verifyRekorAnchor("rh", anchor, {
    rekorPublicKeyPem: publicKeyPem,
    inclusionProof: proof
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes("treeIndex"));
});

// ---------------------------------------------------------------------------
// Canonicalization helper unit tests
// ---------------------------------------------------------------------------

test("canonicalizeSetPayload: keys sorted lexicographically, no whitespace", () => {
  const out = canonicalizeSetPayload({ logIndex: 7, body: "abc", integratedTime: 1000, logID: "" });
  assert.equal(out, '{"body":"abc","integratedTime":1000,"logID":"","logIndex":7}');
});

test("canonicalizeSetPayload: stable across argument order", () => {
  const a = canonicalizeSetPayload({ a: 1, b: 2, c: 3 });
  const b = canonicalizeSetPayload({ c: 3, b: 2, a: 1 });
  assert.equal(a, b);
});
