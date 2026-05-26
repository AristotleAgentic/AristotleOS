# Space Launch — Ward Templates (DEMONSTRATION ONLY)

Sample Wards + Authority Envelopes for the space launch vertical. None of these are coordinated with FAA AST, the relevant USSF Space Launch Delta, NASA range safety, or counsel. They illustrate the SHAPE of a deployable launch-site governance config; verify before any production use.

## Ward — CCSFS Launch Operations (example)

See [`examples/space/ward.ccsfs_launch_ops.yaml`](../examples/space/ward.ccsfs_launch_ops.yaml).

Key bounds:

- `permitted_launch_sites: [ccsfs, vandenberg, wallops, starbase, kodiak, mojave]`
- `permitted_vehicle_classes: [orbital-launch-vehicle, suborbital-launch-vehicle, reentry-vehicle]`
- `max_surface_wind_kts: 30`, `max_upper_wind_shear_kts_per_kft: 30`, `max_q_kpa: 35`
- `require_range_clear / weather_within_limits / fts_armed / afts_nominal / fts_battery_ok / fts_rf_link_ok / propellant_temp_in_spec / itar_cleared / comms_licensed / hazard_area_cleared / tracking_radar_acquired / range_commander_go`: all true

## Authority Envelope — Launch Orchestrator

See [`examples/space/authority_envelope.launch_orchestrator.yaml`](../examples/space/authority_envelope.launch_orchestrator.yaml).

Dual-control gates these high-consequence actions:

- `space.ignite` — 2 approvers, 10-min TTL
- `space.fts_trigger` — 2 approvers
- `space.payload_deploy` — 2 approvers
- `space.hold_down_release` — 2 approvers

## Per-site bounds derived from `SPACE_JURISDICTION_RULE_PRESETS`

Each site preset (CCSFS, Vandenberg, Wallops, Starbase, Kodiak, Mojave) carries a `rule_version` string and `demonstration_only: true`. A production deployment must:

1. Replace the preset's wind, FTS, ITAR, and Ec limits with values from the range's current safety orders + AST license.
2. Sign the rule pack with the operator's signing key.
3. Coordinate the pack with the range commander and AST licensee.
4. Promote `rule_validation_state` from `"demonstration"` to `"counsel-reviewed"` then `"range-coordinated"` only after the above is complete.
