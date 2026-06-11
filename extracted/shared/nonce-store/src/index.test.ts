import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest,
  createEd25519Signer,
  evaluateCommitGate,
  issueWarrant,
  verifyWarrant
} from "@aristotle/execution-control-runtime";
import {
  FilesystemNonceStore,
  InMemoryNonceStore,
  type NonceSeenSet,
  type NonceStore
} from "./index.js";

function tmpPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "nonce-store-"));
  return join(dir, "nonces.jsonl");
}

function cleanup(path: string): void {
  try { rmSync(path, { force: true }); } catch { /* tolerate */ }
}

// ---------------------------------------------------------------------------
// InMemoryNonceStore
// ---------------------------------------------------------------------------

test("InMemoryNonceStore: has() is false for unseen nonces", () => {
  const store = new InMemoryNonceStore();
  assert.equal(store.has("nonce-1"), false);
  assert.equal(store.size(), 0);
});

test("InMemoryNonceStore: add() then has() returns true; size() reflects count", () => {
  const store = new InMemoryNonceStore();
  store.add("a"); store.add("b"); store.add("c");
  assert.equal(store.has("a"), true);
  assert.equal(store.has("b"), true);
  assert.equal(store.has("c"), true);
  assert.equal(store.has("d"), false);
  assert.equal(store.size(), 3);
});

test("InMemoryNonceStore: add() is idempotent", () => {
  const store = new InMemoryNonceStore();
  store.add("x"); store.add("x"); store.add("x");
  assert.equal(store.size(), 1);
});

test("InMemoryNonceStore: addAndCheck() returns false on first add, true on replay", () => {
  const store = new InMemoryNonceStore();
  assert.equal(store.addAndCheck("n"), false, "first sighting must report unseen");
  assert.equal(store.addAndCheck("n"), true, "second sighting must report replay");
});

test("InMemoryNonceStore: TTL eviction drops expired nonces from has()", () => {
  let clock = 1000;
  const store = new InMemoryNonceStore({ maxAgeMs: 100, now: () => clock });
  store.add("a");
  assert.equal(store.has("a"), true);
  clock = 1101; // past the TTL window
  assert.equal(store.has("a"), false, "TTL-expired nonce must report unseen");
  assert.equal(store.size(), 0, "evicted entry must be removed from size()");
});

test("InMemoryNonceStore: compact() returns the eviction count", () => {
  let clock = 0;
  const store = new InMemoryNonceStore({ maxAgeMs: 50, now: () => clock });
  store.add("a"); store.add("b"); store.add("c");
  clock = 200;
  assert.equal(store.compact(), 3);
  assert.equal(store.size(), 0);
});

// ---------------------------------------------------------------------------
// FilesystemNonceStore
// ---------------------------------------------------------------------------

test("FilesystemNonceStore: empty file → empty store; add() then re-open hydrates", () => {
  const path = tmpPath();
  try {
    const a = new FilesystemNonceStore({ path });
    assert.equal(a.size(), 0);
    a.add("nonce-1");
    a.add("nonce-2");
    a.close();

    const b = new FilesystemNonceStore({ path });
    assert.equal(b.has("nonce-1"), true);
    assert.equal(b.has("nonce-2"), true);
    assert.equal(b.has("nonce-3"), false);
    assert.equal(b.size(), 2);
    b.close();
  } finally { cleanup(path); }
});

