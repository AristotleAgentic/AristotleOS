# AristotleOS CLI

The `aristotle` CLI (`@aristotle/os-cli`) is the developer entry point for
governance-as-code and for running agents behind the execution-control boundary.

## Install

```bash
# Global install
npm install -g @aristotle/os-cli
aristotle pilot            # one-command self-check of the full boundary

# Or run without installing
npx @aristotle/os-cli pilot
```

The published package is a single self-contained bundle (no runtime dependencies);
`aristotle pilot` runs ten boundary checks (signed-Warrant issue/verify, key
pinning, REFUSE/ESCALATE, Evidence Bundle verification, GEL chain) and prints
`PILOT READY` on success.

Maintainers can verify the package is publish-ready (pack contents + a packed
`aristotle pilot` smoke run) with `npm run package:cli:check`.

## Run an agent behind the boundary

```bash
aristotle init                                   # scaffold governance + starter agent
aristotle keys generate                          # durable Ed25519 Warrant signing key
aristotle run -- node aristotle/agent.mjs        # govern the agent's actions
aristotle playground                             # no-install browser playground
aristotle mcp                                    # expose the boundary as an MCP server (stdio)
aristotle preflight                              # production-readiness checks
```

`aristotle run` boots the execution-control boundary, injects `ARISTOTLE_ENDPOINT`,
and wraps your agent process so every consequential action is evaluated at a Commit
Gate and recorded in the Governance Evidence Ledger. Add operator access control
with `--api-key`, `--operator role:token`, or `--oidc-config` (see
[ACCESS_CONTROL.md](ACCESS_CONTROL.md)).

## Governance-as-code commands

- `aristotle init`: creates `governance.aristotle`, starter agent code, README, and `.env.example`
- `aristotle check`: validates Ward, Authority Envelope, Commit Gate, Warrant Policy, and GEL blocks
- `aristotle plan`: compiles the file and previews runtime artifact changes
- `aristotle apply`: persists the local compiled policy hash
- `aristotle demo payments`: evaluates the flagship $8,000 refund scenario
- `aristotle approvals`: lists deferred actions
- `aristotle approve <token>`: approves a deferred action and issues a one-time warrant
- `aristotle deny <token>`: denies a deferred action and commits GEL evidence
- `aristotle audit tail`: shows recent GEL records
- `aristotle replay`: replays the payments scenario against the current policy
- `aristotle explain --last-deny`: explains the last denied action class
- `aristotle doctor`: checks local developer posture

## Execution-control & operator commands

- `aristotle pilot`: one-command self-check of the full boundary
- `aristotle keys generate`: generate an Ed25519 Warrant signing keypair
- `aristotle kill engage|release`: engage/release the sovereign-halt kill switch
- `aristotle revoke key|envelope|warrant <id>`: revoke a compromised trust root
- `aristotle preflight`: production-readiness checks (signing key, auth, config)
- `aristotle execution-control serve|submit|evaluate`: run/drive the boundary directly
- `aristotle execution-control audit verify`: verify the GEL hash chain
- `aristotle execution-control evidence export|verify`: export/verify offline Evidence Bundles

The CLI is intentionally deterministic. It does not call an LLM in the enforcement path.
