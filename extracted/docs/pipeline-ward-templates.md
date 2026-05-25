# Pipeline Ward templates

Each template is a `physical_bounds` profile for a class of pipeline operation. All
templates are `criticality: safety_critical` (fail-closed under infrastructure
degradation). Copy `examples/pipeline/ward.transmission_segment.yaml` and adjust.

## Hazardous-liquid transmission (default example)

Long-distance trunk lines. High MAOP, fresh-SCADA and CPM mandatory, dual control for
isolation/relief/compressor/pig acts.

```yaml
physical_bounds:
  permitted_segment_id: segment-transmission-west
  permitted_system_model_id: model-west-2026-05-25
  permitted_asset_types: [pump, valve, pressure-monitor, regulator]
  permitted_pipeline_states: [normal, maintenance, startup]
  max_pressure_psig: 1200          # MAOP ceiling (49 CFR 195.406)
  max_pressure_pct_maop: 100
  min_pressure_psig: 150
  max_flow_bbl_per_day: 50000
  max_telemetry_age_ms: 5000       # Control Room Management (195.446)
  require_leak_detection_armed: true   # CPM (195.444 / API RP 1175)
  require_overpressure_protection: true
  require_esd_ready: true
  require_segment_isolation_ready: true
  require_pump_primed: true
  require_pipeline_scada_fresh: true
  require_operator_qualified: true     # OQ (195.501)
```

## Gas transmission

Use MAOP per 49 CFR 192.619 and gas flow in MMSCFD.

```yaml
physical_bounds:
  permitted_asset_types: [compressor, valve, regulator, pressure-monitor]
  max_pressure_psig: 1000
  max_pressure_pct_maop: 100
  max_flow_mmscfd: 600
  require_overpressure_protection: true
  require_esd_ready: true
  require_pipeline_scada_fresh: true
  require_operator_qualified: true
```

## Gas distribution

Lower pressure; emphasize overpressure protection (192.195/192.201) and CRM.

```yaml
physical_bounds:
  permitted_asset_types: [regulator, valve, pressure-monitor]
  max_pressure_psig: 60
  require_overpressure_protection: true
  require_pipeline_scada_fresh: true
  require_operator_qualified: true
```

## Gathering

Field collection networks; tighter telemetry freshness, isolation readiness for digs.

```yaml
physical_bounds:
  permitted_pipeline_states: [normal, maintenance, integrity-dig]
  max_pressure_psig: 1440
  require_segment_isolation_ready: true
  require_leak_detection_armed: true
  require_pipeline_scada_fresh: true
```

## Compressor / pump station

Station-scoped; ESD readiness and discharge-pressure ceiling are the load-bearing bounds.

```yaml
physical_bounds:
  permitted_asset_types: [compressor, pump, valve]
  max_pressure_psig: 1200
  require_esd_ready: true
  require_pump_primed: true
  require_pipeline_scada_fresh: true
  require_operator_qualified: true
```

## Sample Authority Envelopes

See `examples/pipeline/authority_envelope.operations_center.yaml`. Put high-consequence
actions (`valve.isolate.close`, `pressure.relief.set`, `scada.compressor.start`,
`pig.launch.execute`) under `dual_control`, and always list the safety-disable action
types under `denied_actions` (they are also hard interlocks at the gate, so this is
defense in depth).
