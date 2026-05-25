# Electric grid threat model addendum

This addendum focuses on power utility and OT deployment. It extends the base
AristotleOS threat model with grid-specific execution risks.

## Assets

- SCADA, EMS, ADMS, DERMS, and substation command channels
- IEC 61850, DNP3, Modbus, and OPC UA OT protocol boundaries
- switching orders, topology models, crew clearances, and outage records
- relay settings, protection packages, and firmware campaigns
- runtime state: voltage, frequency, feeder load, transformer load, DER export,
  telemetry freshness, protection state, manual fallback readiness
- Authority Envelopes, Warrants, GEL records, and Grid Evidence Bundles

## Primary threats

| Threat | Risk | AristotleOS control |
|---|---|---|
| Unauthorized breaker command | Field equipment changes state without approved authority | Ward, Authority Envelope, switching-order register, Warrant verification |
| Energization with active crew clearance | Safety hazard to field personnel | `require_clearance_released` hard invariant |
| Relay setting mistake | Protection package weakens or miscoordinates system protection | dual-control approval, relay-setting version, protection-state invariant |
| Protection disablement | A critical interlock is bypassed | `grid.disable_protection` hard invariant refusal |
| DER export over cap | Distributed resources exceed operational or contractual limits | `max_der_export_mw` physical invariant |
| Stale SCADA telemetry | Action uses obsolete field state | `require_scada_fresh` and `max_telemetry_age_ms` |
| Wrong topology model | Switching order is evaluated against stale or mismatched topology | `permitted_topology_model_id` |
| Disconnected substation divergence | Edge execution differs from central authority after reconnect | Conflict Inbox, GEL replay, evidence bundle reconstruction |

## Fail-closed posture

Grid Wards should normally use `criticality: safety_critical`. Missing authority,
stale telemetry, absent switching order, unknown protection state, missing ledger,
ledger degradation, absent dual-control store, or topology mismatch should block
Warrant issuance.

## Operational recommendations

- Put breaker close, relay setting, firmware campaign, and DER export-cap changes
  under dual control.
- Keep Warrant TTLs short for field commands.
- Require fresh telemetry and topology model binding on every OT action.
- Export Grid Evidence Bundles for switching reviews, incident response, and
  compliance workflows.
- Use Shadow Mode before enforcement, but do not auto-weaken policy.
- Use Conflict Inbox for storm-restoration and disconnected substation replay.
