ward "West Subdivision Rail Operations" {
  id ward-rail-subdivision-west
  domain railroad-dispatch-ptc-wayside-ops
  sovereignty "host-railroad-west-dispatch"
  version 0.1.0
  subject agent:rail-dispatch-orchestrator
  envelope ae-rail-dispatch-001
  issuer "aristotle-rail-ops-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "RAIL_OPS"

  allow rail.movement.authority.issue, ptc.authority.sync, crossing.protection.request, locomotive.command.request, crew.bulletin.ack, consist.route.validate when telemetry.territory_id, telemetry.dispatcher_id, telemetry.movement_authority_id, telemetry.ptc_active, telemetry.switch_position_proven, telemetry.work_zone_released, telemetry.track_bulletin_ack, telemetry.crew_acknowledged, telemetry.brake_test_current, telemetry.consist_hash, telemetry.grade_crossing_protected
  allow rail.route.lineup.authorize, ptc.restriction.update, signal.route.clear, switch.align.request, hazmat.routing.authorize when telemetry.territory_id, telemetry.dispatcher_id, telemetry.ptc_active, telemetry.signal_aspect, telemetry.switch_position_proven, telemetry.conflicting_authority_present
  deny rail.disable_ptc, ptc.override.enforcement, signal.force_clear, switch.force_unlock

  within west-subdivision
  budget calls <= 300 per 1h
  approve rail.route.lineup.authorize, ptc.restriction.update, signal.route.clear, switch.align.request, hazmat.routing.authorize requires 2 within 15m
}
