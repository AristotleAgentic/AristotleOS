import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type AristotleSigner,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ExecutionControlDecision,
  type ExecutionControlReasonCode,
  type GelRecord,
  type RuntimeRegister,
  type SignatureAlgorithm,
  type WardManifest,
  type Warrant,
  LedgerStore,
  evaluateExecutionControl,
  getDefaultDevSigner,
  sha256,
  stableStringify,
  verifyEd25519,
  verifyWarrant
} from "./index.js";

/**
 * AristotleOS sandbox execution layer.
 *
 * Division of responsibility: AristotleOS decides *whether* execution may occur
 * (Commit Gate -> Warrant); a sandbox isolates *where* it occurs. This module
 * binds the two: code runs in a sandbox only after an ALLOW + verified Warrant,
 * and the result is sealed into a signed Execution Receipt that is hash-bound to
 * the Warrant and the GEL record — so the proof chain runs intent -> decision ->
 * warrant -> execution -> evidence.
 *
 * `LocalProcessSandboxProvider` is a development provider: it enforces what a
 * process wrapper can (command allowlist, timeout, output-byte cap, working-dir
 * isolation, environment allowlist). It is NOT a kernel security boundary —
 * network and filesystem isolation are delegated to real providers (E2B, Daytona,
 * Modal, Riza, containers) via the same `SandboxProvider` interface.
 */

export interface SandboxPolicy {
  /** Exact allowlist of executable commands (argv[0]). Empty = nothing may run. */
  allowed_commands: string[];
  /** Wall-clock budget; the process is killed past this. */
  timeout_ms: number;
  /** Max bytes captured from stdout+stderr; beyond this, output is truncated + flagged. */
  max_output_bytes: number;
  /** Environment variable names passed through (allowlist). PATH (and SystemRoot/COMSPEC on Windows) are always included so commands resolve. */
  env_allowlist?: string[];
  /** Advisory for the local provider; enforced by real isolating providers. Default false. */
  allow_network?: boolean;
  /** Working directory. When omitted, a fresh isolated temp dir is created and removed on close. */
  working_dir?: string;
}

export type SandboxExecutionStatus = "ok" | "denied" | "timeout" | "error";

export interface SandboxCommand {
  command: string;
  args?: string[];
  stdin?: string;
}

export interface SandboxExecutionResult {
  command: string;
  args: string[];
  started_at: string;
  finished_at: string;
  duration_ms: number;
  exit_code: number | null;
  status: SandboxExecutionStatus;
  signal?: string;
  stdout: string;
  stderr: string;
  output_truncated: boolean;
}

/** A signed, Warrant-bound record of a sandboxed execution. */
export interface SandboxExecutionReceipt extends SandboxExecutionResult {
  receipt_id: string;
  provider: string;
  /** Binds the receipt to the authorizing Warrant + action + GEL record. */
  warrant_id: string;
  canonical_action_hash: string;
  gel_record_id?: string;
  /** sha256 over the canonical receipt material (excludes the hash + signature fields). */
  receipt_hash: string;
  signature?: string;
  signature_algorithm?: SignatureAlgorithm;
  signing_key_id?: string;
  signing_public_key?: string;
}

/** A self-contained proof that a sandboxed execution was authorized and what it did. */
export interface SandboxEvidence {
  receipt: SandboxExecutionReceipt;
  warrant: Warrant;
  gel_record: GelRecord;
}

export interface SandboxSession {
  readonly id: string;
  readonly provider: string;
  readonly workingDir: string;
  exec(command: SandboxCommand): Promise<SandboxExecutionResult>;
  close(): Promise<void>;
}

export interface SandboxProvider {
  readonly name: string;
  open(policy: SandboxPolicy): Promise<SandboxSession>;
}

const RECEIPT_NON_MATERIAL = ["receipt_hash", "signature", "signature_algorithm", "signing_key_id", "signing_public_key"] as const;

