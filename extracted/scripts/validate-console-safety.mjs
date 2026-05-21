import { readFile } from "node:fs/promises";

const checks = [];

function requireText(name, text, needle, detail = needle) {
  const ok = text.includes(needle);
  checks.push({ name, ok, detail });
  if (!ok) {
    throw new Error(`${name} missing required console safety contract: ${detail}`);
  }
}

async function main() {
  const consoleSource = await readFile("apps/console-ui/src/EnterpriseOperatorConsole.tsx", "utf8");
  const publicTrialSource = await readFile("apps/console-ui/src/PublicTrialApp.tsx", "utf8");
  const shellSource = await readFile("apps/console-ui/src/main.tsx", "utf8");
  const consoleCss = await readFile("apps/console-ui/src/canvas.css", "utf8");
  const gatewayClient = await readFile("apps/console-ui/src/gateway-client.ts", "utf8");

  requireText("gateway-client", gatewayClient, "readiness?:", "gateway readiness type is exposed to the UI");
  requireText("gateway-client", gatewayClient, "failedCritical: string[]", "critical upstream failures are typed");
  requireText("console-shell", shellSource, "EnterpriseOperatorConsole", "enterprise console is the default operator surface");
  requireText("console-shell", shellSource, 'window.location.pathname === "/try"', "public playground route");
  requireText("public-trial", publicTrialSource, "Runtime governance for autonomous execution.", "public landing headline");
  requireText("public-trial", publicTrialSource, "Commit Gate", "commit gate visualization");
  requireText("public-trial", publicTrialSource, "Execution Warrant", "warrant visualization");
  requireText("public-trial", publicTrialSource, "Governance Evidence Ledger", "GEL visualization");
  requireText("public-trial", publicTrialSource, "Approve with one-time warrant", "defer approval flow");
  requireText("public-trial", publicTrialSource, "Replay", "replay interface");
  requireText("console-ui", consoleSource, "Operator Safety Gate", "visible operator safety gate");
  requireText("console-ui", consoleSource, "operatorBlocks", "central mutation blocking model");
  requireText("console-ui", consoleSource, "The gateway is fail-closed.", "fail-closed readiness blocks mutations");
  requireText("console-ui", consoleSource, "Enterprise preflight is failing.", "enterprise preflight blocks mutations");
  requireText("console-ui", consoleSource, "Production signed sessions are not enforced.", "production session enforcement guard");
  requireText("console-ui", consoleSource, "Production RBAC is not enforced.", "production RBAC guard");
  requireText("console-ui", consoleSource, "Insecure production override is active.", "insecure override guard");
  requireText("console-ui", consoleSource, "missionErrors", "mission form validation");
  requireText("console-ui", consoleSource, "agentErrors", "agent form validation");
  requireText("console-ui", consoleSource, "Select a concrete", "scoped halt target validation");
  requireText("console-ui", consoleSource, "confirmAction", "irreversible action confirmation");
  requireText("console-ui", consoleSource, "Downstream governed actuation will be suppressed at the execution boundary.", "halt confirmation explains execution-boundary impact");
  requireText("console-ui", consoleSource, "This advances runtime state and must remain admissible at the execution boundary.", "mission action confirmation preserves doctrine");
  requireText("console-ui", consoleSource, "Pilot Workflow", "operator workflow panel");
  requireText("console-ui", consoleSource, "Export Governance Evidence", "evidence export action");
  requireText("console-ui", consoleSource, "fetchGovernanceChainEvidence", "governance evidence export client");
  requireText("console-ui", consoleSource, "disabled={!canMutate || missionErrors.length > 0}", "mission creation disabled until admissible");
  requireText("console-ui", consoleSource, "disabled={!canMutate || agentErrors.length > 0}", "agent registration disabled until admissible");
  requireText("console-ui", consoleSource, "operatorBlocks.length", "operator mutation guard is wired to controls");
  requireText("console-css", consoleCss, ".enterprise-console", "explicit enterprise console layout CSS");
  requireText("console-css", consoleCss, ".console-grid", "explicit grid layout CSS");
  requireText("console-css", consoleCss, "@media (max-width: 720px)", "mobile layout guard");

  console.log(`[ui-safety] console safety contracts passed (${checks.length} checks)`);
}

main().catch((error) => {
  console.error("[ui-safety] console safety contracts failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
