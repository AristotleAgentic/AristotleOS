ward "Autonomous Vehicle Fleet West" {
  id ward-av-fleet-west
  domain autonomous-vehicle-fleet
  sovereignty "av-operator-western-us-safety-ops"
  version 0.1.0
  subject agent:fleet-safety-operator
  envelope ae-av-fleet-safety-001
  issuer "aristotle-vehicle-safety-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "VEHICLE_SAFETY"

  allow fleet.vehicle.hold, fleet.vehicle.return-to-base, simulation.scenario.run when telemetry.vehicle_id, telemetry.odd_id, telemetry.mrc_available, telemetry.safety_case_id
  allow ota.campaign.stage, map.update.activate, remote_assist.command when telemetry.vehicle_id, telemetry.odd_id, telemetry.drive_state, telemetry.map_confidence, telemetry.localization_confidence, telemetry.perception_confidence, telemetry.mrc_available, telemetry.safety_case_id
  deny vehicle.disable_safety_envelope, vehicle.override.mrc, vehicle.force_autonomy_outside_odd

  within sf-soma-odd
  budget calls <= 500 per 1h
  approve ota.campaign.stage, map.update.activate, remote_assist.command requires 2 within 15m
}
