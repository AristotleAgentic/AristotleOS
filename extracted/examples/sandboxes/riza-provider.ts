// Riza hosted code-interpreter adapter (optional provider pattern).
//
// Imports no Riza SDK — inject a client. Riza runs code (not arbitrary argv), so
// this adapter is suited to interpreter-style actions where the "command" names a
// language runtime and the code arrives via stdin.
import type { SandboxProvider } from "@aristotle/execution-control-runtime";
import { capOutput, createRemoteSandboxProvider } from "./remote-sandbox.js";

/** Minimal shape this adapter needs from the Riza SDK. */
export interface RizaClient {
  execute(input: { language: string; code: string; timeoutMs: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export function createRizaSandboxProvider(client: RizaClient): SandboxProvider {
  return createRemoteSandboxProvider("riza", async (command, policy) => {
    const startedMs = Date.now();
    const started_at = new Date(startedMs).toISOString();
    // Convention: `command` is the language (e.g. "python"), code is passed as stdin.
    const res = await client.execute({ language: command.command, code: command.stdin ?? "", timeoutMs: policy.timeout_ms });
    const finishedMs = Date.now();
    const { stdout, stderr, output_truncated } = capOutput(res.stdout, res.stderr, policy.max_output_bytes);
    return {
      command: command.command, args: command.args ?? [], started_at, finished_at: new Date(finishedMs).toISOString(),
      duration_ms: finishedMs - startedMs, exit_code: res.exitCode, status: res.exitCode === 0 ? "ok" : "error",
      stdout, stderr, output_truncated
    };
  });
}
