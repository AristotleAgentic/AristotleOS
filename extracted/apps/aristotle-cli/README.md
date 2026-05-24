# @aristotle/os-cli

Run AI agents behind a governed **execution-control boundary**. Every
consequential action is evaluated at a Commit Gate, receives a single-use
**Ed25519-signed Warrant** only on `ALLOW`, and is recorded in a tamper-evident
**Governance Evidence Ledger** (GEL) you can verify offline.

## Install

```bash
npm install -g @aristotle/os-cli
# or run without installing:
npx @aristotle/os-cli init
```

## Quick start

```bash
aristotle init                          # scaffold a governed project
aristotle keys generate                 # mint a durable Ed25519 signing key
aristotle run -- node aristotle/agent.mjs   # run an agent behind the boundary
aristotle execution-control audit verify --ledger .aristotle/gel.jsonl
```

`aristotle run` boots the boundary on a local port, injects `ARISTOTLE_ENDPOINT`
into your agent's environment, and runs your agent as a governed child process.
Your agent asks the boundary before acting and only proceeds with a verified
Warrant.

## What you get

- **Commit Gate** — `ALLOW` / `REFUSE` / `ESCALATE` with reason codes, evaluated
  before any irreversible action.
- **Signed Warrants** — single-use, short-lived, Ed25519-signed, key-pinnable.
- **Evidence Ledger + Bundles** — hash-chained, signed, offline-verifiable.
- **Ward + Authority Envelope** — declare the protected domain and scoped
  delegated authority in plain YAML.

## Key commands

| Command | Purpose |
|---------|---------|
| `aristotle init` | Scaffold a governed project (Ward, Authority Envelope, agent) |
| `aristotle run -- <cmd>` | Run an agent behind the governed boundary |
| `aristotle keys generate` | Generate an Ed25519 Warrant signing keypair |
| `aristotle kill engage\|release` | Sovereign-halt kill switch |
| `aristotle revoke key\|envelope\|warrant <id>` | Revoke a compromised trust root |
| `aristotle execution-control serve` | Run the boundary as a standalone daemon |
| `aristotle execution-control evaluate` | Evaluate a single action |
| `aristotle execution-control evidence export/verify` | Portable evidence bundles |
| `aristotle execution-control audit verify` | Verify the GEL hash chain |

## Signing

By default a process-stable **ephemeral dev key** signs Warrants (fine for local
development; refused under `NODE_ENV=production`). Generate a durable key and
point the runtime at it:

```bash
aristotle keys generate
export ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH=secrets/warrant-ed25519-private.pem
export ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH=secrets/warrant-ed25519-public.pem
```

The public key and its `key_id` can be shared so anyone can verify your Warrants
and Evidence Bundles offline.

---

This component is independently developed AristotleOS-native software. It is not
affiliated with, certified by, sponsored by, or endorsed by any other runtime
authorization vendor.
