# DEMONSTRATION ONLY - sample APL policy for CCSFS-style launch operations.
# Operational range constraints live in the typed Ward/Authority YAML and runtime invariants.

ward "CCSFS Launch Ops" {
  id ward-space-launch-ccsfs
  domain space-launch-ops
  sovereignty "licensed-us-commercial-space-operator"
  version 0.1.0
  subject agent:launch-orchestrator
  envelope ae-space-launch-orchestrator-001
  issuer "aristotle-space-launch-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "SPACE_OPS", "DEMONSTRATION_ONLY"

  require telemetry.launch_site, telemetry.vehicle_class, telemetry.launch_window_active
  require telemetry.range_clear, telemetry.weather_within_limits
  require telemetry.fts_armed, telemetry.afts_nominal
  require telemetry.fts_battery_ok, telemetry.fts_rf_link_ok
  require telemetry.propellant_temp_in_spec, telemetry.itar_cleared
  require telemetry.comms_licensed, telemetry.hazard_area_cleared
  require telemetry.tracking_radar_acquired, telemetry.range_commander_go

  allow space.range_clear_declare, space.range_commander_go, space.range_hold when telemetry.range_clear
  allow space.propellant_load, space.propellant_drain, space.propellant_top_off when telemetry.propellant_temp_in_spec
  allow space.igniter_arm, space.ignite, space.abort_ignition when telemetry.launch_window_active
  allow space.fts_arm, space.fts_disarm, space.fts_trigger when telemetry.fts_armed
  allow space.payload_deploy, space.payload_despin, space.payload_separate when telemetry.range_commander_go
  allow space.water_deluge_arm, space.hold_down_release, space.pad_emergency_stop when telemetry.hazard_area_cleared
  allow space.comms_freq_acknowledge, space.weather_constraint_acknowledge when telemetry.comms_licensed
  allow space.historian_write when telemetry.tracking_radar_acquired

  approve space.ignite, space.fts_trigger, space.payload_deploy, space.hold_down_release requires 2 within 10m

  deny space.disable_flight_termination, space.override_range_safety
  deny space.bypass_collision_avoidance, space.ignite_outside_window
  deny space.bypass_wind_limits, space.override_propellant_limits
  deny space.bypass_pad_interlocks, space.payload_deploy_outside_primary
}
