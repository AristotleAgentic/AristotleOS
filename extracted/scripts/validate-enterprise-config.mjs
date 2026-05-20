import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.env.ENTERPRISE_ENV_PATH
  ? path.resolve(process.cwd(), process.env.ENTERPRISE_ENV_PATH)
  : path.join(repoRoot, ".env");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
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

function isTruthy(value) {
  return value === "1" || value === "true" || value === "TRUE";
}

function addCheck(checks, name, ok, detail) {
  checks.push({ name, ok, detail });
}

function main() {
  const envFile = parseEnvFile(envPath);
  const mode = (pick(envFile, "NODE_ENV", "development") || "development").trim();
  const targetMode = process.argv.includes("--production") ? "production" : mode;
  const checks = [];

  const operatorApiKey = pick(envFile, "OPERATOR_API_KEY");
  const serviceDiscoveryMode = pick(envFile, "SERVICE_DISCOVERY_MODE", "local");
  const ledgerStatePath = pick(envFile, "EVIDENCE_LEDGER_STATE_PATH");
  const agentOsStatePath = pick(envFile, "AGENT_OS_STATE_PATH");
  const ledgerSigningSecret = pick(envFile, "EVIDENCE_LEDGER_SIGNING_SECRET", "");
  const ledgerSigningPrivateKeyPath = pick(envFile, "EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH", "");
  const ledgerSigningPublicKeyPath = pick(envFile, "EVIDENCE_LEDGER_SIGNING_PUBLIC_KEY_PATH", "");
  const insecureOverride = isTruthy(pick(envFile, "ALLOW_INSECURE_PRODUCTION_BOOT", "false"));
  const roleEnforcement = isTruthy(pick(envFile, "OPERATOR_ROLE_ENFORCEMENT", "false"));
  const sessionEnforcement = isTruthy(pick(envFile, "OPERATOR_SESSION_ENFORCEMENT", "false"));
  const sessionSecret = pick(envFile, "OPERATOR_SESSION_SECRET", "");
  const defaultRole = pick(envFile, "OPERATOR_DEFAULT_ROLE", "operator");
  const mutationRoles = pick(envFile, "OPERATOR_MUTATION_ROLES", "operator,admin");
  const readActors = pick(envFile, "OPERATOR_READ_ACTORS", "");
  const mutationActors = pick(envFile, "OPERATOR_MUTATION_ACTORS", "");
  const viteActor = pick(envFile, "VITE_OPERATOR_ACTOR", "console-ui");
  const operatorActor = pick(envFile, "OPERATOR_ACTOR", "validate-core");
  const chainV2Enabled = isTruthy(pick(envFile, "GOVERNANCE_CHAIN_V2", "false"));
  const chainStatePath = pick(envFile, "GOVERNANCE_CHAIN_STATE_PATH", "");
  const chainSigningSecret = pick(envFile, "GOVERNANCE_CHAIN_SIGNING_SECRET", "");

  addCheck(checks, "env-file", fs.existsSync(envPath), fs.existsSync(envPath) ? `.env loaded from ${envPath}` : `No .env found at ${envPath}`);
  addCheck(checks, "operator-api-key", Boolean(operatorApiKey), operatorApiKey ? "Operator API key configured." : "Missing OPERATOR_API_KEY.");
  addCheck(
    checks,
    "service-discovery",
    serviceDiscoveryMode !== "local",
    serviceDiscoveryMode !== "local"
      ? `SERVICE_DISCOVERY_MODE=${serviceDiscoveryMode}.`
      : "SERVICE_DISCOVERY_MODE=local is not enterprise-safe."
  );
  addCheck(checks, "ledger-state-path", Boolean(ledgerStatePath), ledgerStatePath ? `Ledger durability path ${ledgerStatePath}.` : "Missing EVIDENCE_LEDGER_STATE_PATH.");
  addCheck(checks, "agent-os-state-path", Boolean(agentOsStatePath), agentOsStatePath ? `Agent OS durability path ${agentOsStatePath}.` : "Missing AGENT_OS_STATE_PATH.");
  addCheck(
    checks,
    "governance-chain-v2",
    !chainV2Enabled || (Boolean(chainStatePath) && Boolean(chainSigningSecret)),
    chainV2Enabled
      ? chainStatePath && chainSigningSecret
        ? `GOVERNANCE_CHAIN_V2 enabled with durable state (${chainStatePath}) and a signing secret.`
        : "GOVERNANCE_CHAIN_V2 enabled but GOVERNANCE_CHAIN_STATE_PATH and/or GOVERNANCE_CHAIN_SIGNING_SECRET is missing."
      : "GOVERNANCE_CHAIN_V2 disabled (chain is opt-in)."
  );
  addCheck(
    checks,
    "ledger-signing",
    Boolean(ledgerSigningSecret || ledgerSigningPrivateKeyPath),
    ledgerSigningPrivateKeyPath
      ? `Evidence ledger asymmetric signing configured (${ledgerSigningPrivateKeyPath}${ledgerSigningPublicKeyPath ? `, ${ledgerSigningPublicKeyPath}` : ""}).`
      : ledgerSigningSecret
        ? "Evidence ledger HMAC signing secret configured."
        : "Missing EVIDENCE_LEDGER_SIGNING_SECRET or EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH."
  );
  addCheck(checks, "insecure-override", !insecureOverride, insecureOverride ? "ALLOW_INSECURE_PRODUCTION_BOOT is enabled." : "Insecure production override is disabled.");
  addCheck(
    checks,
    "rbac",
    !roleEnforcement || Boolean(defaultRole && mutationRoles),
    roleEnforcement
      ? `RBAC enabled with default role ${defaultRole} and mutation roles ${mutationRoles}.`
      : "RBAC optional and currently disabled."
  );
  addCheck(
    checks,
    "operator-sessions",
    !sessionEnforcement || Boolean(sessionSecret),
    sessionEnforcement
      ? sessionSecret
        ? "Signed operator sessions enabled with a session secret."
        : "OPERATOR_SESSION_ENFORCEMENT is enabled but OPERATOR_SESSION_SECRET is missing."
      : "Signed operator sessions are optional and currently disabled."
  );
  addCheck(
    checks,
    "actor-allowlists",
    !targetMode || readActors.length > 0 || mutationActors.length > 0 || Boolean(viteActor && operatorActor),
    readActors || mutationActors
      ? `Actor allowlists configured (read=${readActors || "none"}, mutation=${mutationActors || "none"}).`
      : "Actor allowlists are optional; relying on explicit operator identities."
  );
  addCheck(checks, "operator-identity", Boolean(viteActor) && Boolean(operatorActor), `Dashboard actor ${viteActor}; validator actor ${operatorActor}.`);

  const failing = checks.filter((check) => !check.ok);
  const hardFail = targetMode === "production" && failing.length > 0;

  console.log(`[enterprise] mode=${targetMode}`);
  for (const check of checks) {
    console.log(`[enterprise] ${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`);
  }

  if (hardFail) {
    console.error(`[enterprise] enterprise configuration validation failed with ${failing.length} issue(s)`);
    process.exitCode = 1;
    return;
  }

  console.log(
    targetMode === "production"
      ? "[enterprise] enterprise configuration validation passed"
      : "[enterprise] advisory validation complete (run with --production for enforcing mode)"
  );
}

main();
