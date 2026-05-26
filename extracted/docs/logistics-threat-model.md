# Logistics Threat Model Addendum

This addendum covers autonomous or automated trucking and logistics workflows.

## Scope

In scope:

- TMS dispatch and trip assignment
- carrier tender and acceptance
- ELD/HOS dispatch eligibility
- telematics route and geofence changes
- WMS cargo release and YMS gate/dock moves
- fuel advance and accessorial/payment approval
- cold-chain and hazmat routing decisions
- DVIR and maintenance release
- cross-border/customs workflow triggers

Out of scope:

- replacing certified ELD systems
- replacing carrier safety management
- replacing DOT/FMCSA compliance programs
- replacing dispatchers, drivers, brokers, customs brokers, or maintenance staff
- direct vehicle control without separate safety certification

## Primary Threats

| Threat | AristotleOS Control |
| --- | --- |
| HOS-unsafe dispatch | HOS/ELD runtime registers, minimum remaining drive/duty bounds, hard dispatch-over-HOS interlock |
| Stale or forged ELD/telematics state | freshness bounds, runtime registers, optional telemetry attestation, GEL evidence |
| Double-broker fraud | carrier identity binding, authority/insurance checks, risk score bounds, double-broker hard stop |
| Payment/fuel fraud | bounded fuel/accessorial amounts, fraud score bounds, dual control before warrant issuance |
| Unqualified driver/carrier | CDL, medical card, carrier authority, insurance, and endorsement invariants |
| Unsafe hazmat movement | hazmat route, endorsement, cargo class, geofence, and restricted-area checks |
| Cargo theft or unauthorized release | WMS/YMS release gated by seal, appointment, dock, gate, and cargo securement state |
| Cold-chain spoilage | temperature range and cold-chain alarm checks before setpoint or release actions |
| Offline truck divergence | bounded local authority, short warrant TTL, GEL replay, Conflict Inbox reconciliation |
| Rogue logistics agent | Ward Marshal discovery plus warrant-backed credential revocation/quarantine |

## Failure Semantics

- Missing ELD/HOS register: `ESCALATE`
- Expired carrier/driver authority: `REFUSE`
- HOS overrun: `REFUSE`
- Double-broker risk flag: `REFUSE`
- Payment/fuel request without approval store: `ESCALATE`
- Disconnected edge node with stale authority: fail closed when criticality is `safety_critical`
- Replayed dispatch request: `REFUSE` with replay evidence

## Evidence Expectations

Every decision should preserve:

- canonical governed action hash
- Ward and Authority Envelope hashes
- HOS/ELD and telematics snapshot
- carrier/driver/equipment qualification state
- cargo, route, appointment, seal, and temperature context
- fraud/double-broker risk state
- Warrant if admitted
- GEL record and ledger chain material
- redaction manifest for driver/customer/customer-contract fields

## Residual Risk

AristotleOS governs the execution boundary. It still depends on trusted upstream
signals from ELD, telematics, TMS/WMS/YMS, carrier vetting, and payment systems.
For production pilots, bind those signals to signed telemetry, device identity,
or system-of-record attestations where possible.
