import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type GelRecord,
  type WardManifest,
  GENESIS_HASH,
  appendGelRecord,
  createEd25519Signer,
  evaluateCommitGate,
  loadGelChain,
  verifyGelRecords
} from "@aristotle/execution-control-runtime";
import {
  archiveGelChain,
  computeRetentionCutoff,
  restoreArchive,
  retentionRollover,
  verifyActiveChainAfterArchive,
  verifyArchivedChain,
  verifyGelRecordsStartingFrom
} from "./index.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "gel-archive-"));
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* tolerate */ }
}

const NOW = "2026-05-24T12:00:00.000Z";

const ward: WardManifest = {
  ward_id: "w-arch", name: "Archive Ward", sovereignty_context: "test",
  authority_domain: "test-ops", policy_version: "1.0.0",
  permitted_subjects: ["agent:a"]
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-arch", ward_id: "w-arch", subject: "agent:a",
  allowed_actions: ["x.do"], denied_actions: [], constraints: {},
  expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};

function signer() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

function freshAction(i: number, ts?: string): CanonicalActionInput {
  return {
    action_id: `a-arch-${i}`, ward_id: "w-arch", subject: "agent:a",
    action_type: "x.do", target: `t-${i}`, params: { i },
    requested_at: ts ?? NOW, request_id: `r-${i}`
  };
}

/**
 * Build a chain of N records, persist to a real file (so loadGelChain
 * can read it back), and return the file path + the in-memory chain.
 * Optionally stamps a per-record timestamp.
 */
function buildPersistedChain(dir: string, n: number, perRecordTimestamp?: (i: number) => string): { path: string; chain: GelRecord[] } {
  const path = join(dir, "active.jsonl");
  const s = signer();
  for (let i = 0; i < n; i++) {
    const now = perRecordTimestamp ? perRecordTimestamp(i) : NOW;
    const action = freshAction(i, now);
    const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now });
    appendGelRecord({ ledgerPath: path, ward, action, decision, now, signer: s });
  }
  return { path, chain: loadGelChain(path) };
}

// ---------------------------------------------------------------------------
// computeRetentionCutoff
// ---------------------------------------------------------------------------

test("computeRetentionCutoff: maxRecords keeps N newest", () => {
  const dir = tmpDir();
  try {
    const { chain } = buildPersistedChain(dir, 10);
    assert.equal(computeRetentionCutoff(chain, { maxRecords: 5 }), 5);
    assert.equal(computeRetentionCutoff(chain, { maxRecords: 10 }), 0);
    assert.equal(computeRetentionCutoff(chain, { maxRecords: 0 }), 10);
    assert.equal(computeRetentionCutoff(chain, { maxRecords: 100 }), 0);
  } finally { cleanup(dir); }
});

test("computeRetentionCutoff: maxAgeMs keeps records younger than threshold", () => {
  const dir = tmpDir();
  try {
    // Build a chain with timestamps spaced 1s apart, starting at t=1000.
    const { chain } = buildPersistedChain(dir, 10, (i) => new Date(1000 + i * 1000).toISOString());
    // "now" = 1000 + 9000 = 10000ms. maxAgeMs = 3500 -> keep records >= 6500ms.
    // Records at indices 0..5 are at 1000..6000ms — too old.
    // Records at indices 6..9 are at 7000..10000ms — young enough.
    const cutoff = computeRetentionCutoff(chain, { maxAgeMs: 3500, now: () => 10_000 });
    assert.equal(cutoff, 6);
  } finally { cleanup(dir); }
});

