# Sandbox execution

**AristotleOS decides *whether* execution may occur. A sandbox isolates *where* it
occurs.** The two compose: code runs in a sandbox only after the Commit Gate
returns `ALLOW` and a single-use Warrant is verified, and the result is sealed into
a signed **Execution Receipt** that is hash-bound to the Warrant and the GEL record.

```
intent → Canonical Governed Action → Commit Gate
       → ALLOW + signed Warrant        (REFUSE / ESCALATE stop here — nothing runs)
       → verify Warrant → sandbox execution
       → signed Execution Receipt (bound to Warrant + GEL record)
       → Governance Evidence Ledger / Evidence Bundle → replay / audit
```

## Quick start (built-in local provider)

```bash
aristotle sandbox providers
aristotle sandbox run \
  --ward ward.yaml --envelope envelope.yaml --action action.json \
  --cmd /usr/bin/node --arg -e --arg "console.log('built')" \
  --allow /usr/bin/node --timeout 30000 --max-output 1000000 \
  --receipt-out receipt.json
aristotle sandbox receipt verify --receipt receipt.json
```

`sandbox run` evaluates the action at the Commit Gate and runs the command **only
on `ALLOW`**. On `REFUSE`/`ESCALATE` it prints the decision and the GEL record and
exits non-zero without executing anything.

## The interface

| Type | Role |
|------|------|
| `SandboxPolicy` | allowlist, timeout, output cap, env allowlist, working dir, network flag |
| `SandboxProvider` | `open(policy) → SandboxSession` |
| `SandboxSession` | `exec(command) → SandboxExecutionResult`, `close()` |
| `SandboxExecutionReceipt` | signed, bound to `warrant_id` + `canonical_action_hash` + `gel_record_id` |
| `SandboxEvidence` | `{ receipt, warrant, gel_record }` — verifiable end to end |

Orchestrate with `governSandboxExecution({ ward, authorityEnvelope, action,
provider, policy, command, signer, ledger })`. Verify receipts offline with
`verifySandboxReceipt(receipt, { warrant })` and bundles with
`verifySandboxEvidence(evidence)`.

## `LocalProcessSandboxProvider` (built-in)

Enforces what a process wrapper can: an exact **command allowlist**, a
**wall-clock timeout**, an **output-byte cap** (truncates + flags), **working-dir
isolation** (fresh temp dir), and an **environment allowlist** (`PATH`, and
`SystemRoot`/`COMSPEC` on Windows, are always included so binaries resolve).

> It is a **development** provider, **not** a kernel security boundary. It does not
> enforce network or filesystem isolation; `allow_network` is advisory here. For
> untrusted code, use a real isolating provider below.

## Optional providers (no SDK dependency)

`examples/sandboxes/` ships adapters that implement `SandboxProvider` via an
**injected client** — AristotleOS imports no third-party SDK:

| Provider | File | Inject |
|----------|------|--------|
| E2B | `e2b-provider.ts` | `createE2bSandboxProvider(client)` |
| Daytona | `daytona-provider.ts` | `createDaytonaSandboxProvider(client)` |
| Modal | `modal-provider.ts` | `createModalSandboxProvider(runner)` |
| Riza | `riza-provider.ts` | `createRizaSandboxProvider(client)` |

Each enforces the command allowlist locally before any remote call, then delegates
to the injected client. Example:

```ts
import { Sandbox } from "@e2b/code-interpreter";
import { createE2bSandboxProvider } from "./examples/sandboxes/e2b-provider.js";
import { governSandboxExecution } from "@aristotle/execution-control-runtime";

const provider = createE2bSandboxProvider({ create: (o) => Sandbox.create(o) });
const out = await governSandboxExecution({ ward, authorityEnvelope, action, provider, policy, command, signer });
// out.receipt is signed and bound to out.warrant + out.gel_record
```

Because every provider implements the same interface, the gate, Warrant
verification, and signed-receipt evidence are identical no matter where execution
lands.
