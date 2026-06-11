import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
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

const services = [
  "http-gateway",
  "governance-kernel",
  "policy-compiler",
  "evidence-ledger",
  "meta-authority-registry",
  "simulation-engine",
  "authority-router",
  "witness-service",
  "execution-gate",
  "agent-os",
  "console-ui"
];

const args = parseArgs(process.argv.slice(2));
const report = {
  runtime: args.runtime,
  cluster: args.cluster,
  release: args.release,
  namespace: args.namespace,
  tag: args.tag,
  startedAt: new Date().toISOString(),
  checks: []
};

function parseArgs(argv) {
  const config = {
    runtime: "kind",
    cluster: "aristotle-pilot",
    release: "aristotle",
    namespace: "aristotle-governance-os",
    registry: "ghcr.io",
    repositoryPrefix: "aristotle-os",
    tag: "0.1.0-smoke",
    values: [path.join("charts", "aristotle-governance-os", "values-kind-smoke.yaml")],
    gatewayPort: 18080,
    consolePort: 14173,
    skipBuild: false,
    skipLoad: false,
    skipInstall: false,
    skipClusterCreate: false,
    skipVerify: false,
    keepPortForward: false,
    reportPath: "reports/k8s-smoke-report.json"
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--runtime" && next) config.runtime = next, i++;
    else if (arg === "--cluster" && next) config.cluster = next, i++;
    else if (arg === "--release" && next) config.release = next, i++;
    else if (arg === "--namespace" && next) config.namespace = next, i++;
    else if (arg === "--registry" && next) config.registry = next, i++;
    else if (arg === "--repository-prefix" && next) config.repositoryPrefix = next, i++;
    else if (arg === "--tag" && next) config.tag = next, i++;
    else if (arg === "--values" && next) config.values.push(next), i++;
    else if (arg === "--gateway-port" && next) config.gatewayPort = Number(next), i++;
    else if (arg === "--console-port" && next) config.consolePort = Number(next), i++;
    else if (arg === "--report" && next) config.reportPath = next, i++;
    else if (arg === "--skip-build") config.skipBuild = true;
    else if (arg === "--skip-load") config.skipLoad = true;
    else if (arg === "--skip-install") config.skipInstall = true;
    else if (arg === "--skip-cluster-create") config.skipClusterCreate = true;
    else if (arg === "--skip-verify") config.skipVerify = true;
    else if (arg === "--keep-port-forward") config.keepPortForward = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!["kind", "minikube"].includes(config.runtime)) throw new Error("--runtime must be kind or minikube");
  if (!Number.isInteger(config.gatewayPort) || !Number.isInteger(config.consolePort)) throw new Error("local ports must be integers");
  if (config.tag === "latest") throw new Error("smoke installs must use an immutable image tag, not latest");
  return config;
}

function printHelp() {
  console.log(`Usage: npm run pilot:smoke -- [options]

Creates or reuses a local kind/minikube cluster, builds immutable AristotleOS images,
loads them into the cluster, installs the Helm chart, and proves a governed execution:
DEFER before execution -> operator approval -> one-time warrant -> GEL commit -> FAIL_CLOSED.

Options:
  --runtime <kind|minikube>       Local Kubernetes runtime (default: kind)
  --cluster <name>                Cluster/profile name (default: aristotle-pilot)
  --release <name>                Helm release name (default: aristotle)
  --namespace <name>              Kubernetes namespace (default: aristotle-governance-os)
  --registry <host>               Image registry prefix (default: ghcr.io)
  --repository-prefix <prefix>    Image repository prefix/org (default: aristotle-os)
  --tag <tag>                     Immutable image tag (default: 0.1.0-smoke)
  --values <file>                 Additional Helm values file; can be repeated
  --gateway-port <port>           Local gateway port-forward port (default: 18080)
  --console-port <port>           Local console port-forward port (default: 14173)
  --report <file>                 JSON report path (default: reports/k8s-smoke-report.json)
  --skip-build                    Reuse already-built local images
  --skip-load                     Do not load images into kind/minikube
  --skip-install                  Do not run Helm install/upgrade
  --skip-cluster-create           Use the current kubectl context instead of creating/selecting a local cluster
  --skip-verify                   Skip local enterprise verification inside pilot installer
  --keep-port-forward             Leave port-forwards running after verification`);
}

function image(name) {
  return `${args.registry}/${args.repositoryPrefix}/${name}:${args.tag}`;
}

