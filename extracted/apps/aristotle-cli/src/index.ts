#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type AristotleSigner,
  type RevocationKind,
  AsyncLedgerStore,
  CredentialBroker,
  PostgresLedgerBackend,
  addRevocation,
  createEd25519Signer,
  createExecutionControlMcpServer,
  createExecutionControlRuntimeServer,
  deriveKeyId,
  evaluateExecutionControl,
  exportEvidenceBundle,
  getDefaultDevSigner,
  LedgerStore,
  loadEvidenceBundle,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadRevocationList,
  loadWardManifest,
  loadWarrantSignerFromEnv,
  requireAllowedWarrant,
  saveRevocationList,
  SqliteLedgerBackend,
  submitGovernedAction,
  verifyEvidenceBundle,
  verifyGelChain,
  verifyWarrant,
  writeJson
} from "@aristotle/execution-control-runtime";
import {
  PAYMENTS_GOVERNANCE_SOURCE,
  TRIAL_SCENARIOS,
  evaluateTrialAction,
  planGovernanceChange,
  stableStringify,
  validateGovernanceSource
} from "@aristotle/trial-engine";

type Writer = (message: string) => void;

const WARD_SCAFFOLD = `ward_id: local-dev-ward
name: Local Development Ward
sovereignty_context: local-dev
authority_domain: agent-tools
policy_version: 0.1.0
permitted_subjects:
  - agent:local
`;

const ENVELOPE_SCAFFOLD = `envelope_id: ae-local-dev-001
ward_id: local-dev-ward
subject: agent:local
allowed_actions:
  - http.get
  - http.post
denied_actions:
  - secrets.exfiltrate
constraints:
  note: local development envelope - permissive
expires_at: 2027-12-31T23:59:59Z
issuer: aristotle-root
`;

const AGENT_SCAFFOLD = `// Sample governed agent. Run it behind the AristotleOS boundary:
//   aristotle run -- node aristotle/agent.mjs
// The boundary injects ARISTOTLE_ENDPOINT; the agent must get a Warrant
// (decision=ALLOW) before performing a consequential action.

const endpoint = process.env.ARISTOTLE_ENDPOINT;
if (!endpoint) {
  console.error("ARISTOTLE_ENDPOINT is not set. Start with: aristotle run -- node aristotle/agent.mjs");
  process.exit(1);
}

const action = {
  action_id: \`act-\${Date.now()}\`,
  ward_id: process.env.ARISTOTLE_WARD_ID ?? "local-dev-ward",
  subject: process.env.ARISTOTLE_SUBJECT ?? "agent:local",
  action_type: "http.get",
  target: "https://api.example.com/status",
  params: { url: "https://api.example.com/status" },
  requested_at: new Date().toISOString()
};

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action })
});
const result = await response.json();

console.log(\`AristotleOS decision: \${result.decision} (\${(result.reason_codes ?? []).join(",")})\`);
if (result.decision !== "ALLOW" || !result.warrant) {
  console.error("action refused before execution");
  process.exit(1);
}
console.log(\`warrant: \${result.warrant.warrant_id} signed by \${result.warrant.signing_key_id}\`);
console.log("executing governed action (simulated http.get)...");
`;

const INIT_README = `# Governed AristotleOS project

This project runs your agent behind the AristotleOS execution-control boundary.
Every consequential action is evaluated at the Commit Gate, gets a single-use
signed Warrant only on ALLOW, and is recorded in a tamper-evident Governance
Evidence Ledger.

## Run an agent behind the boundary

\`\`\`bash
aristotle run -- node aristotle/agent.mjs
\`\`\`

## Durable signing key (recommended)

\`\`\`bash
aristotle keys generate
export ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH=secrets/warrant-ed25519-private.pem
export ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH=secrets/warrant-ed25519-public.pem
\`\`\`

## Audit

\`\`\`bash
aristotle execution-control audit verify --ledger .aristotle/gel.jsonl
\`\`\`

Files:
- \`aristotle/ward.yaml\` — the protected domain (Ward Manifest)
- \`aristotle/authority-envelope.yaml\` — scoped delegated authority
- \`aristotle.json\` — run configuration
- \`governance.aristotle\` — policy for \`aristotle check / plan / demo\`
`;

const governanceFile = (cwd: string) => path.join(cwd, "governance.aristotle");
const stateDir = (cwd: string) => path.join(cwd, ".aristotle");
const stateFile = (cwd: string) => path.join(stateDir(cwd), "trial-state.json");

const readPolicy = (cwd: string) => {
  const file = governanceFile(cwd);
  if (!existsSync(file)) throw new Error("governance.aristotle not found. Run aristotle init first.");
  return readFileSync(file, "utf8");
};

const loadState = (cwd: string): { records: unknown[]; approvals: Array<{ id: string; scenarioId: string }> } => {
  const file = stateFile(cwd);
  if (!existsSync(file)) return { records: [], approvals: [] };
  return JSON.parse(readFileSync(file, "utf8")) as { records: unknown[]; approvals: Array<{ id: string; scenarioId: string }> };
};

const saveState = (cwd: string, state: { records: unknown[]; approvals: Array<{ id: string; scenarioId: string }> }) => {
  mkdirSync(stateDir(cwd), { recursive: true });
  writeFileSync(stateFile(cwd), `${JSON.stringify(state, null, 2)}\n`);
};

const printJson = (out: Writer, value: unknown, asJson: boolean) => {
  out(asJson ? `${stableStringify(value)}\n` : `${JSON.stringify(value, null, 2)}\n`);
};

