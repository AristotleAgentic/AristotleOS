# Water Threat Model Addendum

This addendum covers AristotleOS deployments around drinking water,
wastewater, distribution, collection, pump stations, lift stations, treatment
plants, and utility compliance workflows.

## Assets Protected

- treatment-process setpoints
- PLC/RTU writes and remote IO state
- pump start/stop/speed commands
- valve and pressure-zone commands
- chemical feed rates
- UV/disinfection release decisions
- lab/LIMS result publication
- historian and compliance records
- tank/reservoir transfer actions
- wastewater discharge and bypass authorization
- operator attribution and GEL evidence

## Primary Risks

- autonomous optimization bypasses licensed operator review
- stale SCADA or lab data admits a dangerous action
- chemical overfeed or under-disinfection reaches the plant boundary
- valve automation creates backflow or pressure shock
- pump automation drains a tank, runs dry, or exceeds pressure bounds
- wastewater bypass/discharge proceeds outside permit conditions
- vendor remote session issues control commands with employee-like authority
- compliance evidence is incomplete after an autonomous action
- disconnected edge station executes with stale authority

## AristotleOS Controls

- Ward Manifest binds the utility, system, facility, pressure zone, process area,
  and permitted water asset types.
- Authority Envelope restricts subject, action types, expiration, runtime
  registers, and dual-control actions.
- Commit Gate refuses unsafe physical invariants before a Warrant can exist.
- Dual control escalates chemical, PLC, valve, disinfection, and discharge
  actions until plural approval is recorded.
- Warrant proves the exact action hash that was admitted at consequence time.
- GEL records the decision, reason codes, runtime register snapshot, Warrant id,
  and physical invariant result.
- Water Evidence Bundle gives compliance and incident teams a regulator-readable
  export.

## Failure Semantics

- Missing required telemetry: `ESCALATE`, no Warrant.
- Unsafe chemistry, pressure, backflow, disinfection, or bypass condition:
  `REFUSE`, no Warrant.
- Missing approval store for dual-control actions: `ESCALATE`, no Warrant.
- Revoked Authority Envelope: `REFUSE`, no Warrant.
- Ledger unavailable for safety-critical Ward: fail closed through degraded-mode
  policy.
- Disconnected edge execution: local action must stay within cached Ward,
  short-lived Warrant, and later Conflict Inbox reconciliation.

## Engineering Recommendations

- Do not let AristotleOS write directly to plant controls without a Warrant
  verification shim at the final adapter.
- Keep PLC safety logic, interlocks, alarms, and manual emergency procedures in
  place. AristotleOS governs autonomous intent; it does not replace plant safety
  systems.
- Require explicit operator attribution for treatment, chemical, discharge, and
  compliance-impacting actions.
- Treat lab and sensor freshness as hard runtime registers, not dashboard-only
  observability.
- Redact customer, location, and security-sensitive fields in exported evidence,
  while retaining hashes needed for replay.
