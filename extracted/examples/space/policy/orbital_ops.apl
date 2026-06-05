# DEMONSTRATION ONLY - sample APL policy for orbital mission operations.
# Space-specific numeric and regulatory invariants live in the typed Ward/Authority YAML and runtime gate.

ward "Aurora Orbital Ops" {
  id ward-space-orbital-ops
  domain space-mission-ops
  sovereignty "licensed-us-commercial-space-operator"
  version 0.1.0
  subject agent:space-mission-controller
  envelope ae-space-mission-controller-001
  issuer "aristotle-space-orbital-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "SPACE_OPS", "EXPORT_CONTROLLED_DEMO"

  require telemetry.asset_id, telemetry.mission_id, telemetry.orbit_regime
  require telemetry.command_window_active, telemetry.ephemeris_fresh
  require telemetry.conjunction_screening_clear, telemetry.rf_authorization_active
  require telemetry.ground_station_authorized, telemetry.operator_console_locked
  require telemetry.safe_mode_available, telemetry.power_margin_positive
  require telemetry.thermal_limits_nominal, telemetry.evidence_path_available

  allow orbit.stationkeeping.burn, orbit.collision_avoidance.burn when telemetry.conjunction_screening_clear
  allow rf.transmit.enable, rf.carrier.plan when telemetry.rf_authorization_active
  allow payload.image.collect, payload.mode.set when telemetry.payload_tasking_authorized
  allow ground_station.contact.schedule, ttc.command.uplink when telemetry.ground_station_authorized
  allow conjunction.assessment.run, space.historian_write when telemetry.evidence_path_available
  allow rpo.approach.execute, deorbit.burn.execute when telemetry.deorbit_plan_approved

  approve rpo.approach.execute, deorbit.burn.execute requires 2 within 10m

  deny space.disable_safe_mode, space.disable_collision_avoidance
  deny space.disable_conjunction_screening, space.rf_transmit_without_authorization
  deny space.force_deorbit_without_approval, space.payload_task_denied_target
  deny space.bypass_export_control, space.disable_evidence
}