const optionValue = (args: string[], name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const requiredOption = (args: string[], name: string) => {
  const value = optionValue(args, name);
  if (!value) throw new Error(`missing required option ${name}`);
  return value;
};

// Resolve the Warrant signing key: explicit --signing-key flag, then env, then a
// process-stable ephemeral dev key. Refuses ephemeral keys under NODE_ENV=production.
const resolveSigner = (rest: string[], cwd: string, err: Writer): AristotleSigner => {
  const privateKeyOpt = optionValue(rest, "--signing-key");
  const publicKeyOpt = optionValue(rest, "--signing-public-key");
  let signer: AristotleSigner;
  if (privateKeyOpt) {
    signer = createEd25519Signer({
      privateKeyPem: readFileSync(path.resolve(cwd, privateKeyOpt), "utf8"),
      publicKeyPem: publicKeyOpt ? readFileSync(path.resolve(cwd, publicKeyOpt), "utf8") : undefined
    });
  } else {
    signer = loadWarrantSignerFromEnv() ?? getDefaultDevSigner();
  }
  if (signer.ephemeral) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "refusing to issue Warrants with an ephemeral dev key in production. " +
        "Run `aristotle keys generate` and set ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH."
      );
    }
    err(`warning: signing Warrants with an ephemeral dev key (${signer.key_id}). Run \`aristotle keys generate\` for a durable key.\n`);
  }
  return signer;
};

const firstExisting = (cwd: string, candidates: string[]) => candidates.find((candidate) => existsSync(path.resolve(cwd, candidate)));

interface RunConfig {
  wardPath: string;
  envelopePath: string;
  ledgerPath: string;
  port: number;
}

// Zero-config discovery for `aristotle run`: explicit flags win, then aristotle.json,
// then conventional file locations. Keeps `aristotle run` "just works" after `aristotle init`.
const discoverRunConfig = (runArgs: string[], cwd: string): RunConfig => {
  const configPath = path.resolve(cwd, optionValue(runArgs, "--config") ?? "aristotle.json");
  const fromConfig: Record<string, unknown> = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  const wardRel =
    optionValue(runArgs, "--ward") ??
    (fromConfig.ward as string | undefined) ??
    firstExisting(cwd, ["aristotle/ward.yaml", "aristotle/ward.yml", "ward.yaml", "ward.yml"]);
  const envelopeRel =
    optionValue(runArgs, "--envelope") ??
    (fromConfig.authority_envelope as string | undefined) ??
    (fromConfig.envelope as string | undefined) ??
    firstExisting(cwd, [
      "aristotle/authority-envelope.yaml",
      "aristotle/authority-envelope.yml",
      "authority-envelope.yaml",
      "authority_envelope.yaml"
    ]);
  if (!wardRel || !envelopeRel) {
    throw new Error(
      "no AristotleOS Ward / Authority Envelope found. Run `aristotle init` to scaffold one, " +
      "or pass --ward and --envelope (or add an aristotle.json)."
    );
  }
  const ledgerRel = optionValue(runArgs, "--ledger") ?? (fromConfig.ledger as string | undefined) ?? ".aristotle/gel.jsonl";
  const portRaw = optionValue(runArgs, "--port") ?? (fromConfig.port !== undefined ? String(fromConfig.port) : undefined);
  const port = portRaw ? Number(portRaw) : 0;
  if (!Number.isInteger(port) || port < 0) throw new Error("--port must be a non-negative integer");
  return {
    wardPath: path.resolve(cwd, wardRel),
    envelopePath: path.resolve(cwd, envelopeRel),
    ledgerPath: path.resolve(cwd, ledgerRel),
    port
  };
};

// Load credential-broker rules from --broker, aristotle.broker.json, or the
// "broker" field of aristotle.json. Returns undefined when no rules are present.
const loadBroker = (runArgs: string[], cwd: string): CredentialBroker | undefined => {
  const explicit = optionValue(runArgs, "--broker");
  let rules: unknown;
  if (explicit) {
    rules = (JSON.parse(readFileSync(path.resolve(cwd, explicit), "utf8")) as { rules?: unknown }).rules;
  } else if (existsSync(path.resolve(cwd, "aristotle.broker.json"))) {
    rules = (JSON.parse(readFileSync(path.resolve(cwd, "aristotle.broker.json"), "utf8")) as { rules?: unknown }).rules;
  } else {
    const aristotleJsonPath = path.resolve(cwd, optionValue(runArgs, "--config") ?? "aristotle.json");
    if (existsSync(aristotleJsonPath)) {
      const cfg = JSON.parse(readFileSync(aristotleJsonPath, "utf8")) as { broker?: { rules?: unknown } };
      rules = cfg.broker?.rules;
    }
  }
  if (!Array.isArray(rules) || rules.length === 0) return undefined;
  return CredentialBroker.fromConfig({ rules: rules as Parameters<typeof CredentialBroker.fromConfig>[0]["rules"] });
};

// Build a ledger store from --ledger-backend. Default (undefined) lets the server
// create a JSONL file store; "sqlite" uses a durable node:sqlite database.
const buildLedger = (args: string[], cwd: string, ledgerPath: string): LedgerStore | undefined => {
  if (optionValue(args, "--ledger-backend") !== "sqlite") return undefined;
  const dbPath = path.resolve(cwd, optionValue(args, "--ledger-db") ?? ledgerPath.replace(/\.jsonl$/, ".db"));
  return new LedgerStore(new SqliteLedgerBackend(dbPath));
};

interface PgClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}
interface PgPoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

// Build a Postgres-backed async ledger when --ledger-backend postgres is set.
// The 'pg' driver is loaded lazily so it is only required for this backend.
const buildAsyncLedger = async (args: string[]): Promise<AsyncLedgerStore | undefined> => {
  if (optionValue(args, "--ledger-backend") !== "postgres") return undefined;
  const url = optionValue(args, "--postgres-url") ?? process.env.ARISTOTLE_POSTGRES_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("postgres backend requires --postgres-url or ARISTOTLE_POSTGRES_URL");
  let pg: { Pool: new (config: { connectionString: string }) => PgPoolLike };
  try {
    pg = createRequire(import.meta.url)("pg") as typeof pg;
  } catch {
    throw new Error("the 'pg' driver is not installed for the postgres ledger backend. Run: npm install pg");
  }
  const pool = new pg.Pool({ connectionString: url });
  const backend = await PostgresLedgerBackend.create(
    {
      query: (text, params) => pool.query(text, params),
      // Serialized append path for active-active multi-writer chain integrity.
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn({ query: (text, params) => client.query(text, params) });
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      }
    },
    { onClose: () => pool.end() }
  );
  return new AsyncLedgerStore(backend);
};

export const ARISTOTLE_CLI_VERSION = "0.1.0";

