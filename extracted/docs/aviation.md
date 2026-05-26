# Aviation / UAV / eVTOL execution-control path

## What it is

An aviation vertical for AristotleOS that governs **flight-control, UTM authorization,
geofence, payload, detect-and-avoid, C2-link, Remote ID, and vertiport** commands
**before** they reach the aircraft. Adapters translate UTM/USS, autopilot, and ground-
control-station requests into Canonical Governed Actions; the Commit Gate returns
ALLOW / REFUSE / ESCALATE / FAIL-CLOSED and issues a single-use Warrant only when the
authority chain and every flight-safety invariant hold. Adapters must verify the Warrant
before commanding any aircraft.

Built to **meet and exceed** the governing regimes:

| Regime | Requires | How this vertical exceeds it |
|---|---|---|
| 14 CFR Part 107 | ≤400 ft AGL, ≤100 mph, VLOS, daylight, ops-over-people categories | `max_altitude_agl_ft`, `max_groundspeed_kts`, `require_vlos_or_waiver`, ops-over-people gate enforced per command |
| 14 CFR Part 108 / 91 / 135 (BVLOS, powered-lift) | C2 integrity, DAA, contingency | `require_c2_link_healthy`, `require_daa_active`, `require_rtl_available`; BVLOS/takeoff are dual-control |
| 14 CFR Part 89 (Remote ID) | Broadcast identity | Hard interlock on disabling Remote ID; `require_remote_id_broadcasting` |
| LAANC / ATC + TFR/NOTAM | Airspace authorization, no TFR incursion | `require_airspace_authorization`, `require_no_active_tfr`; hard interlock on overriding either |
| ASTM F3548 (UTM) / DAA / SORA | Strategic deconfliction, risk class | UTM adapter + signed evidence with SORA risk class |

## Adapter surfaces

`AVIATION_ADAPTER_CATALOG`: `utm`, `flight-control`, `geofence`, `payload`, `vertiport`,
`detect-and-avoid`, `c2-link`, `remote-id`, `ground-control-station`, `historian-write` —
each with its consequence boundary, required runtime registers, and regulatory basis.

## What it prevents

Hard interlocks (REFUSE even if an envelope mistakenly allows them):
`uas.disable_geofence`, `uas.disable_detect_and_avoid`, `uas.disable_remote_id`,
`uas.override_airspace_authorization`, `uas.disable_return_to_home` / `rtl.disable` /
`failsafe.disable`, `uas.override_c2_link_loss_failsafe`, `uas.enter_active_tfr` /
`tfr.override`, `evtol.disable_flight_envelope_protection`.

Per-command bounds: altitude AGL ceiling, groundspeed, battery state-of-charge (RTL
reserve), wind, visibility, ceiling, payload mass, permitted airspace/class/volume/state,
fresh telemetry, and readiness flags (geofence active, Remote ID broadcasting, DAA active,
C2 link healthy, airspace authorization, no active TFR, VLOS/waiver, RTL available,
weather within limits, vertiport clearance, RPIC certificated).

## How to try it

```bash
npm run test:aviation

# ALLOW: a governed waypoint within the corridor with all safety registers satisfied
npm run aristotle -- execution-control evaluate \
  --ward examples/aviation/ward.bvlos_corridor.yaml \
  --envelope examples/aviation/authority_envelope.rpic.yaml \
  --action examples/aviation/actions/waypoint_flight.json \
  --ledger ./.tmp/aviation.gel.jsonl --now 2026-05-25T15:00:00.000Z

# REFUSE: above the 400 ft AGL ceiling / inside an active TFR / geofence inactive
#   actions/refuse_altitude_ceiling.json, refuse_active_tfr.json, refuse_geofence_inactive.json
```

Takeoff, payload release, eVTOL vertiport clearance, and UTM flight authorization are
dual-control: they ESCALATE until two authorized parties (e.g. RPIC + flight director)
sign, then ALLOW.

## Evidence produced

`exportAviationEvidenceBundle()` wraps the signed execution Evidence Bundle with aviation
context (operator, control station, airspace, operation volume, RPIC, waiver, SORA risk
class, and a `regulatory_evidence_profile` covering Part 107/108/91/135, Remote ID, LAANC,
ASTM F3548 UTM, DAA, SORA). `verifyAviationEvidenceBundle()` re-verifies it offline;
tampering is detected. See [aviation-ward-templates.md](aviation-ward-templates.md) and
[aviation-threat-model.md](aviation-threat-model.md).
