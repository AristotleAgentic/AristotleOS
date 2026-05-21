import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

const services = [
  ["http-gateway", "adapters/http-gateway"],
  ["governance-kernel", "services/governance-kernel"],
  ["policy-compiler", "services/policy-compiler"],
  ["evidence-ledger", "services/evidence-ledger"],
  ["meta-authority-registry", "services/meta-authority-registry"],
  ["simulation-engine", "services/simulation-engine"],
  ["authority-router", "services/authority-router"],
  ["witness-service", "services/witness-service"],
  ["execution-gate", "services/execution-gate"],
  ["agent-os", "services/agent-os"]
];

function parseArgs(argv) {
  const config = {
    registry: "ghcr.io",
    repositoryPrefix: "aristotle-os",
    tag: "0.1.0",
    push: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--registry" && next) config.registry = next, i++;
    else if (arg === "--repository-prefix" && next) config.repositoryPrefix = next, i++;
    else if (arg === "--tag" && next) config.tag = next, i++;
    else if (arg === "--push") config.push = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run pilot:images -- [--registry ghcr.io] [--repository-prefix aristotle-os] [--tag 0.1.0-pilot.1] [--push]");
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (config.tag === "latest") throw new Error("pilot images must use an immutable tag, not latest");
  return config;
}

function run(command, commandArgs) {
  const display = [command, ...commandArgs].join(" ");
  console.log(`[images] ${display}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) throw new Error(`${display} failed`);
}

function image(name) {
  return `${args.registry}/${args.repositoryPrefix}/${name}:${args.tag}`;
}

async function main() {
  for (const [name, servicePath] of services) {
    run("docker", [
      "build",
      "-f",
      "manifests/docker/service.Dockerfile",
      "--build-arg",
      `SERVICE_PATH=${servicePath}`,
      "-t",
      image(name),
      "."
    ]);
    if (args.push) run("docker", ["push", image(name)]);
  }

  run("docker", ["build", "-f", "manifests/docker/console-ui.Dockerfile", "-t", image("console-ui"), "."]);
  if (args.push) run("docker", ["push", image("console-ui")]);

  console.log(`[images] built AristotleOS pilot image set with tag ${args.tag}`);
}

main().catch((error) => {
  console.error("[images] pilot image build failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