export async function runCli(argv: string[], cwd = process.cwd(), out: Writer = process.stdout.write.bind(process.stdout), err: Writer = process.stderr.write.bind(process.stderr)) {
  const [command = "help", subcommand, ...rest] = argv;
  const json = argv.includes("--json");
  try {
    if (command === "version" || command === "--version" || command === "-v") {
      out(`${ARISTOTLE_CLI_VERSION}\n`);
      return 0;
    }

    if (command === "help" || command === "--help" || command === "-h") {
      out(`aristotle <command>

Commands:
  init                 Scaffold a governed AristotleOS project
  run -- <cmd>         Run an agent behind the AristotleOS boundary
  mcp                  Serve the boundary to agents over MCP (stdio)
  playground           Serve the no-install browser playground
  check                Validate governance.aristotle
  plan                 Compile and preview runtime governance artifacts
  apply                Persist the compiled local policy hash
  dev                  Print local sandbox startup instructions
  status               Show local runtime status
  audit tail           Show recent GEL records
  explain --last-deny  Explain the last denied action
  approvals            List deferred actions
  approve <token>      Approve a deferred action and issue a warrant
  deny <token>         Deny a deferred action and commit GEL evidence
  replay               Replay the payments scenario
  execution-control evaluate      Evaluate a Ward/Warrant governed action through AristotleOS
  execution-control dev           Start the sample execution-control runtime on localhost
  execution-control serve         Run the AristotleOS execution boundary
  execution-control submit        Submit an action JSON file to the execution boundary
  execution-control audit verify  Verify the execution-control GEL hash chain
  execution-control evidence export  Export an offline Evidence Bundle
  execution-control evidence verify  Verify an offline Evidence Bundle
  keys generate        Generate an Ed25519 Warrant signing keypair
  kill engage|release  Engage/release the sovereign-halt kill switch
  revoke key|envelope|warrant <id>   Revoke a compromised trust root
  pilot                One-command self-check of the full boundary
  preflight            Check production readiness (signing key, auth, config)
  demo payments        Run the flagship payments scenario
  doctor               Check local developer prerequisites
`);
      return 0;
    }

    if (command === "keys" && (subcommand === "generate" || subcommand === "gen")) {
      const outDir = path.resolve(cwd, optionValue(rest, "--out") ?? "secrets");
      mkdirSync(outDir, { recursive: true });
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const privatePath = path.join(outDir, "warrant-ed25519-private.pem");
      const publicPath = path.join(outDir, "warrant-ed25519-public.pem");
      const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
      writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), { mode: 0o600 });
      writeFileSync(publicPath, publicKeyPem, "utf8");
      const keyId = deriveKeyId(publicKeyPem);
      if (json) {
        printJson(out, { key_id: keyId, private_key_path: privatePath, public_key_path: publicPath }, true);
      } else {
        out(`Warrant signing keypair generated
key_id=${keyId}
private=${privatePath}
public=${publicPath}

Export these so the runtime signs Warrants with this key:
  ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH=${privatePath}
  ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH=${publicPath}

Keep the private key secret. The public key and key_id can be shared so others can verify your Warrants and Evidence Bundles offline.
`);
      }
      return 0;
    }

    if (command === "kill") {
      const file = path.resolve(cwd, optionValue(rest, "--file") ?? ".aristotle/KILL_SWITCH");
      if (subcommand === "engage") {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, `engaged ${new Date().toISOString()}\n`);
        out(`kill switch ENGAGED: ${file}\nThe boundary will REFUSE every action until released.\n`);
        return 0;
      }
      if (subcommand === "release") {
        if (existsSync(file)) rmSync(file);
        out(`kill switch released: ${file}\n`);
        return 0;
      }
      if (subcommand === "status" || !subcommand) {
        out(`kill switch ${existsSync(file) ? "ENGAGED" : "released"}: ${file}\n`);
        return 0;
      }
      throw new Error(`unknown kill subcommand: ${subcommand} (use engage|release|status)`);
    }

    if (command === "revoke") {
      const file = path.resolve(cwd, optionValue(rest, "--file") ?? ".aristotle/revocations.json");
      if (subcommand === "list" || !subcommand) {
        printJson(out, loadRevocationList(file), json);
        return 0;
      }
      if (subcommand === "clear") {
        saveRevocationList(file, { revoked_key_ids: [], revoked_envelope_ids: [], revoked_warrant_ids: [] });
        out(`revocations cleared: ${file}\n`);
        return 0;
      }
      if (subcommand === "key" || subcommand === "envelope" || subcommand === "warrant") {
        const id = rest.find((arg) => !arg.startsWith("--"));
        if (!id) throw new Error(`usage: aristotle revoke ${subcommand} <id>`);
        const list = addRevocation(file, subcommand as RevocationKind, id);
        out(`revoked ${subcommand}: ${id}\nfile: ${file}\nrevoked_keys=${list.revoked_key_ids.length} revoked_envelopes=${list.revoked_envelope_ids.length} revoked_warrants=${list.revoked_warrant_ids.length}\n`);
        return 0;
      }
      throw new Error(`unknown revoke subcommand: ${subcommand} (use key|envelope|warrant|list|clear)`);
    }

    if (command === "run") {
      const separator = argv.indexOf("--");
      const runArgs = separator >= 0 ? argv.slice(1, separator) : argv.slice(1);
      const childCommand = separator >= 0 ? argv.slice(separator + 1) : [];
      const config = discoverRunConfig(runArgs, cwd);
      const ward = loadWardManifest(config.wardPath);
      const authorityEnvelope = loadAuthorityEnvelope(config.envelopePath);
      const signer = resolveSigner(runArgs, cwd, err);
      const broker = loadBroker(runArgs, cwd);
      const killSwitchPath = path.resolve(cwd, optionValue(runArgs, "--kill-switch") ?? ".aristotle/KILL_SWITCH");
      const apiKey = optionValue(runArgs, "--api-key") ?? process.env.ARISTOTLE_OPERATOR_API_KEY;
      const replayProtection = !runArgs.includes("--no-replay-protection");
      const revocationListPath = path.resolve(cwd, optionValue(runArgs, "--revocations") ?? ".aristotle/revocations.json");
      const warrantTtlSeconds = Number(optionValue(runArgs, "--warrant-ttl") ?? process.env.ARISTOTLE_WARRANT_TTL_SECONDS ?? "60");
      const rateLimitPerMinute = Number(optionValue(runArgs, "--rate-limit") ?? process.env.ARISTOTLE_RATE_LIMIT_PER_MINUTE ?? "0") || undefined;
      const logFormat = optionValue(runArgs, "--log-format") === "json" ? ("json" as const) : undefined;
      const ledger = buildLedger(runArgs, cwd, config.ledgerPath);
      const asyncLedger = await buildAsyncLedger(runArgs);
      const { server } = createExecutionControlRuntimeServer({
        ward,
        authorityEnvelope,
        ledgerPath: config.ledgerPath,
        signer,
        broker,
        killSwitchPath,
        replayProtection,
        apiKey,
        revocationListPath,
        warrantTtlSeconds,
        rateLimitPerMinute,
        logFormat,
        ledger,
        asyncLedger,
        auditSink: optionValue(runArgs, "--audit-sink") ?? process.env.ARISTOTLE_AUDIT_SINK
      });
      await new Promise<void>((resolve) => server.listen(config.port, "127.0.0.1", resolve));
      const address = server.address();
      const actualPort = address && typeof address === "object" ? address.port : config.port;
      const baseUrl = `http://127.0.0.1:${actualPort}`;
      const endpoint = `${baseUrl}/v1/execution-control/evaluate`;
      out(`AristotleOS is governing this session
Ward: ${ward.ward_id}
Authority Envelope: ${authorityEnvelope.envelope_id}
Subject: ${authorityEnvelope.subject}
Signing key: ${signer.key_id}${signer.ephemeral ? " (ephemeral dev key)" : ""}
Credential broker: ${broker ? "enabled" : "none"}
Replay protection: ${replayProtection ? "on" : "off"}   Auth: ${apiKey ? "required" : "open"}   Kill switch: ${killSwitchPath}
Boundary: ${endpoint}
Proxy: ${baseUrl}/v1/execution-control/proxy
`);

      if (childCommand.length === 0) {
        out(`No agent command provided. The boundary is running; press Ctrl+C to stop.
Start your agent in another shell with:
  ARISTOTLE_ENDPOINT=${endpoint} <your agent command>
Or wrap it directly:
  aristotle run -- <your agent command>
`);
        await new Promise<void>(() => undefined);
        return 0;
      }

      const child = spawn(childCommand.join(" "), {
        stdio: "inherit",
        shell: true,
        cwd,
        env: {
          ...process.env,
          ARISTOTLE_ENDPOINT: endpoint,
          ARISTOTLE_BASE_URL: baseUrl,
          ARISTOTLE_WARD_ID: ward.ward_id,
          ARISTOTLE_SUBJECT: authorityEnvelope.subject
        }
      });

      let shuttingDown = false;
      const forward = (signal: NodeJS.Signals) => () => { if (!shuttingDown) { shuttingDown = true; child.kill(signal); } };
      const onSigint = forward("SIGINT");
      const onSigterm = forward("SIGTERM");
      process.on("SIGINT", onSigint);
      process.on("SIGTERM", onSigterm);

      const code: number = await new Promise((resolve) => {
        child.on("exit", (childCode, childSignal) => resolve(childSignal ? 1 : childCode ?? 0));
        child.on("error", (error) => { err(`failed to start agent command: ${error.message}\n`); resolve(127); });
      });

      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      ledger?.close();
      await asyncLedger?.close();
      out(`AristotleOS boundary stopped. Audit ledger: ${config.ledgerPath}\n`);
      return code;
    }

    if (command === "mcp") {
      // MCP speaks JSON-RPC on stdout; all human-facing output must go to stderr.
      const mcpArgs = argv.slice(1);
      const config = discoverRunConfig(mcpArgs, cwd);
      const ward = loadWardManifest(config.wardPath);
      const authorityEnvelope = loadAuthorityEnvelope(config.envelopePath);
      const signer = resolveSigner(mcpArgs, cwd, err);
      const broker = loadBroker(mcpArgs, cwd);
      const mcp = createExecutionControlMcpServer({
        ward,
        authorityEnvelope,
        ledgerPath: config.ledgerPath,
        signer,
        broker
      });
      err(`AristotleOS MCP server ready on stdio
Ward: ${ward.ward_id}
Signing key: ${signer.key_id}${signer.ephemeral ? " (ephemeral dev key)" : ""}
Credential broker: ${broker ? "enabled" : "none"}
Tools: ${mcp.tools.map((tool) => tool.name).join(", ")}
`);
      await mcp.closed;
      return 0;
    }

    if (command === "playground") {
      const pgArgs = argv.slice(1);
      const port = Number(optionValue(pgArgs, "--port") ?? "4178");
      if (!Number.isInteger(port) || port <= 0) throw new Error("--port must be a positive integer");
      const signer = resolveSigner(pgArgs, cwd, err);
      const broker = loadBroker(pgArgs, cwd);

      // Use the project's Ward/Envelope when present; otherwise a built-in demo so
      // the playground works with zero setup.
      let ward;
      let authorityEnvelope;
      let ledgerPath;
      try {
        const config = discoverRunConfig(pgArgs, cwd);
        ward = loadWardManifest(config.wardPath);
        authorityEnvelope = loadAuthorityEnvelope(config.envelopePath);
        ledgerPath = config.ledgerPath;
      } catch {
        ward = {
          ward_id: "demo-drone-range",
          name: "Demo Drone Range",
          sovereignty_context: "demo",
          authority_domain: "drone-ops",
          policy_version: "0.1.0",
          permitted_subjects: ["agent:survey-planner"],
          physical_bounds: { max_altitude_m: 120, permitted_boundary_id: "demo-zone-a", battery_minimum_pct: 20 }
        };
        authorityEnvelope = {
          envelope_id: "ae-demo-001",
          ward_id: "demo-drone-range",
          subject: "agent:survey-planner",
          allowed_actions: ["drone.takeoff", "drone.scan_area"],
          denied_actions: ["drone.disable_geofence", "drone.leave_boundary"],
          constraints: { required_runtime_registers: ["telemetry.gps_lock"], max_altitude_m: 120, permitted_boundary_id: "demo-zone-a" },
          expires_at: "2099-12-31T23:59:59Z",
          issuer: "aristotle-demo-root"
        };
        ledgerPath = path.resolve(cwd, ".aristotle", "playground", "gel.jsonl");
      }

      const { server } = createExecutionControlRuntimeServer({
        ward,
        authorityEnvelope,
        ledgerPath,
        signer,
        broker,
        servePlayground: true
      });
      await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
      out(`AristotleOS playground: http://127.0.0.1:${port}
Ward: ${ward.ward_id}  Subject: ${authorityEnvelope.subject}
Signing key: ${signer.key_id}${signer.ephemeral ? " (ephemeral dev key)" : ""}
Press Ctrl+C to stop.
`);
      await new Promise<void>(() => undefined);
      return 0;
    }

    if (command === "init") {
      const target = rest.find((arg) => !arg.startsWith("--")) ?? ".";
      const dir = path.resolve(cwd, target);
      mkdirSync(dir, { recursive: true });
      mkdirSync(path.join(dir, "aristotle"), { recursive: true });

      // Governance policy (trial path): check / plan / demo.
      writeFileSync(path.join(dir, "governance.aristotle"), `${PAYMENTS_GOVERNANCE_SOURCE}\n`);

      // Execution-control project (run path): Ward + Authority Envelope + config.
      writeFileSync(path.join(dir, "aristotle", "ward.yaml"), WARD_SCAFFOLD);
      writeFileSync(path.join(dir, "aristotle", "authority-envelope.yaml"), ENVELOPE_SCAFFOLD);
      writeFileSync(path.join(dir, "aristotle", "agent.mjs"), AGENT_SCAFFOLD);
      writeFileSync(path.join(dir, "aristotle.json"), `${JSON.stringify({
        ward: "aristotle/ward.yaml",
        authority_envelope: "aristotle/authority-envelope.yaml",
        ledger: ".aristotle/gel.jsonl"
      }, null, 2)}\n`);

      writeFileSync(path.join(dir, "README.md"), INIT_README);
      writeFileSync(path.join(dir, ".env.example"), [
        "ARISTOTLE_GATEWAY=http://127.0.0.1:8080",
        "# Generate with: aristotle keys generate",
        "# ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH=secrets/warrant-ed25519-private.pem",
        "# ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH=secrets/warrant-ed25519-public.pem",
        ""
      ].join("\n"));
      writeFileSync(path.join(dir, ".gitignore"), [".aristotle/", "secrets/", "node_modules/", ""].join("\n"));

      out(`Created a governed AristotleOS project in ${dir}

Next:
  1. (optional) aristotle keys generate            # durable signing key
  2. aristotle run -- node aristotle/agent.mjs      # run an agent behind the boundary
  3. aristotle execution-control audit verify --ledger .aristotle/gel.jsonl
`);
      return 0;
    }

    if (command === "check") {
      const validation = validateGovernanceSource(readPolicy(cwd));
      if (json) printJson(out, validation, true);
      else out(validation.ok ? `governance.aristotle valid\npolicy_hash=${validation.policy?.policyHash}\n` : `governance.aristotle invalid\n${validation.errors.map((item) => `${item.path}: ${item.message}`).join("\n")}\n`);
      return validation.ok ? 0 : 1;
    }

    if (command === "plan") {
      const plan = planGovernanceChange(readPolicy(cwd));
      if (json) printJson(out, plan, true);
      else out(`policy_hash=${plan.nextPolicyHash ?? "invalid"}\n${plan.changes.length ? plan.changes.map((change) => `~ ${change}`).join("\n") : "no runtime artifact drift detected"}\n`);
      return plan.ok ? 0 : 1;
    }

    if (command === "apply") {
      const validation = validateGovernanceSource(readPolicy(cwd));
      if (!validation.ok || !validation.policy) throw new Error(validation.errors.map((item) => item.message).join("; "));
      const state = loadState(cwd);
      saveState(cwd, { ...state, records: state.records });
      out(`applied policy_hash=${validation.policy.policyHash}\n`);
      return 0;
    }

    if (command === "dev") {
      out("local sandbox: npm run aristotle:demo\nopen: http://127.0.0.1:4173/try\n");
      return 0;
    }

    if (command === "status") {
      const validation = validateGovernanceSource(readPolicy(cwd));
      const state = loadState(cwd);
      printJson(out, { ok: validation.ok, policyHash: validation.policy?.policyHash, records: state.records.length, approvals: state.approvals.length }, json);
      return validation.ok ? 0 : 1;
    }

    if (command === "audit" && subcommand === "tail") {
      const state = loadState(cwd);
      printJson(out, { items: state.records.slice(-10) }, json);
      return 0;
    }

    if (command === "approvals") {
      const state = loadState(cwd);
      printJson(out, { items: state.approvals }, json);
      return 0;
    }

    if (command === "approve" || command === "deny") {
      const token = subcommand;
      const state = loadState(cwd);
      const deferred = state.approvals.find((item) => item.id === token) ?? { id: token ?? "def-local", scenarioId: "payments-refund-8000" };
      const scenario = TRIAL_SCENARIOS.find((item) => item.id === deferred.scenarioId) ?? TRIAL_SCENARIOS[0];
      const evaluation = evaluateTrialAction({ source: readPolicy(cwd), intent: scenario.intent, approval: command === "approve" ? "approve" : "deny" });
      saveState(cwd, { records: [...state.records, evaluation.gelRecord], approvals: state.approvals.filter((item) => item.id !== deferred.id) });
      out(`${command === "approve" ? "approved" : "denied"} ${deferred.id}\ndecision=${evaluation.decision}\nwarrant=${evaluation.warrant?.id ?? "none"}\n`);
      return 0;
    }

    if (command === "replay") {
      const scenario = TRIAL_SCENARIOS[0];
      const evaluation = evaluateTrialAction({ source: readPolicy(cwd), intent: scenario.intent, now: "2026-05-20T00:00:00.000Z" });
      printJson(out, { replayed: true, decision: evaluation.decision, materialHash: evaluation.replay.materialHash }, json);
      return 0;
    }

    if (command === "execution-control" && subcommand === "evaluate") {
      const wardPath = requiredOption(rest, "--ward");
      const envelopePath = requiredOption(rest, "--envelope");
      const actionPath = requiredOption(rest, "--action");
      const ledgerPath = requiredOption(rest, "--ledger");
      const ward = loadWardManifest(path.resolve(cwd, wardPath));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, envelopePath));
      const action = loadCanonicalAction(path.resolve(cwd, actionPath));
      const signer = resolveSigner(rest, cwd, err);
      const result = evaluateExecutionControl({
        ward,
        authorityEnvelope,
        action,
        ledgerPath: path.resolve(cwd, ledgerPath),
        now: optionValue(rest, "--now"),
        signer
      });
      const evidenceOut = optionValue(rest, "--evidence-out");
      if (evidenceOut) {
        const bundle = exportEvidenceBundle({
          ledgerPath: path.resolve(cwd, ledgerPath),
          ward,
          authorityEnvelope,
          recordId: result.gel_record.record_id,
          warrant: result.warrant,
          exportedAt: optionValue(rest, "--now"),
          signer
        });
        writeJson(path.resolve(cwd, evidenceOut), bundle);
      }
      if (json) {
        printJson(out, result, true);
      } else {
        out(`decision=${result.decision}
reason_codes=${result.reason_codes.join(",")}
canonical_action_hash=${result.canonical_action_hash}
warrant_id=${result.warrant?.warrant_id ?? "none"}
signing_key_id=${result.warrant?.signing_key_id ?? signer.key_id}
gel_record_hash=${result.gel_record.record_hash}
ledger_verification=${result.ledger_verification.ok ? "ok" : `failed:${result.ledger_verification.failure}`}
evidence_bundle=${evidenceOut ?? "not requested"}
`);
      }
      return result.ledger_verification.ok ? 0 : 1;
    }

    if (command === "execution-control" && subcommand === "serve") {
      const wardPath = requiredOption(rest, "--ward");
      const envelopePath = requiredOption(rest, "--envelope");
      const ledgerPath = requiredOption(rest, "--ledger");
      const port = Number(optionValue(rest, "--port") ?? "8181");
      if (!Number.isInteger(port) || port <= 0) throw new Error("--port must be a positive integer");
      const ward = loadWardManifest(path.resolve(cwd, wardPath));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, envelopePath));
      const signer = resolveSigner(rest, cwd, err);
      const broker = loadBroker(rest, cwd);
      const killSwitchPath = path.resolve(cwd, optionValue(rest, "--kill-switch") ?? ".aristotle/KILL_SWITCH");
      const apiKey = optionValue(rest, "--api-key") ?? process.env.ARISTOTLE_OPERATOR_API_KEY;
      const replayProtection = !rest.includes("--no-replay-protection");
      const revocationListPath = path.resolve(cwd, optionValue(rest, "--revocations") ?? ".aristotle/revocations.json");
      const warrantTtlSeconds = Number(optionValue(rest, "--warrant-ttl") ?? process.env.ARISTOTLE_WARRANT_TTL_SECONDS ?? "60");
      const rateLimitPerMinute = Number(optionValue(rest, "--rate-limit") ?? process.env.ARISTOTLE_RATE_LIMIT_PER_MINUTE ?? "0") || undefined;
      const logFormat = optionValue(rest, "--log-format") === "json" ? ("json" as const) : undefined;
      const ledger = buildLedger(rest, cwd, path.resolve(cwd, ledgerPath));
      const asyncLedger = await buildAsyncLedger(rest);
      const { server } = createExecutionControlRuntimeServer({
        ward,
        authorityEnvelope,
        ledgerPath: path.resolve(cwd, ledgerPath),
        now: optionValue(rest, "--now"),
        signer,
        broker,
        killSwitchPath,
        replayProtection,
        apiKey,
        revocationListPath,
        warrantTtlSeconds,
        rateLimitPerMinute,
        logFormat,
        ledger,
        asyncLedger,
        auditSink: optionValue(rest, "--audit-sink") ?? process.env.ARISTOTLE_AUDIT_SINK
      });
      await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
      out(`AristotleOS execution-control runtime listening on http://127.0.0.1:${port}
Ward: ${ward.ward_id}
Authority Envelope: ${authorityEnvelope.envelope_id}
Signing key: ${signer.key_id}${signer.ephemeral ? " (ephemeral dev key)" : ""}
Credential broker: ${broker ? "enabled" : "none"}
Replay protection: ${replayProtection ? "on" : "off"}   Auth: ${apiKey ? "required" : "open"}
Ledger: ${asyncLedger ? "postgres" : ledger ? "sqlite" : "file"}
Evaluate: POST http://127.0.0.1:${port}/v1/execution-control/evaluate
Proxy: POST http://127.0.0.1:${port}/v1/execution-control/proxy
Metrics: GET http://127.0.0.1:${port}/metrics
Audit: GET http://127.0.0.1:${port}/v1/execution-control/audit/verify
`);
      // Graceful shutdown for container lifecycles (k8s sends SIGTERM).
      await new Promise<void>((resolve) => {
        const shutdown = () => {
          err("shutting down execution-control runtime...\n");
          server.close(async () => {
            ledger?.close();
            await asyncLedger?.close();
            resolve();
          });
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      });
      return 0;
    }

    if (command === "execution-control" && subcommand === "dev") {
      const devNow = optionValue(rest, "--now");
      return runCli([
        "execution-control",
        "serve",
        "--ward",
        "examples/execution_control/ward.montana_drone_test_range.yaml",
        "--envelope",
        "examples/execution_control/authority_envelope.survey_planner.yaml",
        "--ledger",
        ".tmp/execution-control-runtime.gel.jsonl",
        "--port",
        optionValue(rest, "--port") ?? "8181",
        ...(devNow ? ["--now", devNow] : [])
      ], cwd, out, err);
    }

    if (command === "execution-control" && subcommand === "submit") {
      const actionPath = requiredOption(rest, "--action");
      const endpoint = optionValue(rest, "--endpoint") ?? "http://127.0.0.1:8181/v1/execution-control/evaluate";
      const action = JSON.parse(readFileSync(path.resolve(cwd, actionPath), "utf8"));
      const result = await submitGovernedAction({ endpoint, action, now: optionValue(rest, "--now") });
      if (json) {
        printJson(out, result, true);
      } else {
        const requireWarrant = rest.includes("--require-warrant");
        if (requireWarrant) requireAllowedWarrant(result);
        out(`decision=${result.decision}
reason_codes=${Array.isArray(result.reason_codes) ? result.reason_codes.join(",") : "none"}
canonical_action_hash=${result.canonical_action_hash ?? "none"}
warrant_id=${result.warrant?.warrant_id ?? "none"}
gel_record_hash=${result.gel_record?.record_hash ?? "none"}
ledger_verification=${result.ledger_verification?.ok ? "ok" : "failed"}
`);
      }
      return 0;
    }

    if (command === "execution-control" && subcommand === "audit" && rest[0] === "verify") {
      const ledgerPath = requiredOption(rest, "--ledger");
      const verification = verifyGelChain(path.resolve(cwd, ledgerPath));
      if (json) printJson(out, verification, true);
      else out(`ledger_verification=${verification.ok ? "ok" : `failed:${verification.failure}`}\nrecords=${verification.count}\n`);
      return verification.ok ? 0 : 1;
    }

    if (command === "execution-control" && subcommand === "evidence" && rest[0] === "export") {
      const wardPath = requiredOption(rest, "--ward");
      const envelopePath = requiredOption(rest, "--envelope");
      const ledgerPath = requiredOption(rest, "--ledger");
      const outPath = requiredOption(rest, "--out");
      const warrantPath = optionValue(rest, "--warrant");
      const bundle = exportEvidenceBundle({
        ledgerPath: path.resolve(cwd, ledgerPath),
        ward: loadWardManifest(path.resolve(cwd, wardPath)),
        authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, envelopePath)),
        recordId: optionValue(rest, "--record-id"),
        warrant: warrantPath ? JSON.parse(readFileSync(path.resolve(cwd, warrantPath), "utf8")) : undefined,
        exportedAt: optionValue(rest, "--now")
      });
      writeJson(path.resolve(cwd, outPath), bundle);
      if (json) printJson(out, bundle, true);
      else out(`evidence_bundle=${outPath}\nbundle_hash=${bundle.hashes.bundle_hash}\nverification=${bundle.verification.ok ? "ok" : `failed:${bundle.verification.failures.join(";")}`}\n`);
      return bundle.verification.ok ? 0 : 1;
    }

    if (command === "execution-control" && subcommand === "evidence" && rest[0] === "verify") {
      const bundlePath = requiredOption(rest, "--bundle");
      const revocationsOpt = optionValue(rest, "--revocations");
      const revocations = revocationsOpt ? loadRevocationList(path.resolve(cwd, revocationsOpt)) : undefined;
      const verification = verifyEvidenceBundle(loadEvidenceBundle(path.resolve(cwd, bundlePath)), { revocations });
      if (json) printJson(out, verification, true);
      else out(`evidence_verification=${verification.ok ? "ok" : `failed:${verification.failures.join(";")}`}\nbundle_hash=${verification.bundle_hash ?? "none"}\nledger_records=${verification.ledger.count}\n`);
      return verification.ok ? 0 : 1;
    }

    if (command === "explain" && subcommand === "--last-deny") {
      const payout = TRIAL_SCENARIOS.find((item) => item.id === "payments-payout-deny") ?? TRIAL_SCENARIOS[1];
      const evaluation = evaluateTrialAction({ source: readPolicy(cwd), intent: payout.intent });
      out(`${evaluation.decision}: ${evaluation.explanation}\nrule=${evaluation.controllingRule}\n`);
      return 0;
    }

    if (command === "demo" && (subcommand === "payments" || !subcommand)) {
      const source = existsSync(governanceFile(cwd)) ? readPolicy(cwd) : PAYMENTS_GOVERNANCE_SOURCE;
      const evaluation = evaluateTrialAction({ source, intent: TRIAL_SCENARIOS[0].intent });
      const state = loadState(cwd);
      saveState(cwd, {
        records: [...state.records, evaluation.gelRecord],
        approvals: evaluation.deferToken ? [...state.approvals, { id: evaluation.deferToken, scenarioId: TRIAL_SCENARIOS[0].id }] : state.approvals
      });
      out(`Governance Plane online
Ward: enterprise-payments
Intent: stripe.refund amount=8000 USD
Commit Gate: ${evaluation.decision} ${evaluation.decisionCode}
Warrant: ${evaluation.warrant?.id ?? "not issued"}
GEL: ${evaluation.gelRecord.recordId} ${evaluation.gelRecord.currentHash}
Next: aristotle approvals && aristotle approve ${evaluation.deferToken ?? "<token>"}
`);
      return 0;
    }

    if (command === "doctor") {
      out(`node=${process.version}\nworkspace=${cwd}\npolicy_file=${existsSync(governanceFile(cwd)) ? "present" : "missing"}\n`);
      return 0;
    }

    if (command === "pilot") {
      // One-command, dependency-free self-verification of the whole boundary.
      const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
      const record = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

      const nodeMajor = Number(process.version.replace(/^v/, "").split(".")[0]);
      record("Node.js >= 18", nodeMajor >= 18, process.version);

      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const signer = createEd25519Signer({
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
      });
      record("Durable Ed25519 signing key", !signer.ephemeral, signer.key_id);

      const ledgerDir = path.resolve(cwd, ".aristotle", "pilot");
      const ledger = path.join(ledgerDir, "gel.jsonl");
      rmSync(ledger, { force: true });
      const nowIso = optionValue(rest, "--now") ?? new Date().toISOString();

      const ward = {
        ward_id: "pilot-ward",
        name: "AristotleOS Pilot Ward",
        sovereignty_context: "pilot",
        authority_domain: "pilot-ops",
        policy_version: "0.1.0",
        permitted_subjects: ["agent:pilot"],
        physical_bounds: { max_altitude_m: 100, permitted_boundary_id: "pilot-zone", battery_minimum_pct: 20 }
      };
      const envelope = {
        envelope_id: "ae-pilot-001",
        ward_id: "pilot-ward",
        subject: "agent:pilot",
        allowed_actions: ["drone.takeoff"],
        denied_actions: ["drone.disable_geofence"],
        constraints: { required_runtime_registers: ["telemetry.gps_lock"] },
        expires_at: "2099-12-31T23:59:59Z",
        issuer: "aristotle-pilot-root"
      };
      const baseAction = {
        action_id: "act-pilot-001",
        ward_id: "pilot-ward",
        subject: "agent:pilot",
        action_type: "drone.takeoff",
        target: "pilot/unit-1",
        params: { altitude_m: 50, boundary_id: "pilot-zone", battery_pct: 90 },
        requested_at: nowIso,
        telemetry: { gps_lock: true }
      };

      const allow = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: baseAction, ledgerPath: ledger, signer, now: nowIso });
      record("ALLOW issues a Warrant", allow.decision === "ALLOW" && !!allow.warrant, allow.warrant?.warrant_id);
      record("Warrant signature verifies", !!allow.warrant && verifyWarrant(allow.warrant, allow.canonical_action_hash, nowIso).ok);
      record("Warrant key pinning works", !!allow.warrant && verifyWarrant(allow.warrant, allow.canonical_action_hash, nowIso, { trustedKeyIds: [signer.key_id] }).ok);

      const refuse = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: { ...baseAction, action_id: "act-pilot-002", action_type: "drone.disable_geofence" }, ledgerPath: ledger, signer, now: nowIso });
      record("REFUSE blocks a denied action", refuse.decision === "REFUSE" && !refuse.warrant, refuse.reason_codes.join(","));

      const escalate = evaluateExecutionControl({ ward, authorityEnvelope: envelope, action: { ...baseAction, action_id: "act-pilot-003", telemetry: undefined }, ledgerPath: ledger, signer, now: nowIso });
      record("ESCALATE on missing runtime state", escalate.decision === "ESCALATE", escalate.reason_codes.join(","));

      const bundle = exportEvidenceBundle({ ledgerPath: ledger, ward, authorityEnvelope: envelope, recordId: allow.gel_record.record_id, warrant: allow.warrant, signer, exportedAt: nowIso });
      record("Evidence Bundle self-verifies", bundle.verification.ok);
      record("Evidence Bundle pinned-key verify", verifyEvidenceBundle(bundle, { trustedKeyIds: [signer.key_id] }).ok);
      record("GEL hash chain verifies", verifyGelChain(ledger).ok);

      const failed = checks.filter((check) => !check.ok);
      if (json) {
        printJson(out, { ok: failed.length === 0, checks }, true);
      } else {
        out("AristotleOS pilot self-check\n\n");
        for (const check of checks) out(`  ${check.ok ? "PASS" : "FAIL"}  ${check.name}${check.detail ? `  (${check.detail})` : ""}\n`);
        out(`\n${failed.length === 0 ? "PILOT READY — all checks passed." : `PILOT NOT READY — ${failed.length} check(s) failed.`}\n`);
      }
      rmSync(ledgerDir, { recursive: true, force: true });
      return failed.length === 0 ? 0 : 1;
    }

    if (command === "preflight") {
      const pfArgs = argv.slice(1);
      const checks: Array<{ name: string; level: "FAIL" | "WARN"; ok: boolean; detail?: string }> = [];
      const fail = (name: string, ok: boolean, detail?: string) => checks.push({ name, level: "FAIL", ok, detail });
      const warn = (name: string, ok: boolean, detail?: string) => checks.push({ name, level: "WARN", ok, detail });

      const nodeMajor = Number(process.version.replace(/^v/, "").split(".")[0]);
      fail("Node.js >= 18", nodeMajor >= 18, process.version);

      try {
        const config = discoverRunConfig(pfArgs, cwd);
        loadWardManifest(config.wardPath);
        loadAuthorityEnvelope(config.envelopePath);
        fail("Ward & Authority Envelope present and valid", true, config.wardPath);
        try {
          mkdirSync(path.dirname(config.ledgerPath), { recursive: true });
          const probe = path.join(path.dirname(config.ledgerPath), ".preflight-probe");
          writeFileSync(probe, "ok");
          rmSync(probe);
          fail("Ledger path writable", true, config.ledgerPath);
        } catch {
          fail("Ledger path writable", false, config.ledgerPath);
        }
      } catch (error) {
        fail("Ward & Authority Envelope present and valid", false, error instanceof Error ? error.message : String(error));
      }

      let durableKey = false;
      try {
        durableKey = !!loadWarrantSignerFromEnv() || !!optionValue(pfArgs, "--signing-key");
      } catch {
        durableKey = false;
      }
      fail("Durable Ed25519 signing key configured", durableKey, durableKey ? undefined : "run `aristotle keys generate` and set ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH");

      const apiKey = optionValue(pfArgs, "--api-key") ?? process.env.ARISTOTLE_OPERATOR_API_KEY;
      warn("Operator API key set", !!apiKey, apiKey ? undefined : "set ARISTOTLE_OPERATOR_API_KEY to require auth on /v1");
      warn("Replay protection enabled", !pfArgs.includes("--no-replay-protection"));
      warn("NODE_ENV=production", process.env.NODE_ENV === "production", process.env.NODE_ENV ?? "(unset)");

      const fails = checks.filter((check) => check.level === "FAIL" && !check.ok);
      const warns = checks.filter((check) => check.level === "WARN" && !check.ok);
      if (json) {
        printJson(out, { ok: fails.length === 0, checks }, true);
      } else {
        out("AristotleOS production preflight\n\n");
        for (const check of checks) out(`  ${check.ok ? "PASS" : check.level}  ${check.name}${check.detail ? `  (${check.detail})` : ""}\n`);
        out(`\n${fails.length === 0 ? (warns.length ? `READY (with ${warns.length} warning(s))` : "READY for production.") : `NOT READY — ${fails.length} blocking issue(s).`}\n`);
      }
      return fails.length === 0 ? 0 : 1;
    }

    throw new Error(`unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
  } catch (error) {
    err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