test("computeRetentionCutoff: maxRecords + maxAgeMs combine — more restrictive wins", () => {
  const dir = tmpDir();
  try {
    const { chain } = buildPersistedChain(dir, 10, (i) => new Date(1000 + i * 1000).toISOString());
    // maxRecords=3 -> cutoff 7
    // maxAgeMs=3500 @ now=10000 -> cutoff 6
    // Combined: max(7, 6) = 7 (more aggressive archiving wins).
    assert.equal(
      computeRetentionCutoff(chain, { maxRecords: 3, maxAgeMs: 3500, now: () => 10_000 }),
      7
    );
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// archiveGelChain — the headline operation
// ---------------------------------------------------------------------------

test("archiveGelChain: splits chain at cutoff; both files verify independently", () => {
  const dir = tmpDir();
  try {
    const { path: activePath } = buildPersistedChain(dir, 10);
    const archivePath = join(dir, "archive.jsonl");

    const result = archiveGelChain({ ledgerPath: activePath, archivePath, cutoff: 4 });
    assert.equal(result.archived, 4);
    assert.equal(result.retained, 6);
    assert.equal(result.archiveSize, 4);
    assert.ok(result.rolloverHash);

    // Archive verifies standalone (GENESIS-rooted).
    const archiveVerify = verifyArchivedChain(archivePath);
    assert.equal(archiveVerify.ok, true, `archive must verify: ${archiveVerify.failure}`);
    assert.equal(archiveVerify.count, 4);

    // Active verifies starting from the rollover hash.
    const activeVerify = verifyActiveChainAfterArchive(activePath, result.rolloverHash!);
    assert.equal(activeVerify.ok, true, `active must verify: ${activeVerify.failure}`);
    assert.equal(activeVerify.count, 6);
  } finally { cleanup(dir); }
});

test("archiveGelChain: subsequent rounds append to the archive (multi-round retention)", () => {
  const dir = tmpDir();
  try {
    const { path: activePath } = buildPersistedChain(dir, 10);
    const archivePath = join(dir, "archive.jsonl");

    const r1 = archiveGelChain({ ledgerPath: activePath, archivePath, cutoff: 4 });
    assert.equal(r1.archived, 4); assert.equal(r1.archiveSize, 4);

    // Append more records to the active chain via appendGelRecord (it
    // reads the current file's tip, so chain hash linkage continues
    // correctly through the post-archive state).
    const s = signer();
    for (let i = 10; i < 14; i++) {
      const action = freshAction(i);
      const decision = evaluateCommitGate({ ward, authorityEnvelope: envelope, action, now: NOW });
      appendGelRecord({ ledgerPath: activePath, ward, action, decision, now: NOW, signer: s });
    }
    // Active now has the 6 retained + 4 new = 10 records. Archive again.
    const r2 = archiveGelChain({ ledgerPath: activePath, archivePath, cutoff: 6 });
    assert.equal(r2.archived, 6);
    assert.equal(r2.archiveSize, 10);

    // Archive (10 records) still verifies as a GENESIS-rooted chain.
    const v = verifyArchivedChain(archivePath);
    assert.equal(v.ok, true, `multi-round archive must verify: ${v.failure}`);
    assert.equal(v.count, 10);
  } finally { cleanup(dir); }
});

test("archiveGelChain: empty active chain is a no-op", () => {
  const dir = tmpDir();
  try {
    const activePath = join(dir, "empty.jsonl");
    const archivePath = join(dir, "archive.jsonl");
    const r = archiveGelChain({ ledgerPath: activePath, archivePath, cutoff: 5 });
    assert.equal(r.archived, 0);
    assert.equal(r.retained, 0);
    assert.equal(r.rolloverHash, null);
  } finally { cleanup(dir); }
});

test("archiveGelChain: cutoff=0 is a no-op (active chain unchanged)", () => {
  const dir = tmpDir();
  try {
    const { path: activePath } = buildPersistedChain(dir, 5);
    const archivePath = join(dir, "archive.jsonl");
    const r = archiveGelChain({ ledgerPath: activePath, archivePath, cutoff: 0 });
    assert.equal(r.archived, 0);
    assert.equal(r.retained, 5);
    assert.equal(r.rolloverHash, null);
    assert.equal(existsSync(archivePath), false, "archive file shouldn't be created for no-op");
  } finally { cleanup(dir); }
});

test("archiveGelChain: throws when neither cutoff nor threshold provided", () => {
  const dir = tmpDir();
  try {
    const { path: activePath } = buildPersistedChain(dir, 3);
    assert.throws(
      () => archiveGelChain({ ledgerPath: activePath, archivePath: join(dir, "x.jsonl") }),
      /must provide either `cutoff` or `threshold`/
    );
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// retentionRollover convenience wrapper
// ---------------------------------------------------------------------------

test("retentionRollover: maxRecords threshold drives archive in one call", () => {
  const dir = tmpDir();
  try {
    const { path: activePath } = buildPersistedChain(dir, 12);
    const archivePath = join(dir, "archive.jsonl");
    const r = retentionRollover({
      ledgerPath: activePath, archivePath,
      threshold: { maxRecords: 5 }
    });
    assert.equal(r.archived, 7);
    assert.equal(r.retained, 5);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// restoreArchive — reassembly
// ---------------------------------------------------------------------------

test("restoreArchive: archive + active reassembles into a GENESIS-rooted chain that verifies", () => {
  const dir = tmpDir();
  try {
    const { path: activePath, chain: original } = buildPersistedChain(dir, 8);
    const archivePath = join(dir, "archive.jsonl");
    const outPath = join(dir, "restored.jsonl");

    archiveGelChain({ ledgerPath: activePath, archivePath, cutoff: 3 });
    const r = restoreArchive({ archivePath, activePath, outPath });
    assert.equal(r.ok, true, `restore must succeed: ${r.failure}`);
    assert.equal(r.totalRecords, 8);

    // Restored file = original chain.
    const restored = readFileSync(outPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as GelRecord);
    assert.equal(restored.length, original.length);
    for (let i = 0; i < original.length; i++) {
      assert.equal(restored[i].record_hash, original[i].record_hash, `record ${i} hash must match original`);
    }
    // verifyGelRecords gives the standard GENESIS-rooted verdict.
    const v = verifyGelRecords(restored);
    assert.equal(v.ok, true);
    assert.equal(v.count, 8);
  } finally { cleanup(dir); }
});

test("restoreArchive: archive tip / active first-previous mismatch fails fast", () => {
  const dir = tmpDir();
  try {
    const { path: activePath } = buildPersistedChain(dir, 5);
    const archivePath = join(dir, "archive.jsonl");
    archiveGelChain({ ledgerPath: activePath, archivePath, cutoff: 2 });
    // Corrupt the active file's first record's previous_hash.
    const chain = readFileSync(activePath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as GelRecord);
    chain[0].previous_hash = "0".repeat(64);
    writeFileSync(activePath, chain.map((c) => JSON.stringify(c)).join("\n") + "\n");
    const r = restoreArchive({ archivePath, activePath, outPath: join(dir, "out.jsonl") });
    assert.equal(r.ok, false);
    assert.ok(r.failure?.includes("does not match"));
  } finally { cleanup(dir); }
});

test("restoreArchive: empty archive returns just the active chain", () => {
  const dir = tmpDir();
  try {
    const { path: activePath } = buildPersistedChain(dir, 3);
    const r = restoreArchive({
      archivePath: join(dir, "empty-archive.jsonl"),
      activePath,
      outPath: join(dir, "out.jsonl")
    });
    assert.equal(r.ok, true);
    assert.equal(r.totalRecords, 3);
  } finally { cleanup(dir); }
});

// ---------------------------------------------------------------------------
// verifyGelRecordsStartingFrom
// ---------------------------------------------------------------------------

test("verifyGelRecordsStartingFrom: GENESIS == standard verifyGelRecords", () => {
  const dir = tmpDir();
  try {
    const { chain } = buildPersistedChain(dir, 4);
    const a = verifyGelRecordsStartingFrom(chain, GENESIS_HASH);
    const b = verifyGelRecords(chain);
    assert.deepEqual(a, b);
  } finally { cleanup(dir); }
});

test("verifyGelRecordsStartingFrom: wrong starting hash fails at record 0", () => {
  const dir = tmpDir();
  try {
    const { chain } = buildPersistedChain(dir, 4);
    const v = verifyGelRecordsStartingFrom(chain, "0".repeat(64));
    assert.equal(v.ok, false);
    assert.ok(v.failure?.includes("record 0 previous_hash mismatch"));
  } finally { cleanup(dir); }
});
