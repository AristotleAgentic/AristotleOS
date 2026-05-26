# Trucking and Logistics Operator Pilot Guide

This guide is for carriers, brokers, shippers, 3PLs, private fleets, and
warehouse/distribution operators piloting AristotleOS around autonomous logistics
execution.

## Pilot Goal

Prove that an AI or automation system can propose logistics actions, but cannot
dispatch a load, tender freight, release cargo, approve fuel/payment, reroute a
truck, or alter cold-chain/hazmat state until authority is resolved and a Warrant
is issued.

## Recommended First Scenario

A dispatch agent attempts to move `LOAD-8821` from `dc-denver` to
`store-salt-lake` with a reefer trailer.

Expected admitted path:

1. Intent: dispatch refrigerated load
2. Ward: `ward-logistics-network-west`
3. Authority Envelope: `ae-logistics-dispatch-001`
4. Runtime registers: HOS, ELD, carrier authority, insurance, route, trailer,
   seal, cargo, temperature, appointment, fraud posture
5. Commit Gate: `ALLOW`
6. Warrant: single-use dispatch warrant
7. Execution: TMS dispatch adapter may proceed
8. Evidence: Logistics Evidence Bundle exported

Expected refusal path:

- Same dispatch but remaining drive time is insufficient.
- Result: `REFUSE`, no Warrant, GEL record committed.

Expected escalation path:

- ELD event age is missing.
- Result: `ESCALATE`, no Warrant, operator review required.

## Quick Commands

```bash
npm run test:logistics
npm run aristotle -- logistics templates
npm run aristotle -- logistics adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/logistics/ward.network_west.yaml \
  --envelope examples/logistics/authority_envelope.dispatch_orchestrator.yaml \
  --action examples/logistics/actions/allow_load_dispatch.json \
  --ledger ./.tmp/logistics.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

## Evidence Export

```bash
npm run aristotle -- logistics evidence export \
  --ward examples/logistics/ward.network_west.yaml \
  --envelope examples/logistics/authority_envelope.dispatch_orchestrator.yaml \
  --ledger ./.tmp/logistics.gel.jsonl \
  --out ./.tmp/logistics-evidence.json \
  --network west-freight-network \
  --ops-center west-dispatch \
  --domain cold-chain \
  --load LOAD-8821 \
  --shipment SHP-5521 \
  --trip TRIP-2026-0525-77 \
  --carrier carrier:clearline \
  --broker broker:atlas \
  --shipper shipper:alpine-foods \
  --driver driver:diaz \
  --tractor TRAC-4482 \
  --trailer TRL-9012 \
  --route route-i70-west-safe \
  --origin dc-denver \
  --destination store-salt-lake \
  --cargo-class reefer \
  --commodity "frozen food" \
  --temperature-controlled \
  --cargo-value 74000 \
  --gross-weight 62100 \
  --redact driver_phone
```

## Pilot Success Criteria

- safe dispatch admits and emits a Warrant
- HOS overrun refuses before TMS dispatch
- missing ELD state escalates before consequence
- payment/fuel/high-risk tender requires dual control
- GEL chain verifies after each decision
- evidence bundle verifies offline
- operator can explain each outcome without reading raw JSON

## Production Notes

Integrate ELD, telematics, carrier vetting, TMS, WMS, YMS, payment, and customs
systems as sources of signed or system-of-record runtime registers. Keep driver,
customer, and contract fields redacted by default in exported evidence bundles.
