# Port Threat Model Addendum

This addendum covers AristotleOS deployments in maritime port and terminal
environments. It is scoped to the AristotleOS execution boundary, not to the full
security architecture of a terminal, vessel, port authority, or customs agency.

## Assets

- Terminal operating system actions
- Gate, OCR, appointment, and access-control decisions
- Crane, yard tractor, and automated equipment command surfaces
- Reefer, weighbridge, shore-power, and berth OT workflows
- VTS/AIS/PNT-derived runtime state
- Customs, security, inspection, booking, and release-order records
- Governance Evidence Ledger records and Port Evidence Bundles
- Authority Envelopes and single-use Warrants

## Threats

- Agent or workflow releases cargo under customs/security hold
- Stale TOS or gate state admits an unsafe release
- Crane move is issued while a human/equipment exclusion zone is not clear
- PNT spoofing or stale AIS state influences berth or vessel movement decisions
- Vendor remote session performs unauthorized OT mutation
- Shore-power energization occurs without lockout/fire-watch evidence
- Hazmat cargo moves without approved route or segregation context
- Edge gate or crane controller continues after disconnected policy revocation
- Insider broadens an Authority Envelope to bypass terminal governance
- GEL evidence is tampered with after a disputed release or incident

## Controls In AristotleOS

- Port Ward defines terminal, berth, yard, gate, cargo, and OT domain.
- Authority Envelope scopes the subject, actions, expiry, dual-control classes,
  and required runtime registers.
- Commit Gate fails closed on missing runtime registers, stale policy, expired
  authority, denied action, physical invariant failure, and classification
  violation.
- Warrant is single-use and bound to the canonical action hash.
- GEL records decision context, runtime snapshot, physical invariant result, and
  Warrant id where applicable.
- Conflict Inbox supports disconnected terminal reconciliation.
- Ward Marshal can discover rogue agents and route quarantine or credential
  revocation through governed interdiction.

## Port-Specific Gaps To Close In A Pilot

- Bind real terminal identity to operator OIDC, SPIFFE/SPIRE, or port IAM.
- Add signed telemetry attestations from TOS, gate, crane, PNT, and OT gateways.
- Connect evidence export to the terminal's incident and compliance records.
- Exercise reconnect storms from edge gates, crane networks, and vessel-side
  handoff links.
- Validate that AristotleOS remains outside vital PLC safety loops while still
  governing autonomous software before command submission.

## Fail-Closed Expectations

In a safety-critical Port Ward, AristotleOS should refuse or escalate when:

- GEL is unavailable
- Authority Envelope is stale or revoked
- runtime register is missing
- PNT/AIS state is stale or below confidence threshold
- customs/security/inspection hold is active
- crane exclusion zone is unclear
- shore-power lockout/fire-watch state is missing
- vendor remote session is active for a forbidden OT action
