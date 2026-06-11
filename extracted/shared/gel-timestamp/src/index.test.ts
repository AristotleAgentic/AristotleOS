import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEd25519Signer } from "@aristotle/execution-control-runtime";
import {
  LocalTimestampAuthority,
  canonicalAnchorMessage,
  verifyTimestampAnchor,
  type TimestampAnchor
} from "./index.js";

function tmpLedger(): string {
  const dir = mkdtempSync(join(tmpdir(), "gel-ts-"));
  return join(dir, "anchors.jsonl");
}

function cleanup(p: string): void {
  try { rmSync(p, { force: true }); } catch { /* tolerate */ }
}

function mkSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("LocalTimestampAuthority: anchor() returns a TimestampAnchor that verifies", () => {
  const path = tmpLedger();
  try {
    const s = mkSigner();
    const tsa = new LocalTimestampAuthority({ ledgerPath: path, signer: s });
    const recordHash = "sha256:cafebabedeadbeef".padEnd(72, "0");
    const anchor = tsa.anchor(recordHash);
    assert.equal(anchor.kind, "local-ed25519");
    assert.equal(anchor.record_hash, recordHash);
    assert.equal(anchor.tsa_key_id, s.key_id);
    assert.ok(anchor.signature.length > 0);
    const v = verifyTimestampAnchor(recordHash, anchor, s.public_key_pem);
    assert.equal(v.ok, true, `verify should pass; reason=${v.reason}`);
    tsa.close();
  } finally { cleanup(path); }
});

test("LocalTimestampAuthority: each anchor() persists one JSONL row", () => {
  const path = tmpLedger();
  try {
    const tsa = new LocalTimestampAuthority({ ledgerPath: path });
    tsa.anchor("rh-1");
    tsa.anchor("rh-2");
    tsa.anchor("rh-3");
    tsa.close();
    const content = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(content.length, 3);
    for (const line of content) {
      const a = JSON.parse(line) as TimestampAnchor;
      assert.ok(["rh-1", "rh-2", "rh-3"].includes(a.record_hash));
    }
  } finally { cleanup(path); }
});

test("LocalTimestampAuthority: loadLedger reconstructs the full anchor history", () => {
  const path = tmpLedger();
  try {
    const tsa = new LocalTimestampAuthority({ ledgerPath: path });
    tsa.anchor("a"); tsa.anchor("b"); tsa.anchor("c");
    tsa.close();
    const loaded = LocalTimestampAuthority.loadLedger(path);
    assert.equal(loaded.length, 3);
    assert.deepEqual(loaded.map((a) => a.record_hash), ["a", "b", "c"]);
  } finally { cleanup(path); }
});

test("LocalTimestampAuthority: ephemeral keypair when no signer is provided", () => {
  const path = tmpLedger();
  try {
    const tsa = new LocalTimestampAuthority({ ledgerPath: path });
    assert.ok(tsa.keyId.startsWith("ed25519:"));
    assert.ok(tsa.publicKeyPem.includes("PUBLIC KEY"));
    const a = tsa.anchor("rh");
    const v = verifyTimestampAnchor("rh", a, tsa.publicKeyPem);
    assert.equal(v.ok, true);
    tsa.close();
  } finally { cleanup(path); }
});

// ---------------------------------------------------------------------------
// Verifier failure cases — each category should produce a useful reason
// ---------------------------------------------------------------------------

test("verifyTimestampAnchor: record_hash mismatch -> ok=false with reason", () => {
  const path = tmpLedger();
  try {
    const s = mkSigner();
    const tsa = new LocalTimestampAuthority({ ledgerPath: path, signer: s });
    const anchor = tsa.anchor("real-rh");
    const v = verifyTimestampAnchor("WRONG-RH", anchor, s.public_key_pem);
    assert.equal(v.ok, false);
    assert.ok(v.reason?.includes("record_hash mismatch"));
    tsa.close();
  } finally { cleanup(path); }
});

test("verifyTimestampAnchor: wrong TSA public key -> ok=false with key-id mismatch reason", () => {
  const path = tmpLedger();
  try {
    const real = mkSigner();
    const attacker = mkSigner();
    const tsa = new LocalTimestampAuthority({ ledgerPath: path, signer: real });
    const anchor = tsa.anchor("rh");
    const v = verifyTimestampAnchor("rh", anchor, attacker.public_key_pem);
    assert.equal(v.ok, false);
    assert.ok(v.reason?.includes("TSA key id mismatch"));
    tsa.close();
  } finally { cleanup(path); }
});

test("verifyTimestampAnchor: tampered signature -> ok=false", () => {
  const path = tmpLedger();
  try {
    const s = mkSigner();
    const tsa = new LocalTimestampAuthority({ ledgerPath: path, signer: s });
    const anchor = tsa.anchor("rh");
    const tampered: TimestampAnchor = { ...anchor, signature: "AAAA" + anchor.signature.slice(4) };
    const v = verifyTimestampAnchor("rh", tampered, s.public_key_pem);
    assert.equal(v.ok, false);
    assert.ok(v.reason?.includes("signature verification failed"));
    tsa.close();
  } finally { cleanup(path); }
});

test("verifyTimestampAnchor: tampered timestamp -> ok=false (signature no longer matches material)", () => {
  const path = tmpLedger();
  try {
    const s = mkSigner();
    const tsa = new LocalTimestampAuthority({ ledgerPath: path, signer: s });
    const anchor = tsa.anchor("rh");
    const backdated: TimestampAnchor = { ...anchor, timestamp: "1970-01-01T00:00:00.000Z" };
    const v = verifyTimestampAnchor("rh", backdated, s.public_key_pem);
    assert.equal(v.ok, false, "backdating must surface as a signature failure");
    assert.ok(v.reason?.includes("signature verification failed"));
    tsa.close();
  } finally { cleanup(path); }
});

test("verifyTimestampAnchor: unsupported anchor kind -> ok=false", () => {
  const s = mkSigner();
  const fake: TimestampAnchor = {
    kind: "rfc3161",
    timestamp: "2026-05-24T00:00:00.000Z",
    tsa_key_id: s.key_id,
    record_hash: "rh",
    signature: "AAAA"
  };
  const v = verifyTimestampAnchor("rh", fake, s.public_key_pem);
  assert.equal(v.ok, false);
  assert.ok(v.reason?.includes("unsupported anchor kind: rfc3161"));
});

// ---------------------------------------------------------------------------
// Canonical message format pinned
// ---------------------------------------------------------------------------

test("canonicalAnchorMessage: format is pinned to aristotle.gel-timestamp.v1:<rh>:<ts>", () => {
  assert.equal(
    canonicalAnchorMessage("sha256:abc", "2026-05-24T00:00:00.000Z"),
    "aristotle.gel-timestamp.v1:sha256:abc:2026-05-24T00:00:00.000Z"
  );
});
