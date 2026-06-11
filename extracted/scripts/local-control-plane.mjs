import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(root, ".aristotle-local-stack.json");
const logDir = path.join(root, "logs", "local-control-plane");
const dataDir = path.join(root, "data");

const services = [
  { name: "meta-authority-registry", port: 7004, entry: "services/meta-authority-registry/src/index.js", health: "/health" },
  { name: "policy-compiler", port: 7002, entry: "services/policy-compiler/src/index.js", health: "/health" },
  { name: "evidence-ledger", port: 7003, entry: "services/evidence-ledger/src/index.js", health: "/health" },
  { name: "authority-router", port: 7006, entry: "services/authority-router/src/index.js", health: "/health" },
  { name: "witness-service", port: 7007, entry: "services/witness-service/src/index.js", health: "/health" },
  { name: "execution-gate", port: 7008, entry: "services/execution-gate/src/index.js", health: "/health" },
  { name: "governance-kernel", port: 7001, entry: "services/governance-kernel/src/index.js", health: "/health" },
  { name: "simulation-engine", port: 7005, entry: "services/simulation-engine/src/index.js", health: "/health" },
  { name: "agent-os", port: 7009, entry: "services/agent-os/src/index.js", health: "/health" },
  { name: "http-gateway", port: 8080, entry: "adapters/http-gateway/src/index.js", health: "/ready" },
  { name: "console-ui", port: Number(process.env.PORT_CONSOLE_UI ?? 4173), entry: "scripts/serve-console-dist.mjs", health: "/" },
];

const localEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  SERVICE_DISCOVERY_MODE: "local",
  GOVERNANCE_CHAIN_V2: process.env.GOVERNANCE_CHAIN_V2 ?? "true",
  GOVERNANCE_CHAIN_MODE: process.env.GOVERNANCE_CHAIN_MODE ?? "shadow",
  GOVERNANCE_CHAIN_SIGNING_SECRET: process.env.GOVERNANCE_CHAIN_SIGNING_SECRET ?? "local-dev-governance-chain-secret",
  GOVERNANCE_CHAIN_STATE_PATH: process.env.GOVERNANCE_CHAIN_STATE_PATH ?? path.join(dataDir, "governance-chain.local.json"),
  EVIDENCE_LEDGER_STATE_PATH: process.env.EVIDENCE_LEDGER_STATE_PATH ?? path.join(dataDir, "evidence-ledger.local.json"),
  AGENT_OS_STATE_PATH: process.env.AGENT_OS_STATE_PATH ?? path.join(dataDir, "agent-os.local.json"),
  HOST_GOVERNANCE_KERNEL: "127.0.0.1",
  HOST_POLICY_COMPILER: "127.0.0.1",
  HOST_EVIDENCE_LEDGER: "127.0.0.1",
  HOST_META_AUTHORITY_REGISTRY: "127.0.0.1",
  HOST_SIMULATION_ENGINE: "127.0.0.1",
  HOST_AUTHORITY_ROUTER: "127.0.0.1",
  HOST_WITNESS_SERVICE: "127.0.0.1",
  HOST_EXECUTION_GATE: "127.0.0.1",
  HOST_AGENT_OS: "127.0.0.1",
};

const command = process.argv[2] ?? "status";
const args = new Set(process.argv.slice(3));

if (command === "up") {
  await up();
} else if (command === "status") {
  await status();
} else if (command === "down") {
  await down();
} else {
  console.error("usage: npm run local:up|local:status|local:down [--no-build]");
  process.exitCode = 1;
}

