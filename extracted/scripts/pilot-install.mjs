import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chartPath = path.join(root, "charts", "aristotle-governance-os");
const localK8sToolsBin = path.resolve(root, "..", "..", "..", "aristotle-k8s-tools", "bin");
if (existsSync(localK8sToolsBin)) {
  process.env.PATH = `${localK8sToolsBin}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.MINIKUBE_HOME ??= path.resolve(root, "..", "..", "..", "aristotle-k8s-tools", "minikube-home");
  process.env.DOCKER_CONFIG ??= path.resolve(root, "..", "..", "..", "aristotle-k8s-tools", "docker-config");
}
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const config = {
    release: "aristotle",
    namespace: "aristotle-governance-os",
    registry: "ghcr.io",
    repositoryPrefix: "aristotle-os",
    tag: "0.1.0",
    existingSecret: "aristotle-runtime-secrets",
    dryRun: false,
    skipVerify: false,
    skipSecretApply: false,
    values: []
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--release" && next) config.release = next, i++;
    else if (arg === "--namespace" && next) config.namespace = next, i++;
    else if (arg === "--registry" && next) config.registry = next, i++;
    else if (arg === "--repository-prefix" && next) config.repositoryPrefix = next, i++;
    else if (arg === "--tag" && next) config.tag = next, i++;
    else if (arg === "--existing-secret" && next) config.existingSecret = next, i++;
    else if (arg === "--values" && next) config.values.push(next), i++;
    else if (arg === "--dry-run") config.dryRun = true;
    else if (arg === "--skip-verify") config.skipVerify = true;
    else if (arg === "--skip-secret-apply") config.skipSecretApply = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return config;
}

function printHelp() {
  console.log(`Usage: npm run pilot:install -- [options]

Options:
  --release <name>              Helm release name (default: aristotle)
  --namespace <name>            Kubernetes namespace (default: aristotle-governance-os)
  --registry <host>             Image registry (default: ghcr.io)
  --repository-prefix <prefix>  Image repository prefix/org (default: aristotle-os)
  --tag <tag>                   Immutable image tag for every AristotleOS image (default: 0.1.0)
  --existing-secret <name>      Secret consumed by runtime pods (default: aristotle-runtime-secrets)
  --values <file>               Additional Helm values file; can be repeated
  --dry-run                     Render/validate the install command without changing the cluster
  --skip-verify                 Skip local enterprise verification before install
  --skip-secret-apply           Do not create/update the runtime Secret from env vars

Required env vars unless --skip-secret-apply is set:
  OPERATOR_API_KEY
  OPERATOR_SESSION_SECRET
  EVIDENCE_LEDGER_SIGNING_SECRET
  GOVERNANCE_CHAIN_SIGNING_SECRET`);
}

function run(command, commandArgs, options = {}) {
  const display = [command, ...commandArgs].join(" ");
  console.log(`[pilot] ${display}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: options.capture ? "pipe" : "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(`${display} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return result.stdout?.toString() ?? "";
}

function requireTool(name) {
  const versionArgs = name === "kubectl" ? ["version", "--client=true"] : ["version", "--short"];
  const result = spawnSync(name, versionArgs, {
    cwd: root,
    stdio: "pipe",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error(`${name} is required for pilot install. Install ${name} or run with --dry-run to render the command only.`);
  }
}

function requireSecretEnv() {
  const missing = [
    "OPERATOR_API_KEY",
    "OPERATOR_SESSION_SECRET",
    "EVIDENCE_LEDGER_SIGNING_SECRET",
    "GOVERNANCE_CHAIN_SIGNING_SECRET"
  ].filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`missing required secret env vars: ${missing.join(", ")}. Set them or pass --skip-secret-apply with an existing Secret.`);
  }
}

