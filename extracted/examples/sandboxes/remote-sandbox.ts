// Shared bridge for remote sandbox providers.
//
// AristotleOS decides *whether* execution may occur (Commit Gate -> Warrant); a
// remote sandbox isolates *where* it occurs. A provider only has to implement the
// `SandboxProvider` interface; `governSandboxExecution` does the gate, the Warrant
// verification, and seals the result into a signed, Warrant-bound receipt.
//
// `createRemoteSandboxProvider` turns an injected "run this command remotely"
// function into a provider. It enforces the command allowlist locally (defense in
// depth) before any remote call, so a disallowed binary never leaves the host.
import type {
  SandboxCommand,
  SandboxExecutionResult,
  SandboxPolicy,
  SandboxProvider,
  SandboxSession
} from "@aristotle/execution-control-runtime";

export type RemoteExec = (command: SandboxCommand, policy: SandboxPolicy) => Promise<SandboxExecutionResult>;

export function createRemoteSandboxProvider(name: string, exec: RemoteExec): SandboxProvider {
  return {
    name,
    async open(policy: SandboxPolicy): Promise<SandboxSession> {
      return {
        id: `${name}-${Math.random().toString(36).slice(2, 10)}`,
        provider: name,
        workingDir: policy.working_dir ?? "/sandbox",
        async exec(command: SandboxCommand): Promise<SandboxExecutionResult> {
          const now = new Date().toISOString();
          if (!policy.allowed_commands.includes(command.command)) {
            return {
              command: command.command, args: command.args ?? [], started_at: now, finished_at: now,
              duration_ms: 0, exit_code: null, status: "denied", stdout: "",
              stderr: `command not in sandbox allowlist: ${command.command}`, output_truncated: false
            };
          }
          return exec(command, policy);
        },
        async close() { /* providers that hold a long-lived remote session override this */ }
      };
    }
  };
}

/** Truncate captured output to the policy cap and report whether truncation occurred. */
export function capOutput(stdout: string, stderr: string, maxBytes: number): { stdout: string; stderr: string; output_truncated: boolean } {
  const truncated = Buffer.byteLength(stdout) > maxBytes || Buffer.byteLength(stderr) > maxBytes;
  return {
    stdout: Buffer.from(stdout).subarray(0, maxBytes).toString("utf8"),
    stderr: Buffer.from(stderr).subarray(0, maxBytes).toString("utf8"),
    output_truncated: truncated
  };
}
