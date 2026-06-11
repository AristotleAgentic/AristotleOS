/**
 * AristotleOS reviewer CLI bin entry.
 *
 *   npx @aristotle/reviewer verify         <bundle.json>
 *   npx @aristotle/reviewer verify-warrant <warrant.json> <canonical-action-hash> [--trusted-key <keyid> ...] [--now <iso-timestamp>]
 *   npx @aristotle/reviewer verify-replay  <replay-artifact.json>
 *   npx @aristotle/reviewer help
 *   npx @aristotle/reviewer --version
 *
 * Exit code: 0 on PASS, 1 on FAIL or invalid input, 2 on unknown subcommand.
 *
 * The CLI is a thin layer over a pure `run()` dispatcher in `./index.ts`
 * — that's where the tests live. Keeping main() small (just argv parsing
 * + I/O) lets the bundled bin run with no surprise side effects.
 */

import { run } from "./index.js";

run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd()
}).then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`aristotle-reviewer: uncaught error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
