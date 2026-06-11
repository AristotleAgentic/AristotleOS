// Pilot cluster lifecycle helpers around the Helm release.
//   node scripts/pilot-cluster.mjs status     [--release r] [--namespace ns]
//   node scripts/pilot-cluster.mjs uninstall  [--release r] [--namespace ns] [--purge-namespace]
//
// Install + smoke are handled by scripts/k8s-smoke-install.mjs (kind/minikube).
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const sub = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const release = opt("--release", "aristotle");
const namespace = opt("--namespace", "aristotle-governance-os");

function run(cmd, { capture = false } = {}) {
  return execSync(cmd, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8" });
}

try {
  run("helm version --short", { capture: true });
} catch {
  console.error("helm is not installed / not on PATH. Install Helm 3+ (https://helm.sh).");
  process.exit(2);
}

if (sub === "status") {
  console.log(`AristotleOS pilot status — release ${release} / namespace ${namespace}\n`);
  try { run(`helm status ${release} -n ${namespace}`); } catch { console.error(`\nNo Helm release "${release}" in "${namespace}".`); process.exit(1); }
  try { run(`kubectl get pods,svc,ingress -n ${namespace}`); } catch { /* kubectl optional */ }
  process.exit(0);
}

if (sub === "uninstall") {
  try { run(`helm uninstall ${release} -n ${namespace}`); }
  catch { console.error(`Could not uninstall "${release}" in "${namespace}" (already removed?).`); process.exit(1); }
  if (args.includes("--purge-namespace")) {
    try { run(`kubectl delete namespace ${namespace}`); } catch { /* best effort */ }
  }
  console.log(`\nUninstalled ${release}. ${args.includes("--purge-namespace") ? `Namespace ${namespace} deleted.` : `Namespace ${namespace} retained (PVCs/secrets preserved).`}`);
  process.exit(0);
}

console.error("usage: pilot-cluster.mjs status|uninstall [--release r] [--namespace ns] [--purge-namespace]");
process.exit(1);
