// Modal sandbox/job adapter (optional provider pattern).
//
// Imports no Modal SDK — inject a runner that maps to your Modal app/function.
// Modal sandboxes are typically created from an image; the injected runner hides
// that wiring so this file stays SDK-free.
import type { SandboxProvider } from "@aristotle/execution-control-runtime";
import { capOutput, createRemoteSandboxProvider } from "./remote-sandbox.js";

/** Minimal shape this adapter needs from a Modal-backed runner. */
export interface ModalRunner {
  run(input: { argv: string[]; timeoutSeconds: number; allowNetwork: boolean }): Promise<{ returncode: number; stdout: string; stderr: string }>;
}

export function createModalSandboxProvider(runner: ModalRunner): SandboxProvider {
  return createRemoteSandboxProvider("modal", async (command, policy) => {
    const startedMs = Date.now();
    const started_at = new Date(startedMs).toISOString();
    const res = await runner.run({
      argv: [command.command, ...(command.args ?? [])],
      timeoutSeconds: Math.ceil(policy.timeout_ms / 1000),
      allowNetwork: policy.allow_network ?? false
    });
    const finishedMs = Date.now();
    const { stdout, stderr, output_truncated } = capOutput(res.stdout, res.stderr, policy.max_output_bytes);
    return {
      command: command.command, args: command.args ?? [], started_at, finished_at: new Date(finishedMs).toISOString(),
      duration_ms: finishedMs - startedMs, exit_code: res.returncode, status: res.returncode === 0 ? "ok" : "error",
      stdout, stderr, output_truncated
    };
  });
}
