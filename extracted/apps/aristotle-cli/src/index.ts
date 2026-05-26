#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type AristotleSigner,
  type OidcConfig,
  type OidcKey,
  type OperatorCredential,
  type OperatorRole,
  type RevocationKind,
  type JsonValue,
  AsyncLedgerStore,
  CredentialBroker,
  PostgresLedgerBackend,
  addRevocation,
  type EdgeRecord,
  type SandboxExecutionReceipt,
  type SandboxPolicy,
  type ShadowAction,
  type AutomotiveDomain,
  type AutomotiveEvidenceContext,
  type GridDomain,
  type GridEvidenceContext,
  type PortDomain,
  type PortEvidenceContext,
  type LogisticsDomain,
  type LogisticsEvidenceContext,
  type RailDomain,
  type RailEvidenceContext,
  type TelecomDomain,
  type TelecomEvidenceContext,
  type WaterDomain,
  type WaterEvidenceContext,
  type AgentObservation,
  type AgentRegistry,
  type BehaviorEvent,
  type SequenceRule,
  type WardMarshalInterdictionKind,
  analyzeAgentBehavior,
  assertCryptoPosture,
  behaviorEventsFromGel,
  cryptoPostureFromEnv,
  buildWardMarshalInterdictionAction,
  collectObservations,
  explainWardMarshalFinding,
  fileObservationCollector,
  kubernetesCollector,
  mcpCollector,
  processCollector,
  loadGelChain,
  CredentialRevocationAdapter,
  EndpointQuarantineAdapter,
  KubernetesScaleDownAdapter,
  type WardMarshalAdapter,
  type WardMarshalAdapterKind,
  compileGovernanceManifest,
  compilePolicy,
  ContainerSandboxProvider,
  createEd25519Signer,
  createJwksKeyStore,
  detectContainerRuntime,
  detectWasmRuntime,
  diffGovernanceManifests,
  explainPolicy,
  createExecutionControlMcpServer,
  createExecutionControlRuntimeServer,
  deriveKeyId,
  evaluateExecutionControl,
  exportAutomotiveEvidenceBundle,
  exportEvidenceBundle,
  exportGridEvidenceBundle,
  exportLogisticsEvidenceBundle,
  exportWaterEvidenceBundle,
  exportPortEvidenceBundle,
  exportRailEvidenceBundle,
  exportTelecomEvidenceBundle,
  getDefaultDevSigner,
  governSandboxExecution,
  LedgerStore,
  LocalProcessSandboxProvider,
  WasmSandboxProvider,
  type SandboxProvider,
  profileShadowMode,
  reconcileEdgeRecords,
  ConflictInboxStore,
  ApprovalStore,
  AUTOMOTIVE_ADAPTER_CATALOG,
  GRID_ADAPTER_CATALOG,
  LOGISTICS_ADAPTER_CATALOG,
  PORT_ADAPTER_CATALOG,
  RAIL_ADAPTER_CATALOG,
  TELECOM_ADAPTER_CATALOG,
  WATER_ADAPTER_CATALOG,
  runWardMarshalCensus,
  runCarrierScaleBenchmark,
  runReconnectStormSimulation,
  simulateMultiRegionLedgerSoak,
  executeWardMarshalInterdiction,
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
  verifyAutomotiveEvidenceBundle,
  verifyGridEvidenceBundle,
  verifyLogisticsEvidenceBundle,
  verifyWaterEvidenceBundle,
  verifyPortEvidenceBundle,
  verifyRailEvidenceBundle,
  verifyGelChain,
  verifySandboxReceipt,
  verifyTelecomEvidenceBundle,
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

const optionValues = (args: string[], name: string): string[] => {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1] !== undefined) values.push(args[i + 1]);
  return values;
};

const selectorFromArgs = (args: string[]): Record<string, string> => {
  const entries: Record<string, string> = {};
  for (const item of optionValues(args, "--selector")) {
    const index = item.indexOf("=");
    if (index <= 0) throw new Error("--selector must be key=value");
    entries[item.slice(0, index)] = item.slice(index + 1);
  }
  return entries;
};

// Parse a role-scoped operator token spec: role:token[:subject[:label]]
const parseOperatorSpec = (spec: string): OperatorCredential => {
  const [role, token, subject, label] = spec.split(":");
  if (role !== "viewer" && role !== "operator" && role !== "admin") {
    throw new Error(`--operator role must be viewer|operator|admin (got "${role}")`);
  }
  if (!token) throw new Error(`--operator requires a token: ${role}:<token>[:subject[:label]]`);
  return { role: role as OperatorRole, token, subject: subject || `token:${role}`, label: label || undefined };
};

// Role-scoped static tokens from repeated --operator flags and/or ARISTOTLE_OPERATORS
// (a JSON array of OperatorCredential, or a ";"-separated list of role:token:subject specs).
const loadOperators = (args: string[]): OperatorCredential[] | undefined => {
  const credentials: OperatorCredential[] = optionValues(args, "--operator").map(parseOperatorSpec);
  const env = process.env.ARISTOTLE_OPERATORS?.trim();
  if (env) {
    if (env.startsWith("[")) {
      const parsed = JSON.parse(env) as OperatorCredential[];
      for (const cred of parsed) {
        if (cred.role !== "viewer" && cred.role !== "operator" && cred.role !== "admin") throw new Error(`invalid role in ARISTOTLE_OPERATORS: ${cred.role}`);
        if (!cred.token || !cred.subject) throw new Error("ARISTOTLE_OPERATORS entries require token and subject");
        credentials.push(cred);
      }
    } else {
      for (const spec of env.split(";").map((entry) => entry.trim()).filter(Boolean)) credentials.push(parseOperatorSpec(spec));
    }
  }
  return credentials.length ? credentials : undefined;
};

// OIDC verification from a JSON config (--oidc-config / ARISTOTLE_OIDC_CONFIG).
// Keys come from a live JWKS endpoint (jwksUri, refreshed + rotated automatically)
// and/or static keys (publicKeyPem inline or a publicKeyFile path, resolved vs cwd).
// At least one source is required.
const loadOidc = (args: string[], cwd: string, warn?: Writer): OidcConfig | undefined => {
  const file = optionValue(args, "--oidc-config") ?? process.env.ARISTOTLE_OIDC_CONFIG;
  if (!file) return undefined;
  const raw = JSON.parse(readFileSync(path.resolve(cwd, file), "utf8")) as Omit<OidcConfig, "keys" | "keyStore"> & {
    keys?: Array<{ kid?: string; alg?: OidcKey["alg"]; publicKeyPem?: string; publicKeyFile?: string }>;
    jwksUri?: string;
    jwksTtlSec?: number;
  };
  if (!raw.issuer) throw new Error("--oidc-config requires an issuer");
  const hasStaticKeys = Array.isArray(raw.keys) && raw.keys.length > 0;
  if (!hasStaticKeys && !raw.jwksUri) {
    throw new Error("--oidc-config requires { issuer, keys: [...] } and/or { issuer, jwksUri }");
  }
  const keys = (raw.keys ?? []).map((key) => {
    const publicKeyPem = key.publicKeyPem ?? (key.publicKeyFile ? readFileSync(path.resolve(cwd, key.publicKeyFile), "utf8") : undefined);
    if (!publicKeyPem) throw new Error("each OIDC key requires publicKeyPem or publicKeyFile");
    return { kid: key.kid, alg: key.alg, publicKeyPem };
  });
  let keyStore: OidcConfig["keyStore"];
  if (raw.jwksUri) {
    keyStore = createJwksKeyStore({ uri: raw.jwksUri, ttlSec: raw.jwksTtlSec });
    // Prime the cache so the first verification has keys; verification fails closed
    // until this completes, and a failed prime keeps trying on demand.
    void keyStore.refresh().catch((error) => warn?.(`warning: initial JWKS fetch failed (${String((error as Error).message)}); will retry on demand\n`));
  }
  const { jwksUri: _jwksUri, jwksTtlSec: _jwksTtlSec, keys: _rawKeys, ...rest } = raw;
  return { ...rest, ...(keys.length ? { keys } : {}), ...(keyStore ? { keyStore } : {}) };
};

const authSummary = (apiKey: string | undefined, operators: OperatorCredential[] | undefined, oidc: OidcConfig | undefined): string => {
  const methods: string[] = [];
  if (oidc) methods.push(oidc.keyStore ? "oidc+jwks" : "oidc");
  if (operators?.length) methods.push(`${operators.length} token${operators.length === 1 ? "" : "s"}`);
  if (apiKey) methods.push("api-key");
  return methods.length ? `required (${methods.join(", ")})` : "open";
};

