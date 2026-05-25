# Vehicle Ward Templates

The automotive sample lives under `examples/automotive/`.

## Ward

`ward.fleet_region_west.yaml` defines:

- Ward id: `ward-av-fleet-west`
- sovereignty context: `av-operator-western-us-safety-ops`
- domain: `autonomous-vehicle-fleet`
- criticality: `safety_critical`
- physical bounds:
  - `permitted_boundary_id`
  - `permitted_odd_id`
  - `permitted_road_classes`
  - `max_speed_mps`
  - map, localization, and perception confidence thresholds
  - `require_mrc_available`
  - permitted drive states

## Authority Envelope

`authority_envelope.fleet_safety_operator.yaml` grants scoped authority to
`agent:fleet-safety-operator` for:

- `fleet.vehicle.hold`
- `fleet.vehicle.return-to-base`
- `ota.campaign.stage`
- `map.update.activate`
- `remote_assist.command`
- `simulation.scenario.run`

It denies safety bypass actions and requires runtime registers for vehicle, ODD,
drive state, confidence, MRC, and safety-case material. OTA, map activation, and
remote-assist commands require 2-of-N dual control.

## APL policy

`policy/fleet_region_west.apl` mirrors the same doctrine in human-readable policy:

- allow routine fleet and simulation actions with required safety registers
- allow OTA, map, and remote-assist only with runtime safety context
- deny safety bypass actions
- enforce the mission boundary
- require dual control for the gravest actions

## Sample actions

- `fleet_vehicle_hold.json`: admitted when safety invariants pass
- `ota_campaign_canary.json`: escalates for dual control without approval state
- `map_update_activate.json`: escalates for dual control
- `remote_assist_pull_over.json`: escalates for dual control
- `refuse_speed_envelope_violation.json`: refused by Vehicle Safety Invariants
- `refuse_disable_safety_envelope.json`: refused by denied action policy
- `simulation_scenario_run.json`: admitted for evidence-producing simulation
