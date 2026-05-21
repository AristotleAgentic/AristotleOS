#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createExecutionControlRuntimeServer,
  evaluateExecutionControl,
  loadAuthorityEnvelope,
  loadCanonicalAction,
  loadWardManifest,
  requireAllowedWarrant,
  submitGovernedAction,
  verifyGelChain
} from "@aristotle/execution-control-runtime";
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

const optionValue = (args: string[], name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const requiredOption = (args: string[], name: string) => {
  const value = optionValue(args, name);
  if (!value) throw new Error(`missing required option ${name}`);
  return value;
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
  execution-control evaluate      Evaluate a Ward/Warrant governed action through AristotleOS
  execution-control dev           Start the sample execution-control runtime on localhost
  execution-control serve         Run the AristotleOS execution boundary
  execution-control submit        Submit an action JSON file to the execution boundary
  execution-control audit verify  Verify the execution-control GEL hash chain
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

    if (command === "execution-control" && subcommand === "evaluate") {
      const wardPath = requiredOption(rest, "--ward");
      const envelopePath = requiredOption(rest, "--envelope");
      const actionPath = requiredOption(rest, "--action");
      const ledgerPath = requiredOption(rest, "--ledger");
      const ward = loadWardManifest(path.resolve(cwd, wardPath));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, envelopePath));
      const action = loadCanonicalAction(path.resolve(cwd, actionPath));
      const result = evaluateExecutionControl({
        ward,
        authorityEnvelope,
        action,
        ledgerPath: path.resolve(cwd, ledgerPath),
        now: optionValue(rest, "--now")
      });
      if (json) {
        printJson(out, result, true);
      } else {
        out(`decision=${result.decision}
reason_codes=${result.reason_codes.join(",")}
canonical_action_hash=${result.canonical_action_hash}
warrant_id=${result.warrant?.warrant_id ?? "none"}
gel_record_hash=${result.gel_record.record_hash}
ledger_verification=${result.ledger_verification.ok ? "ok" : `failed:${result.ledger_verification.failure}`}
`);
      }
      return result.ledger_verification.ok ? 0 : 1;
    }

    if (command === "execution-control" && subcommand === "serve") {
      const wardPath = requiredOption(rest, "--ward");
      const envelopePath = requiredOption(rest, "--envelope");
      const ledgerPath = requiredOption(rest, "--ledger");
      const port = Number(optionValue(rest, "--port") ?? "8181");
      if (!Number.isInteger(port) || port <= 0) throw new Error("--port must be a positive integer");
      const ward = loadWardManifest(path.resolve(cwd, wardPath));
      const authorityEnvelope = loadAuthorityEnvelope(path.resolve(cwd, envelopePath));
      const { server } = createExecutionControlRuntimeServer({
        ward,
        authorityEnvelope,
        ledgerPath: path.resolve(cwd, ledgerPath),
        now: optionValue(rest, "--now")
      });
      await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
      out(`AristotleOS execution-control runtime listening on http://127.0.0.1:${port}
Ward: ${ward.ward_id}
Authority Envelope: ${authorityEnvelope.envelope_id}
Evaluate: POST http://127.0.0.1:${port}/v1/execution-control/evaluate
Audit: GET http://127.0.0.1:${port}/v1/execution-control/audit/verify
`);
      await new Promise<void>(() => undefined);
      return 0;
    }

    if (command === "execution-control" && subcommand === "dev") {
      const devNow = optionValue(rest, "--now");
      return runCli([
        "execution-control",
        "serve",
        "--ward",
        "examples/execution_control/ward.montana_drone_test_range.yaml",
        "--envelope",
        "examples/execution_control/authority_envelope.survey_planner.yaml",
        "--ledger",
        ".tmp/execution-control-runtime.gel.jsonl",
        "--port",
        optionValue(rest, "--port") ?? "8181",
        ...(devNow ? ["--now", devNow] : [])
      ], cwd, out, err);
    }

    if (command === "execution-control" && subcommand === "submit") {
      const actionPath = requiredOption(rest, "--action");
      const endpoint = optionValue(rest, "--endpoint") ?? "http://127.0.0.1:8181/v1/execution-control/evaluate";
      const action = JSON.parse(readFileSync(path.resolve(cwd, actionPath), "utf8"));
      const result = await submitGovernedAction({ endpoint, action, now: optionValue(rest, "--now") });
      if (json) {
        printJson(out, result, true);
      } else {
        const requireWarrant = rest.includes("--require-warrant");
        if (requireWarrant) requireAllowedWarrant(result);
        out(`decision=${result.decision}
reason_codes=${Array.isArray(result.reason_codes) ? result.reason_codes.join(",") : "none"}
canonical_action_hash=${result.canonical_action_hash ?? "none"}
warrant_id=${result.warrant?.warrant_id ?? "none"}
gel_record_hash=${result.gel_record?.record_hash ?? "none"}
ledger_verification=${result.ledger_verification?.ok ? "ok" : "failed"}
`);
      }
      return 0;
    }

    if (command === "execution-control" && subcommand === "audit" && rest[0] === "verify") {
      const ledgerPath = requiredOption(rest, "--ledger");
      const verification = verifyGelChain(path.resolve(cwd, ledgerPath));
      if (json) printJson(out, verification, true);
      else out(`ledger_verification=${verification.ok ? "ok" : `failed:${verification.failure}`}\nrecords=${verification.count}\n`);
      return verification.ok ? 0 : 1;
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
