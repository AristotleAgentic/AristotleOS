/**
 * @aristotle/reviewer — CLI tests.
 *
 * These exercise the bundled bin (`dist/index.js`) via `execFileSync` so
 * the tests prove `npx @aristotle/reviewer ...` will actually work for
 * downstream consumers.
 *
 * Run with:
 *   node --import tsx --test src/index.test.ts
 *
 * The bundle is built at install time (`prepare` script) and rebuilt by
 * the first test below if missing — so the test file is self-bootstrapping.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { createHash, generateKeyPairSync } from "node:crypto";

import {
  createEd25519Signer,
  evaluateCommitGate,
  exportEvidenceBundle,
  issueWarrant,
  appendGelRecord,
  loadGelChain,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type WardManifest
} from "@aristotle/execution-control-runtime";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolvePath(here, "..");
const bundlePath = join(packageRoot, "dist", "index.js");

// ---------------------------------------------------------------------------
// Build the bundle on first use so the tests can run from a clean checkout
// ---------------------------------------------------------------------------

let bundleEnsured = false;
function ensureBundle(): void {
  if (bundleEnsured) return;
  if (!existsSync(bundlePath)) {
    const built = spawnSync(process.execPath, [join(packageRoot, "build.mjs")], {
      cwd: packageRoot,
      stdio: "inherit"
    });
    if (built.status !== 0) {
      throw new Error(`build.mjs failed (exit ${built.status})`);
    }
  }
  if (!existsSync(bundlePath)) {
    throw new Error(`bundle did not produce ${bundlePath}`);
  }
  bundleEnsured = true;
}

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runBin(args: string[], opts: { cwd?: string } = {}): CliResult {
  ensureBundle();
  // spawnSync (unlike execFileSync) returns stdout AND stderr on both
  // success and failure exits — execFileSync drops them on success-but-
  // sometimes-throws paths.
  const result = spawnSync(process.execPath, [bundlePath, ...args], {
    cwd: opts.cwd ?? packageRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ? result.stdout.toString("utf8") : "",
    stderr: result.stderr ? result.stderr.toString("utf8") : ""
  };
}

// ---------------------------------------------------------------------------
// Helpers for building a real (passing + tamperable) evidence bundle in a tempdir
// ---------------------------------------------------------------------------

function makeSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return createEd25519Signer({
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  });
}

function ward(): WardManifest {
  return {
    ward_id: "ward-reviewer-cli", name: "Reviewer CLI Test Ward",
    sovereignty_context: "test", authority_domain: "test.local",
    policy_version: "1.0.0",
    permitted_subjects: ["agent:rev"],
    physical_bounds: { max_altitude_m: 120 }
  };
}

function envelope(): AuthorityEnvelope {
  return {
    envelope_id: "ae-rev", ward_id: "ward-reviewer-cli", subject: "agent:rev",
    allowed_actions: ["demo.actuate"], denied_actions: [],
    constraints: {}, expires_at: "2099-01-01T00:00:00.000Z", issuer: "test-root"
  };
}

function action(): CanonicalActionInput {
  return {
    action_id: "act-rev-001",
    ward_id: "ward-reviewer-cli", subject: "agent:rev",
    action_type: "demo.actuate", target: "device:1",
    params: { altitude_m: 50 },
    requested_at: "2026-05-26T15:00:00.000Z",
    request_id: "req-rev-001"
  };
}

interface BundleFixture {
  bundlePath: string;
  warrantPath: string;
  canonicalActionHash: string;
  signerKeyId: string;
  cleanup: () => void;
}

function makeBundleFixture(): BundleFixture {
  const tmp = mkdtempSync(join(tmpdir(), "aristotle-reviewer-test-"));
  const ledgerPath = join(tmp, "gel.log");

  const signer = makeSigner();
  const NOW = "2026-05-26T15:00:00.000Z";
  const decision = evaluateCommitGate({ ward: ward(), authorityEnvelope: envelope(), action: action(), now: NOW });
  assert.equal(decision.decision, "ALLOW", "fixture setup: gate must ALLOW");
  const warrant = issueWarrant(decision, action(), envelope(), NOW, signer, 60);
  assert.ok(warrant, "fixture setup: warrant must issue");

  // Append a GEL record describing the admit (the bundle wants a ledger chain).
  appendGelRecord({
    ledgerPath,
    ward: ward(),
    action: action(),
    decision,
    warrant: warrant ?? undefined,
    now: NOW
  });
  // Sanity: the chain has at least one record.
  assert.ok(loadGelChain(ledgerPath).length >= 1);

  const bundle = exportEvidenceBundle({
    ledgerPath,
    ward: ward(),
    authorityEnvelope: envelope(),
    warrant: warrant ?? undefined,
    signer,
    exportedAt: NOW
  });
  assert.equal(bundle.verification.ok, true, `fixture setup: bundle must verify clean (got failures: ${bundle.verification.failures.join("; ")})`);

  const bundlePathOut = join(tmp, "bundle.json");
  writeFileSync(bundlePathOut, JSON.stringify(bundle), "utf8");

  const warrantPathOut = join(tmp, "warrant.json");
  writeFileSync(warrantPathOut, JSON.stringify(warrant), "utf8");

  return {
    bundlePath: bundlePathOut,
    warrantPath: warrantPathOut,
    canonicalActionHash: decision.canonical_action_hash,
    signerKeyId: signer.key_id,
    cleanup: () => rmSync(tmp, { recursive: true, force: true })
  };
}

// ---------------------------------------------------------------------------
// Tests: version + help
// ---------------------------------------------------------------------------

test("CLI: --version prints the package version on stdout, exit 0", () => {
  const res = runBin(["--version"]);
  assert.equal(res.status, 0);
  // package.json declares 0.1.0; matches the constant in src/index.ts.
  assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("CLI: help subcommand prints usage on stdout, exit 0", () => {
  const res = runBin(["help"]);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes("aristotle-reviewer"));
  assert.ok(res.stdout.includes("verify"));
  assert.ok(res.stdout.includes("verify-warrant"));
  assert.ok(res.stdout.includes("verify-replay"));
});

test("CLI: no args prints usage on stdout, exit 1", () => {
  const res = runBin([]);
  assert.equal(res.status, 1);
  assert.ok(res.stdout.includes("aristotle-reviewer"));
});

test("CLI: unknown subcommand exits 2 with usage on stderr", () => {
  const res = runBin(["doesnotexist"]);
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes("unknown subcommand"));
});

// ---------------------------------------------------------------------------
// Tests: verify (Evidence Bundle)
// ---------------------------------------------------------------------------

test("CLI verify: a known-good bundle returns exit 0 with ok: true in stdout", () => {
  const fx = makeBundleFixture();
  try {
    const res = runBin(["verify", fx.bundlePath]);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}: stderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout) as { ok: boolean; command: string; verification: { ok: boolean } };
    assert.equal(parsed.command, "verify");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.verification.ok, true);
    // stderr should carry the one-line summary; tolerate either casing
    // form ("PASS" / "FAIL") in case of OS line-ending differences.
    assert.match(res.stderr, /evidence-bundle\s+PASS/);
  } finally {
    fx.cleanup();
  }
});

test("CLI verify: a tampered bundle returns non-zero exit", () => {
  const fx = makeBundleFixture();
  try {
    // Mutate a byte: flip a character inside the ward_id field of the
    // selected_record (this breaks the hash chain).
    const raw = readFileSync(fx.bundlePath, "utf8");
    const tampered = raw.replace("ward-reviewer-cli", "ward-reviewer-XLI");
    assert.notEqual(tampered, raw, "tamper test setup: replacement must change the bundle");
    writeFileSync(fx.bundlePath, tampered, "utf8");

    const res = runBin(["verify", fx.bundlePath]);
    assert.notEqual(res.status, 0, "tampered bundle must NOT pass verification");
    const parsed = JSON.parse(res.stdout) as { ok: boolean };
    assert.equal(parsed.ok, false);
    assert.ok(res.stderr.includes("FAIL"));
  } finally {
    fx.cleanup();
  }
});

test("CLI verify: missing file argument exits 1 with stderr hint", () => {
  const res = runBin(["verify"]);
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes("requires <bundle.json>"));
});

test("CLI verify: nonexistent file exits 1", () => {
  const res = runBin(["verify", "/tmp/this-does-not-exist-aristotle.json"]);
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes("cannot read bundle"));
});

// ---------------------------------------------------------------------------
// Tests: verify-warrant
// ---------------------------------------------------------------------------

test("CLI verify-warrant: trusted key + matching hash returns ok: true, exit 0", () => {
  const fx = makeBundleFixture();
  try {
    const res = runBin([
      "verify-warrant",
      fx.warrantPath,
      fx.canonicalActionHash,
      "--trusted-key", fx.signerKeyId,
      "--now", "2026-05-26T15:00:00.000Z"
    ]);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}: stderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout) as { result: { ok: boolean } };
    assert.equal(parsed.result.ok, true);
  } finally {
    fx.cleanup();
  }
});

test("CLI verify-warrant: untrusted key returns ok: false, exit 1", () => {
  const fx = makeBundleFixture();
  try {
    const res = runBin([
      "verify-warrant",
      fx.warrantPath,
      fx.canonicalActionHash,
      "--trusted-key", "some-untrusted-key-id",
      "--now", "2026-05-26T15:00:00.000Z"
    ]);
    assert.equal(res.status, 1);
    const parsed = JSON.parse(res.stdout) as { result: { ok: boolean; reason?: string } };
    assert.equal(parsed.result.ok, false);
    assert.equal(parsed.result.reason, "UNTRUSTED_SIGNING_KEY");
  } finally {
    fx.cleanup();
  }
});

test("CLI verify-warrant: action hash mismatch returns ok: false, exit 1", () => {
  const fx = makeBundleFixture();
  try {
    const res = runBin([
      "verify-warrant",
      fx.warrantPath,
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "--trusted-key", fx.signerKeyId,
      "--now", "2026-05-26T15:00:00.000Z"
    ]);
    assert.equal(res.status, 1);
    const parsed = JSON.parse(res.stdout) as { result: { ok: boolean; reason?: string } };
    assert.equal(parsed.result.ok, false);
    assert.equal(parsed.result.reason, "ACTION_HASH_MISMATCH");
  } finally {
    fx.cleanup();
  }
});

test("CLI verify-warrant: missing required args exits 1", () => {
  const res = runBin(["verify-warrant", "/tmp/warrant.json"]);
  assert.equal(res.status, 1);
  assert.ok(res.stderr.includes("requires"));
});

// ---------------------------------------------------------------------------
// Tests: verify-replay
// ---------------------------------------------------------------------------

test("CLI verify-replay: a well-formed replay artifact returns ok: true, exit 0", () => {
  // Build a minimal replay artifact inline (do not depend on the
  // examples/mesh published artifact — keeps the test hermetic).
  const tmp = mkdtempSync(join(tmpdir(), "aristotle-reviewer-replay-"));
  try {
    const inputs = { assetCount: 3, fluidityTtlMs: 1000 };
    const report = { phase1_allow: 3, phase2_refuse: 0, total: 3 };
    const reportHash = "sha256:" + sha256(stableStringify(report));
    const partial = {
      format: "aristotle.replay-artifact.v1" as const,
      scenario_id: "test-scenario",
      scenario_version: "1.0.0",
      inputs,
      report,
      report_hash: reportHash,
      provenance: { producer: "test", produced_at: "2026-05-26T15:00:00.000Z" }
    };
    const artifactHash = "sha256:" + sha256(stableStringify(partial));
    const artifact = { ...partial, artifact_hash: artifactHash };
    const file = join(tmp, "replay.json");
    writeFileSync(file, JSON.stringify(artifact), "utf8");

    const res = runBin(["verify-replay", file]);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}: stderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout) as {
      ok: boolean;
      artifact_hash_ok: boolean;
      report_hash_ok: boolean;
      scenario_id: string;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.artifact_hash_ok, true);
    assert.equal(parsed.report_hash_ok, true);
    assert.equal(parsed.scenario_id, "test-scenario");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI verify-replay: a tampered report_hash returns ok: false, exit 1", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aristotle-reviewer-replay-"));
  try {
    const inputs = { assetCount: 3, fluidityTtlMs: 1000 };
    const report = { phase1_allow: 3, phase2_refuse: 0, total: 3 };
    const reportHash = "sha256:" + sha256(stableStringify(report));
    const partial = {
      format: "aristotle.replay-artifact.v1" as const,
      scenario_id: "test-scenario",
      scenario_version: "1.0.0",
      inputs,
      report,
      // Tamper: bogus report_hash that will not match.
      report_hash: "sha256:" + "0".repeat(64),
      provenance: { producer: "test", produced_at: "2026-05-26T15:00:00.000Z" }
    };
    const artifactHash = "sha256:" + sha256(stableStringify(partial));
    const artifact = { ...partial, artifact_hash: artifactHash };
    const file = join(tmp, "replay.json");
    writeFileSync(file, JSON.stringify(artifact), "utf8");

    const res = runBin(["verify-replay", file]);
    assert.equal(res.status, 1);
    const parsed = JSON.parse(res.stdout) as {
      ok: boolean;
      report_hash_ok: boolean;
      failures: string[];
    };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.report_hash_ok, false);
    assert.ok(parsed.failures.some((f) => f.includes("report_hash")));
    void reportHash; // unused — only the deliberately-bogus hash should win
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("CLI verify-replay: invalid artifact format exits 1", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aristotle-reviewer-replay-"));
  try {
    const file = join(tmp, "garbage.json");
    writeFileSync(file, '{"hello":"world"}', "utf8");

    const res = runBin(["verify-replay", file]);
    assert.equal(res.status, 1);
    assert.ok(res.stderr.includes("invalid artifact") || res.stderr.includes("unexpected"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Hash helpers (kept identical to the CLI's internal helpers so the tests
// produce the same outputs as the CLI would, by construction).
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
