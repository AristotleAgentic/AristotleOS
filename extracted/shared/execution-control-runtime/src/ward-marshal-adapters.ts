import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  type AristotleSigner,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ExecutionControlDecision,
  type ExecutionControlReasonCode,
  type GelRecord,
  type LedgerStore,
  type RuntimeRegister,
  type WardManifest,
  type Warrant,
  evaluateExecutionControl,
  getDefaultDevSigner,
  stableStringify,
  verifyWarrant
} from "./index.js";
import { addCredentialRevocation } from "./credential-revocation.js";

export type WardMarshalAdapterKind = "kubernetes-scale-down" | "credential-revocation" | "endpoint-quarantine";
export type WardMarshalExecutionStatus = "executed" | "skipped" | "failed";

export interface CommandRunRequest {
  command: string;
  args: string[];
  stdin?: string;
}

export interface CommandRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (request: CommandRunRequest) => Promise<CommandRunResult> | CommandRunResult;

export interface WardMarshalAdapterReceipt {
  receipt_id: string;
  adapter: WardMarshalAdapterKind;
  status: WardMarshalExecutionStatus;
  executed_at: string;
  command?: string;
  args?: string[];
  stdin_hash?: string;
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  action_hash: string;
  warrant_id: string;
  gel_record_id: string;
  result_hash: string;
  signature: string;
  signature_algorithm: AristotleSigner["algorithm"];
  signing_key_id: string;
  signing_public_key: string;
}

export interface WardMarshalAdapterExecution {
  adapter: WardMarshalAdapterKind;
  status: WardMarshalExecutionStatus;
  command?: CommandRunRequest;
  result?: CommandRunResult;
  detail: string;
}

export interface WardMarshalExecuteInput {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  action: CanonicalActionInput;
  adapter: WardMarshalAdapter;
  ledgerPath: string;
  signer?: AristotleSigner;
  ledger?: LedgerStore;
  now?: string;
  runtimeRegister?: RuntimeRegister;
  replayProtection?: boolean;
  revocationListPath?: string;
  warrantTtlSeconds?: number;
}

export interface WardMarshalExecuteResult {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  canonical_action_hash: string;
  warrant?: Warrant;
  gel_record: GelRecord;
  adapter: WardMarshalAdapterKind;
  executed: boolean;
  receipt?: WardMarshalAdapterReceipt;
  error?: string;
}

export interface WardMarshalAdapter {
  readonly kind: WardMarshalAdapterKind;
  canExecute(action: CanonicalActionInput): boolean;
  execute(input: {
    action: CanonicalActionInput;
    warrant: Warrant;
    canonicalActionHash: string;
    gelRecord: GelRecord;
    now: string;
  }): Promise<WardMarshalAdapterExecution> | WardMarshalAdapterExecution;
}

export interface KubernetesAdapterOptions {
  kubectlPath?: string;
  kubeContext?: string;
  runner?: CommandRunner;
}

export interface CredentialRevocationAdapterOptions {
  revocationFile: string;
}

const DEFAULT_STDIO_LIMIT = 4096;

export class KubernetesScaleDownAdapter implements WardMarshalAdapter {
  readonly kind = "kubernetes-scale-down" as const;
  private readonly kubectlPath: string;
  private readonly runner: CommandRunner;
  private readonly kubeContext?: string;

  constructor(options: KubernetesAdapterOptions = {}) {
    this.kubectlPath = options.kubectlPath ?? "kubectl";
    this.runner = options.runner ?? defaultRunner;
    this.kubeContext = options.kubeContext;
  }

  canExecute(action: CanonicalActionInput): boolean {
    return action.action_type === "ward_marshal.scale_to_zero" || action.action_type === "ward_marshal.terminate_execution";
  }

  async execute(input: { action: CanonicalActionInput; warrant: Warrant; canonicalActionHash: string; gelRecord: GelRecord; now: string }): Promise<WardMarshalAdapterExecution> {
    const target = kubernetesWorkloadTarget(input.action);
    const args = [
      ...(this.kubeContext ? ["--context", this.kubeContext] : []),
      "-n",
      target.namespace,
      "scale",
      `${target.kind}/${target.name}`,
      "--replicas=0"
    ];
    const command = { command: this.kubectlPath, args };
    const result = await this.runner(command);
    return {
      adapter: this.kind,
      status: result.status === 0 ? "executed" : "failed",
      command,
      result,
      detail: result.status === 0 ? `scaled ${target.kind}/${target.name} in ${target.namespace} to zero replicas` : "kubectl scale failed"
    };
  }
}

export class EndpointQuarantineAdapter implements WardMarshalAdapter {
  readonly kind = "endpoint-quarantine" as const;
  private readonly kubectlPath: string;
  private readonly runner: CommandRunner;
  private readonly kubeContext?: string;

  constructor(options: KubernetesAdapterOptions = {}) {
    this.kubectlPath = options.kubectlPath ?? "kubectl";
    this.runner = options.runner ?? defaultRunner;
    this.kubeContext = options.kubeContext;
  }