function run(command, commandArgs, options = {}) {
  const display = [command, ...commandArgs].join(" ");
  console.log(`[k8s-smoke] ${display}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: options.capture ? "pipe" : "inherit",
    env: { ...process.env, ...(options.env ?? {}) }
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(`${display} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return result.stdout?.toString() ?? "";
}

function requireTool(name) {
  const result = spawnSync(name, name === "kubectl" ? ["version", "--client=true"] : ["version"], {
    cwd: root,
    stdio: "pipe"
  });
  if (result.status !== 0) throw new Error(`${name} is required for Kubernetes smoke install`);
  record(`tool:${name}`, true);
}

function record(name, ok, detail = "") {
  report.checks.push({ name, ok, detail, at: new Date().toISOString() });
  console.log(`[k8s-smoke] ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

function ensureCluster() {
  if (args.skipClusterCreate) {
    const context = run("kubectl", ["config", "current-context"], { capture: true }).trim();
    if (!context) throw new Error("kubectl has no current context");
    record("cluster:current-context", true, context);
    verifyClusterApi();
    return;
  }

  if (args.runtime === "kind") {
    requireTool("kind");
    const clusters = run("kind", ["get", "clusters"], { capture: true });
    if (!clusters.split(/\r?\n/).includes(args.cluster)) {
      run("kind", ["create", "cluster", "--name", args.cluster]);
    }
    run("kubectl", ["config", "use-context", `kind-${args.cluster}`]);
    record("cluster:kind", true, args.cluster);
    verifyClusterApi();
    return;
  }

  requireTool("minikube");
  const status = spawnSync("minikube", ["status", "-p", args.cluster], {
    cwd: root,
    stdio: "pipe"
  });
  if (status.status !== 0) {
    run("minikube", ["start", "-p", args.cluster, "--driver=docker"]);
  }
  run("kubectl", ["config", "use-context", args.cluster]);
  record("cluster:minikube", true, args.cluster);
  verifyClusterApi();
}

function verifyClusterApi() {
  run("kubectl", ["get", "namespace", "default"], { capture: true });
  record("cluster:api", true, "Kubernetes API reachable");
}

function buildImages() {
  if (args.skipBuild) {
    record("images:build", true, "skipped by operator");
    return;
  }
  run("node", [
    path.join("scripts", "build-pilot-images.mjs"),
    "--registry", args.registry,
    "--repository-prefix", args.repositoryPrefix,
    "--tag", args.tag
  ]);
  record("images:build", true, args.tag);
}

function loadImages() {
  if (args.skipLoad) {
    record("images:load", true, "skipped by operator");
    return;
  }
  for (const service of services) {
    if (args.runtime === "kind") run("kind", ["load", "docker-image", image(service), "--name", args.cluster]);
    else run("minikube", ["-p", args.cluster, "image", "load", image(service)]);
  }
  record("images:load", true, `${services.length} images`);
}

function installChart() {
  if (args.skipInstall) {
    record("helm:install", true, "skipped by operator");
    return;
  }
  const env = {
    OPERATOR_API_KEY: process.env.OPERATOR_API_KEY || "aristotle-smoke-operator-key",
    OPERATOR_SESSION_SECRET: process.env.OPERATOR_SESSION_SECRET || "aristotle-smoke-session-secret-change-me",
    EVIDENCE_LEDGER_SIGNING_SECRET: process.env.EVIDENCE_LEDGER_SIGNING_SECRET || "aristotle-smoke-ledger-signing-secret",
    GOVERNANCE_CHAIN_SIGNING_SECRET: process.env.GOVERNANCE_CHAIN_SIGNING_SECRET || "aristotle-smoke-chain-signing-secret"
  };
  const installArgs = [
    path.join("scripts", "pilot-install.mjs"),
    "--release", args.release,
    "--namespace", args.namespace,
    "--registry", args.registry,
    "--repository-prefix", args.repositoryPrefix,
    "--tag", args.tag
  ];
  for (const values of args.values) installArgs.push("--values", values);
  if (args.skipVerify) installArgs.push("--skip-verify");
  run("node", installArgs, { env });
  record("helm:install", true, `${args.release}/${args.namespace}`);
}

function spawnPortForward(name, service, localPort, remotePort) {
  const logsDir = path.join(root, "logs");
  mkdirSync(logsDir, { recursive: true });
  const out = openSync(path.join(logsDir, `${name}.out`), "a");
  const err = openSync(path.join(logsDir, `${name}.err`), "a");
  console.log(`[k8s-smoke] kubectl -n ${args.namespace} port-forward svc/${service} ${localPort}:${remotePort}`);
  const child = spawn("kubectl", ["-n", args.namespace, "port-forward", `svc/${service}`, `${localPort}:${remotePort}`], {
    cwd: root,
    stdio: ["ignore", out, err],
    windowsHide: true
  });
  return child;
}

async function waitForJson(url, name, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          record(name, true, `${response.status}`);
          return json;
        } catch {
          record(name, true, `${response.status}`);
          return text;
        }
      }
      lastError = `${response.status} ${await response.text()}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`${name} did not become ready: ${lastError}`);
}

async function requestJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const json = await response.json();
  if (!response.ok && response.status !== 202 && response.status !== 409) {
    throw new Error(`${url} returned ${response.status}: ${JSON.stringify(json)}`);
  }
  return { status: response.status, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function proveGovernanceBoundary() {
  const gateway = `http://127.0.0.1:${args.gatewayPort}`;
  const consoleUrl = `http://127.0.0.1:${args.consolePort}`;
  await waitForJson(`${gateway}/ready`, "gateway:ready");
  await waitForJson(`${consoleUrl}/console-health`, "console:health");
  const status = await waitForJson(`${gateway}/v1/status`, "trial:status");
  assert(status?.activePolicyHash, "status did not expose active policy hash");

  const defer = await requestJson(`${gateway}/v1/actions/evaluate`, { scenarioId: "payments-refund-8000" });
  assert(defer.json.evaluation?.decision === "DEFER", `expected DEFER, got ${defer.json.evaluation?.decision}`);
  assert(!defer.json.evaluation?.warrant, "deferred action received a warrant before approval");
  assert(defer.json.evaluation?.deferToken, "deferred action missing defer token");
  record("governance:defer-before-execution", true, defer.json.evaluation.decisionCode);

  const approval = await requestJson(`${gateway}/v1/approvals/${encodeURIComponent(defer.json.evaluation.deferToken)}/approve`, {});
  assert(approval.json.evaluation?.decision === "PERMIT", `expected PERMIT after approval, got ${approval.json.evaluation?.decision}`);
  assert(approval.json.evaluation?.warrant?.singleUse === true, "approved action did not receive a single-use warrant");
  assert(approval.json.evaluation?.gelRecord?.decision === "PERMIT", "approved action did not commit a PERMIT GEL record");
  record("governance:warrant-after-approval", true, approval.json.evaluation.warrant.id);

  const audit = await waitForJson(`${gateway}/v1/audit/tail`, "gel:tail");
  assert(Array.isArray(audit.items) && audit.items.length >= 2, "GEL tail did not include defer and approval records");
  assert(audit.items.some((item) => item.decision === "PERMIT"), "GEL tail missing PERMIT record");
  record("governance:gel-commit", true, `${audit.items.length} records`);

  const policy = readFileSync(path.join(root, "examples", "payments-governance", "governance.aristotle"), "utf8")
    .replace('require_authority = "refund-authority"', 'require_authority = "missing-authority"');
  const failClosed = await requestJson(`${gateway}/v1/actions/evaluate`, {
    scenarioId: "payments-refund-8000",
    policy
  });
  assert(failClosed.json.evaluation?.decision === "FAIL_CLOSED", `expected FAIL_CLOSED, got ${failClosed.json.evaluation?.decision}`);
  assert(failClosed.json.evaluation?.decisionCode === "MISSING_AUTHORITY_BINDING", "fail-closed reason did not identify missing authority binding");
  record("governance:fail-closed", true, failClosed.json.evaluation.decisionCode);

  await waitForJson(`${consoleUrl}/public`, "console:public");
  await waitForJson(`${consoleUrl}/try`, "console:playground");
}

function writeReport(status) {
  const out = path.resolve(root, args.reportPath);
  mkdirSync(path.dirname(out), { recursive: true });
  report.completedAt = new Date().toISOString();
  report.status = status;
  report.urls = {
    gateway: `http://127.0.0.1:${args.gatewayPort}`,
    publicTrial: `http://127.0.0.1:${args.consolePort}/public`,
    playground: `http://127.0.0.1:${args.consolePort}/try`,
    operatorConsole: `http://127.0.0.1:${args.consolePort}/`
  };
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[k8s-smoke] report written: ${out}`);
}

async function main() {
  if (!existsSync(chartPath)) throw new Error(`missing Helm chart: ${chartPath}`);
  if (!args.skipBuild || !args.skipLoad) requireTool("docker");
  requireTool("helm");
  requireTool("kubectl");
  ensureCluster();
  buildImages();
  loadImages();
  installChart();

  const gatewayForward = spawnPortForward("k8s-smoke-gateway", "http-gateway", args.gatewayPort, 8080);
  const consoleForward = spawnPortForward("k8s-smoke-console", "console-ui", args.consolePort, 4173);
  try {
    await proveGovernanceBoundary();
    record("smoke:complete", true, "cluster admitted governed execution only after warrant issuance");
    writeReport("passed");
    if (args.keepPortForward) {
      gatewayForward.unref();
      consoleForward.unref();
      console.log(`[k8s-smoke] gateway left running at http://127.0.0.1:${args.gatewayPort}`);
      console.log(`[k8s-smoke] console left running at http://127.0.0.1:${args.consolePort}`);
    } else {
      gatewayForward.kill();
      consoleForward.kill();
    }
  } catch (error) {
    gatewayForward.kill();
    consoleForward.kill();
    throw error;
  }
}

main().catch((error) => {
  record("smoke:complete", false, error instanceof Error ? error.message : String(error));
  writeReport("failed");
  console.error("[k8s-smoke] install verification failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
