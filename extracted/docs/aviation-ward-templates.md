# Aviation Ward templates

Each template is a `physical_bounds` profile for a class of aviation operation. All are
`criticality: safety_critical` (fail-closed under degradation). Copy
`examples/aviation/ward.bvlos_corridor.yaml` and adjust.

## Part 107 small UAS (VLOS)

The default daylight, visual-line-of-sight rule set.

```yaml
physical_bounds:
  permitted_asset_types: [multirotor, fixed-wing]
  max_altitude_agl_ft: 400
  max_groundspeed_kts: 87        # 100 mph
  min_battery_soc_pct: 25
  require_geofence_active: true
  require_remote_id_broadcasting: true
  require_vlos_or_waiver: true
  require_airspace_authorization: true   # LAANC in controlled airspace
  require_no_active_tfr: true
  require_rtl_available: true
  require_weather_within_limits: true
  require_operator_qualified: true       # remote pilot certificate
```

## BVLOS corridor (default example)

Adds detect-and-avoid, C2 integrity, and tighter battery reserve; BVLOS authorization is
dual-control.

```yaml
physical_bounds:
  permitted_airspace_classes: [G, E]
  permitted_operation_volumes: [vol-corridor-7]
  max_altitude_agl_ft: 400
  min_battery_soc_pct: 30
  require_daa_active: true                # 14 CFR 91.113 / DAA
  require_c2_link_healthy: true
  require_geofence_active: true
  require_remote_id_broadcasting: true
  require_airspace_authorization: true
  require_no_active_tfr: true
  require_rtl_available: true
# envelope: uas.flight.authorize + flight.takeoff under dual_control
```

## Delivery / ops over people

```yaml
physical_bounds:
  max_payload_kg: 2.5
  require_ops_over_people_authorized: true   # 14 CFR 107 Subpart D
  require_daa_active: true
  require_geofence_active: true
# envelope: payload.release under dual_control
```

## eVTOL passenger / cargo

Powered-lift (Part 135) with vertiport clearance and weather gating.

```yaml
physical_bounds:
  permitted_asset_types: [evtol]
  require_vertiport_clearance: true
  require_weather_within_limits: true
  min_visibility_sm: 3
  min_ceiling_ft: 1000
  require_c2_link_healthy: true
  require_rtl_available: true
  require_operator_qualified: true
# envelope: vertiport.takeoff.clear under dual_control;
#           evtol.disable_flight_envelope_protection is a hard interlock
```

## Sample Authority Envelopes

See `examples/aviation/authority_envelope.rpic.yaml`. Put high-consequence acts
(`flight.takeoff`, `payload.release`, `vertiport.takeoff.clear`, `uas.flight.authorize`)
under `dual_control`, and list every safety-disable action type under `denied_actions`
(they are also hard interlocks at the gate — defense in depth).
