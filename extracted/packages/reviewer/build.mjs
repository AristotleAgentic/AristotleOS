// Bundle the AristotleOS reviewer CLI into a single self-contained ESM file.
//
// The substrate resolves @aristotle/* via tsconfig "paths" (workspace
// sources, not installed packages). esbuild follows the same paths and
// bundles every reachable workspace source into dist/index.js so npx can
// execute it without a clone.
//
// The shebang is added here (not via esbuild's --banner) so no shell
// mangles the "/usr/bin/env" path on Windows / Git Bash.

import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(dir, "src", "cli.ts");
const distDir = path.join(dir, "dist");
const outfile = path.join(distDir, "index.js");
const tsconfig = path.join(dir, "tsconfig.json");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const quote = (value) => `"${value}"`;
const command = [
  "npx",
  "-y",
  "esbuild@0.28.0",
  quote(entry),
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node18",
  `--tsconfig=${quote(tsconfig)}`,
  `--outfile=${quote(outfile)}`
].join(" ");
execSync(command, { stdio: "inherit", cwd: dir });

const shebang = "#!/usr/bin/env node\n";
const bundled = readFileSync(outfile, "utf8");
if (!bundled.startsWith(shebang)) writeFileSync(outfile, shebang + bundled, "utf8");
try {
  chmodSync(outfile, 0o755);
} catch {
  // chmod is a no-op on Windows; npm packs the bin perms separately.
}
console.log(`bundled AristotleOS reviewer CLI -> ${path.relative(process.cwd(), outfile)}`);
