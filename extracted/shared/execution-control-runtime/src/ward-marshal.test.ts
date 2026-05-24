import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AgentObservation,
  type AgentRegistry,
  type AuthorityEnvelope,
  type WardManifest,
  buildWardMarshalInterdictionAction,
  evaluateExecutionControl,
  explainWardMarshalFinding,
  runWardMarshalCensus
} from "./index.js";

const now = "2026-05-24T12:00:00.000Z";

const ward: WardManifest = {
  ward_id: "ward-enterprise-ai",
  name: "Enterprise Autonomous Execution Ward",
  sovereignty_context: "regulated-enterprise",
  authority_domain: "rogue-agent-control",
  policy_version: "0.3.0",
  permitted_subjects: ["agent:ward-marshal"],
  metadata: { owner: "security-operations" }
};

const marshalEnvelope: AuthorityEnvelope = {
  envelope_id: "ae-ward-marshal-001",
  ward_id: ward.ward_id,
  subject: "agent:ward-marshal",
  allowed_actions: [
    "ward_marshal.quarantine",
    "ward_marshal.revoke_credentials",
    "ward_marshal.disable_tool_access",
    "ward_marshal.scale_to_zero",
    "ward_marshal.terminate_execution"
  ],
  denied_actions: [],
  constraints: {
    required_runtime_registers: ["registers.operator_ticket", "registers.interdiction_authority"]
  },
  expires_at: "2026-12-31T23:59:59Z",
  issuer: "aristotle-root"
};

const registry: AgentRegistry = {
  registry_version: "2026-05-24.1",
  agents: [
    {
      agent_id: "agent-approved-sre",
      subject: "agent:agent-approved-sre",
      ward_id: ward.ward_id,
      owner: "platform",
      approved_tools: ["kubernetes.read", "incident.ticket.create"],
      credential_refs: ["spiffe://enterprise/platform/sre-agent"],
      status: "approved"
    }
  ]
};

const observations: AgentObservation[] = [
  {
    observation_id: "obs-003",
    source: "kubernetes",
    observed_at: now,
    location: "cluster/prod/ns/payments/pod/refund-agent",
    declared_agent_id: "agent-approved-sre",
    owner: "platform",
    ward_id: ward.ward_id,
    container_image: "registry.local/sre-agent:1.0.0",
    service_account: "agent:agent-approved-sre",
    tool_targets: ["kubernetes.read", "incident.ticket.create"],
    credential_refs: ["spiffe://enterprise/platform/sre-agent"]
  },
  {
    observation_id: "obs-001",
    source: "developer-workstation",
    observed_at: now,
    location: "workstation/finance-17/process/4421",
    process_name: "langgraph-worker",
    command_line: "node refund-workflow.js --agent",
    outbound_hosts: ["api.openai.com", "crm.internal"],
    llm_endpoints: ["https://api.openai.com/v1/responses"],
    tool_targets: ["stripe.refunds.write", "crm.customer.update", "secrets.vault.read"],
    credential_refs: ["oauth:finance-user", "vault:stripe-prod"],
    labels: { subject: "agent:shadow-refund-runner" }
  },
  {
    observation_id: "obs-002",
    source: "mcp",
    observed_at: now,
    location: "mcp/server/prod-shell",
    process_name: "mcp-tool-server",
    service_account: "cluster-admin-agent",
    tool_targets: ["shell.exec", "kubectl.production.deploy", "firewall.rules.write"],
    credential_refs: ["kubeconfig:prod-admin"]
  }
];

function ledgerPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-ward-marshal-")), "gel.jsonl");
}

test("Ward Marshal census is deterministic across observation ordering", () => {
  const left = runWardMarshalCensus({ observations, registry, generatedAt: now });
  const right = runWardMarshalCensus({ observations: [...observations].reverse(), registry, generatedAt: now });
  assert.equal(left.report_hash, right.report_hash);
  assert.deepEqual(left.summary, right.summary);
});

test("approved registered agents are classified as governed", () => {
  const report = runWardMarshalCensus({ observations, registry, generatedAt: now });
  const governed = report.findings.find((finding) => finding.agent_id === "agent-approved-sre");
  assert.equal(governed?.status, "governed");
  assert.equal(governed?.recommended_disposition, "shadow_profile");
});

