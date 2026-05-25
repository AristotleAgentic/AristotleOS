ward "Transmission Segment Operations West" {
  id ward-pipeline-transmission-segment-west
  domain pipeline-transmission-ops
  sovereignty "operator-west-control-authority"
  version 0.1.0
  subject agent:pipeline-ops-orchestrator
  envelope ae-pipeline-operations-001
  issuer "aristotle-pipeline-ops-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "PIPELINE_OPS"

  allow scada.pump.start, scada.pump.stop, historian.record.write when telemetry.asset_id, telemetry.segment_id, telemetry.system_model_id, telemetry.pressure_psig, telemetry.leak_detection_armed, telemetry.overpressure_protection_active, telemetry.esd_ready, telemetry.pump_primed, telemetry.pipeline_scada_fresh, telemetry.operator_qualified, telemetry.operator_id
  allow scada.compressor.start, valve.isolate.close, pressure.setpoint.set, pressure.relief.set, pig.launch.execute when telemetry.asset_id, telemetry.segment_id, telemetry.system_model_id, telemetry.pressure_psig, telemetry.maop_psig, telemetry.leak_detection_armed, telemetry.overpressure_protection_active, telemetry.esd_ready, telemetry.segment_isolation_ready, telemetry.pipeline_scada_fresh, telemetry.operator_qualified, telemetry.operator_id
  deny pipeline.disable_leak_detection, pipeline.disable_overpressure_protection, pipeline.disable_esd, pipeline.isolation.bypass, pressure.relief.disable, pump.overpressure_override, compressor.safety_shutdown_disable

  within segment-transmission-west
  budget calls <= 200 per 1h
  approve valve.isolate.close, pressure.relief.set, scada.compressor.start, pig.launch.execute requires 2 within 10m
}
