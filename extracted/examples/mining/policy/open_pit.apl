ward "Pilbara West Surface Operations" {
  id ward-mining-pilbara-west
  domain mining-surface-ops
  sovereignty "operator-west-mine-authority"
  version 0.1.0
  subject agent:mine-ops-orchestrator
  envelope ae-mining-operations-001
  issuer "aristotle-mine-ops-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "MINE_OPS"

  allow haulage.dispatch.assign, haulage.move.authorize, haulage.stop, historian.record.write when telemetry.asset_id, telemetry.site_id, telemetry.zone_id, telemetry.proximity_detection_active, telemetry.exclusion_zone_clear, telemetry.ground_control_stable, telemetry.gas_monitoring_active, telemetry.ventilation_on, telemetry.mining_scada_fresh, telemetry.operator_qualified, telemetry.operator_id
  allow blast.initiate, tailings.decant.set, hoist.move.authorize when telemetry.asset_id, telemetry.site_id, telemetry.zone_id, telemetry.exclusion_zone_clear, telemetry.personnel_cleared, telemetry.ground_control_stable, telemetry.gas_monitoring_active, telemetry.mining_scada_fresh, telemetry.operator_qualified, telemetry.operator_id
  deny mining.disable_proximity_detection, mining.disable_gas_monitoring, mining.disable_ventilation, mining.disable_ground_control_monitoring, mining.disable_tailings_monitoring, hoist.disable_overspeed_protection, blast.force_initiate

  within site-pilbara-west
  budget calls <= 300 per 1h
  approve blast.initiate, tailings.decant.set, hoist.move.authorize requires 2 within 10m
}