test("undeclared consequential agents are classified as rogue with high or critical risk", () => {
  const report = runWardMarshalCensus({ observations, registry, generatedAt: now });
  const rogue = report.findings.find((finding) => finding.subject === "agent:shadow-refund-runner");
  assert.equal(rogue?.status, "rogue");
  assert.equal(rogue?.risk_band === "high" || rogue?.risk_band === "critical", true);
  assert.ok(rogue?.signals.some((signal) => signal.code === "UNREGISTERED_AGENT"));
  assert.match(explainWardMarshalFinding(rogue!), /Recommended disposition/);
});

test("interdiction is a governed action that receives a Warrant only after Commit Gate ALLOW", () => {
  const report = runWardMarshalCensus({ observations, registry, generatedAt: now });
  const rogue = report.findings.find((finding) => finding.subject === "agent:shadow-refund-runner");
  assert.ok(rogue);
  const action = buildWardMarshalInterdictionAction({
    finding: { ...rogue, ward_id: ward.ward_id },
    kind: "revoke_credentials",
    requestedBy: "agent:ward-marshal",
    requestedAt: now,
    reason: "undeclared agent holds production payment credentials"
  });
  const result = evaluateExecutionControl({
    ward,
    authorityEnvelope: marshalEnvelope,
    action,
    runtimeRegister: { policy_version: ward.policy_version, registers: { operator_ticket: "SEC-1042", interdiction_authority: "soc-commander" } },
    ledgerPath: ledgerPath(),
    now,
    replayProtection: false
  });
  assert.equal(result.decision, "ALLOW");
  assert.ok(result.warrant);
  assert.equal(result.gel_record.decision, "ALLOW");
  assert.equal(result.ledger_verification.ok, true);
});

test("interdiction fails closed when the envelope does not allow that containment action", () => {
  const report = runWardMarshalCensus({ observations, registry, generatedAt: now });
  const rogue = report.findings.find((finding) => finding.subject === "agent:shadow-refund-runner");
  assert.ok(rogue);
  const action = buildWardMarshalInterdictionAction({
    finding: { ...rogue, ward_id: ward.ward_id },
    kind: "terminate_execution",
    requestedBy: "agent:ward-marshal",
    requestedAt: now,
    reason: "test termination not delegated"
  });
  const reducedEnvelope: AuthorityEnvelope = { ...marshalEnvelope, allowed_actions: ["ward_marshal.quarantine"] };
  const result = evaluateExecutionControl({
    ward,
    authorityEnvelope: reducedEnvelope,
    action,
    runtimeRegister: { policy_version: ward.policy_version, registers: { operator_ticket: "SEC-1043", interdiction_authority: "soc-commander" } },
    ledgerPath: ledgerPath(),
    now,
    replayProtection: false
  });
  assert.equal(result.decision, "REFUSE");
  assert.equal(result.reason_codes.includes("ACTION_NOT_ALLOWED"), true);
  assert.equal(result.warrant, undefined);
});

test("interdiction escalates when runtime authority registers are missing", () => {
  const report = runWardMarshalCensus({ observations, registry, generatedAt: now });
  const rogue = report.findings.find((finding) => finding.subject === "agent:shadow-refund-runner");
  assert.ok(rogue);
  const action = buildWardMarshalInterdictionAction({
    finding: { ...rogue, ward_id: ward.ward_id },
    kind: "quarantine",
    requestedBy: "agent:ward-marshal",
    requestedAt: now,
    reason: "operator authority register intentionally omitted"
  });
  const result = evaluateExecutionControl({
    ward,
    authorityEnvelope: marshalEnvelope,
    action,
    runtimeRegister: { policy_version: ward.policy_version, registers: { operator_ticket: "SEC-1044" } },
    ledgerPath: ledgerPath(),
    now,
    replayProtection: false
  });
  assert.equal(result.decision, "ESCALATE");
  assert.equal(result.reason_codes.includes("RUNTIME_STATE_MISSING"), true);
  assert.equal(result.warrant, undefined);
});
