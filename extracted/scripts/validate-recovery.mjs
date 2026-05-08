import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runStep(label, command, args) {
  console.log(`[recovery] ${label}`);
  const isWindows = process.platform === "win32";
  const result = spawnSync(isWindows ? "cmd.exe" : command, isWindows ? ["/c", command, ...args] : args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

async function main() {
  runStep("creating governed snapshot", "npm.cmd", ["run", "enterprise:backup"]);
  runStep("verifying latest snapshot restore readiness", "node", ["scripts/restore-governance-state.mjs", "--yes", "--dry-run"]);
  console.log("[recovery] disaster recovery validation passed");
}

main().catch((error) => {
  console.error("[recovery] disaster recovery validation failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
