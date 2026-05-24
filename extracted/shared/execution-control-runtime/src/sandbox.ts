import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type AristotleSigner,
  type AristotleTracer,
  type AuthorityEnvelope,
  type CanonicalActionInput,
  type ExecutionControlDecision,
  type ExecutionControlReasonCode,
  type GelRecord,
  type RuntimeRegister,
  type SignatureAlgorithm,
  type TraceContext,
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
 * Three built-in providers, in ascending isolation strength:
 *   - `LocalProcessSandboxProvider` — a *development* provider. It enforces what a
 *     process wrapper can (command allowlist, timeout, output-byte cap, working-dir
 *     isolation, environment allowlist) but is NOT a kernel security boundary; it
 *     does not contain network or filesystem access.
 *   - `ContainerSandboxProvider` — runs the command inside a real OS container via a
 *     detected runtime (Docker/Podman) with `--network=none`, a read-only rootfs,
 *     `--cap-drop=ALL`, `--security-opt=no-new-privileges`, and memory/CPU/PID
 *     limits. This is a genuine namespace + cgroup isolation boundary. Its residual
 *     (shared host kernel) is documented in THREAT_MODEL.md; it is not user-space
 *     theater.
 *   - `WasmSandboxProvider` — runs a WASI module under a capability-based runtime
 *     (wasmtime) that denies filesystem, network, and environment access unless
 *     explicitly granted. For governed plugins/policies compiled to Wasm.
 *
 * Remote managed sandboxes (E2B, Daytona, Modal, Riza) implement the same
 * `SandboxProvider` interface via injected clients in examples/sandboxes/. Deeper
 * host enforcement (eBPF/LSM, gVisor/Kata, seccomp profiles) is explicit roadmap,
 * not implemented here — see THREAT_MODEL.md. We do not claim kernel enforcement we
 * do not have.
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

/** Build the host environment for a sandboxed process from the policy allowlist. */
function sandboxEnv(policy: SandboxPolicy): Record<string, string> {
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
  return env;
}

/** A "command not in allowlist" result, with the logical command echoed back. */
function deniedResult(command: string, args: string[]): SandboxExecutionResult {
  const at = new Date().toISOString();
  return {
    command, args, started_at: at, finished_at: at, duration_ms: 0,
    exit_code: null, status: "denied", stdout: "",
    stderr: `command not in sandbox allowlist: ${command}`, output_truncated: false
  };
}

/** What spawnCaptured runs vs. what it records — the two differ for wrappers (e.g. a
 *  container runtime is the binary, but the receipt records the logical command). */
interface SpawnSpec {
  binary: string;
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  stdin?: string;
  timeout_ms: number;
  max_output_bytes: number;
  reportCommand: string;
  reportArgs: string[];
}

/** The shared spawn core: byte-capped capture, wall-clock timeout, SIGKILL on breach.
 *  No allowlist logic here — providers gate before calling this (defense in depth). */
function spawnCaptured(spec: SpawnSpec): Promise<SandboxExecutionResult> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let killReason: "timeout" | "output_cap" | null = null;
    const cap = spec.max_output_bytes;

    const child = spawn(spec.binary, spec.argv, { cwd: spec.cwd, env: spec.env, shell: false, stdio: ["pipe", "pipe", "pipe"] });

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
    if (spec.stdin !== undefined) child.stdin.write(spec.stdin);
    child.stdin.end();

    const timer = setTimeout(() => { killReason = killReason ?? "timeout"; child.kill("SIGKILL"); }, spec.timeout_ms);

    child.on("error", (error) => {
      clearTimeout(timer);
      const finishedMs = Date.now();
      resolve({
        command: spec.reportCommand, args: spec.reportArgs, started_at: startedAt, finished_at: new Date(finishedMs).toISOString(),
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
        command: spec.reportCommand, args: spec.reportArgs, started_at: startedAt, finished_at: new Date(finishedMs).toISOString(),
        duration_ms: finishedMs - startedMs, exit_code: code, status,
        signal: signal ?? undefined, stdout, stderr, output_truncated: truncated
      });
    });
  });
}

