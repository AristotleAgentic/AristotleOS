import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
