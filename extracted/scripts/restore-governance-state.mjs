import fs from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.env.ENTERPRISE_ENV_PATH
  ? path.resolve(process.cwd(), process.env.ENTERPRISE_ENV_PATH)
  : path.join(repoRoot, ".env");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  const entries = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    entries[key] = value;
  }
  return entries;
}

function pick(config, key, fallback = "") {
  const direct = process.env[key];
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }
  return config[key] ?? fallback;
}

function resolveStatePath(relativePath, serviceDir) {
  const repoCandidate = path.resolve(repoRoot, relativePath);
  if (fs.existsSync(repoCandidate)) {
    return repoCandidate;
  }
  return path.resolve(repoRoot, serviceDir, relativePath);
}

function sha256ForFile(filePath) {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function latestSnapshotDir(backupRoot) {
  const snapshots = fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("snapshot-"))
    .map((entry) => entry.name)
    .sort();
  if (!snapshots.length) {
    throw new Error(`No governance snapshots found in ${backupRoot}`);
  }
  return path.join(backupRoot, snapshots[snapshots.length - 1]);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!process.argv.includes("--yes")) {
    throw new Error("Refusing to restore without --yes.");
  }

  const envFile = parseEnvFile(envPath);
  const backupRoot = process.env.GOVERNANCE_BACKUP_DIR
    ? path.resolve(process.cwd(), process.env.GOVERNANCE_BACKUP_DIR)
    : path.join(repoRoot, "backups");
  const snapshotDir = process.env.GOVERNANCE_RESTORE_SNAPSHOT
    ? path.resolve(process.cwd(), process.env.GOVERNANCE_RESTORE_SNAPSHOT)
    : latestSnapshotDir(backupRoot);
  const manifestPath = path.join(snapshotDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Snapshot manifest not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const destinations = {
    "evidence-ledger-state": resolveStatePath(
      pick(envFile, "EVIDENCE_LEDGER_STATE_PATH", "./data/evidence-ledger.json"),
      "services/evidence-ledger"
    ),
    "agent-os-state": resolveStatePath(pick(envFile, "AGENT_OS_STATE_PATH", "./data/agent-os.json"), "services/agent-os")
  };

  for (const file of manifest.files ?? []) {
    const expectedDigest = file.sha256;
    const actualDigest = sha256ForFile(file.destination);
    if (expectedDigest !== actualDigest) {
      throw new Error(`Digest mismatch for ${file.destination}`);
    }
    const destination = destinations[file.name];
    if (!destination) {
      continue;
    }
    if (dryRun) {
      console.log(`[restore] verified ${file.name} -> ${destination}`);
      continue;
    }
    await copyFile(file.destination, destination);
    console.log(`[restore] restored ${file.name} -> ${destination}`);
  }

  console.log(`[restore] ${dryRun ? "verified" : "completed"} from ${snapshotDir}`);
}

main().catch((error) => {
  console.error("[restore] failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
