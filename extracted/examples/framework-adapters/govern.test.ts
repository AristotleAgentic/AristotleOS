import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  type AuthorityEnvelope,
  type WardManifest,
  LedgerStore,
  createEd25519Signer
} from "@aristotle/execution-control-runtime";
import { governToolCall, type GovernedToolBinding, type ToolCall } from "./govern.js";

function testSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

const ward: WardManifest = {
  ward_id: "payments-ward",
  name: "Payments Ward",
  sovereignty_context: "fintech-prod",
  authority_domain: "payments-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:payments"]
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-payments-001",
  ward_id: "payments-ward",
  subject: "agent:payments",
  allowed_actions: ["stripe.refund"],
  denied_actions: ["stripe.payout"],
  constraints: { max_amount: 10000, required_runtime_registers: ["registers.dual_control"] },
  expires_at: "2099-12-31T23:59:59Z",
  issuer: "payments-root"
};

// An OpenAI/Anthropic/MCP-shaped tool call reduces to a ToolCall; the binding maps
// it into AristotleOS authority context.
function binding(overrides: Partial<GovernedToolBinding> = {}): GovernedToolBinding {
  return {
    ward,
    authorityEnvelope: envelope,
    subject: "agent:payments",
    signer: testSigner(),
    now: "2026-05-23T12:00:00.000Z",
    runtimeRegister: { registers: { dual_control: true } },
    toAction: (call: ToolCall) => ({
      action_type: call.name,
      target: `customer/${String(call.arguments.customerId)}`,
      params: { amount: call.arguments.amount, currency: call.arguments.currency }
    }),
    ...overrides
  };
}

test("adapter ALLOW: executes only after a verified Warrant and records GEL", async () => {
  let executed = false;
  const out = await governToolCall(
    { name: "stripe.refund", arguments: { amount: 8000, currency: "USD", customerId: "cus_1" }, callId: "call-allow" },
    binding(),
    () => { executed = true; return { refunded: true }; }
  );
  assert.equal(out.status, "executed");
  assert.equal(executed, true);
  if (out.status === "executed") {
    assert.equal(out.decision, "ALLOW");
    assert.ok(out.warrant.warrant_id);
    assert.equal(out.record.decision, "ALLOW");
    assert.deepEqual(out.result, { refunded: true });
  }
});

test("adapter REFUSE: a constraint violation never executes", async () => {
  let executed = false;
  const out = await governToolCall(
    { name: "stripe.refund", arguments: { amount: 50000, currency: "USD", customerId: "cus_2" }, callId: "call-refuse" },
    binding(),
    () => { executed = true; return { refunded: true }; }
  );
  assert.equal(out.status, "refused");
  assert.equal(executed, false);
  if (out.status === "refused") {
    assert.deepEqual(out.reason_codes, ["CONSTRAINT_FAILED"]);
    assert.equal(out.record.decision, "REFUSE");
  }
});

test("adapter REFUSE: a denied action never executes", async () => {
  let executed = false;
  const out = await governToolCall(
    { name: "stripe.payout", arguments: { amount: 100, currency: "USD", customerId: "cus_3" }, callId: "call-denied" },
    binding(),
    () => { executed = true; return {}; }
  );
  assert.equal(out.status, "refused");
  assert.equal(executed, false);
  if (out.status === "refused") assert.deepEqual(out.reason_codes, ["ACTION_DENIED"]);
});

test("adapter ESCALATE: missing runtime state defers without executing", async () => {
  let executed = false;
  const out = await governToolCall(
    { name: "stripe.refund", arguments: { amount: 8000, currency: "USD", customerId: "cus_4" }, callId: "call-escalate" },
    binding({ runtimeRegister: {} }),
    () => { executed = true; return {}; }
  );
  assert.equal(out.status, "escalated");
  assert.equal(executed, false);
  if (out.status === "escalated") assert.deepEqual(out.reason_codes, ["RUNTIME_STATE_MISSING"]);
});

test("adapter replay: an identical approved call is refused the second time (single-use)", async () => {
  const ledger = LedgerStore.memory();
  const shared = binding({ ledger });
  const call: ToolCall = { name: "stripe.refund", arguments: { amount: 8000, currency: "USD", customerId: "cus_5" }, callId: "call-replay" };

  let executions = 0;
  const first = await governToolCall(call, shared, () => { executions += 1; return { ok: true }; });
  const second = await governToolCall(call, shared, () => { executions += 1; return { ok: true }; });

  assert.equal(first.status, "executed");
  assert.equal(second.status, "refused");
  assert.equal(executions, 1);
  if (second.status === "refused") assert.deepEqual(second.reason_codes, ["REPLAY_DETECTED"]);
});
