# Mining threat model addendum

Scope: an AI agent or control application proposing mining field commands through an
AristotleOS mining adapter. The Commit Gate is the boundary; nothing reaches the field
without a verified single-use Warrant.

## Assets

- Physical: autonomous haul trucks, primary/booster ventilation fans, blast initiation
  systems, tailings storage facilities (decant, pumps, piezometers), gas monitors, shaft
  hoists/winders, ground/strata, and the personnel working among them.
- Governance: the site's Ward, the control-room Authority Envelope, issued Warrants, and
  the tamper-evident GEL evidence ledger.

## Primary threats and controls

| # | Threat | Control |
|---|---|---|
| T1 | Haul truck moves with personnel/equipment in the path | `require_proximity_detection` + `require_exclusion_zone_clear` + speed ceiling; hard interlock on disabling proximity detection |
| T2 | Blast initiated before the zone is cleared | `require_personnel_cleared` + `require_exclusion_zone_clear`; `blast.initiate` is dual-control; `blast.force_initiate` is a hard interlock |
| T3 | Operating in an explosive/irrespirable atmosphere | `max_methane_pct` / `max_co_ppm` / `min_oxygen_pct`, `require_gas_monitoring`, `require_ventilation_on`; hard interlock on disabling gas monitoring or ventilation |
| T4 | Ground/strata failure | `require_ground_control_stable`; hard interlock on disabling ground-control monitoring |
| T5 | Tailings dam overtopping / instability | `max_tailings_pond_level_m`, `min_tailings_freeboard_m`, `require_piezometer_monitoring`; decant is dual-control; hard interlock on disabling tailings monitoring |
| T6 | Hoist overspeed / overload | `max_hoist_load_kg`, `require_overspeed_protection`; hoist movement is dual-control |
| T7 | Acting on stale/forged SCADA | `max_telemetry_age_ms` + `require_mining_scada_fresh` |
| T8 | Unqualified operator performs a covered task | `require_operator_qualified` (MSHA training/task certification) |
| T9 | Wrong site / zone / state | `permitted_mine_site_id` / `permitted_mine_zones` / `permitted_mine_states` mismatch → REFUSE |
| T10 | Warrant replay or evidence tampering | Single-use Warrant consumed before receipt; signed, hash-chained GEL; offline-verifiable bundle |
| T11 | Infrastructure degraded | `criticality: safety_critical` ⇒ fail-closed (REFUSE) on degradation |

## Operational recommendations (exceeding the minimum)

- Dual control for blast initiation, tailings decant, and hoist movement; short Warrant TTLs.
- Keep proximity detection, exclusion-zone-clear, gas monitoring, and ventilation required
  on every governed actuation at the site.
- Treat HCA-adjacent or high-ground-hazard zones with stricter bounds (lower speed, tighter freeboard).
- Export and archive a Mining Evidence Bundle for every consequential command for MSHA /
  ICMM recordkeeping.
