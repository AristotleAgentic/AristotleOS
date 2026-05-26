# Aviation / UAV / eVTOL threat model addendum

Scope: an AI agent or autonomy stack proposing flight commands through an AristotleOS
aviation adapter. The Commit Gate is the boundary; nothing reaches the aircraft without a
verified single-use Warrant.

## Assets

- Physical: the aircraft (multirotor / fixed-wing / VTOL / eVTOL), its payload, other
  airspace users, people and property overflown, and the vertiport.
- Governance: the operation's Ward, the RPIC Authority Envelope, issued Warrants, and the
  tamper-evident GEL evidence ledger.

## Primary threats and controls

| # | Threat | Control |
|---|---|---|
| T1 | Flight above the altitude ceiling or over speed | `max_altitude_agl_ft` (400), `max_groundspeed_kts` per command |
| T2 | Geofence / containment defeated | `require_geofence_active`; hard interlock on `uas.disable_geofence` |
| T3 | Mid-air conflict (lost see-and-avoid) | `require_daa_active`; hard interlock on disabling detect-and-avoid |
| T4 | Flight into controlled airspace / active TFR without authorization | `require_airspace_authorization` (LAANC/ATC), `require_no_active_tfr`; hard interlocks on overriding either |
| T5 | Lost C2 link with no contingency | `require_c2_link_healthy`, `require_rtl_available`; hard interlock on overriding the link-loss failsafe |
| T6 | Battery exhaustion before recovery | `min_battery_soc_pct` (RTL reserve) enforced per command |
| T7 | Untracked flight (no Remote ID) | `require_remote_id_broadcasting`; hard interlock on disabling Remote ID |
| T8 | Payload release over people | `max_payload_kg`, `require_ops_over_people_authorized`; payload release is dual-control |
| T9 | eVTOL flight-envelope protection bypass | hard interlock on `evtol.disable_flight_envelope_protection`; vertiport clearance + weather gating |
| T10 | Weather below minimums | `max_wind_speed_kts`, `min_visibility_sm`, `min_ceiling_ft`, `require_weather_within_limits` |
| T11 | Unqualified RPIC / wrong volume | `require_operator_qualified`, `permitted_operation_volumes`/`permitted_airspace_*` |
| T12 | Warrant replay or evidence tampering | single-use Warrant consumed before receipt; signed, hash-chained GEL; offline-verifiable bundle |
| T13 | Infrastructure degraded | `criticality: safety_critical` ⇒ fail-closed (REFUSE) on degradation |

## Operational recommendations (exceeding the minimum)

- Dual control for takeoff, BVLOS/UTM authorization, payload release, and eVTOL vertiport
  clearance; short Warrant TTLs.
- Keep geofence, Remote ID, DAA, C2 health, airspace authorization, no-active-TFR, and RTL
  reserve required on every flight command.
- Set battery RTL reserve above the worst-case return energy for the operation volume.
- Export and archive an Aviation Evidence Bundle (with SORA risk class) for every command
  for Part 107/108/135 recordkeeping and waiver compliance.