// Resolve the Warrant signing key: explicit --signing-key flag, then env, then a
// process-stable ephemeral dev key. Refuses ephemeral keys under NODE_ENV=production.
const resolveSigner = (rest: string[], cwd: string, err: Writer): AristotleSigner => {
  // Fail closed at the crypto chokepoint when FIPS is required but not active.
  assertCryptoPosture(cryptoPostureFromEnv());
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

const buildWardMarshalAdapter = (args: string[], cwd: string, kind: WardMarshalAdapterKind): WardMarshalAdapter => {
  const kubectlPath = optionValue(args, "--kubectl") ?? "kubectl";
  const kubeContext = optionValue(args, "--kube-context");
  if (kind === "kubernetes-scale-down") return new KubernetesScaleDownAdapter({ kubectlPath, kubeContext });
  if (kind === "endpoint-quarantine") return new EndpointQuarantineAdapter({ kubectlPath, kubeContext });
  return new CredentialRevocationAdapter({
    revocationFile: path.resolve(cwd, optionValue(args, "--credential-revocations") ?? ".aristotle/credential-revocations.json")
  });
};

export const ARISTOTLE_CLI_VERSION = "0.1.1";

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
  execution-control shadow        Observe-only rollout profiling (would-ALLOW/REFUSE/ESCALATE)
  governance compile              Validate + hash a Ward/Envelope into a governance manifest
  governance diff                 Diff two policies; flags changes that weaken authority
  governance explain              Show what a policy permits/refuses/escalates for sample actions
  policy <compile|check>          Compile Aristotle Policy Language (.apl) to governance manifests; check validates only; --out <file>
  reconcile                       Reconcile disconnected-edge decisions against current policy
  conflicts <ingest|list|resolve> Durable Edge Conflict Inbox (--inbox <file>): ingest --records/--ward/--envelope; list; resolve --action-id --action <accept|reject|escalate|reconcile> [--reason]
  dual-control <list|approve|reject> Dual-control (M-of-N) approvals (--store <file>): list; approve/reject --request-id <id> [--by <approver>] [--reason]
  ward-marshal discover           Collect agent observations: --kubernetes, --process [--host], --mcp, or --from-file <f> --source <s> [--map field=key ...]; combine sources; --out <file>
  ward-marshal scan               Discover, inventory, and risk-score autonomous agents
  ward-marshal behavior           Detect denial bursts, rate spikes, first-seen, off-hours, fan-out, and
                                  cross-agent sequence chains over --events <json> and/or --ledger <gel.jsonl>
                                  (--rules seq.json, --registry/--known, --allowed-hours 13-21)
  ward-marshal interdict          Submit/evaluate a containment action; add --execute to run the adapter after Warrant verification
  ward-marshal demo               Run the sample census and governed interdiction path
  execution-control dev           Start the sample execution-control runtime on localhost
  execution-control serve         Run the AristotleOS execution boundary
  execution-control submit        Submit an action JSON file to the execution boundary
  execution-control audit verify  Verify the execution-control GEL hash chain
  execution-control evidence export  Export an offline Evidence Bundle
  execution-control evidence verify  Verify an offline Evidence Bundle
  telecom templates                 List carrier Ward templates, policies, and sample actions
  telecom adapters                  List typed TMF / NETCONF / gNMI / O-RAN adapter surfaces
  telecom evidence export           Export a telecom NOC Evidence Bundle
  telecom benchmark                 Run a carrier-scale Commit Gate benchmark
  telecom reconnect-storm           Simulate disconnected edge reconnect reconciliation
  telecom ha-soak                   Simulate multi-region GEL append/verify soak
  automotive templates              List vehicle Ward templates, policies, and sample actions
  automotive adapters               List typed ROS 2 / AUTOSAR / OTA / map / remote-assist surfaces
  automotive evidence export        Export an automotive Evidence Bundle
  grid templates                    List utility Ward templates, policies, and sample actions
  grid adapters                     List typed IEC 61850 / DNP3 / Modbus / SCADA / DERMS surfaces
  grid evidence export              Export an electric utility Evidence Bundle
  rail templates                    List railroad Ward templates, policies, and sample actions
  rail adapters                     List typed dispatch / PTC / wayside / crew / consist surfaces
  rail evidence export              Export a railroad Evidence Bundle
  port templates                    List port Ward templates, policies, and sample actions
  port adapters                     List typed TOS / PCS / VTS / crane / gate / reefer surfaces
  port evidence export              Export a maritime port Evidence Bundle
  water templates                   List water utility Ward templates, policies, and sample actions
  water adapters                    List typed SCADA / PLC / pump / valve / dosing / discharge surfaces
  water evidence export             Export a water infrastructure Evidence Bundle
  logistics templates               List trucking/logistics Ward templates, policies, and sample actions
  logistics adapters                List typed TMS / ELD / telematics / WMS / YMS / payment surfaces
  logistics evidence export         Export a trucking/logistics Evidence Bundle
  keys generate        Generate an Ed25519 Warrant signing keypair
  kill engage|release  Engage/release the sovereign-halt kill switch
  revoke key|envelope|warrant <id>   Revoke a compromised trust root
  sandbox providers    List sandbox execution providers (and which are available here)
  sandbox run          Evaluate an action, then run a command in a sandbox only on ALLOW
                       --provider local-process|container|wasm (default local-process)
                       container: --image <img> [--runtime docker|podman] [--memory 256m] [--cpus 1]
                       wasm:      --cmd <module.wasm> [--wasm-binary <path>]
  sandbox receipt verify   Verify a signed, Warrant-bound execution receipt
  pilot                One-command self-check of the full boundary
  preflight            Check production readiness (signing key, auth, config)
  demo payments        Run the flagship payments scenario
  doctor               Check local developer prerequisites

Operator access control (run / execution-control serve):
  --api-key <key>                     Single full-access (admin) key. Env: ARISTOTLE_OPERATOR_API_KEY
  --operator <role:token[:subject]>   Role-scoped token (viewer|operator|admin). Repeatable. Env: ARISTOTLE_OPERATORS
  --oidc-config <file.json>           Verify OIDC bearer tokens; the sub is attributed in the GEL. Env: ARISTOTLE_OIDC_CONFIG
                                      Config: { issuer, audience?, jwksUri? (live, auto-rotating), keys?: [{kid,alg,publicKeyPem|publicKeyFile}] }
  Roles: viewer (read) < operator (decisions) < admin (kill switch / revocation over HTTP)
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
      const operators = loadOperators(runArgs);
      const oidc = loadOidc(runArgs, cwd, err);
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
        operators,
        oidc,
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
Replay protection: ${replayProtection ? "on" : "off"}   Auth: ${authSummary(apiKey, operators, oidc)}   Kill switch: ${killSwitchPath}
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
      const operators = loadOperators(rest);
      const oidc = loadOidc(rest, cwd, err);
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
        operators,
        oidc,
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
Replay protection: ${replayProtection ? "on" : "off"}   Auth: ${authSummary(apiKey, operators, oidc)}
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
      const trustedKeyIds = optionValue(rest, "--trusted-key-ids")?.split(",").map((id) => id.trim()).filter(Boolean);
      const verification = verifyEvidenceBundle(loadEvidenceBundle(path.resolve(cwd, bundlePath)), { revocations, trustedKeyIds });
      if (json) printJson(out, verification, true);
      else out(`evidence_verification=${verification.ok ? "ok" : `failed:${verification.failures.join(";")}`}\nbundle_hash=${verification.bundle_hash ?? "none"}\nledger_records=${verification.ledger.count}\n`);
      return verification.ok ? 0 : 1;
    }

    if (command === "telecom") {
      if (subcommand === "templates") {
        const base = "examples/telecom";
        const templates = [
          `${base}/ward.ran_region_west.yaml`,
          `${base}/authority_envelope.noc_change_orchestrator.yaml`,
          `${base}/policy/ran_region_west.apl`
        ];
        const actions = [
          `${base}/actions/tmf_service_order_patch.json`,
          `${base}/actions/netconf_edit_config.json`,
          `${base}/actions/gnmi_set_qos.json`,
          `${base}/actions/oran_a1_policy_put.json`,
          `${base}/actions/refuse_cell_shutdown.json`
        ];
        if (json) printJson(out, { templates, actions }, true);
        else {
          out("AristotleOS telecom pilot templates\n");
          for (const file of [...templates, ...actions]) out(`  ${file}\n`);
        }
        return 0;
      }

      if (subcommand === "adapters") {
        if (json) printJson(out, { adapters: TELECOM_ADAPTER_CATALOG }, true);
        else {
          out("Typed telecom adapter surfaces\n");
          for (const adapter of TELECOM_ADAPTER_CATALOG) {
            out(`\n${adapter.kind} — ${adapter.label}\n`);
            out(`  Boundary: ${adapter.consequenceBoundary}\n`);
            out(`  Actions: ${adapter.actionExamples.join(", ")}\n`);
            out(`  Registers: ${adapter.requiredRuntimeRegisters.join(", ")}\n`);
          }
        }
        return 0;
      }

      if (subcommand === "evidence" && rest[0] === "export") {
        const outPath = requiredOption(rest, "--out");
        const warrantPath = optionValue(rest, "--warrant");
        const standards = optionValues(rest, "--standard");
        const services = optionValues(rest, "--service");
        const preChecks = optionValues(rest, "--pre-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const postChecks = optionValues(rest, "--post-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const telecom: TelecomEvidenceContext = {
          change_ticket: requiredOption(rest, "--ticket"),
          noc_operator: requiredOption(rest, "--operator"),
          network_domain: (optionValue(rest, "--domain") ?? "ran") as TelecomDomain,
          network_scope: requiredOption(rest, "--scope"),
          impacted_services: services.length ? services : [optionValue(rest, "--service-name") ?? "mobile-broadband"],
          impacted_regions: optionValues(rest, "--region"),
          customer_impact: (optionValue(rest, "--customer-impact") ?? "low") as TelecomEvidenceContext["customer_impact"],
          rollback_plan: requiredOption(rest, "--rollback"),
          pre_checks: preChecks.length ? preChecks : [{ name: "precheck evidence attached", ok: true }],
          ...(postChecks.length ? { post_checks: postChecks } : {}),
          standards_profile: (standards.length ? standards : ["TMF_OPEN_API", "NETCONF_YANG", "GNMI_GNOI", "ORAN_A1_R1"]) as TelecomEvidenceContext["standards_profile"],
          redacted_fields: optionValues(rest, "--redact"),
          retained_fields: optionValues(rest, "--retain")
        };
        const bundle = exportTelecomEvidenceBundle({
          ledgerPath: path.resolve(cwd, requiredOption(rest, "--ledger")),
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          recordId: optionValue(rest, "--record-id"),
          warrant: warrantPath ? JSON.parse(readFileSync(path.resolve(cwd, warrantPath), "utf8")) : undefined,
          exportedAt: optionValue(rest, "--now"),
          telecom
        });
        writeJson(path.resolve(cwd, outPath), bundle);
        const verification = verifyTelecomEvidenceBundle(bundle);
        if (json) printJson(out, bundle, true);
        else out(`telecom_evidence_bundle=${outPath}\nbundle_hash=${bundle.hashes.telecom_bundle_hash}\nverification=${verification.ok ? "ok" : `failed:${verification.failures.join(";")}`}\nchange_ticket=${telecom.change_ticket}\nnetwork_scope=${telecom.network_scope}\n`);
        return verification.ok ? 0 : 1;
      }

      if (subcommand === "benchmark") {
        const report = runCarrierScaleBenchmark({
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          actionCount: Number(optionValue(rest, "--count") ?? "1000"),
          ledgerPath: optionValue(rest, "--ledger") ? path.resolve(cwd, requiredOption(rest, "--ledger")) : undefined,
          now: optionValue(rest, "--now")
        });
        const outPath = optionValue(rest, "--out");
        if (outPath) writeJson(path.resolve(cwd, outPath), report);
        if (json) printJson(out, report, true);
        else out(`carrier_benchmark=${report.action_count} decisions\nallowed=${report.allowed} refused=${report.refused} escalated=${report.escalated}\ndecisions_per_second=${report.decisions_per_second}\np95_ms=${report.latency.p95_ms}\nledger_verification=${report.ledger_verification.ok ? "ok" : `failed:${report.ledger_verification.failure}`}\n${outPath ? `report=${outPath}\n` : ""}`);
        return report.ledger_verification.ok ? 0 : 1;
      }

      if (subcommand === "reconnect-storm") {
        const report = runReconnectStormSimulation({
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          edgeNodes: Number(optionValue(rest, "--edge-nodes") ?? "50"),
          recordsPerNode: Number(optionValue(rest, "--records-per-node") ?? "100"),
          now: optionValue(rest, "--now")
        });
        const outPath = optionValue(rest, "--out");
        if (outPath) writeJson(path.resolve(cwd, outPath), report);
        if (json) printJson(out, report, true);
        else out(`reconnect_storm=${report.total_records} records\nagreements=${report.agreements}\nconflicts=${report.conflicts}\nrecords_per_second=${report.records_per_second}\n${outPath ? `report=${outPath}\n` : ""}`);
        return report.conflicts > 0 ? 2 : 0;
      }

      if (subcommand === "ha-soak") {
        const regions = (optionValue(rest, "--regions") ?? "east,central,west").split(",").map((region) => region.trim()).filter(Boolean);
        const report = simulateMultiRegionLedgerSoak({
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          regions,
          decisionsPerRegion: Number(optionValue(rest, "--decisions-per-region") ?? "200"),
          ledgerPath: optionValue(rest, "--ledger") ? path.resolve(cwd, requiredOption(rest, "--ledger")) : undefined,
          now: optionValue(rest, "--now")
        });
        const outPath = optionValue(rest, "--out");
        if (outPath) writeJson(path.resolve(cwd, outPath), report);
        if (json) printJson(out, report, true);
        else out(`multi_region_soak=${report.total_decisions} decisions\nregions=${report.regions.join(",")}\ndecisions_per_second=${report.decisions_per_second}\nledger_verification=${report.ledger_verification.ok ? "ok" : `failed:${report.ledger_verification.failure}`}\n${outPath ? `report=${outPath}\n` : ""}`);
        return report.ledger_verification.ok ? 0 : 1;
      }

      throw new Error("usage: aristotle telecom <templates|adapters|evidence export|benchmark|reconnect-storm|ha-soak> ...");
    }

    if (command === "automotive") {
      if (subcommand === "templates") {
        const base = "examples/automotive";
        const templates = [
          `${base}/ward.fleet_region_west.yaml`,
          `${base}/authority_envelope.fleet_safety_operator.yaml`,
          `${base}/policy/fleet_region_west.apl`
        ];
        const actions = [
          `${base}/actions/fleet_vehicle_hold.json`,
          `${base}/actions/ota_campaign_canary.json`,
          `${base}/actions/map_update_activate.json`,
          `${base}/actions/remote_assist_pull_over.json`,
          `${base}/actions/refuse_speed_envelope_violation.json`,
          `${base}/actions/refuse_disable_safety_envelope.json`,
          `${base}/actions/simulation_scenario_run.json`
        ];
        if (json) printJson(out, { templates, actions }, true);
        else {
          out("AristotleOS autonomous vehicle pilot templates\n");
          for (const file of [...templates, ...actions]) out(`  ${file}\n`);
        }
        return 0;
      }

      if (subcommand === "adapters") {
        if (json) printJson(out, { adapters: AUTOMOTIVE_ADAPTER_CATALOG }, true);
        else {
          out("Typed autonomous vehicle adapter surfaces\n");
          for (const adapter of AUTOMOTIVE_ADAPTER_CATALOG) {
            out(`\n${adapter.kind} - ${adapter.label}\n`);
            out(`  Boundary: ${adapter.consequenceBoundary}\n`);
            out(`  Actions: ${adapter.actionExamples.join(", ")}\n`);
            out(`  Registers: ${adapter.requiredRuntimeRegisters.join(", ")}\n`);
          }
        }
        return 0;
      }

      if (subcommand === "evidence" && rest[0] === "export") {
        const outPath = requiredOption(rest, "--out");
        const warrantPath = optionValue(rest, "--warrant");
        const standards = optionValues(rest, "--standard");
        const preChecks = optionValues(rest, "--pre-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const postChecks = optionValues(rest, "--post-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const automotive: AutomotiveEvidenceContext = {
          fleet_id: requiredOption(rest, "--fleet"),
          vehicle_id: requiredOption(rest, "--vehicle"),
          safety_operator: requiredOption(rest, "--operator"),
          automotive_domain: (optionValue(rest, "--domain") ?? "fleet-operations") as AutomotiveDomain,
          operational_scope: requiredOption(rest, "--scope"),
          odd_id: requiredOption(rest, "--odd"),
          software_version: optionValue(rest, "--software"),
          map_version: optionValue(rest, "--map"),
          remote_assist_session_id: optionValue(rest, "--remote-assist-session"),
          scenario_id: optionValue(rest, "--scenario"),
          safety_case_id: requiredOption(rest, "--safety-case"),
          pre_checks: preChecks.length ? preChecks : [{ name: "vehicle safety precheck attached", ok: true }],
          ...(postChecks.length ? { post_checks: postChecks } : {}),
          standards_profile: (standards.length ? standards : ["ISO_26262", "ISO_21448", "ISO_21434", "UNECE_R155", "UNECE_R156"]) as AutomotiveEvidenceContext["standards_profile"],
          redacted_fields: optionValues(rest, "--redact"),
          retained_fields: optionValues(rest, "--retain")
        };
        const bundle = exportAutomotiveEvidenceBundle({
          ledgerPath: path.resolve(cwd, requiredOption(rest, "--ledger")),
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          recordId: optionValue(rest, "--record-id"),
          warrant: warrantPath ? JSON.parse(readFileSync(path.resolve(cwd, warrantPath), "utf8")) : undefined,
          exportedAt: optionValue(rest, "--now"),
          automotive
        });
        writeJson(path.resolve(cwd, outPath), bundle);
        const verification = verifyAutomotiveEvidenceBundle(bundle);
        if (json) printJson(out, bundle, true);
        else out(`automotive_evidence_bundle=${outPath}\nbundle_hash=${bundle.hashes.automotive_bundle_hash}\nverification=${verification.ok ? "ok" : `failed:${verification.failures.join(";")}`}\nvehicle=${automotive.vehicle_id}\noperational_scope=${automotive.operational_scope}\n`);
        return verification.ok ? 0 : 1;
      }

      throw new Error("usage: aristotle automotive <templates|adapters|evidence export> ...");
    }

    if (command === "grid") {
      if (subcommand === "templates") {
        const base = "examples/grid";
        const templates = [
          `${base}/ward.transmission_ops.yaml`,
          `${base}/authority_envelope.switching_operator.yaml`,
          `${base}/policy/transmission_ops.apl`
        ];
        const actions = [
          `${base}/actions/scada_breaker_open.json`,
          `${base}/actions/derms_dispatch.json`,
          `${base}/actions/relay_setting_update.json`,
          `${base}/actions/refuse_live_crew_clearance.json`,
          `${base}/actions/refuse_disable_protection.json`,
          `${base}/actions/refuse_der_export_over_cap.json`
        ];
        if (json) printJson(out, { templates, actions }, true);
        else {
          out("AristotleOS electric utility pilot templates\n");
          for (const file of [...templates, ...actions]) out(`  ${file}\n`);
        }
        return 0;
      }

      if (subcommand === "adapters") {
        if (json) printJson(out, { adapters: GRID_ADAPTER_CATALOG }, true);
        else {
          out("Typed electric utility adapter surfaces\n");
          for (const adapter of GRID_ADAPTER_CATALOG) {
            out(`\n${adapter.kind} - ${adapter.label}\n`);
            out(`  Boundary: ${adapter.consequenceBoundary}\n`);
            out(`  Actions: ${adapter.actionExamples.join(", ")}\n`);
            out(`  Registers: ${adapter.requiredRuntimeRegisters.join(", ")}\n`);
          }
        }
        return 0;
      }

      if (subcommand === "evidence" && rest[0] === "export") {
        const outPath = requiredOption(rest, "--out");
        const warrantPath = optionValue(rest, "--warrant");
        const profiles = optionValues(rest, "--profile");
        const preChecks = optionValues(rest, "--pre-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const postChecks = optionValues(rest, "--post-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const grid: GridEvidenceContext = {
          utility_id: requiredOption(rest, "--utility"),
          control_center: requiredOption(rest, "--control-center"),
          grid_domain: (optionValue(rest, "--domain") ?? "transmission") as GridDomain,
          operational_scope: requiredOption(rest, "--scope"),
          asset_id: requiredOption(rest, "--asset"),
          switching_order_id: optionValue(rest, "--switching-order"),
          work_order_id: optionValue(rest, "--work-order"),
          outage_id: optionValue(rest, "--outage"),
          operator_id: requiredOption(rest, "--operator"),
          topology_model_id: requiredOption(rest, "--topology"),
          voltage_class: requiredOption(rest, "--voltage-class"),
          bes_impact: (optionValue(rest, "--bes-impact") ?? "medium") as GridEvidenceContext["bes_impact"],
          cip_evidence_profile: (profiles.length ? profiles : ["CIP_002", "CIP_005", "CIP_010", "NERC_OPS", "LOCAL_SWITCHING_ORDER"]) as GridEvidenceContext["cip_evidence_profile"],
          pre_checks: preChecks.length ? preChecks : [{ name: "switching precheck attached", ok: true }],
          ...(postChecks.length ? { post_checks: postChecks } : {}),
          redacted_fields: optionValues(rest, "--redact"),
          retained_fields: optionValues(rest, "--retain")
        };
        const bundle = exportGridEvidenceBundle({
          ledgerPath: path.resolve(cwd, requiredOption(rest, "--ledger")),
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          recordId: optionValue(rest, "--record-id"),
          warrant: warrantPath ? JSON.parse(readFileSync(path.resolve(cwd, warrantPath), "utf8")) : undefined,
          exportedAt: optionValue(rest, "--now"),
          grid
        });
        writeJson(path.resolve(cwd, outPath), bundle);
        const verification = verifyGridEvidenceBundle(bundle);
        if (json) printJson(out, bundle, true);
        else out(`grid_evidence_bundle=${outPath}\nbundle_hash=${bundle.hashes.grid_bundle_hash}\nverification=${verification.ok ? "ok" : `failed:${verification.failures.join(";")}`}\nasset=${grid.asset_id}\noperational_scope=${grid.operational_scope}\n`);
        return verification.ok ? 0 : 1;
      }

      throw new Error("usage: aristotle grid <templates|adapters|evidence export> ...");
    }

    if (command === "rail") {
      if (subcommand === "templates") {
        const base = "examples/rail";
        const templates = [
          `${base}/ward.subdivision_west.yaml`,
          `${base}/authority_envelope.dispatcher.yaml`,
          `${base}/policy/subdivision_west.apl`
        ];
        const actions = [
          `${base}/actions/allow_movement_authority.json`,
          `${base}/actions/refuse_conflicting_authority.json`,
          `${base}/actions/refuse_misaligned_switch.json`,
          `${base}/actions/escalate_missing_ptc_state.json`,
          `${base}/actions/refuse_disable_ptc.json`
        ];
        if (json) printJson(out, { templates, actions }, true);
        else {
          out("AristotleOS railroad pilot templates\n");
          for (const file of [...templates, ...actions]) out(`  ${file}\n`);
        }
        return 0;
      }

      if (subcommand === "adapters") {
        if (json) printJson(out, { adapters: RAIL_ADAPTER_CATALOG }, true);
        else {
          out("Typed railroad adapter surfaces\n");
          for (const adapter of RAIL_ADAPTER_CATALOG) {
            out(`\n${adapter.kind} - ${adapter.label}\n`);
            out(`  Boundary: ${adapter.consequenceBoundary}\n`);
            out(`  Actions: ${adapter.actionExamples.join(", ")}\n`);
            out(`  Registers: ${adapter.requiredRuntimeRegisters.join(", ")}\n`);
          }
        }
        return 0;
      }

      if (subcommand === "evidence" && rest[0] === "export") {
        const outPath = requiredOption(rest, "--out");
        const warrantPath = optionValue(rest, "--warrant");
        const profiles = optionValues(rest, "--profile");
        const preChecks = optionValues(rest, "--pre-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const postChecks = optionValues(rest, "--post-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const rail: RailEvidenceContext = {
          railroad_id: requiredOption(rest, "--railroad"),
          operations_center: requiredOption(rest, "--ops-center"),
          rail_domain: (optionValue(rest, "--domain") ?? "ptc-mainline") as RailDomain,
          territory_id: requiredOption(rest, "--territory"),
          subdivision: requiredOption(rest, "--subdivision"),
          milepost_limits: {
            from: Number(requiredOption(rest, "--milepost-from")),
            to: Number(requiredOption(rest, "--milepost-to"))
          },
          train_id: requiredOption(rest, "--train"),
          train_symbol: requiredOption(rest, "--symbol"),
          locomotive_id: requiredOption(rest, "--locomotive"),
          movement_authority_id: optionValue(rest, "--authority"),
          dispatcher_id: requiredOption(rest, "--dispatcher"),
          crew_id: optionValue(rest, "--crew"),
          consist_hash: requiredOption(rest, "--consist"),
          ptc_status: (optionValue(rest, "--ptc-status") ?? "active") as RailEvidenceContext["ptc_status"],
          route_id: requiredOption(rest, "--route"),
          track_id: requiredOption(rest, "--track"),
          signal_system: optionValue(rest, "--signal-system"),
          work_zone_id: optionValue(rest, "--work-zone"),
          hazmat_profile: optionValues(rest, "--hazmat"),
          standards_profile: (profiles.length ? profiles : ["FRA_PTC", "FRA_SIGNAL_TRAIN_CONTROL", "TSA_RAIL_CYBER", "DISPATCH_LOG", "EVENT_RECORDER", "LOCAL_OPERATING_RULE"]) as RailEvidenceContext["standards_profile"],
          pre_checks: preChecks.length ? preChecks : [{ name: "PTC state attached", ok: true }],
          ...(postChecks.length ? { post_checks: postChecks } : {}),
          redacted_fields: optionValues(rest, "--redact"),
          retained_fields: optionValues(rest, "--retain")
        };
        const bundle = exportRailEvidenceBundle({
          ledgerPath: path.resolve(cwd, requiredOption(rest, "--ledger")),
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          recordId: optionValue(rest, "--record-id"),
          warrant: warrantPath ? JSON.parse(readFileSync(path.resolve(cwd, warrantPath), "utf8")) : undefined,
          exportedAt: optionValue(rest, "--now"),
          rail
        });
        writeJson(path.resolve(cwd, outPath), bundle);
        const verification = verifyRailEvidenceBundle(bundle);
        if (json) printJson(out, bundle, true);
        else out(`rail_evidence_bundle=${outPath}\nbundle_hash=${bundle.hashes.rail_bundle_hash}\nverification=${verification.ok ? "ok" : `failed:${verification.failures.join(";")}`}\ntrain=${rail.train_id}\nterritory=${rail.territory_id}\n`);
        return verification.ok ? 0 : 1;
      }

      throw new Error("usage: aristotle rail <templates|adapters|evidence export> ...");
    }

    if (command === "port") {
      if (subcommand === "templates") {
        const base = "examples/port";
        const templates = [
          `${base}/ward.container_terminal_alpha.yaml`,
          `${base}/authority_envelope.terminal_orchestrator.yaml`,
          `${base}/policy/container_terminal_alpha.apl`
        ];
        const actions = [
          `${base}/actions/allow_container_release.json`,
          `${base}/actions/refuse_customs_hold_release.json`,
          `${base}/actions/refuse_crane_exclusion_zone.json`,
          `${base}/actions/escalate_missing_pnt_state.json`,
          `${base}/actions/refuse_force_gate_open.json`
        ];
        if (json) printJson(out, { templates, actions }, true);
        else {
          out("AristotleOS port pilot templates\n");
          for (const file of [...templates, ...actions]) out(`  ${file}\n`);
        }
        return 0;
      }

      if (subcommand === "adapters") {
        if (json) printJson(out, { adapters: PORT_ADAPTER_CATALOG }, true);
        else {
          out("Typed maritime port adapter surfaces\n");
          for (const adapter of PORT_ADAPTER_CATALOG) {
            out(`\n${adapter.kind} - ${adapter.label}\n`);
            out(`  Boundary: ${adapter.consequenceBoundary}\n`);
            out(`  Actions: ${adapter.actionExamples.join(", ")}\n`);
            out(`  Registers: ${adapter.requiredRuntimeRegisters.join(", ")}\n`);
          }
        }
        return 0;
      }

      if (subcommand === "evidence" && rest[0] === "export") {
        const outPath = requiredOption(rest, "--out");
        const warrantPath = optionValue(rest, "--warrant");
        const profiles = optionValues(rest, "--profile");
        const preChecks = optionValues(rest, "--pre-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const postChecks = optionValues(rest, "--post-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const weight = optionValue(rest, "--weight-kg");
        const port: PortEvidenceContext = {
          port_id: requiredOption(rest, "--port"),
          facility_id: requiredOption(rest, "--facility"),
          terminal_id: requiredOption(rest, "--terminal"),
          port_domain: (optionValue(rest, "--domain") ?? "container-terminal") as PortDomain,
          operations_center: requiredOption(rest, "--ops-center"),
          berth_id: optionValue(rest, "--berth"),
          yard_block_id: optionValue(rest, "--yard-block"),
          gate_id: optionValue(rest, "--gate"),
          container_id: optionValue(rest, "--container"),
          vessel_imo: optionValue(rest, "--vessel"),
          voyage_id: optionValue(rest, "--voyage"),
          booking_id: optionValue(rest, "--booking"),
          bill_of_lading: optionValue(rest, "--bol"),
          release_order_id: optionValue(rest, "--release"),
          equipment_id: optionValue(rest, "--equipment"),
          cargo_profile: {
            cargo_type: optionValue(rest, "--cargo-type") ?? "container",
            hazmat_class: optionValue(rest, "--hazmat"),
            reefer: rest.includes("--reefer"),
            ...(weight ? { container_weight_kg: Number(weight) } : {})
          },
          standards_profile: (profiles.length ? profiles : ["USCG_MTSA_CYBER", "IMO_MSC_FAL", "CISA_MTS_RESILIENCE", "ISPS", "NIST_CSF", "LOCAL_TERMINAL_RULE"]) as PortEvidenceContext["standards_profile"],
          pre_checks: preChecks.length ? preChecks : [{ name: "customs/security holds evaluated", ok: true }],
          ...(postChecks.length ? { post_checks: postChecks } : {}),
          redacted_fields: optionValues(rest, "--redact"),
          retained_fields: optionValues(rest, "--retain")
        };
        const bundle = exportPortEvidenceBundle({
          ledgerPath: path.resolve(cwd, requiredOption(rest, "--ledger")),
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          recordId: optionValue(rest, "--record-id"),
          warrant: warrantPath ? JSON.parse(readFileSync(path.resolve(cwd, warrantPath), "utf8")) : undefined,
          exportedAt: optionValue(rest, "--now"),
          port
        });
        writeJson(path.resolve(cwd, outPath), bundle);
        const verification = verifyPortEvidenceBundle(bundle);
        if (json) printJson(out, bundle, true);
        else out(`port_evidence_bundle=${outPath}\nbundle_hash=${bundle.hashes.port_bundle_hash}\nverification=${verification.ok ? "ok" : `failed:${verification.failures.join(";")}`}\nport=${port.port_id}\nterminal=${port.terminal_id}\n` );
        return verification.ok ? 0 : 1;
      }

      throw new Error("usage: aristotle port <templates|adapters|evidence export> ...");
    }

    if (command === "water") {
      if (subcommand === "templates") {
        const base = "examples/water";
        const templates = [
          `${base}/ward.drinking_water_plant.yaml`,
          `${base}/authority_envelope.water_operator.yaml`,
          `${base}/policy/drinking_water_plant.apl`
        ];
        const actions = [
          `${base}/actions/allow_pump_speed_adjust.json`,
          `${base}/actions/refuse_chlorine_overfeed.json`,
          `${base}/actions/refuse_backflow_valve.json`,
          `${base}/actions/escalate_missing_turbidity_state.json`,
          `${base}/actions/refuse_disable_disinfection.json`
        ];
        if (json) printJson(out, { templates, actions }, true);
        else {
          out("AristotleOS water infrastructure pilot templates\n");
          for (const file of [...templates, ...actions]) out(`  ${file}\n`);
        }
        return 0;
      }

      if (subcommand === "adapters") {
        if (json) printJson(out, { adapters: WATER_ADAPTER_CATALOG }, true);
        else {
          out("Typed water and wastewater adapter surfaces\n");
          for (const adapter of WATER_ADAPTER_CATALOG) {
            out(`\n${adapter.kind} - ${adapter.label}\n`);
            out(`  Boundary: ${adapter.consequenceBoundary}\n`);
            out(`  Actions: ${adapter.actionExamples.join(", ")}\n`);
            out(`  Registers: ${adapter.requiredRuntimeRegisters.join(", ")}\n`);
          }
        }
        return 0;
      }

      if (subcommand === "evidence" && rest[0] === "export") {
        const outPath = requiredOption(rest, "--out");
        const warrantPath = optionValue(rest, "--warrant");
        const profiles = optionValues(rest, "--profile");
        const preChecks = optionValues(rest, "--pre-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const postChecks = optionValues(rest, "--post-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const numericOption = (name: string) => {
          const value = optionValue(rest, name);
          return value === undefined ? undefined : Number(value);
        };
        const processSnapshot: WaterEvidenceContext["process_snapshot"] = {};
        const chlorine = numericOption("--chlorine");
        const ph = numericOption("--ph");
        const turbidity = numericOption("--turbidity");
        const pressure = numericOption("--pressure");
        const tankLevel = numericOption("--tank-level");
        const flow = numericOption("--flow");
        if (chlorine !== undefined) processSnapshot.chlorine_residual_mg_l = chlorine;
        if (ph !== undefined) processSnapshot.ph = ph;
        if (turbidity !== undefined) processSnapshot.turbidity_ntu = turbidity;
        if (pressure !== undefined) processSnapshot.pressure_psi = pressure;
        if (tankLevel !== undefined) processSnapshot.tank_level_pct = tankLevel;
        if (flow !== undefined) processSnapshot.flow_mgd = flow;
        const water: WaterEvidenceContext = {
          utility_id: requiredOption(rest, "--utility"),
          water_system_id: requiredOption(rest, "--system"),
          facility_id: requiredOption(rest, "--facility"),
          water_domain: (optionValue(rest, "--domain") ?? "drinking-water-treatment") as WaterDomain,
          operations_center: requiredOption(rest, "--ops-center"),
          asset_id: requiredOption(rest, "--asset"),
          asset_type: requiredOption(rest, "--asset-type"),
          process_area: requiredOption(rest, "--process-area"),
          pressure_zone_id: optionValue(rest, "--pressure-zone"),
          tank_id: optionValue(rest, "--tank"),
          reservoir_id: optionValue(rest, "--reservoir"),
          lift_station_id: optionValue(rest, "--lift-station"),
          outfall_id: optionValue(rest, "--outfall"),
          work_order_id: optionValue(rest, "--work-order"),
          discharge_permit_id: optionValue(rest, "--permit"),
          process_snapshot: processSnapshot,
          standards_profile: (profiles.length ? profiles : ["EPA_WATER_CYBER", "CISA_WWS_CPG", "AWWA_CYBER", "AWIA_RRA", "NIST_CSF", "LOCAL_OPERATING_PROCEDURE"]) as WaterEvidenceContext["standards_profile"],
          pre_checks: preChecks.length ? preChecks : [{ name: "SCADA state fresh and process telemetry attached", ok: true }],
          ...(postChecks.length ? { post_checks: postChecks } : {}),
          redacted_fields: optionValues(rest, "--redact"),
          retained_fields: optionValues(rest, "--retain")
        };
        const bundle = exportWaterEvidenceBundle({
          ledgerPath: path.resolve(cwd, requiredOption(rest, "--ledger")),
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          recordId: optionValue(rest, "--record-id"),
          warrant: warrantPath ? JSON.parse(readFileSync(path.resolve(cwd, warrantPath), "utf8")) : undefined,
          exportedAt: optionValue(rest, "--now"),
          water
        });
        writeJson(path.resolve(cwd, outPath), bundle);
        const verification = verifyWaterEvidenceBundle(bundle);
        if (json) printJson(out, bundle, true);
        else out(`water_evidence_bundle=${outPath}\nbundle_hash=${bundle.hashes.water_bundle_hash}\nverification=${verification.ok ? "ok" : `failed:${verification.failures.join(";")}`}\nutility=${water.utility_id}\nfacility=${water.facility_id}\n`);
        return verification.ok ? 0 : 1;
      }

      throw new Error("usage: aristotle water <templates|adapters|evidence export> ...");
    }

    if (command === "logistics") {
      if (subcommand === "templates") {
        const base = "examples/logistics";
        const templates = [
          `${base}/ward.network_west.yaml`,
          `${base}/authority_envelope.dispatch_orchestrator.yaml`,
          `${base}/policy/network_west.apl`
        ];
        const actions = [
          `${base}/actions/allow_load_dispatch.json`,
          `${base}/actions/refuse_hos_overrun.json`,
          `${base}/actions/refuse_double_broker_risk.json`,
          `${base}/actions/escalate_missing_eld_state.json`,
          `${base}/actions/refuse_payment_force_release.json`
        ];
        if (json) printJson(out, { templates, actions }, true);
        else {
          out("AristotleOS trucking and logistics pilot templates\n");
          for (const file of [...templates, ...actions]) out(`  ${file}\n`);
        }
        return 0;
      }

      if (subcommand === "adapters") {
        if (json) printJson(out, { adapters: LOGISTICS_ADAPTER_CATALOG }, true);
        else {
          out("Typed trucking and logistics adapter surfaces\n");
          for (const adapter of LOGISTICS_ADAPTER_CATALOG) {
            out(`\n${adapter.kind} - ${adapter.label}\n`);
            out(`  Boundary: ${adapter.consequenceBoundary}\n`);
            out(`  Actions: ${adapter.actionExamples.join(", ")}\n`);
            out(`  Registers: ${adapter.requiredRuntimeRegisters.join(", ")}\n`);
          }
        }
        return 0;
      }

      if (subcommand === "evidence" && rest[0] === "export") {
        const outPath = requiredOption(rest, "--out");
        const warrantPath = optionValue(rest, "--warrant");
        const profiles = optionValues(rest, "--profile");
        const preChecks = optionValues(rest, "--pre-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const postChecks = optionValues(rest, "--post-check").map((item) => {
          const [name, raw = "true", detail] = item.split(":");
          return { name, ok: raw !== "false" && raw !== "fail", ...(detail ? { detail } : {}) };
        });
        const numericOption = (name: string) => {
          const value = optionValue(rest, name);
          return value === undefined ? undefined : Number(value);
        };
        const cargoValue = numericOption("--cargo-value");
        const grossWeight = numericOption("--gross-weight");
        const logistics: LogisticsEvidenceContext = {
          logistics_network_id: requiredOption(rest, "--network"),
          operations_center: requiredOption(rest, "--ops-center"),
          logistics_domain: (optionValue(rest, "--domain") ?? "truckload-fleet") as LogisticsDomain,
          load_id: requiredOption(rest, "--load"),
          shipment_id: requiredOption(rest, "--shipment"),
          trip_id: requiredOption(rest, "--trip"),
          carrier_id: requiredOption(rest, "--carrier"),
          broker_id: optionValue(rest, "--broker"),
          shipper_id: requiredOption(rest, "--shipper"),
          driver_id: requiredOption(rest, "--driver"),
          tractor_id: requiredOption(rest, "--tractor"),
          trailer_id: requiredOption(rest, "--trailer"),
          route_id: requiredOption(rest, "--route"),
          origin_facility_id: requiredOption(rest, "--origin"),
          destination_facility_id: requiredOption(rest, "--destination"),
          cargo_profile: {
            cargo_class: optionValue(rest, "--cargo-class") ?? "general",
            commodity: optionValue(rest, "--commodity") ?? "freight",
            hazmat_class: optionValue(rest, "--hazmat"),
            temperature_controlled: rest.includes("--temperature-controlled"),
            ...(cargoValue !== undefined ? { cargo_value_usd: cargoValue } : {}),
            ...(grossWeight !== undefined ? { gross_weight_lbs: grossWeight } : {})
          },
          compliance_profile: (profiles.length ? profiles : ["FMCSA_HOS", "ELD", "DOT_SAFETY", "FSMA_SANITARY_TRANSPORT", "NIST_CSF", "LOCAL_SOP"]) as LogisticsEvidenceContext["compliance_profile"],
          pre_checks: preChecks.length ? preChecks : [{ name: "HOS, ELD, carrier, route, and cargo checks evaluated", ok: true }],
          ...(postChecks.length ? { post_checks: postChecks } : {}),
          redacted_fields: optionValues(rest, "--redact"),
          retained_fields: optionValues(rest, "--retain")
        };
        const bundle = exportLogisticsEvidenceBundle({
          ledgerPath: path.resolve(cwd, requiredOption(rest, "--ledger")),
          ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))),
          authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))),
          recordId: optionValue(rest, "--record-id"),
          warrant: warrantPath ? JSON.parse(readFileSync(path.resolve(cwd, warrantPath), "utf8")) : undefined,
          exportedAt: optionValue(rest, "--now"),
          logistics
        });
        writeJson(path.resolve(cwd, outPath), bundle);
        const verification = verifyLogisticsEvidenceBundle(bundle);
        if (json) printJson(out, bundle, true);
        else out(`logistics_evidence_bundle=${outPath}\nbundle_hash=${bundle.hashes.logistics_bundle_hash}\nverification=${verification.ok ? "ok" : `failed:${verification.failures.join(";")}`}\nload=${logistics.load_id}\ncarrier=${logistics.carrier_id}\n`);
        return verification.ok ? 0 : 1;
      }

      throw new Error("usage: aristotle logistics <templates|adapters|evidence export> ...");
    }

    if (command === "execution-control" && subcommand === "shadow") {
      // Observe-only rollout profiling: run proposed actions through the real Commit
      // Gate without touching the live ledger or weakening any policy.
      const ward = loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward")));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope")));
      const raw = JSON.parse(readFileSync(path.resolve(cwd, requiredOption(rest, "--actions")), "utf8")) as unknown;
      const entries = Array.isArray(raw) ? raw : [raw];
      const actions: ShadowAction[] = entries.map((entry) => {
        const e = entry as Record<string, unknown>;
        return "action" in e
          ? { action: e.action as ShadowAction["action"], runtimeRegister: (e.runtime_register ?? e.runtimeRegister) as ShadowAction["runtimeRegister"] }
          : { action: e as unknown as ShadowAction["action"] };
      });
      const report = profileShadowMode({
        ward, authorityEnvelope, actions,
        signer: resolveSigner(rest, cwd, err),
        now: optionValue(rest, "--now"),
        revocationListPath: optionValue(rest, "--revocations") ? path.resolve(cwd, optionValue(rest, "--revocations")!) : undefined
      });

      const outPath = optionValue(rest, "--out");
      if (outPath) writeFileSync(path.resolve(cwd, outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");

      if (json) { printJson(out, report, true); }
      else {
        out(`AristotleOS Shadow Mode — ${report.ward_id} / ${report.authority_envelope_id}\n`);
        out(`Evaluated ${report.count} action(s): ALLOW ${report.decisions.ALLOW} · REFUSE ${report.decisions.REFUSE} · ESCALATE ${report.decisions.ESCALATE}\n`);
        out(`Allow rate: ${(report.rollout.allow_rate * 100).toFixed(1)}%   Rollout: ${report.rollout.ready ? "READY" : "NOT READY"}\n`);
        if (report.rollout.blockers.length) out(`Blockers: ${report.rollout.blockers.map((b) => `${b.reason_code}×${b.count}`).join(", ")}\n`);
        for (const t of report.would_block) out(`  would REFUSE  ${t.action_id} (${t.action_type}) — ${t.reason_codes.join(", ")}\n`);
        for (const t of report.would_escalate) out(`  would ESCALATE ${t.action_id} (${t.action_type}) — ${t.reason_codes.join(", ")}${t.missing_runtime_registers.length ? ` · missing ${t.missing_runtime_registers.join(",")}` : ""}\n`);
        for (const n of report.findings.physical_near_misses) out(`  near-miss     ${n.action_id} — ${n.detail}\n`);
        out(`Evidence: ${report.evidence.length} GEL-compatible record(s) (ephemeral, observe-only)${outPath ? ` · report → ${outPath}` : ""}\n`);
      }
      // Exit non-zero when not rollout-ready, so a promotion pipeline can gate on it.
      return report.rollout.ready ? 0 : 1;
    }

    if (command === "governance" && subcommand === "compile") {
      const ward = loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward")));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope")));
      const manifest = compileGovernanceManifest({ ward, authorityEnvelope, now: optionValue(rest, "--now") });
      const outPath = optionValue(rest, "--out");
      if (outPath) writeFileSync(path.resolve(cwd, outPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      if (json) { printJson(out, manifest, true); }
      else {
        out(`governance manifest — ${manifest.ward.ward_id} / ${manifest.authority_envelope.envelope_id}\n`);
        out(`validation: ${manifest.validation.ok ? "ok" : "FAILED"}\n`);
        for (const e of manifest.validation.errors) out(`  - ${e}\n`);
        out(`ward_hash=${manifest.hashes.ward_hash.slice(0, 16)}…  envelope_hash=${manifest.hashes.authority_envelope_hash.slice(0, 16)}…\n`);
        out(`manifest_hash=${manifest.hashes.manifest_hash}\n${outPath ? `written → ${outPath}\n` : ""}`);
      }
      return manifest.validation.ok ? 0 : 1;
    }

    if (command === "governance" && subcommand === "diff") {
      const before = { ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward"))), authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope"))) };
      const after = { ward: loadWardManifest(path.resolve(cwd, requiredOption(rest, "--against-ward"))), authorityEnvelope: loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--against-envelope"))) };
      const diff = diffGovernanceManifests(before, after);
      const weakenings = diff.filter((d) => d.weakening);
      if (json) { printJson(out, { diff, weakening_count: weakenings.length }, true); }
      else {
        out(`governance diff — ${diff.length} change(s), ${weakenings.length} weaken authority\n`);
        for (const d of diff) out(`  ${d.weakening ? "⚠ WEAKENS" : "·       "} ${d.path}  (${d.note})\n`);
      }
      // Exit non-zero when authority is weakened, so a review gate can require sign-off.
      return weakenings.length === 0 ? 0 : 1;
    }

    if (command === "governance" && subcommand === "explain") {
      const ward = loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward")));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope")));
      const actionsOpt = optionValue(rest, "--actions");
      const sampleActions = actionsOpt ? (() => { const raw = JSON.parse(readFileSync(path.resolve(cwd, actionsOpt), "utf8")); return Array.isArray(raw) ? raw : [raw]; })() : [];
      const explanation = explainPolicy({ ward, authorityEnvelope, sampleActions, now: optionValue(rest, "--now") });
      if (json) { printJson(out, explanation, true); }
      else {
        out(`policy — ${explanation.ward_id} / ${explanation.authority_envelope_id}\n`);
        out(`allows: ${explanation.allowed_actions.join(", ") || "(none)"}\n`);
        out(`denies: ${explanation.denied_actions.join(", ") || "(none)"}\n`);
        for (const s of explanation.samples) out(`  ${s.decision.padEnd(8)} ${s.action_type} — ${s.reason_codes.join(", ")}\n`);
      }
      return 0;
    }

    if (command === "ward-marshal" && subcommand === "scan") {
      const observations = JSON.parse(readFileSync(path.resolve(cwd, requiredOption(rest, "--observations")), "utf8")) as AgentObservation[];
      const registryPath = optionValue(rest, "--registry");
      const registry = registryPath ? JSON.parse(readFileSync(path.resolve(cwd, registryPath), "utf8")) as AgentRegistry : undefined;
      const report = runWardMarshalCensus({ observations, registry, generatedAt: optionValue(rest, "--now") });
      const outPath = optionValue(rest, "--out");
      if (outPath) writeJson(path.resolve(cwd, outPath), report);
      if (json) {
        printJson(out, report, true);
      } else {
        out(`Ward Marshal census — ${report.summary.observed} agent surface(s)\n`);
        out(`governed=${report.summary.governed} shadow=${report.summary.shadow} rogue=${report.summary.rogue} orphaned=${report.summary.orphaned} high_or_critical=${report.summary.high_or_critical}\n`);
        for (const finding of report.findings) {
          out(`  ${finding.status.toUpperCase().padEnd(9)} ${finding.subject} risk=${finding.risk_band}/${finding.risk_score} disposition=${finding.recommended_disposition}\n`);
          out(`    ${explainWardMarshalFinding(finding)}\n`);
        }
        out(`report_hash=${report.report_hash}${outPath ? `\nwritten → ${outPath}` : ""}\n`);
      }
      return report.summary.rogue || report.summary.orphaned ? 2 : 0;
    }

    if (command === "ward-marshal" && subcommand === "discover") {
      const collectors = [];
      if (rest.includes("--kubernetes")) {
        collectors.push(kubernetesCollector({
          kubectlPath: optionValue(rest, "--kubectl"),
          kubeContext: optionValue(rest, "--kube-context"),
          namespaces: optionValues(rest, "--namespace"),
          now: optionValue(rest, "--now")
        }));
      }
      if (rest.includes("--process")) {
        collectors.push(processCollector({
          psPath: optionValue(rest, "--ps"),
          host: optionValue(rest, "--host"),
          now: optionValue(rest, "--now")
        }));
      }
      if (rest.includes("--mcp")) {
        const mcpArgs = optionValues(rest, "--mcp-arg");
        collectors.push(mcpCollector({
          command: optionValue(rest, "--mcp-command"),
          args: mcpArgs.length ? mcpArgs : undefined,
          now: optionValue(rest, "--now")
        }));
      }
      const fromFile = optionValue(rest, "--from-file");
      if (fromFile) {
        const source = optionValue(rest, "--source");
        if (!source) throw new Error("--from-file requires --source <ci|saas-automation|network|api-gateway|edge-node|...>");
        const mapping: Record<string, string> = {};
        for (const pair of optionValues(rest, "--map")) {
          const eq = pair.indexOf("=");
          if (eq <= 0) throw new Error(`--map expects field=key (got "${pair}")`);
          mapping[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
        collectors.push(fileObservationCollector({
          path: path.resolve(cwd, fromFile),
          source: source as Parameters<typeof fileObservationCollector>[0]["source"],
          mapping,
          captureLabels: rest.includes("--capture-labels"),
          now: optionValue(rest, "--now")
        }));
      }
      if (collectors.length === 0) throw new Error("ward-marshal discover requires a source (e.g. --kubernetes, --process, --mcp, or --from-file)");
      const observations = await collectObservations(collectors);
      const outPath = optionValue(rest, "--out");
      if (outPath) writeJson(path.resolve(cwd, outPath), observations);
      if (json) {
        printJson(out, observations, true);
      } else {
        out(`Ward Marshal discovery — ${observations.length} agent surface(s)\n`);
        for (const observation of observations) {
          out(`  ${observation.source.padEnd(12)} ${observation.location}${observation.declared_agent_id ? ` (agent:${observation.declared_agent_id})` : " (undeclared)"}\n`);
        }
        out(outPath ? `written → ${outPath}\n` : "Pipe into `ward-marshal scan --observations <file>` to risk-score.\n");
      }
      return 0;
    }

    if (command === "ward-marshal" && subcommand === "behavior") {
      const events: BehaviorEvent[] = [];
      const eventsPath = optionValue(rest, "--events");
      if (eventsPath) events.push(...(JSON.parse(readFileSync(path.resolve(cwd, eventsPath), "utf8")) as BehaviorEvent[]));
      const ledgerPath = optionValue(rest, "--ledger");
      if (ledgerPath) events.push(...behaviorEventsFromGel(loadGelChain(path.resolve(cwd, ledgerPath))));
      if (events.length === 0) throw new Error("ward-marshal behavior requires --events <file.json> and/or --ledger <gel.jsonl>");

      const rulesPath = optionValue(rest, "--rules");
      const sequenceRules = rulesPath ? (JSON.parse(readFileSync(path.resolve(cwd, rulesPath), "utf8")) as SequenceRule[]) : undefined;
      const registryPath = optionValue(rest, "--registry");
      const knownSubjects = registryPath
        ? (JSON.parse(readFileSync(path.resolve(cwd, registryPath), "utf8")) as AgentRegistry).agents.map((agent) => agent.subject)
        : optionValue(rest, "--known")?.split(",").map((value) => value.trim()).filter(Boolean);
      const allowedHoursRaw = optionValue(rest, "--allowed-hours");
      const allowedHoursUtc = allowedHoursRaw && /^\d+-\d+$/.test(allowedHoursRaw)
        ? { start: Number(allowedHoursRaw.split("-")[0]), end: Number(allowedHoursRaw.split("-")[1]) }
        : undefined;
      const windowRaw = optionValue(rest, "--window-ms");

      const report = analyzeAgentBehavior(events, {
        now: optionValue(rest, "--now"),
        windowMs: windowRaw ? Number(windowRaw) : undefined,
        knownSubjects,
        sequenceRules,
        allowedHoursUtc
      });

      const outPath = optionValue(rest, "--out");
      if (outPath) writeJson(path.resolve(cwd, outPath), report);
      if (json) {
        printJson(out, report, true);
      } else {
        out(`Ward Marshal behavior — ${report.summary.events} event(s), ${report.summary.findings} finding(s), ${report.summary.high_or_critical} high/critical\n`);
        for (const finding of report.findings) {
          out(`  ${finding.severity.toUpperCase().padEnd(8)} ${finding.kind.padEnd(15)} ${finding.subjects.join(", ")} → ${finding.recommended_disposition}\n`);
          out(`    ${finding.detail}\n`);
        }
        out(`report_hash=${report.report_hash}${outPath ? `\nwritten → ${outPath}` : ""}\n`);
      }
      return report.summary.high_or_critical > 0 ? 2 : 0;
    }

    if (command === "ward-marshal" && subcommand === "interdict") {
      const reportPath = optionValue(rest, "--report");
      const observationsPath = optionValue(rest, "--observations");
      const registryPath = optionValue(rest, "--registry");
      const report = reportPath
        ? JSON.parse(readFileSync(path.resolve(cwd, reportPath), "utf8")) as ReturnType<typeof runWardMarshalCensus>
        : runWardMarshalCensus({
            observations: JSON.parse(readFileSync(path.resolve(cwd, observationsPath ?? "examples/ward_marshal/observations.enterprise.json"), "utf8")) as AgentObservation[],
            registry: registryPath ? JSON.parse(readFileSync(path.resolve(cwd, registryPath), "utf8")) as AgentRegistry : undefined,
            generatedAt: optionValue(rest, "--now")
          });
      const findingId = optionValue(rest, "--finding-id");
      const finding = findingId
        ? report.findings.find((item) => item.finding_id === findingId)
        : report.findings.find((item) => item.status === "rogue" && (item.risk_band === "critical" || item.risk_band === "high"))
          ?? report.findings.find((item) => item.status === "orphaned")
          ?? report.findings.find((item) => item.status === "rogue");
      if (!finding) throw new Error("no Ward Marshal finding selected. Pass --finding-id or scan observations with rogue/orphaned agents.");
      const kind = (optionValue(rest, "--kind") ?? finding.recommended_disposition) as WardMarshalInterdictionKind;
      if (!["quarantine", "revoke_credentials", "disable_tool_access", "scale_to_zero", "terminate_execution"].includes(kind)) {
        throw new Error("--kind must be quarantine|revoke_credentials|disable_tool_access|scale_to_zero|terminate_execution");
      }
      const ward = loadWardManifest(path.resolve(cwd, optionValue(rest, "--ward") ?? "examples/ward_marshal/ward.enterprise_autonomy.yaml"));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, optionValue(rest, "--envelope") ?? "examples/ward_marshal/authority_envelope.ward_marshal.yaml"));
      const ledgerPath = path.resolve(cwd, optionValue(rest, "--ledger") ?? ".tmp/ward-marshal.gel.jsonl");
      const action = buildWardMarshalInterdictionAction({
        finding: { ...finding, ward_id: finding.ward_id ?? ward.ward_id },
        kind,
        requestedBy: optionValue(rest, "--requested-by") ?? authorityEnvelope.subject,
        requestedAt: optionValue(rest, "--now") ?? new Date().toISOString(),
        reason: optionValue(rest, "--reason") ?? `Ward Marshal ${kind} for ${finding.subject}`,
        target: optionValue(rest, "--target")
      });
      const k8sNamespace = optionValue(rest, "--k8s-namespace");
      const k8sKind = optionValue(rest, "--k8s-kind");
      const k8sName = optionValue(rest, "--k8s-name");
      if (k8sNamespace || k8sKind || k8sName) {
        if (!k8sNamespace || !k8sKind || !k8sName) throw new Error("--k8s-namespace, --k8s-kind, and --k8s-name must be provided together");
        action.params.kubernetes = { namespace: k8sNamespace, kind: k8sKind, name: k8sName };
      }
      const selector = selectorFromArgs(rest);
      const quarantineNamespace = optionValue(rest, "--quarantine-namespace");
      if (quarantineNamespace || Object.keys(selector).length) {
        if (!quarantineNamespace) throw new Error("--quarantine-namespace is required with --selector");
        const quarantine: Record<string, JsonValue> = {
          namespace: quarantineNamespace,
          pod_selector: selector
        };
        const policyName = optionValue(rest, "--policy-name");
        if (policyName) quarantine.policy_name = policyName;
        action.params.endpoint_quarantine = quarantine;
      }
      const registers: Record<string, string> = {};
      const operatorTicket = optionValue(rest, "--operator-ticket");
      const interdictionAuthority = optionValue(rest, "--interdiction-authority");
      if (operatorTicket) registers.operator_ticket = operatorTicket;
      if (interdictionAuthority) registers.interdiction_authority = interdictionAuthority;
      const runtimeRegister = { policy_version: ward.policy_version, registers };
      const signer = resolveSigner(rest, cwd, err);
      const execute = rest.includes("--execute");
      const defaultAdapter: WardMarshalAdapterKind =
        kind === "revoke_credentials" ? "credential-revocation" :
          (kind === "quarantine" || kind === "disable_tool_access") ? "endpoint-quarantine" :
            "kubernetes-scale-down";
      const adapterKind = (optionValue(rest, "--adapter") ?? defaultAdapter) as WardMarshalAdapterKind;
      const result = execute
        ? await executeWardMarshalInterdiction({
            ward,
            authorityEnvelope,
            action,
            adapter: buildWardMarshalAdapter(rest, cwd, adapterKind),
            ledgerPath,
            runtimeRegister,
            now: optionValue(rest, "--now"),
            signer,
            replayProtection: !rest.includes("--no-replay-protection")
          })
        : evaluateExecutionControl({
            ward,
            authorityEnvelope,
            action,
            runtimeRegister,
            ledgerPath,
            now: optionValue(rest, "--now"),
            signer,
            replayProtection: !rest.includes("--no-replay-protection")
          });
      if (json) {
        printJson(out, { finding, action, result }, true);
      } else {
        out(`Ward Marshal interdiction — ${kind}${execute ? ` via ${adapterKind}` : " (evaluate only)"}\n`);
        out(`target=${finding.subject} finding=${finding.finding_id} risk=${finding.risk_band}/${finding.risk_score}\n`);
        out(`decision=${result.decision}\nreason_codes=${result.reason_codes.join(",")}\nwarrant_id=${result.warrant?.warrant_id ?? "none"}\ngel_record_hash=${result.gel_record.record_hash}\n`);
        if (!("executed" in result)) out(`ledger_verification=${result.ledger_verification.ok ? "ok" : `failed:${result.ledger_verification.failure}`}\n`);
        if ("executed" in result) out(`executed=${result.executed ? "yes" : "no"}\nreceipt_id=${result.receipt?.receipt_id ?? "none"}\nadapter_status=${result.receipt?.status ?? "none"}\n`);
        if ("error" in result && result.error) out(`error=${result.error}\n`);
      }
      if ("executed" in result) return result.decision === "ALLOW" && result.executed ? 0 : result.decision === "ESCALATE" ? 2 : 1;
      return result.decision === "ALLOW" && result.ledger_verification.ok ? 0 : result.decision === "ESCALATE" ? 2 : 1;
    }

    if (command === "ward-marshal" && subcommand === "demo") {
      const demoArgs = [
        "ward-marshal",
        "interdict",
        "--observations",
        "examples/ward_marshal/observations.enterprise.json",
        "--registry",
        "examples/ward_marshal/agent-registry.json",
        "--ward",
        "examples/ward_marshal/ward.enterprise_autonomy.yaml",
        "--envelope",
        "examples/ward_marshal/authority_envelope.ward_marshal.yaml",
        "--ledger",
        ".tmp/ward-marshal.gel.jsonl",
        "--execute",
        "--credential-revocations",
        ".tmp/ward-marshal-credential-revocations.json",
        "--no-replay-protection",
        "--kind",
        optionValue(rest, "--kind") ?? "revoke_credentials",
        "--operator-ticket",
        optionValue(rest, "--operator-ticket") ?? "SEC-DEMO-001",
        "--interdiction-authority",
        optionValue(rest, "--interdiction-authority") ?? "soc-commander",
        "--now",
        optionValue(rest, "--now") ?? "2026-05-24T12:05:00.000Z"
      ];
      return runCli(demoArgs, cwd, out, err);
    }

    if (command === "reconcile") {
      // No subcommand: options begin right after the command name.
      const rargs = argv.slice(1);
      const ward = loadWardManifest(path.resolve(cwd, requiredOption(rargs, "--ward")));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rargs, "--envelope")));
      const records = JSON.parse(readFileSync(path.resolve(cwd, requiredOption(rargs, "--records")), "utf8")) as EdgeRecord[];
      const report = reconcileEdgeRecords({ records, ward, authorityEnvelope, now: optionValue(rargs, "--now") });
      const outPath = optionValue(rargs, "--out");
      if (outPath) writeFileSync(path.resolve(cwd, outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      if (json) { printJson(out, report, true); }
      else {
        out(`edge reconciliation — ${report.ward_id} / ${report.authority_envelope_id}\n`);
        out(`${report.count} record(s): ${report.agreements} agree, ${report.conflicts} conflict\n`);
        for (const i of report.items.filter((x) => !x.agrees)) {
          out(`  CONFLICT ${i.action_id} (${i.action_type}) — edge ${i.edge_decision} vs current ${i.current_decision} [${i.conflict_kind}]`);
          if (i.replay.against_execution_time) out(` · exec-time ${i.replay.against_execution_time.decision}`);
          out(`\n`);
        }
        out(`${outPath ? `report → ${outPath}\n` : ""}`);
      }
      // Exit non-zero when unresolved conflicts exist.
      return report.conflicts === 0 ? 0 : 1;
    }

    if (command === "policy") {
      const sub = argv[1];
      const pargs = argv.slice(2);
      const file = pargs.find((a) => !a.startsWith("--")) ?? optionValue(pargs, "--file");
      if (!file || (sub !== "compile" && sub !== "check")) {
        throw new Error("usage: aristotle policy <compile|check> <file.apl> [--out <file>]");
      }
      const source = readFileSync(path.resolve(cwd, file), "utf8");
      const result = compilePolicy(source, { now: optionValue(pargs, "--now") });
      if (!result.ok) {
        for (const d of result.diagnostics) err(`${file}:${d.line}:${d.column} ${d.message}\n`);
        return 1;
      }
      if (sub === "check") {
        if (json) { printJson(out, { ok: true, wards: result.drafts.map((d) => d.ward.ward_id) }, true); }
        else out(`ok — ${result.drafts.length} ward(s) compiled: ${result.drafts.map((d) => d.ward.ward_id).join(", ")}\n`);
        return 0;
      }
      // compile: validate + hash each draft into a content-addressed manifest.
      const manifests = result.drafts.map((d) => compileGovernanceManifest(d));
      const allValid = manifests.every((m) => m.validation.ok);
      const outPath = optionValue(pargs, "--out");
      if (outPath) writeJson(path.resolve(cwd, outPath), manifests.length === 1 ? manifests[0] : manifests);
      if (json) { printJson(out, manifests.length === 1 ? manifests[0] : manifests, true); }
      else {
        out(`compiled ${manifests.length} ward(s) from ${file}\n`);
        for (const m of manifests) {
          out(`  ${m.ward.ward_id} → manifest ${m.hashes.manifest_hash.slice(0, 12)} · ${m.authority_envelope.allowed_actions.length} allow / ${m.authority_envelope.denied_actions.length} deny · validation ${m.validation.ok ? "ok" : "FAILED"}\n`);
          if (!m.validation.ok) for (const e of m.validation.errors) err(`    ! ${e}\n`);
        }
        out(`${outPath ? `manifest → ${outPath}\n` : ""}`);
      }
      return allValid ? 0 : 1;
    }

    if (command === "dual-control") {
      const sub = argv[1];
      const aargs = argv.slice(2);
      const storePath = path.resolve(cwd, optionValue(aargs, "--store") ?? ".tmp/approvals.json");
      const store = new ApprovalStore(storePath);

      if (sub === "list") {
        const items = store.list();
        const pending = items.filter((i) => i.status === "pending").length;
        if (json) { printJson(out, { items, pending }, true); }
        else {
          out(`Dual-control approvals — ${items.length} request(s), ${pending} pending\n`);
          for (const i of items) {
            const approvers = i.votes.filter((v) => v.decision === "approve").length;
            out(`  ${i.status.padEnd(9)} ${i.request_id} ${i.action_type} by ${i.subject} — ${approvers}/${i.required} approvals\n`);
          }
        }
        return pending === 0 ? 0 : 1; // non-zero while approvals are outstanding (ops gate)
      }

      if (sub === "approve" || sub === "reject") {
        const item = store.vote(requiredOption(aargs, "--request-id"), optionValue(aargs, "--by") ?? "operator", sub === "approve" ? "approve" : "reject", optionValue(aargs, "--reason"), optionValue(aargs, "--now"));
        if (json) { printJson(out, item, true); }
        else out(`${sub} recorded on ${item.request_id} by ${optionValue(aargs, "--by") ?? "operator"} → ${item.status}\n`);
        return 0;
      }

      throw new Error("usage: aristotle dual-control <list|approve|reject> [--store <file>] --request-id <id> [--by <approver>] [--reason <text>]");
    }

    if (command === "conflicts") {
      const sub = argv[1];
      const cargs = argv.slice(2);
      const inboxPath = path.resolve(cwd, optionValue(cargs, "--inbox") ?? ".tmp/conflict-inbox.json");
      const store = new ConflictInboxStore(inboxPath);

      if (sub === "ingest") {
        const ward = loadWardManifest(path.resolve(cwd, requiredOption(cargs, "--ward")));
        const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, requiredOption(cargs, "--envelope")));
        const records = JSON.parse(readFileSync(path.resolve(cwd, requiredOption(cargs, "--records")), "utf8")) as EdgeRecord[];
        const report = store.ingest({ records, ward, authorityEnvelope, now: optionValue(cargs, "--now") });
        const summary = store.summary();
        if (json) { printJson(out, { report, summary }, true); }
        else out(`ingested ${report.count} record(s) → inbox ${inboxPath}\n  ${summary.total} total · ${summary.open} open · ${summary.conflicts} conflict(s)\n`);
        return 0;
      }

      if (sub === "list") {
        const items = store.list();
        const summary = store.summary();
        if (json) { printJson(out, { items, summary }, true); }
        else {
          out(`Conflict Inbox — ${summary.total} item(s): ${summary.open} open, ${summary.by_status.reconciled} reconciled\n`);
          for (const i of items) {
            const tag = i.agrees ? "ok      " : "CONFLICT";
            out(`  ${tag} ${i.status.padEnd(10)} ${i.action_id} (${i.action_type}) edge ${i.edge_decision} vs current ${i.current_decision}${i.conflict_kind ? ` [${i.conflict_kind}]` : ""}${i.resolved_by ? ` — ${i.resolution_action} by ${i.resolved_by}` : ""}\n`);
          }
        }
        // Non-zero when items still need operator review (CI/ops gate).
        return summary.open === 0 ? 0 : 1;
      }

      if (sub === "resolve") {
        const action = requiredOption(cargs, "--action") as "accept" | "reject" | "escalate" | "reconcile";
        const item = store.resolve(requiredOption(cargs, "--action-id"), action, optionValue(cargs, "--by") ?? "operator", optionValue(cargs, "--reason"), optionValue(cargs, "--now"));
        if (json) { printJson(out, { item, summary: store.summary() }, true); }
        else out(`resolved ${item.action_id} → ${item.status} (${item.resolution_action} by ${item.resolved_by})\n`);
        return 0;
      }

      throw new Error("usage: aristotle conflicts <ingest|list|resolve> [--inbox <file>] ...");
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

    if (command === "sandbox" && subcommand === "providers") {
      const containerRuntime = detectContainerRuntime();
      const wasmAvailable = detectWasmRuntime();
      const providers = [
        { name: "local-process", builtin: true, available: true, isolation: "process (allowlist/timeout/output-cap/cwd/env)", note: "development provider; not a kernel security boundary" },
        { name: "container", builtin: true, available: Boolean(containerRuntime), isolation: "OS container (namespaces+cgroups, --network=none, read-only rootfs, cap-drop=ALL)", note: containerRuntime ? `runtime detected: ${containerRuntime}; pass --provider container --image <img>` : "needs docker or podman on PATH" },
        { name: "wasm", builtin: true, available: wasmAvailable, isolation: "WASI capability sandbox (no fs/net/env unless granted)", note: wasmAvailable ? "wasmtime detected; pass --provider wasm --cmd module.wasm" : "needs wasmtime on PATH" },
        { name: "e2b", builtin: false, available: false, isolation: "remote micro-VM", note: "wire via examples/sandboxes/e2b-provider.ts" },
        { name: "daytona", builtin: false, available: false, isolation: "remote workspace", note: "wire via examples/sandboxes/daytona-provider.ts" },
        { name: "modal", builtin: false, available: false, isolation: "remote container/job", note: "wire via examples/sandboxes/modal-provider.ts" },
        { name: "riza", builtin: false, available: false, isolation: "hosted code interpreter", note: "wire via examples/sandboxes/riza-provider.ts" }
      ];
      if (json) { printJson(out, { providers }, true); return 0; }
      out("AristotleOS sandbox providers\n\n");
      for (const p of providers) out(`  ${p.builtin ? "*" : " "} ${p.name.padEnd(14)} ${p.available ? "[available]" : "[unavailable]"} ${p.isolation}\n      ${p.note}\n`);
      out("\n  * built-in. eBPF/LSM, gVisor/Kata, seccomp profiles are roadmap (see THREAT_MODEL.md).\n  See docs/sandboxes.md to wire optional remote providers.\n");
      return 0;
    }

    if (command === "sandbox" && subcommand === "run") {
      const ward = loadWardManifest(path.resolve(cwd, requiredOption(rest, "--ward")));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, requiredOption(rest, "--envelope")));
      const action = loadCanonicalAction(path.resolve(cwd, requiredOption(rest, "--action")));
      const binary = requiredOption(rest, "--cmd");
      const args = optionValues(rest, "--arg");
      const allowed = optionValues(rest, "--allow");
      const signer = resolveSigner(rest, cwd, err);
      const policy: SandboxPolicy = {
        allowed_commands: allowed.length ? allowed : [binary],
        timeout_ms: Number(optionValue(rest, "--timeout") ?? "30000"),
        max_output_bytes: Number(optionValue(rest, "--max-output") ?? "1000000"),
        allow_network: rest.includes("--allow-network")
      };
      const providerKind = optionValue(rest, "--provider") ?? "local-process";
      let provider: SandboxProvider;
      if (providerKind === "local-process") {
        provider = new LocalProcessSandboxProvider();
      } else if (providerKind === "container") {
        provider = new ContainerSandboxProvider({
          image: requiredOption(rest, "--image"),
          runtime: optionValue(rest, "--runtime") as "docker" | "podman" | undefined,
          memory: optionValue(rest, "--memory"),
          cpus: optionValue(rest, "--cpus")
        });
      } else if (providerKind === "wasm") {
        provider = new WasmSandboxProvider({ binaryPath: optionValue(rest, "--wasm-binary") });
      } else {
        throw new Error(`unknown --provider: ${providerKind} (expected local-process | container | wasm)`);
      }
      const ledgerPath = optionValue(rest, "--ledger");
      const result = await governSandboxExecution({
        ward, authorityEnvelope, action,
        provider, policy,
        command: { command: binary, args, stdin: optionValue(rest, "--stdin") },
        signer,
        ledgerPath: ledgerPath ? path.resolve(cwd, ledgerPath) : undefined,
        now: optionValue(rest, "--now")
      });

      const receiptOut = optionValue(rest, "--receipt-out");
      if (receiptOut && result.receipt) writeFileSync(path.resolve(cwd, receiptOut), `${JSON.stringify(result.receipt, null, 2)}\n`, "utf8");

      if (json) { printJson(out, result, true); }
      else if (result.decision !== "ALLOW") {
        out(`${result.decision} — not executed (${result.reason_codes.join(", ")})\nGEL record ${result.gel_record.record_id}\n`);
      } else if (result.error) {
        out(`ALLOW but blocked: ${result.error}\n`);
      } else {
        const r = result.receipt!;
        out(`ALLOW — executed in sandbox (${result.evidence!.receipt.provider})\nWarrant ${result.warrant!.warrant_id}\nGEL record ${result.gel_record.record_id}\nReceipt ${r.receipt_id} status=${r.status} exit=${r.exit_code ?? "-"}${r.output_truncated ? " (output truncated)" : ""}\n`);
        if (r.stdout) out(`--- stdout ---\n${r.stdout}\n`);
        if (r.stderr) out(`--- stderr ---\n${r.stderr}\n`);
      }
      if (result.decision !== "ALLOW" || result.error) return 1;
      return typeof result.receipt?.exit_code === "number" ? result.receipt.exit_code : (result.receipt?.status === "ok" ? 0 : 1);
    }

    if (command === "sandbox" && subcommand === "receipt" && rest[0] === "verify") {
      const receipt = JSON.parse(readFileSync(path.resolve(cwd, requiredOption(rest, "--receipt")), "utf8")) as SandboxExecutionReceipt;
      const warrantPath = optionValue(rest, "--warrant");
      const warrant = warrantPath ? JSON.parse(readFileSync(path.resolve(cwd, warrantPath), "utf8")) : undefined;
      const verification = verifySandboxReceipt(receipt, { warrant });
      if (json) { printJson(out, verification, true); }
      else out(verification.ok ? "receipt OK — integrity, signature, and Warrant binding verified\n" : `receipt FAILED:\n${verification.failures.map((f) => `  - ${f}`).join("\n")}\n`);
      return verification.ok ? 0 : 1;
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
      const pfOperators = loadOperators(pfArgs);
      const pfOidc = loadOidc(pfArgs, cwd);
      const authConfigured = !!apiKey || !!pfOperators?.length || !!pfOidc;
      warn("Operator authentication configured", authConfigured, authConfigured ? authSummary(apiKey, pfOperators, pfOidc) : "configure --api-key, --operator role:token, or --oidc-config to require & role-gate /v1");
      const hasAdmin = !!apiKey || (pfOperators?.some((operator) => operator.role === "admin") ?? false);
      warn("Admin role available for operator actions", hasAdmin, hasAdmin ? undefined : "no admin credential: kill-switch/revoke over HTTP will be refused");
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
