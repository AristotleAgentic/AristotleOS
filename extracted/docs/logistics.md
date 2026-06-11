# Trucking and Logistics Execution-Control Path

AristotleOS now includes a trucking and logistics execution-control vertical for
fleet dispatch, brokerage, carrier vetting, ELD/HOS, telematics, warehouse
release, yard/dock movement, fuel advances, accessorials, cold chain, hazmat,
DVIR, and cross-border workflows.

The doctrine does not change:

> Authority before consequence. Warrant before execution. Evidence after every decision.

## What It Is

The logistics path turns consequential freight activity into Canonical Governed
Actions. A dispatch agent, broker workflow, TMS automation, yard system, or
payment assistant can propose an action, but the action must pass Ward
resolution, Authority Envelope validation, Logistics Safety Invariant checks,
Commit Gate admission, Warrant issuance, and GEL commit before it reaches a TMS,
ELD/HOS workflow, telematics route change, WMS cargo release, YMS gate/dock
workflow, fuel card, payment system, cold-chain platform, hazmat route, DVIR, or
customs boundary.

AristotleOS does not replace TMS, WMS, YMS, ELD, telematics, payment, customs,
maintenance, or broker/carrier systems. It governs proposed autonomous or
automated actions before those systems receive consequence-bearing commands.

## Adapter Boundaries

The first logistics adapter catalog includes:

- TMS Dispatch: `tms.load.dispatch`, `tms.trip.assign`
- Broker / Carrier Tender: `broker.load.tender`, `carrier.load.accept`
- Carrier and Driver Qualification: `carrier.vetting.approve`, `driver.qualification.attest`
- ELD / Hours-of-Service: `eld.hos.attest`, `hos.dispatch.clear`
- Telematics / Route: `route.reroute.authorize`, `telematics.location.attest`
- WMS Cargo Release: `wms.cargo.release`, `warehouse.shipment.release`
- YMS Dock / Gate: `yms.dock.assign`, `yard.gate.release`
- Fuel Card / Advance: `fuel.advance.authorize`, `fuel.card.limit.set`
- Accessorial / Payment: `accessorial.approve`, `payment.carrier.release`
- Cold Chain: `coldchain.setpoint.update`, `coldchain.alarm.ack`
- Hazmat Routing: `hazmat.route.authorize`, `hazmat.placard.attest`
- Maintenance / DVIR: `dvir.vehicle.release`, `maintenance.hold.release`
- Customs / Cross-Border: `customs.entry.submit`, `crossborder.dispatch.authorize`

## Logistics Safety Invariants

The Commit Gate now understands logistics-specific operational and fraud
invariants. Examples:

- driver HOS and ELD freshness must be proven before dispatch
- required drive time cannot exceed remaining drive time
- carrier authority and insurance must be active
- driver CDL, medical card, and hazmat endorsement must match cargo
- route and geofence must be permitted
- route deviation and telematics age must stay within Ward bounds
- trailer seal, cargo securement, cold-chain state, appointment, dock, and yard
  access must be valid before release/move
- fuel advance, accessorial, fraud, and double-broker risk scores must stay
  inside bounded authority

Hard interlocks refuse even if an Authority Envelope mistakenly allows them:

- `logistics.dispatch_over_hos`
- `eld.disable`
- `carrier.vetting.override`
- `driver.qualification.override`
- `hazmat.route.override`
- `coldchain.temp_alarm.override`
- `pod.force_accept`
- `payment.force_release`
- `fuel.unbounded_advance`
- `yard.force_gate_open`
- `load.double_broker.override`
- `telematics.spoof_override`

## Evidence

Logistics Evidence Bundles wrap the ordinary GEL/Warrant evidence with load
context: load, shipment, trip, carrier, broker, shipper, driver, tractor,
trailer, route, origin/destination, cargo profile, compliance profile, pre-checks,
post-checks, redaction manifest, and retained verification fields.

Run:

```bash
npm run aristotle -- logistics templates
npm run aristotle -- logistics adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/logistics/ward.network_west.yaml \
  --envelope examples/logistics/authority_envelope.dispatch_orchestrator.yaml \
  --action examples/logistics/actions/allow_load_dispatch.json \
  --ledger ./.tmp/logistics.gel.jsonl
```

## What It Prevents

This vertical is designed to stop or escalate:

- dispatching a driver beyond HOS or stale ELD state
- tendering freight to unverified, uninsured, or suspicious carriers
- double-broker and payment-release fraud
- releasing cargo without appointment, seal, securement, or dock/gate state
- changing cold-chain state during temperature alarm uncertainty
- routing hazmat without endorsement or permitted route
- releasing a vehicle with unresolved DVIR or maintenance status
- forcing POD/payment/fuel outcomes without bounded authority

## Developer Use

Developers should use `shared/execution-control-runtime/src/logistics.ts` to
translate logistics intents into Canonical Governed Actions. Real adapters must
verify the returned Warrant before touching TMS, ELD, telematics, WMS, YMS,
payment, cold-chain, hazmat, DVIR, or customs interfaces.
