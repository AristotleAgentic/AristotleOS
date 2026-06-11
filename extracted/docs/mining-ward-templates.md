# Mining Ward templates

Each template is a `physical_bounds` profile for a class of mining operation. All are
`criticality: safety_critical` (fail-closed under degradation). Copy
`examples/mining/ward.open_pit.yaml` and adjust.

## Surface / open-pit autonomous haulage (default example)

AHS movement governed by ISO 17757 exclusion zones and a speed ceiling.

```yaml
physical_bounds:
  permitted_mine_site_id: site-pilbara-west
  permitted_mine_zones: [haul-road-a, pit-3-bench-12, rom-pad]
  permitted_asset_types: [haul-truck, fan, blast-controller, gas-sensor]
  permitted_mine_states: [normal, maintenance, blasting]
  max_haulage_speed_kph: 50
  max_methane_pct: 1.0
  min_oxygen_pct: 19.5
  require_proximity_detection: true       # 30 CFR 75.1732 / ISO 17757
  require_exclusion_zone_clear: true
  require_personnel_cleared: true
  require_ground_control_stable: true
  require_gas_monitoring: true
  require_ventilation_on: true
  require_mining_scada_fresh: true
  require_operator_qualified: true        # MSHA Part 48/46 training
```

## Underground coal

Methane action levels (30 CFR 75.323) and ventilation are the load-bearing bounds.

```yaml
physical_bounds:
  permitted_asset_types: [fan, continuous-miner, gas-sensor]
  max_methane_pct: 1.0
  max_co_ppm: 35
  min_oxygen_pct: 19.5
  min_airflow_cfm: 9000
  require_ventilation_on: true
  require_gas_monitoring: true
  require_ground_control_stable: true
  require_proximity_detection: true       # continuous mining machines
  require_operator_qualified: true
```

## Blasting

Add personnel and exclusion-zone clearance; make blast initiation dual-control.

```yaml
physical_bounds:
  permitted_mine_states: [blasting]
  require_exclusion_zone_clear: true
  require_personnel_cleared: true
  require_ground_control_stable: true
  require_operator_qualified: true
# envelope: put blast.initiate under dual_control; blast.force_initiate is a hard interlock
```

## Tailings storage facility (TSF)

ICMM GISTM surveillance: pond level, freeboard, and piezometer monitoring.

```yaml
physical_bounds:
  permitted_asset_types: [tailings-pump]
  max_tailings_pond_level_m: 3.0
  min_tailings_freeboard_m: 1.0
  require_piezometer_monitoring: true
  require_mining_scada_fresh: true
  require_operator_qualified: true
# envelope: tailings.decant.set under dual_control
```

## Shaft hoisting

```yaml
physical_bounds:
  permitted_asset_types: [hoist]
  max_hoist_load_kg: 12000
  require_overspeed_protection: true
  require_ground_control_stable: true
  require_operator_qualified: true
# envelope: hoist.move.authorize under dual_control
```

## Sample Authority Envelopes

See `examples/mining/authority_envelope.control_room.yaml`. Put high-consequence acts
(`blast.initiate`, `tailings.decant.set`, `hoist.move.authorize`) under `dual_control`,
and list every safety-disable action type under `denied_actions` (they are also hard
interlocks at the gate — defense in depth).