  canExecute(action: CanonicalActionInput): boolean {
    return action.action_type === "ward_marshal.quarantine" || action.action_type === "ward_marshal.disable_tool_access";
  }

  async execute(input: { action: CanonicalActionInput; warrant: Warrant; canonicalActionHash: string; gelRecord: GelRecord; now: string }): Promise<WardMarshalAdapterExecution> {
    const target = quarantineTarget(input.action);
    const manifest = networkPolicyManifest(target);
    const args = [
      ...(this.kubeContext ? ["--context", this.kubeContext] : []),
      "apply",
      "-f",
      "-"
    ];
    const command = { command: this.kubectlPath, args, stdin: manifest };
    const result = await this.runner(command);
    return {
      adapter: this.kind,
      status: result.status === 0 ? "executed" : "failed",
      command,
      result,
      detail: result.status === 0 ? `applied quarantine NetworkPolicy ${target.policyName} in ${target.namespace}` : "kubectl apply NetworkPolicy failed"
    };
  }
}

export class CredentialRevocationAdapter implements WardMarshalAdapter {
  readonly kind = "credential-revocation" as const;

  constructor(private readonly options: CredentialRevocationAdapterOptions) {}

  canExecute(action: CanonicalActionInput): boolean {
    return action.action_type === "ward_marshal.revoke_credentials";
  }

  execute(input: { action: CanonicalActionInput; warrant: Warrant; canonicalActionHash: string; gelRecord: GelRecord; now: string }): WardMarshalAdapterExecution {
    const refs = credentialRefs(input.action);
    for (const credential_ref of refs) {
      addCredentialRevocation(this.options.revocationFile, {
        credential_ref,
        revoked_at: input.now,
        reason: stringParam(input.action, "reason") ?? "Ward Marshal credential revocation",
        source: "ward-marshal",
        warrant_id: input.warrant.warrant_id,
        gel_record_id: input.gelRecord.record_id,
        finding_id: stringTelemetry(input.action, "finding_id"),
        evidence_hash: stringParam(input.action, "evidence_hash")
      });
    }
    return {
      adapter: this.kind,
      status: "executed",
      detail: `revoked ${refs.length} credential reference(s) in ${this.options.revocationFile}`
    };
  }
}

export async function executeWardMarshalInterdiction(input: WardMarshalExecuteInput): Promise<WardMarshalExecuteResult> {
  const signer = input.signer ?? getDefaultDevSigner();
  const evaluation = evaluateExecutionControl({
    ward: input.ward,
    authorityEnvelope: input.authorityEnvelope,
    action: input.action,
    ledgerPath: input.ledgerPath,
    ledger: input.ledger,
    signer,
    now: input.now,
    runtimeRegister: input.runtimeRegister,
    replayProtection: input.replayProtection ?? true,
    revocationListPath: input.revocationListPath,
    warrantTtlSeconds: input.warrantTtlSeconds
  });

  const base = {
    decision: evaluation.decision,
    reason_codes: evaluation.reason_codes,
    canonical_action_hash: evaluation.canonical_action_hash,
    warrant: evaluation.warrant,
    gel_record: evaluation.gel_record,
    adapter: input.adapter.kind,
    executed: false
  };

  if (evaluation.decision !== "ALLOW" || !evaluation.warrant) return base;
  if (!input.adapter.canExecute(input.action)) {
    return { ...base, error: `adapter ${input.adapter.kind} cannot execute ${input.action.action_type}` };
  }
  const verification = verifyWarrant(evaluation.warrant, evaluation.canonical_action_hash, input.now);
  if (!verification.ok) {
    return { ...base, error: `warrant verification failed: ${verification.reason}` };
  }

  const executedAt = input.now ?? new Date().toISOString();
  const execution = await input.adapter.execute({
    action: input.action,
    warrant: evaluation.warrant,
    canonicalActionHash: evaluation.canonical_action_hash,
    gelRecord: evaluation.gel_record,
    now: executedAt
  });
  const receipt = buildWardMarshalAdapterReceipt(execution, {
    actionHash: evaluation.canonical_action_hash,
    gelRecord: evaluation.gel_record,
    warrant: evaluation.warrant,
    executedAt,
    signer
  });

  return {
    ...base,
    executed: execution.status === "executed",
    receipt,
    error: execution.status === "failed" ? execution.detail : undefined
  };
}

