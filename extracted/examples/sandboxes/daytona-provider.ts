// Daytona workspace adapter (optional provider pattern).
//
// Imports no Daytona SDK — inject a client. Wire it with the real SDK, e.g.:
//   const provider = createDaytonaSandboxProvider({
//     createWorkspace: (o) => daytona.workspaces.create(o)
//   });
import type { SandboxProvider } from "@aristotle/execution-control-runtime";
import { capOutput, createRemoteSandboxProvider } from "./remote-sandbox.js";

/** Minimal shape this adapter needs from the Daytona SDK. */
export interface DaytonaWorkspace {
  process: { exec(cmd: string, opts: { timeout: number }): Promise<{ exitCode: number; result: string; stderr?: string }> };
  delete(): Promise<void>;
}
export interface DaytonaClient {
  createWorkspace(opts: { network: boolean }): Promise<DaytonaWorkspace>;
}

export function createDaytonaSandboxProvider(client: DaytonaClient): SandboxProvider {
  return createRemoteSandboxProvider("daytona", async (command, policy) => {
    const startedMs = Date.now();
    const started_at = new Date(startedMs).toISOString();
    const workspace = await client.createWorkspace({ network: policy.allow_network ?? false });
    try {
      const res = await workspace.process.exec([command.command, ...(command.args ?? [])].join(" "), { timeout: policy.timeout_ms });
      const finishedMs = Date.now();
      const { stdout, stderr, output_truncated } = capOutput(res.result, res.stderr ?? "", policy.max_output_bytes);
      return {
        command: command.command, args: command.args ?? [], started_at, finished_at: new Date(finishedMs).toISOString(),
        duration_ms: finishedMs - startedMs, exit_code: res.exitCode, status: res.exitCode === 0 ? "ok" : "error",
        stdout, stderr, output_truncated
      };
    } finally {
      await workspace.delete();
    }
  });
}
