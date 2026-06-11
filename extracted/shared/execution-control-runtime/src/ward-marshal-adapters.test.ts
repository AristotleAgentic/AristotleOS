import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type AuthorityEnvelope,
  type CommandRunRequest,
  type CommandRunResult,
  type WardManifest,
  CredentialBroker,
  CredentialRevocationAdapter,
  EndpointQuarantineAdapter,
  KubernetesScaleDownAdapter,
  buildWardMarshalInterdictionAction,
  executeWardMarshalInterdiction,
  loadCredentialRevocations,
  verifyEd25519
} from "./index.js";

const now = "2026-05-24T12:00:00.000Z";

const ward: WardManifest = {
  ward_id: "enterprise-autonomy-ward",
  name: "Enterprise Autonomous Execution Ward",
  sovereignty_context: "regulated-enterprise",
  authority_domain: "rogue-agent-control",
  policy_version: "0.3.0",
  permitted_subjects: ["agent:ward-marshal"]
};

const envelope: AuthorityEnvelope = {
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

const finding = {
  finding_id: "wmf-test",
  agent_id: "discovered-prod-shell",
  subject: "agent:unclaimed:prod-shell",
  ward_id: ward.ward_id,
  status: "rogue" as const,
  risk_score: 100,
  risk_band: "critical" as const,
  observed_locations: ["cluster/prod/ns/payments/deploy/shadow-agent"],
  observed_tools: ["kubectl.production.deploy", "shell.exec"],
  credential_refs: ["kubeconfig:prod-admin"],
  last_seen: now,
  signals: [],
  recommended_disposition: "terminate_execution" as const,
  evidence_hash: "evidence-hash",
  observation_ids: ["obs-1"]
};

function tempPath(name: string) {
  return path.join(mkdtempSync(path.join(tmpdir(), "aos-ward-marshal-adapters-")), name);
}

function runtimeRegister() {
  return { policy_version: ward.policy_version, registers: { operator_ticket: "SEC-1042", interdiction_authority: "soc-commander" } };
}

test("Kubernetes scale-down adapter executes kubectl scale only after Warrant ALLOW", async () => {
  const calls: CommandRunRequest[] = [];
  const runner = (request: CommandRunRequest): CommandRunResult => {
    calls.push(request);
    return { status: 0, stdout: "deployment.apps/shadow-agent scaled\n", stderr: "" };
  };
  const action = buildWardMarshalInterdictionAction({
    finding,
    kind: "scale_to_zero",
    requestedBy: "agent:ward-marshal",
    requestedAt: now,
    reason: "rogue workload must be scaled down"
  });
  action.params.kubernetes = { namespace: "payments", kind: "deployment", name: "shadow-agent" };
  const result = await executeWardMarshalInterdiction({
    ward,
    authorityEnvelope: envelope,
    action,
    adapter: new KubernetesScaleDownAdapter({ runner, kubeContext: "kind-aristotle" }),
    ledgerPath: tempPath("gel.jsonl"),
    runtimeRegister: runtimeRegister(),
    now,
    replayProtection: false
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.executed, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["--context", "kind-aristotle", "-n", "payments", "scale", "deployment/shadow-agent", "--replicas=0"]);
  assert.equal(result.receipt?.adapter, "kubernetes-scale-down");
  assert.equal(result.receipt?.status, "executed");
  assert.equal(verifyEd25519(result.receipt!.signing_public_key, result.receipt!.result_hash, result.receipt!.signature), true);
});

test("Kubernetes scale-down adapter does not execute when Commit Gate escalates", async () => {
  const calls: CommandRunRequest[] = [];
  const action = buildWardMarshalInterdictionAction({
    finding,
    kind: "scale_to_zero",
    requestedBy: "agent:ward-marshal",
    requestedAt: now,
    reason: "missing registers"
  });
  action.params.kubernetes = { namespace: "payments", kind: "deployment", name: "shadow-agent" };
  const result = await executeWardMarshalInterdiction({
    ward,
    authorityEnvelope: envelope,
    action,
    adapter: new KubernetesScaleDownAdapter({ runner: (request) => { calls.push(request); return { status: 0, stdout: "", stderr: "" }; } }),
    ledgerPath: tempPath("gel.jsonl"),
    runtimeRegister: { policy_version: ward.policy_version, registers: { operator_ticket: "SEC-1043" } },
    now,
    replayProtection: false
  });
  assert.equal(result.decision, "ESCALATE");
  assert.equal(result.executed, false);
  assert.equal(result.receipt, undefined);
  assert.equal(calls.length, 0);
});

test("Credential revocation adapter writes a real revocation list and broker refuses revoked refs", async () => {
  const revocations = tempPath("credential-revocations.json");
  const action = buildWardMarshalInterdictionAction({
    finding,
    kind: "revoke_credentials",
    requestedBy: "agent:ward-marshal",
    requestedAt: now,
    reason: "rogue agent used production credentials"
  });
  const result = await executeWardMarshalInterdiction({
    ward,
    authorityEnvelope: envelope,
    action,
    adapter: new CredentialRevocationAdapter({ revocationFile: revocations }),
    ledgerPath: tempPath("gel.jsonl"),
    runtimeRegister: runtimeRegister(),
    now,
    replayProtection: false
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.executed, true);
  assert.equal(existsSync(revocations), true);
  const list = loadCredentialRevocations(revocations);
  assert.equal(list.revoked_credentials[0].credential_ref, "kubeconfig:prod-admin");
  assert.equal(list.revoked_credentials[0].warrant_id, result.warrant?.warrant_id);

  const broker = CredentialBroker.fromConfig(
    { rules: [{ action_type: "http.post", header: "Authorization", value_env: "SECRET", credential_ref: "kubeconfig:prod-admin" }] },
    { SECRET: "secret" },
    list
  );
  assert.throws(() => broker.resolve({ ...action, action_type: "http.post", target: "https://example.com" }), /credential "kubeconfig:prod-admin" is revoked/);
});

test("Endpoint quarantine adapter applies a default-deny NetworkPolicy through kubectl", async () => {
  const calls: CommandRunRequest[] = [];
  const action = buildWardMarshalInterdictionAction({
    finding,
    kind: "quarantine",
    requestedBy: "agent:ward-marshal",
    requestedAt: now,
    reason: "isolate rogue endpoint"
  });
  action.params.endpoint_quarantine = {
    namespace: "payments",
    policy_name: "aos-quarantine-shadow-agent",
    pod_selector: { app: "shadow-agent", "aristotleos.io/agent": "rogue" }
  };
  const result = await executeWardMarshalInterdiction({
    ward,
    authorityEnvelope: envelope,
    action,
    adapter: new EndpointQuarantineAdapter({ runner: (request) => { calls.push(request); return { status: 0, stdout: "networkpolicy created\n", stderr: "" }; } }),
    ledgerPath: tempPath("gel.jsonl"),
    runtimeRegister: runtimeRegister(),
    now,
    replayProtection: false
  });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.executed, true);
  assert.deepEqual(calls[0].args, ["apply", "-f", "-"]);
  assert.match(calls[0].stdin ?? "", /kind: NetworkPolicy/);
  assert.match(calls[0].stdin ?? "", /namespace: payments/);
  assert.match(calls[0].stdin ?? "", /ingress: \[\]/);
  assert.match(calls[0].stdin ?? "", /egress: \[\]/);
});

test("adapter mismatch records ALLOW but does not execute the wrong backend", async () => {
  const action = buildWardMarshalInterdictionAction({
    finding,
    kind: "revoke_credentials",
    requestedBy: "agent:ward-marshal",
    requestedAt: now,
    reason: "wrong adapter"
  });
  const dir = mkdtempSync(path.join(tmpdir(), "aos-ward-marshal-adapters-"));
  try {
    const result = await executeWardMarshalInterdiction({
      ward,
      authorityEnvelope: envelope,
      action,
      adapter: new KubernetesScaleDownAdapter(),
      ledgerPath: path.join(dir, "gel.jsonl"),
      runtimeRegister: runtimeRegister(),
      now,
      replayProtection: false
    });
    assert.equal(result.decision, "ALLOW");
    assert.equal(result.executed, false);
    assert.match(result.error ?? "", /cannot execute/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
