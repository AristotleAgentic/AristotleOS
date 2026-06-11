# @aristotle/os-cli

Run autonomous action behind human authority. AristotleOS evaluates every
consequential action at a governed **execution-control boundary**, issues a
single-use **Ed25519-signed Warrant** only on `ALLOW`, and records the decision
in a tamper-evident **Governance Evidence Ledger** (GEL) you can verify offline.
The same authority model is designed to survive disconnected, intermittent, and
partitioned operation through bounded edge authority and later reconciliation.

## Install

```bash
npm install -g @aristotle/os-cli
# or run without installing:
npx @aristotle/os-cli demo
```

Requires Node.js 18+. The CLI ships as a single ~540 kB ESM bundle with the sample Ward + Authority Envelope fixtures included, so the boundary boots from any directory without further setup.

## 30-second governed-action check

```bash
npm install -g @aristotle/os-cli
aristotle demo
```

The demo runs without a server and verifies the core boundary between autonomous
action and human authority: an allowed action gets a signed Warrant, a denied
action is refused, missing runtime state escalates, the Evidence Bundle verifies
offline, and the GEL hash chain verifies.

For partition/disconnection proof, run the repository reviewer flow from the
workspace root with `pnpm reviewer:verify`; Stage 3 verifies the 40-asset mesh
scenario.

For a local HTTP boundary:

```bash
aristotle execution-control dev          # boots a real Commit Gate on http://127.0.0.1:8181
curl -s http://127.0.0.1:8181/v1/execution-control/audit/verify | jq
# {"ok": true, "count": 0}

# Submit an action and watch the gate evaluate it
aristotle execution-control submit --action ./my-action.json
```

The boundary serves `/v1/execution-control/evaluate`, `/proxy`, `/audit/verify`, `/metrics`, `/approvals`, and the full HTTP surface documented in `@aristotle/os-sdk`.

## Quick start (governed project)

```bash
aristotle init                          # scaffold a governed project
aristotle keys generate                 # mint a durable Ed25519 signing key
aristotle run -- node aristotle/agent.mjs   # run an agent behind the boundary
aristotle execution-control audit verify --ledger .aristotle/gel.jsonl
```

`aristotle run` boots the boundary on a local port, injects `ARISTOTLE_ENDPOINT`
into your agent's environment, and runs your agent as a governed child process.
Your agent asks the boundary before acting and only proceeds when the exact
action has a verified Warrant.

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
| `aristotle preflight` | Check production readiness (signing key, auth, config) |
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
