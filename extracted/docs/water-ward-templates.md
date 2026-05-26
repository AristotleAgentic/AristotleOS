# Water Ward Templates

The sample water Ward lives at:

```text
examples/water/ward.drinking_water_plant.yaml
```

The sample Authority Envelope lives at:

```text
examples/water/authority_envelope.water_operator.yaml
```

The sample APL policy lives at:

```text
examples/water/policy/drinking_water_plant.apl
```

## Ward Shape

A water Ward should bind:

- utility id
- water system id
- facility id
- pressure zones
- process areas
- permitted water asset types
- discharge permit ids
- physical/quality limits
- telemetry freshness limits
- operator attribution requirements
- vendor remote-session posture

Example bounds:

```yaml
physical_bounds:
  permitted_water_system_id: west-water-system
  permitted_facility_id: west-treatment-plant
  permitted_pressure_zones:
    - west-zone-a
  permitted_process_areas:
    - filtration
    - disinfection
    - distribution
  max_chlorine_dose_mg_l: 4
  min_chlorine_residual_mg_l: 0.2
  max_turbidity_ntu: 0.3
  min_pressure_psi: 35
  max_pressure_psi: 120
  require_water_scada_fresh: true
  require_backflow_clear: true
  require_disinfection_active: true
  require_operator_identity: true
```

## Authority Envelope Shape

A water Authority Envelope should keep delegated authority narrow:

- subject is the exact agent/operator identity
- allowed actions are only the adapter actions needed for the mission
- hard interlock actions are explicitly denied
- runtime registers name the evidence the Commit Gate must see
- dual-control actions include chemical, PLC, valve, disinfection, and discharge
  changes
- expiration is short enough for the operational window

## Sample Actions

Fixtures:

- `allow_pump_speed_adjust.json`
- `refuse_chlorine_overfeed.json`
- `refuse_backflow_valve.json`
- `escalate_missing_turbidity_state.json`
- `refuse_disable_disinfection.json`

Run:

```bash
npm run aristotle -- water templates
npm run aristotle -- policy check examples/water/policy/drinking_water_plant.apl
npm run test:water
```
