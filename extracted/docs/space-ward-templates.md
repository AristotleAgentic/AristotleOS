# Space Launch + Orbital Operations - Ward Templates

These are demonstration-only Ward and Authority Envelope examples for the Space vertical. They are not coordinated with FAA AST, the relevant Space Launch Delta, NASA range safety, spectrum counsel, export-control counsel, ground-station operators, spacecraft operators, or mission assurance.

## Launch Ward - CCSFS Launch Operations

See `examples/space/ward.ccsfs_launch_ops.yaml`.

Key bounds:

- `permitted_launch_sites: [ccsfs, vandenberg, wallops, starbase, kodiak, mojave]`
- `permitted_vehicle_classes: [orbital-launch-vehicle, suborbital-launch-vehicle, reentry-vehicle]`
- `max_surface_wind_kts: 30`
- `max_upper_wind_shear_kts_per_kft: 30`
- `max_q_kpa: 35`
- `require_range_clear`, `require_weather_within_limits`, `require_fts_armed`, `require_afts_nominal`, `require_fts_battery_ok`, `require_fts_rf_link_ok`, `require_propellant_temp_in_spec`, `require_itar_cleared`, `require_comms_licensed`, `require_hazard_area_cleared`, `require_tracking_radar_acquired`, and `require_range_commander_go`.

## Launch Authority Envelope

See `examples/space/authority_envelope.launch_orchestrator.yaml`.

Dual-control gates these high-consequence actions:

- `space.ignite`
- `space.fts_trigger`
- `space.payload_deploy`
- `space.hold_down_release`

## Orbital Ward - Mission Operations

See `examples/space/ward.orbital_ops.yaml`.

Key bounds:

- `permitted_space_asset_ids: [sat-aurora-7, gs-pine-gap-demo]`
- `permitted_orbit_regimes: [LEO, MEO, GEO]`
- `permitted_space_mission_classes: [earth-observation, communications, space-domain-awareness, deorbit]`
- `permitted_ground_station_ids: [gs-pine-gap-demo, gs-alaska-demo]`
- `permitted_rf_bands: [S-band, X-band]`
- `permitted_payload_modes: [earth-observation, calibration, safe]`
- `max_delta_v_mps: 1.5`
- `max_burn_duration_s: 120`
- `max_conjunction_probability: 0.0001`
- `min_miss_distance_km: 5`
- `max_ephemeris_age_ms: 120000`
- `max_command_window_age_ms: 60000`
- `require_conjunction_screening_clear`, `require_debris_mitigation_plan`, `require_rf_authorization`, `require_ground_station_authorized`, `require_ephemeris_fresh`, `require_attitude_control_stable`, `require_safe_mode_available`, `require_power_margin_positive`, `require_thermal_limits_nominal`, `require_operator_console_locked`, `require_payload_tasking_authorized`, `require_export_control_clearance`, `require_deorbit_plan_approved`, and `require_collision_avoidance_enabled`.

## Orbital Authority Envelope

See `examples/space/authority_envelope.mission_controller.yaml`.

Dual-control gates these high-consequence actions:

- `rpo.approach.execute`
- `deorbit.burn.execute`

## Promotion Discipline

A production launch rule pack must replace demo wind, FTS, ITAR, Ec, comms, and range values with the current mission/range values, sign the pack with the operator's key, coordinate with the range commander and AST licensee, and promote `rule_validation_state` only after review.

A production orbital rule pack must replace demo RF, ground-station, conjunction, ephemeris, export-control, debris-mitigation, and deorbit values with mission-approved constraints, sign the pack, coordinate with the spacecraft operator and mission assurance, and keep the posture fail-closed until authority is current.
