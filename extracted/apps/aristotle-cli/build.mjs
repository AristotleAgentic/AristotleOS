// Bundle the AristotleOS CLI into a single self-contained ESM file.
//
// The monorepo resolves @aristotle/* via tsconfig "paths" (no installed
// packages), so the published CLI must inline its workspace deps. esbuild
// follows the same tsconfig paths and bundles everything into dist/index.js.
//
// The shebang is added here (not via esbuild's --banner) so no shell mangles
// the "/usr/bin/env" path on Windows/Git Bash.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(dir, "src", "index.ts");
const distDir = path.join(dir, "dist");
const outfile = path.join(distDir, "index.js");
const tsconfig = path.resolve(dir, "..", "..", "tsconfig.base.json");
const esbuildBin = require.resolve("esbuild/bin/esbuild");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const args = [
  esbuildBin,
  entry,
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node18",
  `--tsconfig=${tsconfig}`,
  `--outfile=${outfile}`
];
execFileSync(process.execPath, args, { stdio: "inherit", cwd: dir });

const shebang = "#!/usr/bin/env node\n";
const bundled = readFileSync(outfile, "utf8");
if (!bundled.startsWith(shebang)) writeFileSync(outfile, shebang + bundled, "utf8");
try {
  chmodSync(outfile, 0o755);
} catch {
  // chmod is a no-op on Windows; the published tarball still records bin perms.
}
console.log(`bundled AristotleOS CLI -> ${path.relative(process.cwd(), outfile)}`);
