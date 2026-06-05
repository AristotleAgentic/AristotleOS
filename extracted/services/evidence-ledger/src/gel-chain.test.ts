import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startService } from "../../../tests/_harness.mjs";

/**
 * Evidence-ledger GEL chain integrity tests.
 *
 * The GEL is the substrate's append-only hash-chained evidence
 * ledger; its security depends on:
 *
 *   - record_hash of record N covering all of N's material fields
 *   - previous_hash of record N matching record_hash of record N-1
 *   - verifyGelChain rejecting any chain whose linkage is broken
 *
 * shared/execution-control-runtime carries the gel.mutation.test.ts
 * property suite that proves the verifier catches every category of
 * tampering at the library level. THESE tests pin the SERVICE-level
 * behavior: that the /gel/append → /gel/chain → /gel/verify pipeline
 * actually wires the verifier and the hash chain end-to-end over
 * real HTTP and a real on-disk JSONL ledger.
 *
 *   (1) /gel/append on a fresh ledger creates record 1 whose
 *       previous_hash is GENESIS_HASH
 *   (2) /gel/append twice produces a chain where record 2's
 *       previous_hash equals record 1's record_hash (chain linkage)
 *   (3) /gel/chain reports count, tip_hash, and the full records
 *       array consistently
 *   (4) /gel/verify returns ok=true after honest appends
 *   (5) /gel/append with missing required fields returns 400
 *
 * Each test isolates EVIDENCE_LEDGER_GEL_PATH to a fresh mkdtemp()
 * so on-disk state never leaks between tests or pollutes the
 * dev workspace's ./data directory.
 *
 * No production code is modified.
 */

const NOW = "2026-06-05T12:00:00.000Z";
// The substrate's GENESIS sentinel is the literal string "GENESIS", not a
// zero hash — see shared/execution-control-runtime/src/index.ts (export const
// GENESIS_HASH = "GENESIS"). Using a zero hash here would be a wrong assumption
// about the chain's anchor.
const GENESIS_HASH = "GENESIS";

async function tempLedger() {
  const dir = await mkdtemp(join(tmpdir(), "aristotle-gel-test-"));
  return {
    gelPath: join(dir, "gel.jsonl"),
    statePath: join(dir, "state.json")
  };
}

async function startLedger() {
  const paths = await tempLedger();
  return await startService("evidence-ledger", {
    env: {
      EVIDENCE_LEDGER_STATE_PATH: paths.statePath,
      EVIDENCE_LEDGER_GEL_PATH: paths.gelPath
    }
  });
}

/**
 * Build a minimal-but-real WardManifest. The substrate only requires
 * a handful of fields; physical_bounds and metadata are optional.
 */
function fixtureWard(i = 0) {
  return {
    ward_id: `ward-test-${i}`,
    name: `Test Ward ${i}`,
    sovereignty_context: "test",
    authority_domain: "test-ops",
    policy_version: "1.0.0",
    permitted_subjects: ["agent:test"]
  };
}

/**
 * Build a CanonicalActionInput. action_id must be unique per record
 * (the GEL admits the (canonical_action_hash, decision) pair once).
 */
function fixtureAction(i = 0) {
  return {
    action_id: `act-test-${i}`,
    ward_id: `ward-test-${i}`,
    subject: "agent:test",
    action_type: "test.do",
    target: `target-${i}`,
    params: { idx: i },
    requested_at: NOW,
    request_id: `req-${i}`
  };
}

/**
 * Build a CommitGateDecision. canonical_action_hash is the substrate's
 * hash of the canonicalized action; we use a unique-per-record string
 * because buildGelRecord embeds it verbatim — it doesn't re-canonicalize.
 * (See shared/execution-control-runtime/src/index.ts ::buildGelRecord.)
 */
function fixtureDecision(i = 0) {
  return {
    decision: "ALLOW",
    reason_codes: ["ALLOWED"],
    canonical_action_hash: `cah-test-${i}-${i.toString().padStart(8, "0")}`,
    policy_version: "1.0.0",
    authority_envelope_id: "env-test-001",
    runtime_register_snapshot: {}
  };
}

