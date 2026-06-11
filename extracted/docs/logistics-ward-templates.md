# Logistics Ward Templates

The starter logistics Ward is:

- `examples/logistics/ward.network_west.yaml`
- `examples/logistics/authority_envelope.dispatch_orchestrator.yaml`
- `examples/logistics/policy/network_west.apl`

## Ward Shape

The Ward binds a freight network, facilities, carrier/driver identities, route
sets, geofences, cargo classes, trailer types, fraud limits, payment limits, HOS
state, ELD freshness, route state, and evidence expectations.

Core fields:

- `ward_id`: `ward-logistics-network-west`
- `sovereignty_context`: `shipper-carrier-broker-network-west`
- `authority_domain`: `trucking-logistics-dispatch`
- `permitted_subjects`: `agent:logistics-dispatch-orchestrator`
- `criticality`: `safety_critical`

## Authority Envelope Shape

The starter Authority Envelope permits dispatch, tender, carrier vetting,
ELD/HOS attestation, route changes, WMS/YMS release, fuel advance, accessorial,
cold-chain, hazmat, DVIR, and cross-border actions. It denies hard override
actions including dispatch-over-HOS, ELD disable, carrier override, driver
qualification override, payment force-release, and double-broker override.

Dual-control defaults:

- `broker.load.tender`
- `fuel.advance.authorize`
- `accessorial.approve`
- `payment.carrier.release`
- `hazmat.route.authorize`
- `coldchain.setpoint.update`

## Sample Actions

- `allow_load_dispatch.json`: admitted dispatch under HOS, carrier, route, and cargo bounds
- `refuse_hos_overrun.json`: refused because required drive exceeds remaining HOS
- `refuse_double_broker_risk.json`: refused by risk and double-broker invariants
- `escalate_missing_eld_state.json`: escalates because the ELD freshness register is missing
- `refuse_payment_force_release.json`: force-release path denied before payment consequence

## Pilot Adaptation

For a carrier, broker, shipper, 3PL, or private fleet pilot, replace:

- carrier and driver ids
- facility ids
- route and geofence ids
- cargo classes and trailer types
- fuel/accessorial caps
- risk scoring thresholds
- redaction profile
- dual-control operator groups

Do not weaken hard interlocks. They are designed to prevent standing machine
power over dispatch, payment, carrier qualification, and cargo release.