function runLocalProcess(command: SandboxCommand, policy: SandboxPolicy, workingDir: string): Promise<SandboxExecutionResult> {
  const args = command.args ?? [];
  if (!policy.allowed_commands.includes(command.command)) return Promise.resolve(deniedResult(command.command, args));
  return spawnCaptured({
    binary: command.command, argv: args, env: sandboxEnv(policy), cwd: workingDir,
    stdin: command.stdin, timeout_ms: policy.timeout_ms, max_output_bytes: policy.max_output_bytes,
    reportCommand: command.command, reportArgs: args
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
// Container provider — real namespace + cgroup isolation (Docker / Podman)
// ---------------------------------------------------------------------------

export type ContainerRuntime = "docker" | "podman";

export interface ContainerSandboxOptions {
  /** Image the command runs inside. Required (e.g. "node:22-alpine", "python:3.12-slim"). */
  image: string;
  /** Runtime binary; auto-detected (docker, then podman) when omitted. */
  runtime?: ContainerRuntime;
  /** Memory limit, e.g. "256m". Default "256m". */
  memory?: string;
  /** CPU limit, e.g. "1" or "0.5". Default "1". */
  cpus?: string;
  /** Max process count inside the container. Default 128. */
  pidsLimit?: number;
  /** User the command runs as inside the container. Defaults to the host uid:gid on
   *  POSIX (non-root, can write the mounted workspace); omitted on Windows. */
  user?: string;
  /** Path the host working dir is mounted at inside the container. Default "/sandbox". */
  guestDir?: string;
  /** Extra `run` args inserted before the image (escape hatch, e.g. an seccomp profile). */
  extraRunArgs?: string[];
}

/** Detect an available container runtime on PATH (docker, then podman). */
export function detectContainerRuntime(): ContainerRuntime | undefined {
  for (const runtime of ["docker", "podman"] as const) {
    try {
      const probe = spawnSync(runtime, ["--version"], { stdio: "ignore", timeout: 5000 });
      if (!probe.error && probe.status === 0) return runtime;
    } catch { /* not installed; try the next */ }
  }
  return undefined;
}

interface NormalizedContainerOptions {
  image: string;
  memory: string;
  cpus: string;
  pidsLimit: number;
  user?: string;
  guestDir: string;
  extraRunArgs: string[];
}

function normalizeContainerOptions(options: ContainerSandboxOptions): NormalizedContainerOptions {
  const defaultUser = process.platform === "win32"
    ? undefined
    : `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
  return {
    image: options.image,
    memory: options.memory ?? "256m",
    cpus: options.cpus ?? "1",
    pidsLimit: options.pidsLimit ?? 128,
    user: options.user ?? defaultUser,
    guestDir: options.guestDir ?? "/sandbox",
    extraRunArgs: options.extraRunArgs ?? []
  };
}

/**
 * Build the `run` argv for a container runtime. Pure and deterministic so the
 * security-critical flags can be unit-tested without a runtime installed. Network
 * is off (`--network=none`) unless the policy explicitly opts in; the root fs is
 * read-only with a small writable `/tmp` tmpfs; all capabilities are dropped and
 * privilege escalation is blocked; the host working dir is bind-mounted at guestDir.
 */
export function buildContainerRunArgs(options: ContainerSandboxOptions, policy: SandboxPolicy, command: SandboxCommand, hostWorkingDir: string): string[] {
  const opts = normalizeContainerOptions(options);
  const args = [
    "run", "--rm",
    "--network", policy.allow_network ? "bridge" : "none",
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--memory", opts.memory,
    "--cpus", opts.cpus,
    "--pids-limit", String(opts.pidsLimit),
    "--workdir", opts.guestDir,
    "--volume", `${hostWorkingDir}:${opts.guestDir}:rw`
  ];
  if (opts.user) args.push("--user", opts.user);
  // Pass env by name (value inherited from the runtime's own environment) so secret
  // values never appear in the host process argv.
  for (const key of policy.env_allowlist ?? []) args.push("--env", key);
  if (command.stdin !== undefined) args.push("--interactive");
  args.push(...opts.extraRunArgs);
  args.push(opts.image, command.command, ...(command.args ?? []));
  return args;
}

class ContainerSandboxSession implements SandboxSession {
  readonly id = `sbx-${randomUUID().slice(0, 12)}`;
  constructor(
    readonly provider: string,
    private readonly runtime: ContainerRuntime,
    private readonly options: ContainerSandboxOptions,
    readonly workingDir: string,
    private readonly policy: SandboxPolicy,
    private readonly ownsDir: boolean
  ) {}

  exec(command: SandboxCommand): Promise<SandboxExecutionResult> {
    const args = command.args ?? [];
    if (!this.policy.allowed_commands.includes(command.command)) return Promise.resolve(deniedResult(command.command, args));
    const runArgs = buildContainerRunArgs(this.options, this.policy, command, this.workingDir);
    return spawnCaptured({
      binary: this.runtime, argv: runArgs, env: sandboxEnv(this.policy), cwd: this.workingDir,
      stdin: command.stdin, timeout_ms: this.policy.timeout_ms, max_output_bytes: this.policy.max_output_bytes,
      reportCommand: command.command, reportArgs: args
    });
  }

  async close(): Promise<void> {
    if (this.ownsDir) {
      try { rmSync(this.workingDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

export class ContainerSandboxProvider implements SandboxProvider {
  readonly name: string;
  private readonly runtime: ContainerRuntime;

  constructor(private readonly options: ContainerSandboxOptions) {
    if (!options.image) throw new Error("ContainerSandboxProvider requires an image");
    const runtime = options.runtime ?? detectContainerRuntime();
    if (!runtime) throw new Error("no container runtime found on PATH (install docker or podman, or set options.runtime)");
    this.runtime = runtime;
    this.name = `container:${runtime}`;
  }

  async open(policy: SandboxPolicy): Promise<SandboxSession> {
    const ownsDir = !policy.working_dir;
    const workingDir = policy.working_dir ?? mkdtempSync(path.join(tmpdir(), "aos-sbx-"));
    return new ContainerSandboxSession(this.name, this.runtime, this.options, workingDir, policy, ownsDir);
  }
}

// ---------------------------------------------------------------------------
// Wasm provider — capability-based isolation (wasmtime / WASI)
// ---------------------------------------------------------------------------

export interface WasmSandboxOptions {
  /** wasmtime binary path/name. Default "wasmtime". */
  binaryPath?: string;
  /** Guest path the host working dir is preopened at. Default "/sandbox". */
  guestDir?: string;
  /** Preopen the host working dir as a writable guest dir. Default true. When false,
   *  the module gets no filesystem access at all. */
  mountWorkingDir?: boolean;
  /** Extra `run` args inserted before the module (escape hatch). */
  extraRunArgs?: string[];
}

/** Detect wasmtime on PATH (honoring a custom binary path). */
export function detectWasmRuntime(binaryPath = "wasmtime"): boolean {
  try {
    const probe = spawnSync(binaryPath, ["--version"], { stdio: "ignore", timeout: 5000 });
    return !probe.error && probe.status === 0;
  } catch {
    return false;
  }
}

/**
 * Build the wasmtime `run` argv for a WASI module. Pure/deterministic for testing.
 * wasmtime denies filesystem, network, and environment access by default; this grants
 * only what the policy permits: a single preopened working dir, the allowlisted env
 * vars, and network *only* when `allow_network` is set. `command.command` is the path
 * to the `.wasm` module; `command.args` are passed to the module.
 */
export function buildWasmRunArgs(options: WasmSandboxOptions, policy: SandboxPolicy, command: SandboxCommand, hostWorkingDir: string, env: Record<string, string>): string[] {
  const guestDir = options.guestDir ?? "/sandbox";
  const mount = options.mountWorkingDir ?? true;
  const args = ["run"];
  if (policy.allow_network) args.push("-S", "inherit-network");
  if (mount) args.push("--dir", `${hostWorkingDir}::${guestDir}`);
  for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
  args.push(...(options.extraRunArgs ?? []));
  args.push(command.command, ...(command.args ?? []));
  return args;
}

class WasmSandboxSession implements SandboxSession {
  readonly id = `sbx-${randomUUID().slice(0, 12)}`;
  constructor(
    readonly provider: string,
    private readonly binaryPath: string,
    private readonly options: WasmSandboxOptions,
    readonly workingDir: string,
    private readonly policy: SandboxPolicy,
    private readonly ownsDir: boolean
  ) {}

  exec(command: SandboxCommand): Promise<SandboxExecutionResult> {
    const args = command.args ?? [];
    if (!this.policy.allowed_commands.includes(command.command)) return Promise.resolve(deniedResult(command.command, args));
    // Only the allowlisted env is granted to the module (no PATH inheritance).
    const granted: Record<string, string> = {};
    for (const key of this.policy.env_allowlist ?? []) {
      const value = process.env[key];
      if (value !== undefined) granted[key] = value;
    }
    const runArgs = buildWasmRunArgs(this.options, this.policy, command, this.workingDir, granted);
    return spawnCaptured({
      binary: this.binaryPath, argv: runArgs, env: sandboxEnv(this.policy), cwd: this.workingDir,
      stdin: command.stdin, timeout_ms: this.policy.timeout_ms, max_output_bytes: this.policy.max_output_bytes,
      reportCommand: command.command, reportArgs: args
    });
  }

  async close(): Promise<void> {
    if (this.ownsDir) {
      try { rmSync(this.workingDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

export class WasmSandboxProvider implements SandboxProvider {
  readonly name = "wasm:wasmtime";
  private readonly binaryPath: string;

  constructor(private readonly options: WasmSandboxOptions = {}) {
    this.binaryPath = options.binaryPath ?? "wasmtime";
  }

  async open(policy: SandboxPolicy): Promise<SandboxSession> {
    const ownsDir = !policy.working_dir;
    const workingDir = policy.working_dir ?? mkdtempSync(path.join(tmpdir(), "aos-wasm-"));
    return new WasmSandboxSession(this.name, this.binaryPath, this.options, workingDir, policy, ownsDir);
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
  /** W3C trace context stamped into the GEL record. */
  trace_context?: TraceContext;
  /** Optional OpenTelemetry-shaped tracer. */
  tracer?: AristotleTracer;
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
    replayProtection: input.replayProtection ?? true,
    trace_context: input.trace_context,
    tracer: input.tracer
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
