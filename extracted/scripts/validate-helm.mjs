// Validate the AristotleOS Helm chart: lint + render with the default and the
// kind-smoke value sets. Fails if helm reports an error or a template won't render.
//   node scripts/validate-helm.mjs        (npm run helm:validate)
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chart = "charts/aristotle-governance-os";

function helm(args) {
  // Discard rendered manifests on stdout; surface errors from stderr.
  return execSync(`helm ${args}`, { cwd: root, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
}

try {
  helm("version --short");
} catch {
  console.error("helm is not installed / not on PATH. Install Helm 3+ (https://helm.sh) to run this check.");
  process.exit(2);
}

const checks = [
  ["lint", `lint ${chart}`],
  ["template (default values)", `template aristotle ${chart}`],
  ["template (kind-smoke values)", `template aristotle ${chart} -f ${chart}/values-kind-smoke.yaml`]
];

console.log("AristotleOS Helm chart validation\n");
let failed = 0;
for (const [label, args] of checks) {
  try {
    helm(args);
    console.log(`  PASS  helm ${label}`);
  } catch (error) {
    failed += 1;
    const detail = ((error.stderr ?? "") + (error.stdout ?? "") || error.message).trim();
    console.error(`  FAIL  helm ${label}\n        ${detail.split(/\r?\n/).slice(0, 6).join("\n        ")}`);
  }
}

console.log(`\n${failed ? `FAIL — ${failed} helm check(s) failed` : "OK — chart lints and renders (default + kind-smoke)"}`);
process.exit(failed ? 1 : 0);
