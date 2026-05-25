# Railroad Threat Model Addendum

This addendum covers the AristotleOS rail execution-control path.

## Scope

In scope:

- autonomous dispatch assistants
- PTC back-office automation
- wayside signal and switch command bridges
- yard automation systems
- crew, consist, and hazmat workflow automation
- maintenance-of-way release and speed restriction automation
- disconnected territory reconciliation

Out of scope:

- replacing PTC
- replacing vital signal logic
- replacing dispatcher operating rules
- certifying onboard or wayside safety systems

## Primary Threats

| Threat | AristotleOS Control |
| --- | --- |
| Unauthorized movement authority | Ward territory binding, subject binding, required dispatcher identity, Warrant issuance only on Commit Gate ALLOW |
| Conflicting train authority | `require_no_conflicting_authority`, GEL record of every refused conflict |
| PTC cut-out or enforcement override | hard physical interlock for `rail.disable_ptc` and `ptc.override.enforcement` |
| Signal clear against unsafe route state | signal aspect bounds, switch proof, dual control for route clear |
| Misaligned or unproven switch | `require_switch_proven` fails closed |
| Work-zone incursion | `require_work_zone_released` and track bulletin acknowledgement |
| Stale PTC / onboard telemetry | `max_ptc_telemetry_age_ms` and `require_ptc_active` |
| Grade crossing exposure | `require_grade_crossing_protected` |
| Hazmat route violation | hazmat routing is dual-controlled and evidence-bundled |
| Host/tenant authority confusion | Ward territory establishes host context; future federation should encode tenant bridge material |
| Rogue rail automation | Ward Marshal should discover unauthorized rail agents and route interdiction through Warrant-backed actions |
| Evidence tampering | hash-linked GEL plus offline-verifiable Rail Evidence Bundle |

## Failure Semantics

- Missing Rail Ward: `REFUSE`
- Missing Authority Envelope: `REFUSE`
- Missing PTC state or dispatcher runtime register: `ESCALATE`
- Stale PTC state: `REFUSE`
- Conflicting authority: `REFUSE`
- PTC disable request: `REFUSE`
- Ledger unavailable in safety-critical Ward: `REFUSE`
- Dual-control store unavailable for route/signal/switch/hazmat: `ESCALATE`
- Disconnected territory replay divergence: route through Conflict Inbox before central commit

## Residual Risk

AristotleOS does not prove the physical world is safe by itself. The rail adapter
must ingest trusted runtime registers from dispatch, PTC, wayside, onboard,
maintenance, and crew systems. Production pilots should add signed telemetry,
device identity, clock discipline, and simulator replay before live authority.
