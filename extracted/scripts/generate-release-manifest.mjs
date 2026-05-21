import { createHash, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(root, args.out);
const markdownPath = outputPath.replace(/\.json$/i, ".md");
const DOCTRINE = "Governance must bind at the execution boundary before irreversible state mutation or external action occurs.";
const releaseSecret = process.env.RELEASE_MANIFEST_SIGNING_SECRET?.trim();

const excludeDirs = new Set(["node_modules", "dist", "coverage", "logs", "reports", "backups", "secrets", "data", ".git"]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yaml", ".yml", ".tpl", ".Dockerfile", ".txt"]);
const alwaysInclude = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "docker-compose.yml", ".env.example", ".env.production.example"]);

function parseArgs(argv) {
  const config = { out: "reports/release-manifest.json", requireSignature: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--out" && next) {
      config.out = next;
      i++;
    } else if (arg === "--require-signature") {
      config.requireSignature = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run enterprise:release-manifest -- [--out reports/release-manifest.json] [--require-signature]");
      process.exit(0);
    } else if (arg === "--") {
      continue;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return config;
}

function canonicalize(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function listFiles(dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && !alwaysInclude.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      files.push(...await listFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (alwaysInclude.has(rel) || sourceExtensions.has(path.extname(entry.name)) || entry.name.endsWith(".Dockerfile")) {
      files.push(rel);
    }
  }
  return files.sort();
}

async function fileInventory() {
  const files = await listFiles();
  const out = [];
  for (const rel of files) {
    const full = path.join(root, rel);
    const info = await stat(full);
    out.push({ path: rel, bytes: info.size, sha256: await hashFile(full) });
  }
  return out;
}

async function dependencyInventory(rootPackage, lockfile) {
  const packages = lockfile.packages ?? {};
  const dependencies = new Map();
  const workspaces = await workspaceInventory(rootPackage);

  for (const [location, descriptor] of Object.entries(packages)) {
    if (!descriptor || typeof descriptor !== "object") continue;
    if (!location.startsWith("node_modules/") || descriptor.link) continue;
    const name = packageNameFromNodeModulesPath(location);
    if (!name || name.startsWith("@aristotle/")) continue;
    dependencies.set(`${name}@${descriptor.version ?? ""}`, {
      name,
      version: descriptor.version ?? "",
      resolved: descriptor.resolved ?? "",
      integrity: descriptor.integrity ?? "",
      license: descriptor.license ?? ""
    });
  }

  return {
    workspaces,
    externalDependencies: [...dependencies.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
  };
}

async function workspaceInventory(rootPackage) {
  const workspacePaths = new Set(["."]);
  for (const pattern of rootPackage.workspaces ?? []) {
    if (!pattern.endsWith("/*")) continue;
    const base = pattern.slice(0, -2);
    const fullBase = path.join(root, base);
    if (!existsSync(fullBase)) continue;
    for (const entry of await readdir(fullBase, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(path.join(fullBase, entry.name, "package.json"))) {
        workspacePaths.add(`${base}/${entry.name}`);
      }
    }
  }

  const workspaces = [];
  for (const workspacePath of workspacePaths) {
    const pkg = await readJson(path.join(workspacePath, "package.json").replace(/\\/g, "/"));
    workspaces.push({
      path: workspacePath,
      name: pkg.name,
      version: pkg.version ?? "",
      dependencies: Object.keys(pkg.dependencies ?? {}).sort(),
      devDependencies: Object.keys(pkg.devDependencies ?? {}).sort()
    });
  }
  return workspaces.sort((a, b) => a.name.localeCompare(b.name));
}

function packageNameFromNodeModulesPath(location) {
  const parts = location.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index < 0 || index + 1 >= parts.length) return "";
  const first = parts[index + 1];
  if (first?.startsWith("@") && index + 2 < parts.length) return `${first}/${parts[index + 2]}`;
  return first ?? "";
}

function deploymentInventory(files) {
  const wanted = [
    "docker-compose.yml",
    "manifests/docker/service.Dockerfile",
    "manifests/docker/console-ui.Dockerfile",
    "manifests/k8s/namespace.yaml",
    "manifests/k8s/control-plane.yaml",
    "manifests/k8s/production-secrets.example.yaml",
    "manifests/k8s/network-policy.yaml",
    "manifests/k8s/observability.yaml",
    "manifests/k8s/gateway-deployment.yaml",
    "charts/aristotle-governance-os/Chart.yaml",
    "charts/aristotle-governance-os/values.yaml",
    "charts/aristotle-governance-os/values-spiffe.example.yaml"
  ];
  return wanted.map((file) => files.find((item) => item.path === file)).filter(Boolean);
}

function buildManifest({ rootPackage, lockfile, files, deps }) {
  const manifest = {
    schema: "aristotle.release-manifest.v1",
    generatedAt: new Date().toISOString(),
    product: {
      name: rootPackage.name,
      version: rootPackage.version,
      doctrine: DOCTRINE,
      classification: "runtime execution governance operating system"
    },
    governanceContract: {
      executionBoundary: "Commit Gate",
      authorityChain: ["Meta Authority Envelope", "Ward", "Authority Envelope", "Warrant", "Commit Gate", "GEL Record"],
      failClosedRequired: true,
      warrantSingleUseRequired: true,
      evidenceLedgerHashChainedRequired: true,
      readinessEndpoint: "/ready",
      metricsEndpoint: "/metrics"
    },
    workspace: deps.workspaces,
    dependencies: {
      externalCount: deps.externalDependencies.length,
      external: deps.externalDependencies
    },
    artifacts: {
      fileCount: files.length,
      sourceTreeHash: sha256(canonicalize(files.map((file) => ({ path: file.path, sha256: file.sha256 })))),
      files,
      deployment: deploymentInventory(files)
    },
    lockfiles: {
      packageLockSha256: files.find((file) => file.path === "package-lock.json")?.sha256 ?? "",
      pnpmLockSha256: files.find((file) => file.path === "pnpm-lock.yaml")?.sha256 ?? ""
    }
  };
  const manifestHash = sha256(canonicalize(manifest));
  return {
    ...manifest,
    manifestHash,
    signature: signManifest(manifestHash)
  };
}

function signManifest(manifestHash) {
  if (!releaseSecret) {
    if (args.requireSignature) throw new Error("RELEASE_MANIFEST_SIGNING_SECRET is required when --require-signature is set");
    return { algorithm: "none", keyId: "", value: "", signedAt: "" };
  }
  const keyId = process.env.RELEASE_MANIFEST_SIGNING_KEY_ID?.trim() || "release-manifest-hmac";
  return {
    algorithm: "hmac-sha256",
    keyId,
    value: createHmac("sha256", releaseSecret).update(manifestHash).digest("hex"),
    signedAt: new Date().toISOString()
  };
}

function renderMarkdown(manifest) {
  const signatureState = manifest.signature.algorithm === "none" ? "unsigned" : `${manifest.signature.algorithm} (${manifest.signature.keyId})`;
  const deployments = manifest.artifacts.deployment.map((item) => `- \`${item.path}\` ${item.sha256}`).join("\n");
  const workspaces = manifest.workspace.map((item) => `- \`${item.name}\` at \`${item.path}\``).join("\n");
  return `# AristotleOS Release Manifest

Generated: ${manifest.generatedAt}

Product: \`${manifest.product.name}\` ${manifest.product.version}

Doctrine: ${manifest.product.doctrine}

Manifest hash: \`${manifest.manifestHash}\`

Signature: ${signatureState}

## Governance Contract

- Execution boundary: ${manifest.governanceContract.executionBoundary}
- Authority chain: ${manifest.governanceContract.authorityChain.join(" -> ")}
- Fail closed required: ${manifest.governanceContract.failClosedRequired}
- Single-use warrants required: ${manifest.governanceContract.warrantSingleUseRequired}
- Hash-chained GEL required: ${manifest.governanceContract.evidenceLedgerHashChainedRequired}
- Readiness endpoint: \`${manifest.governanceContract.readinessEndpoint}\`
- Metrics endpoint: \`${manifest.governanceContract.metricsEndpoint}\`

## Artifact Summary

- Source files: ${manifest.artifacts.fileCount}
- Source tree hash: \`${manifest.artifacts.sourceTreeHash}\`
- External dependencies: ${manifest.dependencies.externalCount}
- package-lock hash: \`${manifest.lockfiles.packageLockSha256}\`
- pnpm-lock hash: \`${manifest.lockfiles.pnpmLockSha256}\`

## Workspaces

${workspaces}

## Deployment Artifacts

${deployments}
`;
}

async function main() {
  if (!existsSync(path.join(root, "package-lock.json"))) throw new Error("package-lock.json is required for release manifest generation");
  const [rootPackage, lockfile, files] = await Promise.all([readJson("package.json"), readJson("package-lock.json"), fileInventory()]);
  const deps = await dependencyInventory(rootPackage, lockfile);
  const manifest = buildManifest({ rootPackage, lockfile, files, deps });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(manifest), "utf8");
  console.log(`[release] manifest written: ${path.relative(root, outputPath)}`);
  console.log(`[release] markdown written: ${path.relative(root, markdownPath)}`);
  console.log(`[release] manifestHash=${manifest.manifestHash}`);
  console.log(`[release] signature=${manifest.signature.algorithm}`);
}

main().catch((error) => {
  console.error("[release] manifest generation failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