test("/gel/append on a fresh ledger creates record 1 anchored at GENESIS_HASH", async () => {
  const svc = await startLedger();
  try {
    const r = await svc.post("/gel/append", {
      ward: fixtureWard(0),
      action: fixtureAction(0),
      decision: fixtureDecision(0)
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.record, "response must include the appended record");
    assert.equal(r.body.record.previous_hash, GENESIS_HASH,
      `first record's previous_hash must equal the substrate's GENESIS sentinel ("${GENESIS_HASH}")`);
    assert.equal(typeof r.body.record.record_hash, "string");
    assert.equal(r.body.record.record_hash.length, 64,
      "record_hash must be a 64-char sha256 hex digest");
    assert.equal(r.body.record.decision, "ALLOW");
    assert.equal(r.body.record.ward_id, "ward-test-0");
  } finally { await svc.stop(); }
});

test("/gel/append twice links the chain: record 2's previous_hash == record 1's record_hash", async () => {
  const svc = await startLedger();
  try {
    const first = await svc.post("/gel/append", {
      ward: fixtureWard(1),
      action: fixtureAction(1),
      decision: fixtureDecision(1)
    });
    assert.equal(first.status, 201);

    const second = await svc.post("/gel/append", {
      ward: fixtureWard(2),
      action: fixtureAction(2),
      decision: fixtureDecision(2)
    });
    assert.equal(second.status, 201);

    assert.equal(second.body.record.previous_hash, first.body.record.record_hash,
      "chain linkage broken: record 2 must reference record 1's record_hash");
    assert.notEqual(second.body.record.record_hash, first.body.record.record_hash,
      "two distinct records must have distinct record_hash values");
  } finally { await svc.stop(); }
});

test("/gel/chain reports count, tip_hash, and full records consistently with /gel/append", async () => {
  const svc = await startLedger();
  try {
    // Start: empty chain
    const empty = await svc.get("/gel/chain");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.count, 0);
    assert.equal(empty.body.tip_hash, "GENESIS", "empty chain reports tip_hash=GENESIS");
    assert.deepEqual(empty.body.records, []);

    // Append two records
    const a = await svc.post("/gel/append", {
      ward: fixtureWard(3), action: fixtureAction(3), decision: fixtureDecision(3)
    });
    const b = await svc.post("/gel/append", {
      ward: fixtureWard(4), action: fixtureAction(4), decision: fixtureDecision(4)
    });

    const chain = await svc.get("/gel/chain");
    assert.equal(chain.body.count, 2);
    assert.equal(chain.body.records.length, 2);
    assert.equal(chain.body.tip_hash, b.body.record.record_hash, "tip_hash must match the last record's record_hash");
    assert.equal(chain.body.records[0].record_hash, a.body.record.record_hash);
    assert.equal(chain.body.records[1].previous_hash, a.body.record.record_hash);
  } finally { await svc.stop(); }
});

test("/gel/verify returns ok=true on a chain of honest appends", async () => {
  const svc = await startLedger();
  try {
    for (let i = 5; i < 8; i++) {
      const r = await svc.post("/gel/append", {
        ward: fixtureWard(i), action: fixtureAction(i), decision: fixtureDecision(i)
      });
      assert.equal(r.status, 201, `append ${i} failed: ${JSON.stringify(r.body)}`);
    }
    const verify = await svc.get("/gel/verify");
    assert.equal(verify.status, 200);
    assert.equal(verify.body.ok, true,
      `GEL verification must pass for an honestly-built chain (got: ${JSON.stringify(verify.body)})`);
    assert.equal(verify.body.count, 3);
  } finally { await svc.stop(); }
});

test("/gel/append with missing required fields returns 400 missing_required_fields", async () => {
  const svc = await startLedger();
  try {
    const noWard = await svc.post("/gel/append", {
      action: fixtureAction(99), decision: fixtureDecision(99)
    });
    assert.equal(noWard.status, 400);
    assert.equal(noWard.body.error, "missing_required_fields");

    const noAction = await svc.post("/gel/append", {
      ward: fixtureWard(99), decision: fixtureDecision(99)
    });
    assert.equal(noAction.status, 400);

    const noDecision = await svc.post("/gel/append", {
      ward: fixtureWard(99), action: fixtureAction(99)
    });
    assert.equal(noDecision.status, 400);
  } finally { await svc.stop(); }
});