test("FilesystemNonceStore: persistence file is append-only JSONL", () => {
  const path = tmpPath();
  try {
    const store = new FilesystemNonceStore({ path });
    store.add("alpha");
    store.add("beta");
    store.close();

    const content = readFileSync(path, "utf8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 2);
    const r0 = JSON.parse(lines[0]) as { nonce: string; ts: number };
    const r1 = JSON.parse(lines[1]) as { nonce: string; ts: number };
    assert.equal(r0.nonce, "alpha");
    assert.equal(r1.nonce, "beta");
    assert.equal(typeof r0.ts, "number");
    assert.equal(typeof r1.ts, "number");
  } finally { cleanup(path); }
});

test("FilesystemNonceStore: addAndCheck() persists on first call, detects replay on second", () => {
  const path = tmpPath();
  try {
    const store = new FilesystemNonceStore({ path });
    assert.equal(store.addAndCheck("once"), false);
    assert.equal(store.addAndCheck("once"), true);
    store.close();

    // Replay survives across restart.
    const reopened = new FilesystemNonceStore({ path });
    assert.equal(reopened.addAndCheck("once"), true, "post-restart replay must be detected");
    reopened.close();
  } finally { cleanup(path); }
});

test("FilesystemNonceStore: hydrate tolerates a truncated trailing line (crash simulation)", () => {
  const path = tmpPath();
  try {
    const store = new FilesystemNonceStore({ path });
    store.add("good-1");
    store.add("good-2");
    store.close();

    // Simulate crash mid-write by appending a partial line.
    appendFileSync(path, '{"nonce":"partial","t');

    const reopened = new FilesystemNonceStore({ path });
    assert.equal(reopened.has("good-1"), true);
    assert.equal(reopened.has("good-2"), true);
    assert.equal(reopened.has("partial"), false, "truncated record must not hydrate");
    reopened.close();
  } finally { cleanup(path); }
});

test("FilesystemNonceStore: TTL filters expired records on hydrate", () => {
  const path = tmpPath();
  try {
    let clock = 1_000_000;
    const writer = new FilesystemNonceStore({ path, now: () => clock });
    writer.add("old");
    clock = 2_000_000;
    writer.add("new");
    writer.close();

    // Reopen with maxAgeMs = 500_000; "old" (added at 1_000_000) is at
    // age 1_100_000 when clock is set to 2_100_000 → past cutoff.
    clock = 2_100_000;
    const reopened = new FilesystemNonceStore({ path, maxAgeMs: 500_000, now: () => clock });
    assert.equal(reopened.has("old"), false, "expired nonce must not hydrate");
    assert.equal(reopened.has("new"), true);
    reopened.close();
  } finally { cleanup(path); }
});

test("FilesystemNonceStore: compact() rewrites the file with only surviving records", () => {
  const path = tmpPath();
  try {
    let clock = 1000;
    const store = new FilesystemNonceStore({ path, maxAgeMs: 100, now: () => clock });
    store.add("a"); store.add("b"); store.add("c");
    clock = 1500;
    store.add("d");
    // a/b/c are now expired; compact() should drop them.
    const evicted = store.compact();
    assert.equal(evicted, 3);
    assert.equal(store.size(), 1);
    store.close();

    const reopened = new FilesystemNonceStore({ path, now: () => clock });
    assert.equal(reopened.has("a"), false);
    assert.equal(reopened.has("b"), false);
    assert.equal(reopened.has("c"), false);
    assert.equal(reopened.has("d"), true);
    reopened.close();
  } finally { cleanup(path); }
});

test("FilesystemNonceStore: add() after close() throws", () => {
  const path = tmpPath();
  try {
    const store = new FilesystemNonceStore({ path });
    store.close();
    assert.throws(() => store.add("nope"), /after close/);
  } finally { cleanup(path); }
});

// ---------------------------------------------------------------------------
// NonceSeenSet structural compatibility
// ---------------------------------------------------------------------------

test("NonceSeenSet compatibility: both stores satisfy the read-only seen-set shape", () => {
  // Compile-time check (assigning to NonceSeenSet must compile) and a
  // runtime check that has() exists and works.
  const mem: NonceSeenSet = new InMemoryNonceStore();
  const path = tmpPath();
  try {
    const fs: NonceSeenSet = new FilesystemNonceStore({ path });
    assert.equal(mem.has("none"), false);
    assert.equal(fs.has("none"), false);
    (fs as NonceStore).close?.();
  } finally { cleanup(path); }
});

// ---------------------------------------------------------------------------
// Integration with verifyWarrant: real replay protection
//
// This is the headline test for the package. A FilesystemNonceStore
// records a verified Warrant's nonce; a second verifyWarrant call with
// the same Warrant must be rejected with reason WARRANT_REPLAYED, and
// the rejection must survive a restart (we close + reopen the store
// between the two attempts).
// ---------------------------------------------------------------------------

const NOW = "2026-05-24T12:00:00.000Z";
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

function signer() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

test("Integration: FilesystemNonceStore enforces WARRANT_REPLAYED across a restart", () => {
  const path = tmpPath();
  try {
    const s = signer();
    const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now: NOW });
    const warrant = issueWarrant(decision, action, envelope, NOW, s, 60)!;
    assert.ok(warrant, "issueWarrant should produce a Warrant on ALLOW");
    assert.ok(warrant.nonce, "Warrant must carry a nonce for replay protection");

    // First sighting: verify must succeed AND we record the nonce.
    const store1 = new FilesystemNonceStore({ path });
    const v1 = verifyWarrant(warrant, decision.canonical_action_hash, NOW, {
      trustedKeyIds: [s.key_id],
      seenNonces: store1
    });
    assert.equal(v1.ok, true, `first verify must succeed; got reason=${v1.ok ? "ok" : v1.reason}`);
    store1.add(warrant.nonce!);
    store1.close();

    // Process restart: brand-new FilesystemNonceStore reading the same file.
    const store2 = new FilesystemNonceStore({ path });
    assert.equal(store2.has(warrant.nonce!), true, "hydrated store must remember the nonce");

    // Second sighting: same Warrant → must be rejected as WARRANT_REPLAYED.
    const v2 = verifyWarrant(warrant, decision.canonical_action_hash, NOW, {
      trustedKeyIds: [s.key_id],
      seenNonces: store2
    });
    assert.equal(v2.ok, false);
    if (!v2.ok) {
      assert.equal(v2.reason, "WARRANT_REPLAYED", "replay must produce WARRANT_REPLAYED");
    }
    store2.close();
  } finally { cleanup(path); }
});

test("Integration: InMemoryNonceStore enforces WARRANT_REPLAYED inside a single process", () => {
  const s = signer();
  const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now: NOW });
  const warrant = issueWarrant(decision, action, envelope, NOW, s, 60)!;
  assert.ok(warrant.nonce);

  const store = new InMemoryNonceStore();
  const v1 = verifyWarrant(warrant, decision.canonical_action_hash, NOW, {
    trustedKeyIds: [s.key_id],
    seenNonces: store
  });
  assert.equal(v1.ok, true);
  store.add(warrant.nonce!);

  const v2 = verifyWarrant(warrant, decision.canonical_action_hash, NOW, {
    trustedKeyIds: [s.key_id],
    seenNonces: store
  });
  assert.equal(v2.ok, false);
  if (!v2.ok) assert.equal(v2.reason, "WARRANT_REPLAYED");
});
