// Generate a CycloneDX 1.5 SBOM for the AristotleOS workspace from the resolved
// pnpm dependency graph. Output: sbom.json (repo project root).
//   node scripts/generate-sbom.mjs
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

let projects;
try {
  const raw = execSync("corepack pnpm list -r --depth Infinity --prod --json", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  projects = JSON.parse(raw);
} catch (error) {
  console.error("pnpm list failed; ensure dependencies are installed (corepack pnpm install).", error?.message ?? error);
  process.exit(1);
}

const components = new Map();
const visit = (deps) => {
  if (!deps) return;
  for (const [name, info] of Object.entries(deps)) {
    if (!info || typeof info !== "object") continue;
    const version = info.version;
    // skip workspace-internal packages from the third-party component list
    if (typeof version === "string" && !version.startsWith("link:") && !name.startsWith("@aristotle/")) {
      const key = `${name}@${version}`;
      if (!components.has(key)) {
        components.set(key, { type: "library", name, version, purl: `pkg:npm/${encodeURIComponent(name)}@${version}` });
      }
    }
    visit(info.dependencies);
  }
};
for (const project of Array.isArray(projects) ? projects : [projects]) {
  visit(project.dependencies);
}

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: "AristotleOS", name: "generate-sbom", version: "0.1.1" }],
    component: { type: "application", name: pkg.name, version: pkg.version, "bom-ref": `${pkg.name}@${pkg.version}` }
  },
  components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name))
};

writeFileSync(path.join(root, "sbom.json"), `${JSON.stringify(bom, null, 2)}\n`, "utf8");
console.log(`wrote sbom.json — ${bom.components.length} third-party components`);
