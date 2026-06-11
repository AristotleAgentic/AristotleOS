// E2B sandbox adapter (optional provider pattern).
//
// This file imports NO E2B SDK — you inject a client, so AristotleOS has no hard
// dependency on E2B. Wire it with the real SDK:
//
//   import { Sandbox } from "@e2b/code-interpreter";
//   const provider = createE2bSandboxProvider({ create: (o) => Sandbox.create(o) });
//   await governSandboxExecution({ ...gateInputs, provider, policy, command });
import type { SandboxProvider } from "@aristotle/execution-control-runtime";
import { capOutput, createRemoteSandboxProvider } from "./remote-sandbox.js";

/** Minimal shape this adapter needs from the E2B SDK. */
export interface E2bSandboxHandle {
  commands: { run(cmd: string, opts: { timeoutMs: number }): Promise<{ exitCode: number; stdout: string; stderr: string }> };
  kill(): Promise<void>;
}
export interface E2bSandboxClient {
  create(opts: { timeoutMs: number }): Promise<E2bSandboxHandle>;
}

export function createE2bSandboxProvider(client: E2bSandboxClient): SandboxProvider {
  return createRemoteSandboxProvider("e2b", async (command, policy) => {
    const startedMs = Date.now();
    const started_at = new Date(startedMs).toISOString();
    const handle = await client.create({ timeoutMs: policy.timeout_ms });
    try {
      const res = await handle.commands.run([command.command, ...(command.args ?? [])].join(" "), { timeoutMs: policy.timeout_ms });
      const finishedMs = Date.now();
      const { stdout, stderr, output_truncated } = capOutput(res.stdout, res.stderr, policy.max_output_bytes);
      return {
        command: command.command, args: command.args ?? [], started_at, finished_at: new Date(finishedMs).toISOString(),
        duration_ms: finishedMs - startedMs, exit_code: res.exitCode, status: res.exitCode === 0 ? "ok" : "error",
        stdout, stderr, output_truncated
      };
    } finally {
      await handle.kill();
    }
  });
}
