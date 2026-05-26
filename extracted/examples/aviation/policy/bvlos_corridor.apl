ward "BVLOS Corridor Operations NYC" {
  id ward-aviation-bvlos-corridor
  domain aviation-bvlos-ops
  sovereignty "operator-bvlos-authority"
  version 0.1.0
  subject agent:flight-ops-orchestrator
  envelope ae-aviation-operations-001
  issuer "aristotle-aviation-ops-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "AVIATION_OPS"

  allow flight.waypoint.set, flight.hold, flight.land, flight.rtl, daa.maneuver.execute, historian.record.write when telemetry.asset_id, telemetry.airspace_id, telemetry.operation_volume_id, telemetry.altitude_agl_ft, telemetry.battery_soc_pct, telemetry.geofence_active, telemetry.remote_id_broadcasting, telemetry.daa_active, telemetry.c2_link_healthy, telemetry.airspace_authorization_active, telemetry.no_active_tfr, telemetry.rtl_available, telemetry.operator_qualified, telemetry.operator_id
  allow flight.takeoff, payload.release, vertiport.takeoff.clear, uas.flight.authorize when telemetry.asset_id, telemetry.airspace_id, telemetry.operation_volume_id, telemetry.geofence_active, telemetry.remote_id_broadcasting, telemetry.daa_active, telemetry.c2_link_healthy, telemetry.airspace_authorization_active, telemetry.no_active_tfr, telemetry.rtl_available, telemetry.weather_within_limits, telemetry.operator_qualified, telemetry.operator_id
  deny uas.disable_geofence, uas.disable_detect_and_avoid, uas.disable_remote_id, uas.override_airspace_authorization, uas.disable_return_to_home, uas.override_c2_link_loss_failsafe, uas.enter_active_tfr, evtol.disable_flight_envelope_protection

  within airspace-knyc-volume
  budget calls <= 400 per 1h
  approve flight.takeoff, payload.release, vertiport.takeoff.clear, uas.flight.authorize requires 2 within 10m
}