async function up() {
  await mkdir(logDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  if (!args.has("--no-build")) {
    runBuild();
  }

  const launched = [];
  for (const service of services) {
    const existing = await health(service);
    if (existing.ok) {
      launched.push({ ...service, pid: null, reused: true, url: url(service) });
      console.log(`[local] ${service.name} already healthy at ${url(service)}`);
      continue;
    }

    const pid = start(service);
    launched.push({ ...service, pid, reused: false, url: url(service) });
    await waitForHealth(service, 45_000);
    console.log(`[local] ${service.name} healthy at ${url(service)} (pid ${pid})`);
  }

  await writeFile(
    statePath,
    `${JSON.stringify({ startedAt: new Date().toISOString(), root, services: launched }, null, 2)}\n`,
    "utf8",
  );
  console.log("[local] AristotleOS local control plane is ready");
  console.log(`[local] dashboard: http://localhost:${services.find((s) => s.name === "console-ui").port}/`);
  console.log("[local] gateway:   http://localhost:8080/health");
}

async function status() {
  const state = await readState();
  const rows = [];
  for (const service of services) {
    const recorded = state?.services?.find((item) => item.name === service.name);
    const probe = await health(service);
    rows.push({
      service: service.name,
      url: url(service),
      pid: recorded?.pid ?? "",
      reused: recorded?.reused === true ? "yes" : "no",
      health: probe.ok ? "ok" : `down${probe.status ? ` (${probe.status})` : ""}`,
    });
  }
  console.table(rows);
}

async function down() {
  const state = await readState();
  if (!state) {
    console.log("[local] no local stack state file found");
    return;
  }
  for (const service of [...state.services].reverse()) {
    if (service.reused || !service.pid) {
      console.log(`[local] leaving ${service.name} alone (not started by this supervisor)`);
      continue;
    }
    stopPid(service.pid, service.name);
  }
  await rm(statePath, { force: true });
  console.log("[local] AristotleOS local control plane stopped");
}

function runBuild() {
  console.log("[local] building workspace before boot");
  // Node 24 on Windows fails to spawn npm.cmd via spawnSync without `shell: true`.
  // Using shell:true also resolves the binary through %PATHEXT% naturally.
  const isWin = process.platform === "win32";
  const npm = isWin ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", "build"], {
    cwd: root,
    env: localEnv,
    stdio: "inherit",
    shell: isWin
  });
  if (result.status !== 0) {
    throw new Error(`workspace build failed with exit code ${result.status}`);
  }
}

function start(service) {
  // Node 24 hardened stdio validation: WriteStream with null `fd` is rejected.
  // Open real file descriptors with openSync and pass them directly to spawn.
  const outPath = path.join(logDir, `${service.name}.out`);
  const errPath = path.join(logDir, `${service.name}.err`);
  const outFd = openSync(outPath, "a");
  const errFd = openSync(errPath, "a");
  // Header line via a one-shot WriteStream around the same path; flush quickly.
  const header = createWriteStream(outPath, { flags: "a" });
  header.write(`\n[${new Date().toISOString()}] starting ${service.name}\n`);
  header.end();
  const child = spawn(process.execPath, [path.join(root, service.entry)], {
    cwd: root,
    env: localEnv,
    detached: true,
    stdio: ["ignore", outFd, errFd],
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function waitForHealth(service, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const probe = await health(service);
    if (probe.ok) return;
    last = probe.error ?? String(probe.status ?? "");
    await sleep(750);
  }
  throw new Error(`${service.name} did not become healthy at ${url(service)}. Last probe: ${last || "no response"}`);
}

async function health(service) {
  try {
    const response = await fetch(`${url(service)}${service.health}`);
    if (!response.ok) return { ok: false, status: response.status };
    if (service.name === "console-ui") {
      const text = await response.text();
      return { ok: text.includes("<!doctype html") || text.includes("<!DOCTYPE html"), status: response.status };
    }
    const json = await response.json().catch(() => null);
    return { ok: json?.ok === true, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function url(service) {
  return `http://127.0.0.1:${service.port}`;
}

async function readState() {
  if (!existsSync(statePath)) return null;
  return JSON.parse(await readFile(statePath, "utf8"));
}

function stopPid(pid, name) {
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    console.log(`[local] ${result.status === 0 ? "stopped" : "could not stop"} ${name} (pid ${pid})`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[local] stopped ${name} (pid ${pid})`);
  } catch {
    console.log(`[local] could not stop ${name} (pid ${pid})`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
