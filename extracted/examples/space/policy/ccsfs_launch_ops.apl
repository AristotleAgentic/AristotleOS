# DEMONSTRATION ONLY — Sample APL policy for CCSFS launch operations.
# Not coordinated with USSF SLD-45 or FAA AST. For shape illustration only.

ward "ward-space-launch-ccsfs" {
  authority_domain "space-launch-ops"
  criticality safety_critical
  classification CUI caveats SPACE_OPS, DEMONSTRATION_ONLY

  bounds {
    permitted_launch_sites      [ccsfs, vandenberg, wallops, starbase, kodiak, mojave]
    permitted_vehicle_classes   [orbital-launch-vehicle, suborbital-launch-vehicle, reentry-vehicle]
    max_surface_wind_kts        30
    max_upper_wind_shear_kts_per_kft 30
    max_q_kpa                   35
    require_range_clear         true
    require_weather_within_limits true
    require_fts_armed           true
    require_afts_nominal        true
    require_fts_battery_ok      true
    require_fts_rf_link_ok      true
    require_propellant_temp_in_spec true
    require_itar_cleared        true
    require_comms_licensed      true
    require_hazard_area_cleared true
    require_tracking_radar_acquired true
    require_range_commander_go  true
  }

  envelope "agent:launch-orchestrator" {
    allow space.range_clear_declare, space.range_commander_go, space.range_hold
    allow space.propellant_load, space.propellant_drain, space.propellant_top_off
    allow space.igniter_arm, space.ignite, space.abort_ignition
    allow space.fts_arm, space.fts_disarm, space.fts_trigger
    allow space.payload_deploy, space.payload_despin, space.payload_separate
    allow space.water_deluge_arm, space.hold_down_release, space.pad_emergency_stop
    allow space.comms_freq_acknowledge, space.weather_constraint_acknowledge
    allow space.historian_write

    # Hard interlocks (gate-level; envelope policy is defense-in-depth).
    deny  space.disable_flight_termination
    deny  space.override_range_safety
    deny  space.bypass_collision_avoidance
    deny  space.ignite_outside_window
    deny  space.bypass_wind_limits
    deny  space.override_propellant_limits
    deny  space.bypass_pad_interlocks
    deny  space.payload_deploy_outside_primary

    dual_control [space.ignite, space.fts_trigger, space.payload_deploy, space.hold_down_release] {
      required 2
      ttl_ms   600000
    }
  }
}
