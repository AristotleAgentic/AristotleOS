# Swarm Ward templates

Each template is a `physical_bounds` profile for a class of swarm operation. All templates
are `criticality: safety_critical`. Copy `examples/swarm/ward.wildfire_swarm.yaml` and
adjust.

## Wildfire / disaster response (default)

Incident-command-driven swarm operating BVLOS in degraded comms; mesh-relay is the normal
operating state, not a corner case.

```yaml
physical_bounds:
  permitted_mission_classes: [wildfire, disaster-response, temporary-comms-mesh]
  permitted_flight_states: [preflight, connected, degraded, mesh-relay, hold-safe, recover, landing, landed]
  min_swarm_size: 3
  max_swarm_size: 12
  max_swarm_radius_m: 1500
  min_unit_separation_m: 10
  max_unit_separation_m: 200
  max_lost_link_seconds: 30
  max_authority_sync_age_ms: 10000
  min_mesh_link_quality: 0.5
  require_mesh_relay_healthy: true
  require_fluidity_token_valid: true
  require_launch_readiness_approved: true
  require_recovery_plan_active: true
```

## Temporary comms-mesh (UAVs *as* the mesh)

Looser separation, larger radius, longer lost-link windows. The mission *is* providing
backhaul, so mesh-relay is steady-state.

```yaml
physical_bounds:
  permitted_mission_classes: [temporary-comms-mesh]
  max_swarm_radius_m: 5000
  max_unit_separation_m: 800
  max_lost_link_seconds: 120
  max_authority_sync_age_ms: 60000
  min_mesh_link_quality: 0.4
```

## Agriculture / range ops

Long loiter, large area, fewer constraints on ops-over-people; tight battery reserve.

```yaml
physical_bounds:
  permitted_mission_classes: [agriculture, range-ops]
  min_swarm_battery_soc_pct: 35
  max_altitude_agl_ft: 400
  require_fluidity_token_valid: true
```

## Infrastructure inspection (BVLOS)

Linear (pipeline/rail/grid) routes. Tighter geofence + airspace authority required.

```yaml
physical_bounds:
  permitted_mission_classes: [infrastructure-inspection]
  require_airspace_authorization: true
  require_no_active_tfr: true
  max_unit_separation_m: 100
```

## Defense perimeter / reconnaissance

Restricted airspace; stricter approval flows; payload release dual-controlled.

```yaml
physical_bounds:
  permitted_mission_classes: [defense-perimeter, reconnaissance]
  max_swarm_size: 8
  require_mesh_relay_healthy: true
  require_fluidity_token_valid: true
```

## High-altitude balloon / mothership (Part 101 — STRESS CASE)

Separate ward — the extreme design case. If the gate can govern this, it can govern
normal operations.

```yaml
physical_bounds:
  permitted_mission_classes: [high-altitude-launch]
  permitted_asset_types: [balloon-mothership]
  require_balloon_position_monitor_active: true   # 14 CFR Part 101
  require_balloon_within_envelope: true
  require_launch_readiness_approved: true
  require_recovery_plan_active: true
```

## Sample Authority Envelopes

See `examples/swarm/authority_envelope.incident_commander.yaml`. Dual-control belongs on
`swarm.launch.execute`, `swarm.recover.execute`, `swarm.payload.release`, `balloon.launch`,
and `balloon.release_stack`. Always list the safety-disable action types under
`denied_actions` (they are also hard interlocks at the gate, so this is defense in depth).
