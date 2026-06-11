# Pipeline threat model addendum

Scope: an AI agent or control application proposing pipeline field commands through an
AristotleOS pipeline adapter. The Commit Gate is the boundary; nothing reaches the field
without a verified single-use Warrant.

## Assets

- Physical: mainline pumps, compressors, block/control/ESD valves, regulators, pressure
  relief, leak-detection (CPM) systems, pig launchers/receivers, the line itself and any
  High Consequence Areas (HCAs) along it.
- Governance: the segment's Ward, the operations-center Authority Envelope, issued
  Warrants, and the tamper-evident GEL evidence ledger.

## Primary threats and controls

| # | Threat | Control |
|---|---|---|
| T1 | Command drives pressure above MAOP | `max_pressure_psig` / `max_pressure_pct_maop` per-command ceiling (checks setpoint too); REFUSE |
| T2 | Safety system disabled (CPM, overpressure, ESD, isolation, relief) | Hard interlocks — REFUSE even if the envelope allows it; no Warrant issued |
| T3 | Acting on stale/forged SCADA | `max_telemetry_age_ms` + `require_pipeline_scada_fresh`; CRM-aligned freshness gate |
| T4 | Unqualified operator performs a covered task | `require_operator_qualified` attestation; REFUSE |
| T5 | Wrong segment / system model / operating state | `permitted_segment_id` / `permitted_system_model_id` / `permitted_pipeline_states` mismatch → REFUSE |
| T6 | Isolation/relief/compressor/pig executed unilaterally | `dual_control` — two qualified approvers required; ESCALATE then ALLOW |
| T7 | Warrant replay or artifact tampering | Single-use Warrant consumed before receipt; signed, hash-chained GEL; offline-verifiable evidence |
| T8 | Infrastructure degraded (ledger/SCADA/control-plane) | `criticality: safety_critical` ⇒ fail-closed (REFUSE) on degradation |
| T9 | Repudiation / audit gap (PHMSA records) | Every decision (ALLOW/REFUSE/ESCALATE/FAIL-CLOSED) is a signed GEL record + Evidence Bundle |

## Fail-closed posture

Pipeline Wards should be `safety_critical`. Under any unresolved degradation signal
(ledger unavailable, control-plane stale, dependency timeout) the gate REFUSES rather
than admitting an ungoverned field command.

## Operational recommendations (exceeding the minimum)

- Keep Warrant TTLs short (minutes) for actuating commands.
- Require dual control for valve isolation, pressure-relief setpoints, compressor starts,
  and pig launches.
- Keep `require_leak_detection_armed`, `require_overpressure_protection`,
  `require_esd_ready`, and `require_pipeline_scada_fresh` on for all transmission Wards.
- Treat HCA segments with stricter pressure margins (set `max_pressure_pct_maop` below 100).
- Export and archive a Pipeline Evidence Bundle for every consequential command for
  PHMSA/API 1173 recordkeeping.