function writeSecretManifest() {
  const outputDir = path.join(root, "reports");
  mkdirSync(outputDir, { recursive: true });
  const secretPath = path.join(outputDir, "pilot-runtime-secret.redacted.yaml");
  const manifest = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: args.existingSecret,
      namespace: args.namespace
    },
    type: "Opaque",
    stringData: {
      OPERATOR_API_KEY: process.env.OPERATOR_API_KEY,
      OPERATOR_SESSION_SECRET: process.env.OPERATOR_SESSION_SECRET,
      EVIDENCE_LEDGER_SIGNING_SECRET: process.env.EVIDENCE_LEDGER_SIGNING_SECRET,
      GOVERNANCE_CHAIN_SIGNING_SECRET: process.env.GOVERNANCE_CHAIN_SIGNING_SECRET
    }
  };
  writeFileSync(secretPath, JSON.stringify({ ...manifest, stringData: "<redacted by pilot installer>" }, null, 2), "utf8");
  return manifest;
}

function applySecret() {
  if (args.skipSecretApply) return;
  requireSecretEnv();
  const manifest = writeSecretManifest();
  if (args.dryRun) {
    console.log(`[pilot] secret ${args.existingSecret} would be applied in namespace ${args.namespace}`);
    return;
  }
  const namespaceManifest = {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: args.namespace,
      labels: {
        "app.kubernetes.io/name": "aristotle-governance-os",
        "app.kubernetes.io/instance": args.release,
        "app.kubernetes.io/managed-by": "Helm",
        "aristotle.io/doctrine": "execution-boundary-governance",
        "pod-security.kubernetes.io/enforce": "restricted",
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted"
      },
      annotations: {
        "meta.helm.sh/release-name": args.release,
        "meta.helm.sh/release-namespace": args.namespace
      }
    }
  };
  const namespaceApply = spawnSync("kubectl", ["apply", "-f", "-"], {
    cwd: root,
    input: `${JSON.stringify(namespaceManifest)}\n`,
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32"
  });
  if (namespaceApply.status !== 0) throw new Error("kubectl apply namespace failed");
  const apply = spawnSync("kubectl", ["apply", "-f", "-"], {
    cwd: root,
    input: `${JSON.stringify(manifest)}\n`,
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32"
  });
  if (apply.status !== 0) throw new Error("kubectl apply secret failed");
}

function helmArgs() {
  const out = [
    "upgrade",
    "--install",
    args.release,
    chartPath,
    "--namespace",
    args.namespace,
    "--create-namespace",
    "--set",
    `global.namespace.name=${args.namespace}`,
    "--set",
    `global.image.registry=${args.registry}`,
    "--set",
    `global.image.repositoryPrefix=${args.repositoryPrefix}`,
    "--set",
    `global.image.tag=${args.tag}`,
    "--set",
    `secrets.existingSecret=${args.existingSecret}`,
    "--wait",
    "--timeout",
    "10m"
  ];
  for (const values of args.values) out.push("--values", values);
  if (args.dryRun) out.push("--dry-run");
  return out;
}

async function main() {
  if (!existsSync(chartPath)) throw new Error(`missing Helm chart: ${chartPath}`);
  if (!args.skipVerify) {
    run("npm.cmd", ["run", "enterprise:contracts"]);
    run("npm.cmd", ["run", "enterprise:ui-safety"]);
    run("npm.cmd", ["run", "enterprise:release-manifest", "--", "--out", "reports/release-manifest.json"]);
  }
  requireTool("helm");
  if (!args.dryRun) requireTool("kubectl");
  applySecret();
  run("helm", helmArgs());
  console.log("[pilot] install path completed");
  console.log(`[pilot] gateway: kubectl -n ${args.namespace} port-forward svc/http-gateway 8080:8080`);
  console.log(`[pilot] console: kubectl -n ${args.namespace} port-forward svc/console-ui 4173:4173`);
  console.log("[pilot] public trial: http://127.0.0.1:4173/public");
  console.log("[pilot] playground: http://127.0.0.1:4173/try");
  console.log("[pilot] operator workflow: create governed mission -> advance/admit execution -> export GEL evidence from Pilot Workflow");
}

main().catch((error) => {
  console.error("[pilot] install failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
