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

## Built-in providers

`aristotle sandbox providers` lists all providers and shows which are **available**
on the current host (runtime detected on `PATH`).

| Provider | Isolation | Select |
|----------|-----------|--------|
| `local-process` | process wrapper: allowlist, timeout, output cap, cwd, env allowlist | default |
| `container` | OS container: namespaces + cgroups | `--provider container --image <img>` |
| `wasm` | WASI capability sandbox | `--provider wasm --cmd <module.wasm>` |

### `local-process` (development)

Enforces what a process wrapper can: an exact **command allowlist**, a
**wall-clock timeout**, an **output-byte cap** (truncates + flags), **working-dir
isolation** (fresh temp dir), and an **environment allowlist** (`PATH`, and
`SystemRoot`/`COMSPEC` on Windows, are always included so binaries resolve).

> It is a **development** provider, **not** a kernel security boundary. It does not
> contain network or filesystem access; `allow_network` is advisory here. For
> untrusted code, use the container or wasm provider.

### `container` (real namespace + cgroup isolation)

Runs the command inside a real OS container via a detected runtime (**Docker** or
**Podman**) — a genuine kernel-enforced isolation boundary:

- `--network=none` (no networking) unless the policy sets `allow_network`,
- a **read-only root filesystem** with a small writable `/tmp` tmpfs and the working
  dir bind-mounted at `/sandbox`,
- `--cap-drop=ALL` and `--security-opt=no-new-privileges`,
- **memory / CPU / PID limits** (`--memory`, `--cpus`, `--pids-limit`),
- runs as a **non-root** user (the host uid:gid on POSIX by default).

```bash
aristotle sandbox run \
  --ward ward.yaml --envelope envelope.yaml --action action.json \
  --provider container --image alpine:3.20 \
  --cmd /bin/echo --arg hello --allow /bin/echo \
  --receipt-out receipt.json
```

The command allowlist is still enforced **before** the runtime is invoked (defense
in depth), and the signed receipt records the *logical* command, not the `docker`
wrapper. The exact `run` argv (every isolation flag) is built by the pure,
unit-tested `buildContainerRunArgs`.

> Residual risk: containers share the host **kernel**. For multi-tenant untrusted
> code, layer a stronger boundary (gVisor/Kata, a tuned seccomp profile, or a remote
> micro-VM provider) — see *Roadmap* below and `THREAT_MODEL.md`.

### `wasm` (capability-based WASI isolation)

Runs a **WASI module** (`--cmd module.wasm`) under **wasmtime**, which denies
filesystem, network, and environment access by **default**. The provider grants only
what the policy permits: one preopened working dir, the allowlisted env vars, and
network *only* when `allow_network` is set. Use it to govern plugins/policies
compiled to Wasm. The argv is built by the pure, unit-tested `buildWasmRunArgs`.

## Optional remote providers (no SDK dependency)

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

## Roadmap (honest about what is *not* yet enforced)

The following are **not implemented** and are not claimed by any provider above. We
document them as roadmap rather than ship user-space code that pretends to be
kernel enforcement:

- **Stronger kernel isolation** — gVisor / Kata Containers (user-space or VM-isolated
  kernels) as a drop-in `container` runtime, for multi-tenant untrusted workloads.
- **seccomp / LSM profiles** — a curated syscall-filtering profile and AppArmor/SELinux
  policy shipped with the container provider (today you can pass your own via
  `--security-opt`).
- **eBPF runtime attestation** — observing/attesting the actual syscalls a sandboxed
  process makes and binding that evidence into the GEL. This is genuinely
  kernel-level work and is **not** present; the current boundary governs *whether*
  execution may occur and isolates *where*, but does not yet attest *what* it did at
  the syscall level.

See `THREAT_MODEL.md` for how these map to residual risk.
