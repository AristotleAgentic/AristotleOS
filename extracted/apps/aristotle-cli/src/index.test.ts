import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./index.js";

const capture = async (argv: string[], cwd: string) => {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, cwd, (message) => { stdout += message; }, (message) => { stderr += message; });
  return { code, stdout, stderr };
};

test("cli init creates a valid governance file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    assert.equal((await capture(["init"], dir)).code, 0);
    const check = await capture(["check"], dir);
    assert.equal(check.code, 0);
    assert.match(check.stdout, /policy_hash=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli execution-control evaluate runs Ward/Warrant action through AristotleOS", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    const examples = path.resolve(process.cwd(), "examples", "execution_control");
    cpSync(examples, path.join(dir, "execution_control"), { recursive: true });
    const result = await capture([
      "execution-control",
      "evaluate",
      "--ward",
      "execution_control/ward.montana_drone_test_range.yaml",
      "--envelope",
      "execution_control/authority_envelope.survey_planner.yaml",
      "--action",
      "execution_control/actions/allow_takeoff.json",
      "--ledger",
      ".tmp/gel.jsonl",
      "--evidence-out",
      ".tmp/evidence-bundle.json",
      "--now",
      "2026-05-21T14:00:00.000Z"
    ], dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /decision=ALLOW/);
    assert.match(result.stdout, /warrant_id=wrn-/);
    assert.match(result.stdout, /ledger_verification=ok/);
    assert.match(result.stdout, /evidence_bundle=.tmp\/evidence-bundle.json/);
    assert.equal(existsSync(path.join(dir, ".tmp", "evidence-bundle.json")), true);

    const verification = await capture([
      "execution-control",
      "evidence",
      "verify",
      "--bundle",
      ".tmp/evidence-bundle.json"
    ], dir);
    assert.equal(verification.code, 0, verification.stderr);
    assert.match(verification.stdout, /evidence_verification=ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli run governs a child agent process and writes a verifiable ledger", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    await capture(["init"], dir);
    const run = await capture(["run", "--", "node", "aristotle/agent.mjs"], dir);
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /governing this session/);
    assert.match(run.stdout, /Boundary: http:\/\/127\.0\.0\.1:\d+/);
    assert.equal(existsSync(path.join(dir, ".aristotle", "gel.jsonl")), true);
    const audit = await capture(["execution-control", "audit", "verify", "--ledger", ".aristotle/gel.jsonl"], dir);
    assert.equal(audit.code, 0, audit.stderr);
    assert.match(audit.stdout, /ledger_verification=ok/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli run with the SQLite backend governs an agent and persists a durable ledger", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    await capture(["init"], dir);
    const run = await capture(["run", "--ledger-backend", "sqlite", "--", "node", "aristotle/agent.mjs"], dir);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(existsSync(path.join(dir, ".aristotle", "gel.db")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli kill switch halts governed runs until released", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    await capture(["init"], dir);
    const engage = await capture(["kill", "engage"], dir);
    assert.equal(engage.code, 0);
    assert.match(engage.stdout, /ENGAGED/);

    const halted = await capture(["run", "--", "node", "aristotle/agent.mjs"], dir);
    assert.notEqual(halted.code, 0); // agent was refused at the boundary

    const release = await capture(["kill", "release"], dir);
    assert.equal(release.code, 0);

    const allowed = await capture(["run", "--", "node", "aristotle/agent.mjs"], dir);
    assert.equal(allowed.code, 0, allowed.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli revoke halts a governed run until cleared", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    await capture(["init"], dir);
    const revoke = await capture(["revoke", "envelope", "ae-local-dev-001"], dir);
    assert.equal(revoke.code, 0);
    assert.match(revoke.stdout, /revoked envelope/);

    const halted = await capture(["run", "--", "node", "aristotle/agent.mjs"], dir);
    assert.notEqual(halted.code, 0); // refused with AUTHORITY_REVOKED

    const cleared = await capture(["revoke", "clear"], dir);
    assert.equal(cleared.code, 0);

    const allowed = await capture(["run", "--", "node", "aristotle/agent.mjs"], dir);
    assert.equal(allowed.code, 0, allowed.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli pilot self-check passes every boundary check", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    const result = await capture(["pilot"], dir);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PILOT READY/);
    assert.doesNotMatch(result.stdout, /FAIL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli preflight blocks without a signing key and passes when configured", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  const savedPriv = process.env.ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH;
  const savedPub = process.env.ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH;
  try {
    await capture(["init"], dir);
    delete process.env.ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH;
    delete process.env.ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH;

    const notReady = await capture(["preflight"], dir);
    assert.notEqual(notReady.code, 0);
    assert.match(notReady.stdout, /NOT READY/);

    await capture(["keys", "generate"], dir);
    process.env.ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH = path.join(dir, "secrets", "warrant-ed25519-private.pem");
    process.env.ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH = path.join(dir, "secrets", "warrant-ed25519-public.pem");
    const ready = await capture(["preflight"], dir);
    assert.equal(ready.code, 0, ready.stdout);
    assert.match(ready.stdout, /READY/);
  } finally {
    if (savedPriv === undefined) delete process.env.ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH; else process.env.ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH = savedPriv;
    if (savedPub === undefined) delete process.env.ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH; else process.env.ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH = savedPub;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli keys generate mints an Ed25519 warrant signing keypair", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    const result = await capture(["keys", "generate", "--out", "secrets"], dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /key_id=ed25519:/);
    assert.equal(existsSync(path.join(dir, "secrets", "warrant-ed25519-private.pem")), true);
    assert.equal(existsSync(path.join(dir, "secrets", "warrant-ed25519-public.pem")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli ward-marshal scans and governs an interdiction", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    const examples = path.resolve(process.cwd(), "examples", "ward_marshal");
    cpSync(examples, path.join(dir, "ward_marshal"), { recursive: true });
    const scan = await capture([
      "ward-marshal",
      "scan",
      "--observations",
      "ward_marshal/observations.enterprise.json",
      "--registry",
      "ward_marshal/agent-registry.json",
      "--out",
      ".tmp/ward-marshal-report.json",
      "--now",
      "2026-05-24T12:00:00.000Z"
    ], dir);
    assert.equal(scan.code, 2, scan.stderr);
    assert.match(scan.stdout, /Ward Marshal census/);
    assert.match(scan.stdout, /ROGUE/);
    assert.equal(existsSync(path.join(dir, ".tmp", "ward-marshal-report.json")), true);

    const interdict = await capture([
      "ward-marshal",
      "interdict",
      "--report",
      ".tmp/ward-marshal-report.json",
      "--ward",
      "ward_marshal/ward.enterprise_autonomy.yaml",
      "--envelope",
      "ward_marshal/authority_envelope.ward_marshal.yaml",
      "--ledger",
      ".tmp/ward-marshal.gel.jsonl",
      "--kind",
      "revoke_credentials",
      "--operator-ticket",
      "SEC-1042",
      "--interdiction-authority",
      "soc-commander",
      "--now",
      "2026-05-24T12:05:00.000Z"
    ], dir);
    assert.equal(interdict.code, 0, interdict.stderr);
    assert.match(interdict.stdout, /decision=ALLOW/);
    assert.match(interdict.stdout, /warrant_id=wrn-/);
    assert.match(interdict.stdout, /ledger_verification=ok/);

    const execute = await capture([
      "ward-marshal",
      "interdict",
      "--report",
      ".tmp/ward-marshal-report.json",
      "--ward",
      "ward_marshal/ward.enterprise_autonomy.yaml",
      "--envelope",
      "ward_marshal/authority_envelope.ward_marshal.yaml",
      "--ledger",
      ".tmp/ward-marshal-execute.gel.jsonl",
      "--kind",
      "revoke_credentials",
      "--execute",
      "--credential-revocations",
      ".tmp/credential-revocations.json",
      "--operator-ticket",
      "SEC-1042",
      "--interdiction-authority",
      "soc-commander",
      "--now",
      "2026-05-24T12:06:00.000Z"
    ], dir);
    assert.equal(execute.code, 0, execute.stderr);
    assert.match(execute.stdout, /executed=yes/);
    assert.match(execute.stdout, /receipt_id=wmr-/);
    assert.equal(existsSync(path.join(dir, ".tmp", "credential-revocations.json")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli ward-marshal discover supports process/mcp sources and requires one", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    // No source ⇒ a clear error naming the available sources.
    const none = await capture(["ward-marshal", "discover"], dir);
    assert.notEqual(none.code, 0);
    assert.match(none.stderr + none.stdout, /requires a source/);

    // --process runs the host collector via the OS `ps`; on a host without `ps`
    // it fails soft to an empty set. Either way the command succeeds and reports.
    const proc = await capture(["ward-marshal", "discover", "--process", "--host", "test-host", "--now", "2026-05-24T12:00:00.000Z"], dir);
    assert.equal(proc.code, 0, proc.stderr);
    assert.match(proc.stdout, /Ward Marshal discovery/);

    // --from-file ingests an exported inventory via a field mapping.
    writeFileSync(path.join(dir, "ci.json"), JSON.stringify({ results: [{ run: "run-9", repo: "acme/api", actor: "deploy-bot", tools: "gh.deploy" }] }));
    const file = await capture([
      "ward-marshal", "discover",
      "--from-file", "ci.json", "--source", "ci",
      "--map", "observation_id=run", "--map", "location=repo", "--map", "declared_agent_id=actor", "--map", "tool_targets=tools",
      "--now", "2026-05-24T12:00:00.000Z"
    ], dir);
    assert.equal(file.code, 0, file.stderr);
    assert.match(file.stdout, /acme\/api/);
    assert.match(file.stdout, /deploy-bot/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli conflicts ingest/list/resolve over a durable inbox", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    const examples = path.resolve(process.cwd(), "examples", "execution_control");
    cpSync(examples, path.join(dir, "execution_control"), { recursive: true });
    // An edge that ALLOWED a now-denied action ⇒ an open conflict.
    const records = [{
      action: { action_id: "edge-1", ward_id: "montana-drone-test-range", subject: "agent:survey-planner", action_type: "drone.disable_geofence", target: "t", params: { boundary_id: "ranch-test-grid-a" }, requested_at: "2026-05-24T12:00:00.000Z", telemetry: { gps_lock: true } },
      edge_decision: "ALLOW", occurred_at: "2026-05-24T12:00:00.000Z"
    }];
    writeFileSync(path.join(dir, "edge.json"), JSON.stringify(records));

    const ingest = await capture(["conflicts", "ingest", "--inbox", ".tmp/inbox.json", "--records", "edge.json",
      "--ward", "execution_control/ward.montana_drone_test_range.yaml",
      "--envelope", "execution_control/authority_envelope.survey_planner.yaml",
      "--now", "2026-05-24T12:00:00.000Z"], dir);
    assert.equal(ingest.code, 0, ingest.stderr);
    assert.match(ingest.stdout, /1 conflict/);

    // list exits non-zero while a conflict is open.
    const listOpen = await capture(["conflicts", "list", "--inbox", ".tmp/inbox.json"], dir);
    assert.equal(listOpen.code, 1);
    assert.match(listOpen.stdout, /CONFLICT/);

    // resolve it, then list is clean (exit 0).
    const resolve = await capture(["conflicts", "resolve", "--inbox", ".tmp/inbox.json", "--action-id", "edge-1", "--action", "reject", "--by", "alice@corp", "--reason", "edge exceeded authority"], dir);
    assert.equal(resolve.code, 0, resolve.stderr);
    assert.match(resolve.stdout, /rejected/);

    const listClean = await capture(["conflicts", "list", "--inbox", ".tmp/inbox.json"], dir);
    assert.equal(listClean.code, 0);
    assert.match(listClean.stdout, /reject by alice@corp/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli plan and demo produce real governance output", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aristotle-cli-"));
  try {
    await capture(["init"], dir);
    const plan = await capture(["plan"], dir);
    assert.equal(plan.code, 0);
    const demo = await capture(["demo", "payments"], dir);
    assert.equal(demo.code, 0);
    assert.match(demo.stdout, /Commit Gate: DEFER/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
