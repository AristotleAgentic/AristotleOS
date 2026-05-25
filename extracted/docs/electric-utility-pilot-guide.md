# Electric Utility Pilot Guide

This guide describes a narrow, defensible pilot for a power utility or grid
operator.

## Pilot objective

Prove that AristotleOS can govern consequential grid actions before execution:

- SCADA breaker open
- DERMS dispatch
- relay setting update
- refusal of breaker close with unreleased crew clearance
- refusal of protection disablement
- refusal of DER export above cap
- Grid Evidence Bundle export

## Pilot topology

```text
Grid agent or automation
-> AristotleOS execution-control boundary
-> Commit Gate + Grid Electrical Invariants
-> Warrant verifier
-> OT adapter boundary
-> GEL + Grid Evidence Bundle
```

The first pilot should run against a simulator, lab substation, or OT mock
adapter. The adapter can preserve IEC 61850, DNP3, Modbus, SCADA, DERMS, and relay
interfaces while enforcing Warrant verification before any field command is sent.

## Acceptance gates

1. `scada.breaker.open` receives `ALLOW`, a Warrant, and a GEL record.
2. `refuse_live_crew_clearance.json` receives `REFUSE` with
   `PHYSICAL_INVARIANT_FAILED`.
3. `refuse_disable_protection.json` receives `REFUSE`; no Warrant is issued.
4. `relay.setting.update` receives `ESCALATE` without an approval store.
5. `relay.setting.update` receives `ALLOW` only after M-of-N dual control.
6. Grid Evidence Bundle verification returns `ok`.
7. The Grid Control Console shows the workflow from switching mission to Warrant
   to evidence export.

## Commands

```bash
npm run test:grid
npm run aristotle -- grid templates
npm run aristotle -- execution-control evaluate \
  --ward examples/grid/ward.transmission_ops.yaml \
  --envelope examples/grid/authority_envelope.switching_operator.yaml \
  --action examples/grid/actions/scada_breaker_open.json \
  --ledger ./.tmp/grid.gel.jsonl
```

## Evidence package

For a pilot review, export:

- Ward Manifest
- Authority Envelope
- APL policy
- action JSON
- Warrant if admitted
- GEL record and ledger verification
- Grid Evidence Bundle
- Shadow Mode report
- Conflict Inbox report for any disconnected substation or storm-restoration replay

## Production hardening still required

- integrate real IEC 61850, DNP3, Modbus, OPC UA, SCADA/EMS/ADMS, DERMS, and relay clients
- bind asset identity to utility asset inventory and OT network zones
- connect topology model freshness to EMS/ADMS source of truth
- bind operator and switching authority to utility IAM
- test storm-restoration reconnect and substation-edge conflict replay
- run safety and compliance review before live field enforcement
