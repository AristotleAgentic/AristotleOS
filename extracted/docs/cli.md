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

## Telecom pilot commands

- `aristotle telecom templates`: list carrier Ward, Authority Envelope, APL, and sample action fixtures
- `aristotle telecom adapters`: list typed TM Forum, NETCONF/YANG, gNMI/gNOI, and O-RAN adapter boundaries
- `aristotle telecom evidence export`: export a telecom Evidence Bundle with change-ticket, NOC, standards, redaction, GEL, and Warrant material
- `aristotle telecom benchmark`: run the carrier-scale Commit Gate / Warrant / GEL benchmark
- `aristotle telecom reconnect-storm`: replay disconnected edge records against current authority and classify conflicts
- `aristotle telecom ha-soak`: simulate multi-region ledger append and verification

Example:

```bash
aristotle telecom benchmark \
  --ward examples/telecom/ward.ran_region_west.yaml \
  --envelope examples/telecom/authority_envelope.noc_change_orchestrator.yaml \
  --count 500
```

## Automotive pilot commands

- `aristotle automotive templates`: list vehicle Ward, Authority Envelope, APL, and sample action fixtures
- `aristotle automotive adapters`: list typed ROS 2/DDS, AUTOSAR Adaptive, OTA, map, remote-assist, fleet, and simulation boundaries
- `aristotle automotive evidence export`: export an Automotive Evidence Bundle with fleet, vehicle, ODD, safety-case, standards, redaction, GEL, and Warrant material

Example:

```bash
aristotle automotive evidence export \
  --ward examples/automotive/ward.fleet_region_west.yaml \
  --envelope examples/automotive/authority_envelope.fleet_safety_operator.yaml \
  --ledger ./.tmp/automotive.gel.jsonl \
  --out ./.tmp/automotive-evidence.json \
  --fleet fleet-west \
  --vehicle AV-1042 \
  --operator operator:fleet-safety-west \
  --scope sf-soma-odd \
  --odd sf-soma-daylight \
  --software AVOS-2026.05.25 \
  --map 2026.05.25 \
  --safety-case SC-AV-WEST-2026-001
```

## Grid pilot commands

- `aristotle grid templates`: list electric-utility Ward, Authority Envelope, APL, and sample action fixtures
- `aristotle grid adapters`: list typed SCADA/EMS/ADMS, IEC 61850, DNP3, Modbus, OPC UA, DERMS, relay-setting, firmware-campaign, and historian boundaries
- `aristotle grid evidence export`: export a Grid Evidence Bundle with utility, control center, topology model, switching order, work order, outage plan, redaction, GEL, and Warrant material

Example:

```bash
aristotle grid evidence export \
  --ward examples/grid/ward.transmission_ops.yaml \
  --envelope examples/grid/authority_envelope.switching_operator.yaml \
  --ledger ./.tmp/grid.gel.jsonl \
  --out ./.tmp/grid-evidence.json \
  --utility northstar-grid \
  --control-center west-transmission-ops \
  --scope west-500kv-corridor \
  --asset breaker-BKR-4421 \
  --operator operator:grid-switching-west \
  --topology topo-west-2026.05.25 \
  --voltage-class 500kV \
  --switching-order SWO-2026-0525-17 \
  --work-order WO-77102 \
  --outage OUT-2026-05-25-A
```

The CLI is intentionally deterministic. It does not call an LLM in the enforcement path.
