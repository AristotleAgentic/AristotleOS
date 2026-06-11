import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type SandboxPolicy,
  type WardManifest,
  ContainerSandboxProvider,
  LocalProcessSandboxProvider,
  WasmSandboxProvider,
  buildContainerRunArgs,
  buildSandboxReceipt,
  buildWasmRunArgs,
  createEd25519Signer,
  detectContainerRuntime,
  executeInSandbox,
  governSandboxExecution,
  verifySandboxEvidence,
  verifySandboxReceipt
} from "./index.js";

/** Index of the value following a flag in an argv array (-1 if the flag is absent). */
function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

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

// --- Container provider (real namespace + cgroup isolation) -----------------

test("buildContainerRunArgs enforces network-off, read-only rootfs, dropped caps, and limits", () => {
  const p = policy({ allowed_commands: ["/bin/echo"], env_allowlist: ["MY_TOKEN"] });
  const args = buildContainerRunArgs({ image: "alpine:3.20", user: "1000:1000", memory: "128m", pidsLimit: 64 }, p, { command: "/bin/echo", args: ["hi"] }, "/tmp/work");

  assert.equal(flagValue(args, "--network"), "none", "network is off by default");
  assert.ok(args.includes("--read-only"), "rootfs is read-only");
  assert.equal(flagValue(args, "--cap-drop"), "ALL", "all capabilities dropped");
  assert.equal(flagValue(args, "--security-opt"), "no-new-privileges");
  assert.equal(flagValue(args, "--memory"), "128m");
  assert.equal(flagValue(args, "--pids-limit"), "64");
  assert.equal(flagValue(args, "--user"), "1000:1000");
  assert.equal(flagValue(args, "--volume"), "/tmp/work:/sandbox:rw");
  assert.equal(flagValue(args, "--workdir"), "/sandbox");

  // env is passed by name only — the secret value must never reach the host argv
  assert.equal(flagValue(args, "--env"), "MY_TOKEN");
  assert.ok(!args.some((a) => a.includes("MY_TOKEN=")), "secret value must not appear in argv");

  // image, then the logical command + args, come last
  assert.deepEqual(args.slice(-3), ["alpine:3.20", "/bin/echo", "hi"]);
});

test("buildContainerRunArgs opts into bridge networking only when the policy allows it", () => {
  const args = buildContainerRunArgs({ image: "x" }, policy({ allow_network: true }), { command: "/bin/echo" }, "/w");
  assert.equal(flagValue(args, "--network"), "bridge");
});

test("ContainerSandboxProvider derives its name from the runtime and requires an image", () => {
  assert.throws(() => new ContainerSandboxProvider({ image: "" }), /requires an image/);
  const provider = new ContainerSandboxProvider({ image: "alpine:3.20", runtime: "podman" });
  assert.equal(provider.name, "container:podman");
});

test("ContainerSandboxProvider denies a disallowed binary before invoking the runtime", async () => {
  // runtime pinned so construction needs no docker on PATH; the allowlist denies pre-spawn.
  const provider = new ContainerSandboxProvider({ image: "alpine:3.20", runtime: "docker" });
  const res = await executeInSandbox(provider, { command: "/bin/badcmd" }, policy({ allowed_commands: ["/bin/echo"] }));
  assert.equal(res.status, "denied");
  assert.match(res.stderr, /not in sandbox allowlist/);
});

const containerRuntime = detectContainerRuntime();
function containerDaemonUp(rt: string): boolean {
  try { const p = spawnSync(rt, ["info"], { stdio: "ignore", timeout: 8000 }); return !p.error && p.status === 0; } catch { return false; }
}
// Opt-in (AOS_SANDBOX_E2E=1) AND a runtime whose daemon is actually reachable — so a
// CLI-installed-but-daemon-down host skips cleanly instead of hard-failing.
const containerE2E = process.env.AOS_SANDBOX_E2E === "1" && Boolean(containerRuntime) && containerDaemonUp(containerRuntime!);
test("ContainerSandboxProvider runs a governed command in a real container (e2e)", { skip: containerE2E ? false : "set AOS_SANDBOX_E2E=1 with a running docker/podman daemon" }, async () => {
  const signer = testSigner();
  const out = await governSandboxExecution({
    ward, authorityEnvelope: envelope, action: action("shell.exec", "ctr-e2e"),
    provider: new ContainerSandboxProvider({ image: "alpine:3.20" }),
    policy: policy({ allowed_commands: ["/bin/echo"], timeout_ms: 60000 }),
    command: { command: "/bin/echo", args: ["hello-container"] }, signer
  });
  assert.equal(out.decision, "ALLOW");
  assert.equal(out.receipt!.status, "ok");
  assert.match(out.receipt!.stdout, /hello-container/);
  assert.equal(out.receipt!.command, "/bin/echo", "receipt records the logical command, not the runtime");
  assert.equal(verifySandboxEvidence(out.evidence!).ok, true);
});

// --- Wasm provider (capability-based WASI isolation) ------------------------

test("buildWasmRunArgs denies fs/net/env by default and grants only what the policy allows", () => {
  const noGrant = buildWasmRunArgs({ mountWorkingDir: false }, policy(), { command: "mod.wasm", args: ["x"] }, "/w", {});
  assert.deepEqual(noGrant, ["run", "mod.wasm", "x"], "no --dir, no network, no env by default");

  const granted = buildWasmRunArgs({}, policy({ allow_network: true }), { command: "mod.wasm" }, "/w", { TOK: "v" });
  assert.equal(flagValue(granted, "-S"), "inherit-network", "network only when allowed");
  assert.equal(flagValue(granted, "--dir"), "/w::/sandbox", "working dir preopened when mounting");
  assert.equal(flagValue(granted, "--env"), "TOK=v");
});

test("WasmSandboxProvider denies a disallowed module before invoking wasmtime", async () => {
  const provider = new WasmSandboxProvider({ binaryPath: "wasmtime" });
  assert.equal(provider.name, "wasm:wasmtime");
  const res = await executeInSandbox(provider, { command: "evil.wasm" }, policy({ allowed_commands: ["ok.wasm"] }));
  assert.equal(res.status, "denied");
  assert.match(res.stderr, /not in sandbox allowlist/);
});
