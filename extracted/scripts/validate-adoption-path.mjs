import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`adoption-path validation failed: ${message}`);
    process.exitCode = 1;
  }
}

const doc = read("docs/commercial-adoption-path.md");
for (const phrase of [
  "Authority before consequence",
  "Warrant before execution",
  "Evidence after every decision",
  "Policy Promotion Pipeline",
  "Failure Mode Console",
  "Governed Tool Gateway",
  "Policy Test Harness",
  "Runtime SLOs"
]) {
  assert(doc.includes(phrase), `missing doc phrase: ${phrase}`);
}

const catalog = JSON.parse(read("examples/mission-templates/catalog.json"));
assert(catalog.schema === "aristotle.mission-template.catalog/v0.1", "mission template catalog schema mismatch");
assert(Array.isArray(catalog.templates) && catalog.templates.length >= 4, "expected at least four mission templates");

for (const tpl of catalog.templates ?? []) {
  assert(typeof tpl.id === "string" && tpl.id.length > 0, "template missing id");
  assert(typeof tpl.ward?.id === "string" && tpl.ward.id.length > 0, `${tpl.id} missing Ward id`);
  assert(typeof tpl.authorityEnvelope?.subject === "string", `${tpl.id} missing Authority Envelope subject`);
  assert(Array.isArray(tpl.authorityEnvelope?.allowedActions), `${tpl.id} missing allowed actions`);
  assert(Array.isArray(tpl.authorityEnvelope?.refusedActions), `${tpl.id} missing refused actions`);
  assert(tpl.authorityEnvelope?.warrantRequired === true, `${tpl.id} must require Warrant`);
  assert(Array.isArray(tpl.evidenceRequired) && tpl.evidenceRequired.includes("warrant"), `${tpl.id} must include Warrant evidence`);
  assert(["ALLOW", "REFUSE", "ESCALATE", "FAIL_CLOSED"].includes(tpl.expectedDefaultDecision), `${tpl.id} has invalid default decision`);
}

const commandCenter = read("apps/console-ui/src/command-center/CommandCenter.tsx");
assert(commandCenter.includes("AdoptionPathConsole"), "Command Center does not expose AdoptionPathConsole");
assert(commandCenter.includes("FailureModeConsole"), "Command Center does not expose FailureModeConsole");
assert(commandCenter.includes("GovernanceBuilderConsole"), "Command Center does not expose GovernanceBuilderConsole");
assert(commandCenter.includes("ShadowModeConsole"), "Command Center does not expose ShadowModeConsole");
assert(commandCenter.includes("ConflictInboxConsole"), "Command Center does not expose ConflictInboxConsole");

const mockData = read("apps/console-ui/src/command-center/mockData.ts");
for (const exportName of ["POLICY_PROMOTION", "MISSION_TEMPLATES", "TOOL_GATEWAYS", "POLICY_HARNESS", "RUNTIME_SLOS", "FAILURE_DRILLS", "BUILDER_PREVIEW", "SHADOW_PROFILE", "CONFLICT_INBOX"]) {
  assert(mockData.includes(`export const ${exportName}`), `missing UI fixture: ${exportName}`);
}

if (!process.exitCode) {
  console.log("adoption-path validation passed");
}
