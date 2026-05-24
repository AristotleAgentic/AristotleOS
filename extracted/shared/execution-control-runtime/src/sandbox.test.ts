import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type SandboxPolicy,
  type WardManifest,
  LocalProcessSandboxProvider,
  buildSandboxReceipt,
  createEd25519Signer,
  governSandboxExecution,
  verifySandboxEvidence,
  verifySandboxReceipt
} from "./index.js";

function testSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

const NODE = process.execPath;

const ward: WardManifest = {
  ward_id: "ci-ward",
  name: "CI Ward",
  sovereignty_context: "build-infra",
  authority_domain: "ci-ops",
  policy_version: "0.1.0",
  permitted_subjects: ["agent:ci"]
};

const envelope: AuthorityEnvelope = {
  envelope_id: "ae-ci-001",
  ward_id: "ci-ward",
  subject: "agent:ci",
  allowed_actions: ["shell.exec"],
  denied_actions: ["shell.destroy"],
  constraints: {},
  expires_at: "2099-12-31T23:59:59Z",
  issuer: "ci-root"
};

function action(actionType: string, requestId: string): CanonicalActionInput {
  return {
    action_id: `act-${requestId}`,
    ward_id: "ci-ward",
    subject: "agent:ci",
    action_type: actionType,
    target: "build-step",
    params: {},
    requested_at: "2026-05-23T12:00:00.000Z",
    request_id: requestId
  };
}

const policy = (over: Partial<SandboxPolicy> = {}): SandboxPolicy => ({
  allowed_commands: [NODE],
  timeout_ms: 5000,
  max_output_bytes: 1_000_000,
  ...over
});

test("ALLOW executes in the sandbox; receipt is signed, Warrant-bound, and verifies", async () => {
  const signer = testSigner();
  const out = await governSandboxExecution({
    ward, authorityEnvelope: envelope, action: action("shell.exec", "ok-1"),
    provider: new LocalProcessSandboxProvider(), policy: policy(),
    command: { command: NODE, args: ["-e", "console.log('hello-sandbox')"] }, signer
  });

  assert.equal(out.decision, "ALLOW");
  assert.ok(out.warrant);
  assert.ok(out.receipt);
  assert.equal(out.receipt!.status, "ok");
  assert.equal(out.receipt!.exit_code, 0);
  assert.match(out.receipt!.stdout, /hello-sandbox/);

  // Receipt is bound to the authorizing Warrant + the GEL record.
  assert.equal(out.receipt!.warrant_id, out.warrant!.warrant_id);
  assert.equal(out.receipt!.canonical_action_hash, out.canonical_action_hash);
  assert.equal(out.receipt!.gel_record_id, out.gel_record.record_id);

  assert.equal(verifySandboxReceipt(out.receipt!, { warrant: out.warrant }).ok, true);
  assert.equal(verifySandboxEvidence(out.evidence!).ok, true);
});

test("REFUSE never reaches the sandbox (no receipt, no execution)", async () => {
  const out = await governSandboxExecution({
    ward, authorityEnvelope: envelope, action: action("shell.destroy", "refuse-1"),
    provider: new LocalProcessSandboxProvider(), policy: policy(),
    command: { command: NODE, args: ["-e", "console.log('should-not-run')"] }
  });
  assert.equal(out.decision, "REFUSE");
  assert.deepEqual(out.reason_codes, ["ACTION_DENIED"]);
  assert.equal(out.receipt, undefined);
  assert.equal(out.evidence, undefined);
});

test("sandbox command allowlist denies an authorized action's disallowed binary", async () => {
  // Gate ALLOWs the action, but the sandbox policy does not permit this binary.
  const out = await governSandboxExecution({
    ward, authorityEnvelope: envelope, action: action("shell.exec", "denied-1"),
    provider: new LocalProcessSandboxProvider(), policy: policy({ allowed_commands: ["/bin/echo-not-real"] }),
    command: { command: NODE, args: ["-e", "console.log('blocked')"] }
  });
  assert.equal(out.decision, "ALLOW");
  assert.ok(out.receipt);
  assert.equal(out.receipt!.status, "denied");
  assert.equal(out.receipt!.exit_code, null);
  assert.equal(out.receipt!.stdout, "");
  assert.match(out.receipt!.stderr, /not in sandbox allowlist/);
});

test("sandbox enforces the timeout budget", async () => {
  const out = await governSandboxExecution({
    ward, authorityEnvelope: envelope, action: action("shell.exec", "timeout-1"),
    provider: new LocalProcessSandboxProvider(), policy: policy({ timeout_ms: 250 }),
    command: { command: NODE, args: ["-e", "setTimeout(() => {}, 100000)"] }
  });
  assert.equal(out.receipt!.status, "timeout");
  assert.ok(out.receipt!.duration_ms < 5000);
});

test("sandbox caps captured output", async () => {
  const out = await governSandboxExecution({
    ward, authorityEnvelope: envelope, action: action("shell.exec", "cap-1"),
    provider: new LocalProcessSandboxProvider(), policy: policy({ max_output_bytes: 50 }),
    command: { command: NODE, args: ["-e", "process.stdout.write('x'.repeat(100000))"] }
  });
  assert.equal(out.receipt!.output_truncated, true);
  assert.ok(Buffer.byteLength(out.receipt!.stdout) <= 50);
});

test("a receipt does not verify against a different Warrant, and tampering is detected", async () => {
  const signer = testSigner();
  const a = await governSandboxExecution({
    ward, authorityEnvelope: envelope, action: action("shell.exec", "mm-a"),
    provider: new LocalProcessSandboxProvider(), policy: policy(),
    command: { command: NODE, args: ["-e", "console.log('a')"] }, signer
  });
  const b = await governSandboxExecution({
    ward, authorityEnvelope: envelope, action: action("shell.exec", "mm-b"),
    provider: new LocalProcessSandboxProvider(), policy: policy(),
    command: { command: NODE, args: ["-e", "console.log('b')"] }, signer
  });

  // Receipt A is bound to Warrant A, not Warrant B.
  const mismatch = verifySandboxReceipt(a.receipt!, { warrant: b.warrant });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.failures.some((f) => /warrant id does not match/.test(f)));

  // Tampering with the captured output breaks the signed receipt hash.
  const tampered = { ...a.receipt!, stdout: "forged output" };
  assert.equal(verifySandboxReceipt(tampered, { warrant: a.warrant }).ok, false);
});

test("buildSandboxReceipt + verify works for a standalone (unsigned) receipt", async () => {
  const signer = testSigner();
  const allowed = await governSandboxExecution({
    ward, authorityEnvelope: envelope, action: action("shell.exec", "standalone-1"),
    provider: new LocalProcessSandboxProvider(), policy: policy(),
    command: { command: NODE, args: ["-e", "console.log('x')"] }, signer
  });
  const unsigned = buildSandboxReceipt(
    { command: NODE, args: [], started_at: "2026-05-23T12:00:00.000Z", finished_at: "2026-05-23T12:00:00.100Z", duration_ms: 100, exit_code: 0, status: "ok", stdout: "x", stderr: "", output_truncated: false },
    { provider: "local-process", warrant: allowed.warrant!, canonical_action_hash: allowed.canonical_action_hash }
  );
  assert.equal(unsigned.signature, undefined);
  assert.equal(verifySandboxReceipt(unsigned, { warrant: allowed.warrant }).ok, true);
});
