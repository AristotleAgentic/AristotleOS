// Validate that @aristotle/os-cli is ready for public install, end to end:
//   1. `npm pack` the CLI (runs its prepack build) and inspect the tarball contents.
//   2. Assert the published file set is correct (bundle + README + manifest only;
//      no source, secrets, tests, or node_modules).
//   3. Install the packed tarball into a throwaway directory (as a real consumer
//      would) and run `aristotle pilot` from it, asserting the boundary self-check
//      passes from the installed package — no source-checkout assumptions.
//
//   node scripts/check-cli-package.mjs      (npm run package:cli:check)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.join(root, "apps", "aristotle-cli");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const checks = [];
const record = (ok, label, detail) => {
  checks.push({ ok, label, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", ...opts });
}

console.log("AristotleOS CLI package check\n");

// ---- 1. build, then pack and read the file manifest --------------------------
// Build first and pack with --ignore-scripts so the prepack build's stdout does
// not contaminate the JSON manifest we parse from `npm pack --json`.
const packDir = mkdtempSync(path.join(tmpdir(), "aos-cli-pack-"));
let tarball;
let files = [];
try {
  run(process.execPath, ["build.mjs"], { cwd: cliDir, stdio: ["ignore", "ignore", "inherit"], shell: false });
  const out = run(npm, ["pack", "--ignore-scripts", "--json", `--pack-destination=${packDir}`], { cwd: cliDir, stdio: ["ignore", "pipe", "inherit"] });
  const parsed = JSON.parse(out);
  const meta = Array.isArray(parsed) ? parsed[0] : parsed;
  tarball = path.join(packDir, meta.filename);
  files = (meta.files ?? []).map((f) => f.path.replace(/\\/g, "/"));
  record(true, "npm pack succeeds", `${meta.name}@${meta.version}, ${files.length} files`);
} catch (error) {
  record(false, "npm pack succeeds", error?.message ?? String(error));
  finish();
}

const has = (p) => files.includes(p);
record(has("dist/index.js"), "tarball includes the CLI bundle", "dist/index.js");
record(has("package.json"), "tarball includes package.json");
record(has("README.md"), "tarball includes README.md");

const leaked = files.filter((f) =>
  f.startsWith("src/") || f.startsWith("node_modules/") || /\.test\./.test(f) ||
  f.includes("secret") || f === "build.mjs" || f.endsWith("tsconfig.json")
);
record(leaked.length === 0, "tarball excludes source/tests/secrets", leaked.length ? leaked.join(", ") : "clean");

// ---- 2. the bundle is an executable, self-contained ESM binary ---------------
const distEntry = path.join(cliDir, "dist", "index.js");
let bundle = "";
try { bundle = readFileSync(distEntry, "utf8"); } catch { /* handled below */ }
record(bundle.startsWith("#!/usr/bin/env node"), "bundle carries a node shebang");
record(!/\bfrom\s+["']@aristotle\//.test(bundle), "bundle inlines @aristotle/* workspace deps", "no unresolved workspace imports");

const pkg = JSON.parse(readFileSync(path.join(cliDir, "package.json"), "utf8"));
record(pkg.bin?.aristotle === "dist/index.js" && has(pkg.bin.aristotle), "bin target is published", pkg.bin?.aristotle);
record(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, "no runtime dependencies (self-contained)");

// ---- 3. install the tarball as a consumer and run `aristotle pilot` ----------
const installDir = mkdtempSync(path.join(tmpdir(), "aos-cli-install-"));
try {
  writeFileSync(path.join(installDir, "package.json"), JSON.stringify({ name: "aos-cli-smoke", private: true, version: "0.0.0" }) + "\n");
  run(npm, ["install", tarball, "--no-audit", "--no-fund", "--loglevel=error"], { cwd: installDir, stdio: ["ignore", "ignore", "inherit"] });
  const installedEntry = path.join(installDir, "node_modules", "@aristotle", "os-cli", "dist", "index.js");
  record(existsSync(installedEntry), "installs into a clean consumer project");

  const pilotOut = run(process.execPath, [installedEntry, "pilot"], { cwd: installDir, stdio: ["ignore", "pipe", "pipe"], shell: false });
  record(/PILOT READY/.test(pilotOut), "packed `aristotle pilot` passes", "all boundary checks green");
} catch (error) {
  const detail = (error?.stdout || "") + (error?.stderr || error?.message || String(error));
  record(false, "packed `aristotle pilot` passes", detail.split(/\r?\n/).slice(-3).join(" | "));
} finally {
  rmSync(installDir, { recursive: true, force: true });
}

finish();

function finish() {
  rmSync(packDir, { recursive: true, force: true });
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length ? `FAIL — ${failed.length} check(s) failed` : "OK — @aristotle/os-cli packs, installs, and self-checks cleanly"}`);
  process.exit(failed.length ? 1 : 0);
}
