import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApprovalStore, dualControlPolicyFrom, evaluateApproval } from "./dual-control.js";
import type { AuthorityEnvelope, CanonicalActionInput, WardManifest } from "./index.js";
import { evaluateExecutionControl } from "./index.js";

const now = "2026-05-24T12:00:00.000Z";

test("evaluateApproval: reject wins, then M distinct approvers, then TTL", () => {
  const base = { request_id: "r", canonical_action_hash: "h", ward_id: "w", subject: "agent:x", action_type: "t", required: 2, votes: [], created_at: now };
  assert.equal(evaluateApproval(base, now), "pending");
  assert.equal(evaluateApproval({ ...base, votes: [{ by: "a", decision: "approve", at: now }] }, now), "pending");
  assert.equal(evaluateApproval({ ...base, votes: [{ by: "a", decision: "approve", at: now }, { by: "b", decision: "approve", at: now }] }, now), "approved");
  // two votes from the same approver do not satisfy a 2-of-N
  assert.equal(evaluateApproval({ ...base, votes: [{ by: "a", decision: "approve", at: now }, { by: "a", decision: "approve", at: now }] }, now), "pending");
  assert.equal(evaluateApproval({ ...base, votes: [{ by: "a", decision: "approve", at: now }, { by: "b", decision: "reject", at: now }] }, now), "rejected");
  assert.equal(evaluateApproval({ ...base, expires_at: "2026-05-24T12:00:00.000Z" }, "2026-05-24T13:00:00.000Z"), "expired");
});

test("dualControlPolicyFrom parses and rejects invalid blobs", () => {
  assert.deepEqual(dualControlPolicyFrom({ actions: ["x"], required: 2 }), { actions: ["x"], required: 2 });
  assert.deepEqual(dualControlPolicyFrom({ actions: ["x"], required: 2, ttl_ms: 1000 }), { actions: ["x"], required: 2, ttlMs: 1000 });
  assert.equal(dualControlPolicyFrom({ actions: [], required: 2 }), undefined);
  assert.equal(dualControlPolicyFrom({ actions: ["x"], required: 0 }), undefined);
  assert.equal(dualControlPolicyFrom(null), undefined);
});

test("ApprovalStore enforces separation of duties and one-vote-per-approver", () => {
  const store = ApprovalStore.memory();
  const req = store.request({ canonicalHash: "abc123def456", wardId: "w", subject: "agent:x", actionType: "t", required: 2, now });
  assert.equal(req.status, "pending");
  // the requesting subject cannot approve its own action
  assert.throws(() => store.vote(req.request_id, "agent:x", "approve", undefined, now), /separation of duties/);
  store.vote(req.request_id, "alice@corp", "approve", "looks fine", now);
  // one vote per approver
  assert.throws(() => store.vote(req.request_id, "alice@corp", "approve", undefined, now), /already voted/);
  const after = store.vote(req.request_id, "bob@corp", "approve", undefined, now);
  assert.equal(after.status, "approved");
  // terminal requests reject further votes
  assert.throws(() => store.vote(req.request_id, "carol@corp", "approve", undefined, now), /already approved/);
});

test("ApprovalStore is idempotent on request and durable across instances", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "aos-dual-")), "approvals.json");
  const a = new ApprovalStore(file);
  const r1 = a.request({ canonicalHash: "hash-1", wardId: "w", subject: "agent:x", actionType: "t", required: 2, now });
  const r2 = a.request({ canonicalHash: "hash-1", wardId: "w", subject: "agent:x", actionType: "t", required: 2, now });
  assert.equal(r1.request_id, r2.request_id); // idempotent
  a.vote(r1.request_id, "alice@corp", "approve", undefined, now);
  const b = new ApprovalStore(file);
  assert.equal(b.get(r1.request_id, now)?.votes.length, 1);
});

// --- end-to-end through the gate -------------------------------------------

const ward: WardManifest = {
  ward_id: "w-cyber", name: "Cyber", sovereignty_context: "corp", authority_domain: "secops",
  policy_version: "0.1.0", permitted_subjects: ["agent:responder"]
};
const envelope: AuthorityEnvelope = {
  envelope_id: "ae-cyber", ward_id: "w-cyber", subject: "agent:responder",
  allowed_actions: ["firewall.block", "host.isolate"], denied_actions: [],
  constraints: { dual_control: { actions: ["host.isolate"], required: 2 } },
  expires_at: "2099-12-31T23:59:59Z", issuer: "root"
};
function action(type: string, id = "a1"): CanonicalActionInput {
  return { action_id: id, ward_id: "w-cyber", subject: "agent:responder", action_type: type, target: "host-7", params: {}, requested_at: now };
}
function ledger() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-dual-gel-")), "gel.jsonl");
}

test("a dual-control action escalates and opens a pending request; approval then admits it", () => {
  const store = ApprovalStore.memory();
  const file = ledger();

  // Non-dual-control action is admitted normally.
  const block = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: action("firewall.block", "f1"), ledgerPath: file, now, approvalStore: store });
  assert.equal(block.decision, "ALLOW");

  // host.isolate is under 2-of-N control ⇒ first attempt ESCALATEs, no Warrant.
  const isolate = action("host.isolate", "h1");
  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: isolate, ledgerPath: file, now, approvalStore: store });
  assert.equal(first.decision, "ESCALATE");
  assert.deepEqual(first.reason_codes, ["DUAL_CONTROL_REQUIRED"]);
  assert.equal(first.warrant, undefined);

  // A pending request was opened, keyed by the canonical action hash.
  const pending = store.getByHash(first.canonical_action_hash, now);
  assert.ok(pending, "expected a pending approval request");
  assert.equal(pending!.status, "pending");

  // Two independent operators approve.
  store.vote(pending!.request_id, "alice@corp", "approve", "incident SEV-1", now);
  const approved = store.vote(pending!.request_id, "bob@corp", "approve", undefined, now);
  assert.equal(approved.status, "approved");

  // The same canonical action now ALLOWs and issues a Warrant.
  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: isolate, ledgerPath: ledger(), now, approvalStore: store });
  assert.equal(second.decision, "ALLOW");
  assert.match(second.warrant!.warrant_id, /^wrn-/);
});

test("a rejection keeps a dual-control action escalated", () => {
  const store = ApprovalStore.memory();
  const isolate = action("host.isolate", "h2");
  const first = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: isolate, ledgerPath: ledger(), now, approvalStore: store });
  assert.equal(first.decision, "ESCALATE");
  store.vote(store.getByHash(first.canonical_action_hash, now)!.request_id, "alice@corp", "reject", "not warranted", now);
  const second = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: isolate, ledgerPath: ledger(), now, approvalStore: store });
  assert.equal(second.decision, "ESCALATE"); // rejected ⇒ not approved ⇒ still gated
  assert.equal(second.warrant, undefined);
});

test("without an approval store, dual control fails closed instead of silently bypassing plural authority", () => {
  const r = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: action("host.isolate", "h3"), ledgerPath: ledger(), now });
  assert.equal(r.decision, "ESCALATE");
  assert.deepEqual(r.reason_codes, ["DUAL_CONTROL_STORE_MISSING"]);
  assert.equal(r.warrant, undefined);
});
