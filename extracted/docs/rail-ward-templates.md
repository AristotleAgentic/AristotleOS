# Rail Ward Templates

Rail Wards define the territory where authority is valid.

## Subdivision Ward

Use for PTC-governed mainline dispatch.

Required context:

- host railroad
- subdivision / territory id
- route classes
- track classes
- permitted train types
- PTC required
- switch proof required
- work-zone release required
- dispatcher identity required
- crew acknowledgement required
- no conflicting authority required

Example:

```yaml
ward_id: ward-rail-subdivision-west
name: West Subdivision Rail Operations
sovereignty_context: host-railroad-west-dispatch
authority_domain: railroad-dispatch-ptc-wayside-ops
policy_version: 0.1.0
permitted_subjects:
  - agent:rail-dispatch-orchestrator
physical_bounds:
  permitted_territory_id: west-subdivision
  max_authority_speed_mph: 60
  min_train_separation_m: 1800
  max_ptc_telemetry_age_ms: 5000
  require_ptc_active: true
  require_switch_proven: true
  require_work_zone_released: true
  require_no_conflicting_authority: true
criticality: safety_critical
```

## Terminal / Yard Ward

Use for yard route lining, remote shove authorization, and classification-yard
automation. Lower speed does not mean lower consequence. Require track occupancy,
switch proof, crew acknowledgement, and visibility into cut/consist state.

## Maintenance-of-Way Ward

Use for work-zone establishment, release, and temporary speed restrictions.
Release actions should require dual control and preserve bulletin evidence.

## Hazmat Corridor Ward

Use for route validation and movement authority involving restricted commodities.
Require consist hash, hazmat classes, route class, emergency plan reference, and
dual-control approval before Warrant issuance.

## Host/Tenant Federation

For tenant railroad movements, model the host territory as the Ward and tenant
operating authority as a bridged Authority Envelope. The tenant does not receive
standing machine power over host territory; each consequential action must still
receive a Warrant at the commit boundary.
