ward "Wildfire Response Swarm West" {
  id ward-swarm-wildfire-west
  domain swarm-disconnected-ops
  sovereignty "incident-command-authority"
  version 0.1.0
  subject agent:swarm-ops-orchestrator
  envelope ae-swarm-operations-001
  issuer "aristotle-swarm-ops-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "SWARM_OPS"

  allow swarm.mission.tick, swarm.hold.safe, mesh.relay.activate, mesh.relay.handover, mesh.revocation.propagate, airspace.authority.compile, flight_warrant.issue, flight_warrant.refresh, flight_warrant.verify, fluidity_token.issue, fluidity_token.refresh, mission.reconstruction.export, mission.reconstruction.verify, historian.record.write when telemetry.swarm_id, telemetry.mission_id, telemetry.flight_state, telemetry.mesh_relay_healthy, telemetry.fluidity_token_valid, telemetry.launch_readiness_approved, telemetry.recovery_plan_active, telemetry.airspace_authorization_active, telemetry.geofence_active, telemetry.remote_id_broadcasting, telemetry.daa_active, telemetry.operator_qualified, telemetry.operator_id
  allow swarm.launch.execute, swarm.recover.execute, swarm.payload.release, balloon.launch, balloon.release_stack when telemetry.swarm_id, telemetry.mission_id, telemetry.flight_state, telemetry.mesh_relay_healthy, telemetry.fluidity_token_valid, telemetry.launch_readiness_approved, telemetry.recovery_plan_active, telemetry.airspace_authorization_active, telemetry.geofence_active, telemetry.remote_id_broadcasting, telemetry.daa_active, telemetry.operator_qualified, telemetry.operator_id
  deny swarm.disable_mesh, swarm.bypass_launch_readiness, swarm.override_fluidity_token, swarm.override_lost_link_failsafe, swarm.disable_evidence_ledger, balloon.disable_position_monitor, balloon.override_envelope_protection

  within swarm-wildfire-west-1
  budget calls <= 1200 per 1h
  approve swarm.launch.execute, swarm.recover.execute, swarm.payload.release, balloon.launch, balloon.release_stack requires 2 within 10m
}