function buildWardMarshalAdapterReceipt(
  execution: WardMarshalAdapterExecution,
  binding: { actionHash: string; warrant: Warrant; gelRecord: GelRecord; executedAt: string; signer: AristotleSigner }
): WardMarshalAdapterReceipt {
  const resultMaterial = {
    adapter: execution.adapter,
    args: execution.command?.args,
    command: execution.command?.command,
    detail: execution.detail,
    executed_at: binding.executedAt,
    exit_code: execution.result?.status,
    gel_record_id: binding.gelRecord.record_id,
    action_hash: binding.actionHash,
    status: execution.status,
    stderr: truncate(execution.result?.stderr ?? ""),
    stdin_hash: execution.command?.stdin ? sha256(execution.command.stdin) : undefined,
    stdout: truncate(execution.result?.stdout ?? ""),
    warrant_id: binding.warrant.warrant_id
  };
  const result_hash = sha256(stableStringify(resultMaterial));
  return {
    receipt_id: `wmr-${result_hash.slice(0, 24)}`,
    adapter: execution.adapter,
    status: execution.status,
    executed_at: binding.executedAt,
    command: execution.command?.command,
    args: execution.command?.args,
    stdin_hash: execution.command?.stdin ? sha256(execution.command.stdin) : undefined,
    exit_code: execution.result?.status,
    stdout: truncate(execution.result?.stdout ?? ""),
    stderr: truncate(execution.result?.stderr ?? ""),
    action_hash: binding.actionHash,
    warrant_id: binding.warrant.warrant_id,
    gel_record_id: binding.gelRecord.record_id,
    result_hash,
    signature: binding.signer.sign(result_hash),
    signature_algorithm: binding.signer.algorithm,
    signing_key_id: binding.signer.key_id,
    signing_public_key: binding.signer.public_key_pem
  };
}

function defaultRunner(request: CommandRunRequest): CommandRunResult {
  const result = spawnSync(request.command, request.args, {
    input: request.stdin,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? ""
  };
}

function kubernetesWorkloadTarget(action: CanonicalActionInput): { namespace: string; kind: string; name: string } {
  const k8s = objectParam(action, "kubernetes") ?? objectParam(action, "kubernetes_workload");
  const namespace = stringRecord(k8s, "namespace") ?? stringParam(action, "namespace");
  const kind = (stringRecord(k8s, "kind") ?? stringParam(action, "kind") ?? "").toLowerCase();
  const name = stringRecord(k8s, "name") ?? stringParam(action, "name");
  if (!namespace || !kind || !name) throw new Error("kubernetes scale-down requires namespace, kind, and name");
  if (!["deployment", "statefulset", "replicaset", "replicaSet".toLowerCase()].includes(kind)) {
    throw new Error(`unsupported scalable Kubernetes workload kind: ${kind}`);
  }
  return { namespace, kind, name };
}

function quarantineTarget(action: CanonicalActionInput): { namespace: string; policyName: string; podSelector: Record<string, string> } {
  const quarantine = objectParam(action, "endpoint_quarantine") ?? objectParam(action, "quarantine");
  const namespace = stringRecord(quarantine, "namespace") ?? stringParam(action, "namespace");
  const policyName = stringRecord(quarantine, "policy_name") ?? stringParam(action, "policy_name") ?? `aos-quarantine-${safeName(action.action_id)}`;
  const rawSelector = objectRecord(quarantine, "pod_selector") ?? objectParam(action, "pod_selector");
  const podSelector = stringMap(rawSelector);
  if (!namespace) throw new Error("endpoint quarantine requires namespace");
  if (!Object.keys(podSelector).length) throw new Error("endpoint quarantine requires pod_selector labels");
  return { namespace, policyName, podSelector };
}

function networkPolicyManifest(target: { namespace: string; policyName: string; podSelector: Record<string, string> }): string {
  const labels = Object.entries(target.podSelector)
    .map(([key, value]) => `      ${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return [
    "apiVersion: networking.k8s.io/v1",
    "kind: NetworkPolicy",
    "metadata:",
    `  name: ${target.policyName}`,
    `  namespace: ${target.namespace}`,
    "  labels:",
    "    app.kubernetes.io/managed-by: aristotleos",
    "    aristotleos.io/purpose: ward-marshal-quarantine",
    "spec:",
    "  podSelector:",
    "    matchLabels:",
    labels,
    "  policyTypes:",
    "    - Ingress",
    "    - Egress",
    "  ingress: []",
    "  egress: []",
    ""
  ].join("\n");
}

function credentialRefs(action: CanonicalActionInput): string[] {
  const refs = action.params.credential_refs;
  if (!Array.isArray(refs)) throw new Error("credential revocation requires credential_refs");
  const out = refs.filter((item): item is string => typeof item === "string" && item.length > 0).sort();
  if (!out.length) throw new Error("credential revocation requires at least one credential ref");
  return out;
}

function objectParam(action: CanonicalActionInput, key: string): Record<string, unknown> | undefined {
  const value = action.params[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function objectRecord(source: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = source?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringParam(action: CanonicalActionInput, key: string): string | undefined {
  const value = action.params[key];
  return typeof value === "string" ? value : undefined;
}

function stringRecord(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}

function stringTelemetry(action: CanonicalActionInput, key: string): string | undefined {
  const value = action.telemetry?.[key];
  return typeof value === "string" ? value : undefined;
}

function stringMap(source: Record<string, unknown> | undefined): Record<string, string> {
  if (!source) return {};
  return Object.fromEntries(Object.entries(source).filter(([, value]) => typeof value === "string")) as Record<string, string>;
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "agent";
}

function truncate(value: string, limit = DEFAULT_STDIO_LIMIT): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...[truncated]`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