// ---------------------------------------------------------------------------
// Local process provider
// ---------------------------------------------------------------------------

class LocalProcessSandboxSession implements SandboxSession {
  readonly id = `sbx-${randomUUID().slice(0, 12)}`;
  readonly provider = "local-process";
  constructor(readonly workingDir: string, private readonly policy: SandboxPolicy, private readonly ownsDir: boolean) {}

  exec(command: SandboxCommand): Promise<SandboxExecutionResult> {
    return runLocalProcess(command, this.policy, this.workingDir);
  }

  async close(): Promise<void> {
    if (this.ownsDir) {
      try { rmSync(this.workingDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

export class LocalProcessSandboxProvider implements SandboxProvider {
  readonly name = "local-process";

  async open(policy: SandboxPolicy): Promise<SandboxSession> {
    const ownsDir = !policy.working_dir;
    const workingDir = policy.working_dir ?? mkdtempSync(path.join(tmpdir(), "aos-sbx-"));
    return new LocalProcessSandboxSession(workingDir, policy, ownsDir);
  }
}

function runLocalProcess(command: SandboxCommand, policy: SandboxPolicy, workingDir: string): Promise<SandboxExecutionResult> {
  const args = command.args ?? [];
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();

  if (!policy.allowed_commands.includes(command.command)) {
    return Promise.resolve({
      command: command.command, args, started_at: startedAt, finished_at: startedAt, duration_ms: 0,
      exit_code: null, status: "denied", stdout: "",
      stderr: `command not in sandbox allowlist: ${command.command}`, output_truncated: false
    });
  }

  const env: Record<string, string> = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.platform === "win32") {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (process.env.COMSPEC) env.COMSPEC = process.env.COMSPEC;
  }
  for (const key of policy.env_allowlist ?? []) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let killReason: "timeout" | "output_cap" | null = null;
    const cap = policy.max_output_bytes;

    const child = spawn(command.command, args, { cwd: workingDir, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });

    const capture = (buf: Buffer, which: "out" | "err") => {
      const current = which === "out" ? stdout : stderr;
      const used = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
      if (used >= cap) { truncated = true; if (!killReason) { killReason = "output_cap"; child.kill("SIGKILL"); } return; }
      const remaining = cap - used;
      const chunk = buf.toString("utf8");
      if (Buffer.byteLength(chunk) > remaining) {
        truncated = true;
        const sliced = Buffer.from(chunk).subarray(0, remaining).toString("utf8");
        if (which === "out") stdout = current + sliced; else stderr = current + sliced;
        if (!killReason) { killReason = "output_cap"; child.kill("SIGKILL"); }
      } else if (which === "out") {
        stdout = current + chunk;
      } else {
        stderr = current + chunk;
      }
    };

    child.stdout.on("data", (b: Buffer) => capture(b, "out"));
    child.stderr.on("data", (b: Buffer) => capture(b, "err"));
    child.stdin.on("error", () => { /* ignore EPIPE when the child exits early */ });
    if (command.stdin !== undefined) child.stdin.write(command.stdin);
    child.stdin.end();

    const timer = setTimeout(() => { killReason = killReason ?? "timeout"; child.kill("SIGKILL"); }, policy.timeout_ms);

    child.on("error", (error) => {
      clearTimeout(timer);
      const finishedMs = Date.now();
      resolve({
        command: command.command, args, started_at: startedAt, finished_at: new Date(finishedMs).toISOString(),
        duration_ms: finishedMs - startedMs, exit_code: null, status: "error",
        stdout, stderr: stderr || String((error as Error).message), output_truncated: truncated
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const finishedMs = Date.now();
      const status: SandboxExecutionStatus =
        killReason === "timeout" ? "timeout" :
        killReason === "output_cap" ? "ok" :
        code === 0 ? "ok" : "error";
      resolve({
        command: command.command, args, started_at: startedAt, finished_at: new Date(finishedMs).toISOString(),
        duration_ms: finishedMs - startedMs, exit_code: code, status,
        signal: signal ?? undefined, stdout, stderr, output_truncated: truncated
      });
    });
  });
}

/** One-shot convenience: open a session, run a single command, close. */
export async function executeInSandbox(provider: SandboxProvider, command: SandboxCommand, policy: SandboxPolicy): Promise<SandboxExecutionResult> {
  const session = await provider.open(policy);
  try {
    return await session.exec(command);
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Receipts: hash-bound to the Warrant + GEL record, optionally Ed25519-signed
// ---------------------------------------------------------------------------

export function buildSandboxReceipt(
  result: SandboxExecutionResult,
  binding: { provider: string; warrant: Warrant; canonical_action_hash: string; gel_record_id?: string },
  signer?: AristotleSigner
): SandboxExecutionReceipt {
  const base = {
    receipt_id: `rcpt-${sha256(stableStringify({ result, warrant_id: binding.warrant.warrant_id, gel: binding.gel_record_id })).slice(0, 24)}`,
    provider: binding.provider,
    warrant_id: binding.warrant.warrant_id,
    canonical_action_hash: binding.canonical_action_hash,
    gel_record_id: binding.gel_record_id,
    command: result.command,
    args: result.args,
    started_at: result.started_at,
    finished_at: result.finished_at,
    duration_ms: result.duration_ms,
    exit_code: result.exit_code,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    output_truncated: result.output_truncated
  };
  const receipt_hash = sha256(stableStringify(base));
  return {
    ...base,
    receipt_hash,
    ...(signer
      ? { signature: signer.sign(receipt_hash), signature_algorithm: signer.algorithm, signing_key_id: signer.key_id, signing_public_key: signer.public_key_pem }
      : {})
  };
}

export interface SandboxReceiptVerification {
  ok: boolean;
  failures: string[];
}

/** Verify a receipt's integrity, signature, and (optionally) binding to a Warrant. */
export function verifySandboxReceipt(receipt: SandboxExecutionReceipt, options: { warrant?: Warrant; trustedKeyIds?: string[] } = {}): SandboxReceiptVerification {
  const failures: string[] = [];
  const material = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => !RECEIPT_NON_MATERIAL.includes(key as (typeof RECEIPT_NON_MATERIAL)[number]))
  );
  if (receipt.receipt_hash !== sha256(stableStringify(material))) failures.push("receipt hash mismatch");

  if (receipt.signature) {
    if (receipt.signature_algorithm !== "ed25519" || !receipt.signing_public_key || !verifyEd25519(receipt.signing_public_key, receipt.receipt_hash, receipt.signature)) {
      failures.push("receipt signature invalid");
    }
    if (options.trustedKeyIds && receipt.signing_key_id && !options.trustedKeyIds.includes(receipt.signing_key_id)) {
      failures.push("receipt signed by an untrusted key");
    }
  }

  if (options.warrant) {
    if (options.warrant.warrant_id !== receipt.warrant_id) failures.push("receipt warrant id does not match warrant");
    if (options.warrant.canonical_action_hash !== receipt.canonical_action_hash) failures.push("receipt action hash does not match warrant");
  }

  return { ok: failures.length === 0, failures };
}

/** Verify an end-to-end sandbox evidence bundle: Warrant -> receipt -> GEL coherence. */
export function verifySandboxEvidence(evidence: SandboxEvidence, options: { trustedKeyIds?: string[] } = {}): SandboxReceiptVerification {
  const failures: string[] = [];
  const warrantCheck = verifyWarrant(evidence.warrant, evidence.receipt.canonical_action_hash, evidence.warrant.issued_at, { trustedKeyIds: options.trustedKeyIds });
  if (!warrantCheck.ok) failures.push(`warrant verification failed: ${warrantCheck.reason}`);

  const receiptCheck = verifySandboxReceipt(evidence.receipt, { warrant: evidence.warrant, trustedKeyIds: options.trustedKeyIds });
  failures.push(...receiptCheck.failures);

  if (evidence.gel_record.warrant_id && evidence.gel_record.warrant_id !== evidence.warrant.warrant_id) {
    failures.push("GEL record warrant id does not match the bundled Warrant");
  }
  if (evidence.receipt.gel_record_id && evidence.receipt.gel_record_id !== evidence.gel_record.record_id) {
    failures.push("receipt GEL record id does not match the bundled GEL record");
  }
  if (evidence.gel_record.canonical_action_hash !== evidence.receipt.canonical_action_hash) {
    failures.push("GEL record action hash does not match the receipt");
  }
  return { ok: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Orchestrator: gate -> ALLOW + verified Warrant -> sandbox -> signed receipt
// ---------------------------------------------------------------------------

export interface GovernSandboxExecutionInput {
  ward: WardManifest;
  authorityEnvelope: AuthorityEnvelope;
  action: CanonicalActionInput;
  provider: SandboxProvider;
  policy: SandboxPolicy;
  command: SandboxCommand;
  signer?: AristotleSigner;
  ledger?: LedgerStore;
  ledgerPath?: string;
  now?: string;
  runtimeRegister?: RuntimeRegister;
  replayProtection?: boolean;
}

export interface GovernSandboxExecutionResult {
  decision: ExecutionControlDecision;
  reason_codes: ExecutionControlReasonCode[];
  canonical_action_hash: string;
  warrant?: Warrant;
  gel_record: GelRecord;
  receipt?: SandboxExecutionReceipt;
  evidence?: SandboxEvidence;
  error?: string;
}

/**
 * Evaluate an action at the Commit Gate and execute `command` in `provider`'s
 * sandbox ONLY on ALLOW + verified Warrant. REFUSE/ESCALATE never execute. The
 * returned receipt (when present) is signed and hash-bound to the Warrant and GEL
 * record. The signed GEL record is always returned, executed or not.
 */
export async function governSandboxExecution(input: GovernSandboxExecutionInput): Promise<GovernSandboxExecutionResult> {
  const signer = input.signer ?? getDefaultDevSigner();
  const ledger = input.ledger ?? (input.ledgerPath ? undefined : LedgerStore.memory());

  const evaluation = evaluateExecutionControl({
    ward: input.ward,
    authorityEnvelope: input.authorityEnvelope,
    action: input.action,
    runtimeRegister: input.runtimeRegister,
    ledger,
    ledgerPath: input.ledgerPath ?? "unused",
    signer,
    now: input.now,
    replayProtection: input.replayProtection ?? true
  });

  const base = {
    decision: evaluation.decision,
    reason_codes: evaluation.reason_codes,
    canonical_action_hash: evaluation.canonical_action_hash,
    gel_record: evaluation.gel_record
  };

  if (evaluation.decision !== "ALLOW" || !evaluation.warrant) {
    return base; // REFUSE / ESCALATE: never reaches the sandbox.
  }

  // Defense in depth: never execute against an unverifiable Warrant.
  const verification = verifyWarrant(evaluation.warrant, evaluation.canonical_action_hash, input.now);
  if (!verification.ok) {
    return { ...base, warrant: evaluation.warrant, error: `warrant verification failed: ${verification.reason}` };
  }

  const result = await executeInSandbox(input.provider, input.command, input.policy);
  const receipt = buildSandboxReceipt(
    result,
    { provider: input.provider.name, warrant: evaluation.warrant, canonical_action_hash: evaluation.canonical_action_hash, gel_record_id: evaluation.gel_record.record_id },
    signer
  );
  return {
    ...base,
    warrant: evaluation.warrant,
    receipt,
    evidence: { receipt, warrant: evaluation.warrant, gel_record: evaluation.gel_record }
  };
}
