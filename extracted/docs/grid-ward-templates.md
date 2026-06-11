# Grid Ward Templates

The utility sample lives under `examples/grid/`.

## Ward

`ward.transmission_ops.yaml` defines:

- Ward id: `ward-grid-transmission-west`
- sovereignty context: `utility-west-control-authority`
- domain: `electric-grid-transmission-ops`
- criticality: `safety_critical`
- physical bounds:
  - `permitted_boundary_id`
  - `permitted_topology_model_id`
  - permitted voltage classes, asset types, and grid states
  - voltage and frequency bounds
  - feeder, transformer, and DER export caps
  - telemetry age limit
  - required switching order
  - required crew clearance release
  - required known protection state
  - required fresh SCADA
  - required manual fallback readiness

## Authority Envelope

`authority_envelope.switching_operator.yaml` grants scoped authority to
`agent:grid-ops-orchestrator` for:

- `scada.breaker.open`
- `scada.breaker.close`
- `adms.switching-order.execute`
- `derms.dispatch.set`
- `derms.export-cap.set`
- `relay.setting.update`
- `firmware.campaign.stage`
- protocol-bound operations for IEC 61850, DNP3, Modbus, OPC UA, and historian writes

It denies protection bypass actions and requires runtime registers for asset,
boundary, topology, switching order, crew clearance, protection state, SCADA
freshness, manual fallback readiness, and operator identity. Breaker close, relay
setting, firmware campaign, and DER export cap changes require 2-of-N dual control.

## APL policy

`policy/transmission_ops.apl` mirrors the same doctrine in human-readable policy:

- allow routine switching and historian actions with required grid registers
- allow higher-risk relay, firmware, and DER actions only with runtime context
- deny protection bypass actions
- enforce the transmission boundary
- require dual control for the gravest actions

## Sample actions

- `scada_breaker_open.json`: admitted when electrical invariants pass
- `derms_dispatch.json`: admitted under DER export cap
- `relay_setting_update.json`: escalates for dual control without approval state
- `refuse_live_crew_clearance.json`: refused by crew-clearance invariant
- `refuse_disable_protection.json`: refused by denied action and hard interlock
- `refuse_der_export_over_cap.json`: refused by DER export invariant
