#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PAYMENTS_GOVERNANCE_SOURCE,
  TRIAL_SCENARIOS,
  evaluateTrialAction,
  planGovernanceChange,
  stableStringify,
  validateGovernanceSource
} from "@aristotle/trial-engine";

type Writer = (message: string) => void;

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

export async function runCli(argv: string[], cwd = process.cwd(), out: Writer = process.stdout.write.bind(process.stdout), err: Writer = process.stderr.write.bind(process.stderr)) {
  const [command = "help", subcommand, ...rest] = argv;
  const json = argv.includes("--json");
  try {
    if (command === "help" || command === "--help" || command === "-h") {
      out(`aristotle <command>

Commands:
  init                 Create governance.aristotle and starter files
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
  demo payments        Run the flagship payments scenario
  doctor               Check local developer prerequisites
`);
      return 0;
    }

    if (command === "init") {
      const target = rest.find((arg) => !arg.startsWith("--")) ?? ".";
      const dir = path.resolve(cwd, target);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "governance.aristotle"), `${PAYMENTS_GOVERNANCE_SOURCE}\n`);
      writeFileSync(path.join(dir, "README.md"), "# Governed AristotleOS starter\n\nRun `aristotle check`, `aristotle plan`, and `aristotle demo payments`.\n");
      writeFileSync(path.join(dir, ".env.example"), "ARISTOTLE_GATEWAY=http://127.0.0.1:8080\n");
      mkdirSync(path.join(dir, "examples"), { recursive: true });
      writeFileSync(path.join(dir, "examples", "agent.ts"), `// Governed tool call sketch\n// Call AristotleOS before irreversible action.\nexport const action = { requestedAction: "stripe.refund", parameters: { amount: 8000, currency: "USD" } };\n`);
      out(`created AristotleOS starter in ${dir}\n`);
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
