ward "Transmission Operations West" {
  id ward-grid-transmission-west
  domain electric-grid-transmission-ops
  sovereignty "utility-west-control-authority"
  version 0.1.0
  subject agent:grid-ops-orchestrator
  envelope ae-grid-switching-001
  issuer "aristotle-grid-ops-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "BES_OPS"

  allow scada.breaker.open, adms.switching-order.execute, historian.record.write when telemetry.asset_id, telemetry.grid_boundary_id, telemetry.topology_model_id, telemetry.switching_order_id, telemetry.crew_clearance_released, telemetry.protection_state_known, telemetry.scada_fresh, telemetry.manual_fallback_ready, telemetry.operator_id
  allow scada.breaker.close, relay.setting.update, firmware.campaign.stage, derms.dispatch.set, derms.export-cap.set when telemetry.asset_id, telemetry.grid_boundary_id, telemetry.topology_model_id, telemetry.switching_order_id, telemetry.crew_clearance_released, telemetry.protection_state_known, telemetry.scada_fresh, telemetry.manual_fallback_ready, telemetry.operator_id
  deny grid.disable_protection, relay.protection.disable, breaker.force_close_without_clearance, load_shed.blackstart_override

  within transmission-west
  budget calls <= 400 per 1h
  approve scada.breaker.close, relay.setting.update, firmware.campaign.stage, derms.export-cap.set requires 2 within 15m
}
