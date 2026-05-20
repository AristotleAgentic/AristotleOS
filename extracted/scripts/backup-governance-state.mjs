import fs from "node:fs";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
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

async function main() {
  const envFile = parseEnvFile(envPath);
  const backupRoot = process.env.GOVERNANCE_BACKUP_DIR
    ? path.resolve(process.cwd(), process.env.GOVERNANCE_BACKUP_DIR)
    : path.join(repoRoot, "backups");
  const timestamp = new Date().toISOString().replace(/[:]/g, "-").replace(/\..+/, "Z");
  const backupDir = path.join(backupRoot, `snapshot-${timestamp}`);

  const targets = [
    {
      name: "evidence-ledger-state",
      path: resolveStatePath(pick(envFile, "EVIDENCE_LEDGER_STATE_PATH", "./data/evidence-ledger.json"), "services/evidence-ledger")
    },
    {
      name: "agent-os-state",
      path: resolveStatePath(pick(envFile, "AGENT_OS_STATE_PATH", "./data/agent-os.json"), "services/agent-os")
    },
    {
      name: "governance-chain-state",
      path: resolveStatePath(pick(envFile, "GOVERNANCE_CHAIN_STATE_PATH", "./data/governance-chain.json"), "services/governance-kernel")
    }
  ];

  await mkdir(backupDir, { recursive: true });

  const manifest = {
    createdAt: new Date().toISOString(),
    sourceEnv: envPath,
    snapshotDir: backupDir,
    files: []
  };

  for (const target of targets) {
    if (!fs.existsSync(target.path)) {
      console.log(`[backup] skipped ${target.name} (missing ${target.path})`);
      continue;
    }
    const destination = path.join(backupDir, path.basename(target.path));
    await copyFile(target.path, destination);
    const digest = sha256ForFile(destination);
    manifest.files.push({
      name: target.name,
      source: target.path,
      destination,
      sha256: digest
    });
    console.log(`[backup] copied ${target.name} -> ${destination}`);
  }

  const manifestPath = path.join(backupDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[backup] manifest ${manifestPath}`);
}

main().catch((error) => {
  console.error("[backup] failed");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
