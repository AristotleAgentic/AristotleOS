# Electric grid execution-control path

Electric utility operations are consequence-heavy. Breaker operations, relay
setting changes, DER dispatch, firmware campaigns, and restoration commands must
be governed before they reach field equipment. AristotleOS treats each request as
a Canonical Governed Action and admits it only through the Ward, Authority
Envelope, electrical invariant, Commit Gate, Warrant, and GEL path.

## What it is

The grid path adds utility-native adapter surfaces, Ward templates, electrical
physical invariants, and a Grid Evidence Bundle.

The doctrine is unchanged:

- authority before consequence
- Warrant before execution
- evidence after every decision

## Runtime placement

```text
Grid intent
-> Canonical Governed Action
-> Utility Ward
-> Authority Envelope
-> Grid Electrical Invariants
-> Commit Gate
-> Dual-control approval when required
-> single-use Warrant
-> OT adapter execution
-> GEL + Grid Evidence Bundle
```

## Adapter surfaces

`GRID_ADAPTER_CATALOG` describes the current typed boundaries:

| Adapter | Consequence boundary |
|---|---|
| `iec61850` | IEC 61850 control operations and substation automation changes |
| `dnp3` | DNP3 output control and RTU operations |
| `modbus` | register writes that can mutate field device behavior |
| `opc-ua` | OPC UA node writes and method calls |
| `scada-ems-adms` | breaker, switching order, restoration, EMS, and ADMS commands |
| `derms` | DER dispatch, export caps, curtailment, and islanding |
| `relay-settings` | protection setting updates and relay group activation |
| `firmware-campaign` | relay, RTU, IED, and gateway firmware staging or activation |
| `historian-write` | operational annotations and compliance records |

## What it prevents

- breaker operation without a switching order
- energization while crew clearance is not released
- relay setting changes without plural authority
- protection disablement, even if accidentally added to an allowed action list
- DER export above the Ward cap
- field command with stale SCADA telemetry
- field command against the wrong topology model
- execution when manual fallback is not ready

## How to try it

```bash
npm run test:grid
npm run aristotle -- grid templates
npm run aristotle -- grid adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/grid/ward.transmission_ops.yaml \
  --envelope examples/grid/authority_envelope.switching_operator.yaml \
  --action examples/grid/actions/scada_breaker_open.json \
  --ledger ./.tmp/grid.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

Then export a utility evidence bundle:

```bash
npm run aristotle -- grid evidence export \
  --ward examples/grid/ward.transmission_ops.yaml \
  --envelope examples/grid/authority_envelope.switching_operator.yaml \
  --ledger ./.tmp/grid-refuse.gel.jsonl \
  --out ./.tmp/grid-evidence.json \
  --utility utility-west \
  --control-center west-cc \
  --scope transmission-west \
  --asset BRK-230-17 \
  --switching-order SWO-2026-0525-17 \
  --operator operator:grid-west \
  --topology topo-west-2026-05-25 \
  --voltage-class 230kV
```

## Evidence produced

The Grid Evidence Bundle wraps the standard AristotleOS Evidence Bundle with
utility, control-center, asset, topology, switching-order, operator, pre-check,
post-check, NERC/CIP-adjacent evidence profile, and redaction context. It is
offline-verifiable and points back to the exact GEL record and Warrant material
when a Warrant exists.
