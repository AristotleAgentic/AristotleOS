# Changelog

## v0.1.40 - Aristotle Verified Title Transaction Layer (vehicle title / registration / ELT)
- **Vehicle title transaction governance vertical.** New
  `shared/execution-control-runtime/src/title.ts` governs consequential title, lien,
  registration, and DMV-document actions BEFORE they cross into legal effect.
  Positioned alongside Vitu / CVR / Dealertrack / DDI Technology / Reynolds & Reynolds:
  those platforms move bits to government endpoints; Aristotle proves every action was
  authorized, state-rule compliant, fraud-checked, and audit-ready.
- **`TITLE_ADAPTER_CATALOG`** — 10 typed boundaries: ELT lien, title transaction,
  registration, digital signature, dealer workflow, lender workflow, DMV submission,
  fraud check, NMVTIS, historian.
- **`JURISDICTION_RULE_PRESETS`** for **MT, OR, CA, TX, FL** (SAMPLE / DEMONSTRATION
  ONLY — not legal advice). Each declares ELT support, digital-signature support,
  odometer-disclosure requirement, VIN-inspection requirement, NMVTIS requirement,
  fraud-escalation threshold, identity-confidence floor, permitted transaction types,
  and required forms by transaction type.
- **Gate enforcement:** new `physical_bounds` (jurisdictions/transaction-types/
  organization-kinds, fraud-risk / identity-confidence thresholds, warrant freshness,
  require_* flags for signer/NMVTIS/theft/odometer/identity/envelope/warrant/forms/
  VIN-inspection/ELT/digital-signature/lien-exists/lien-release-authority/dealer-
  license/lender-active/lender-elt-participant) and hard interlocks for bypass-NMVTIS,
  bypass-theft-check, bypass-state-rules, override-dealer-license, override-odometer-
  disclosure, disable-identity-verification, signature-bypass-jurisdiction-acceptance,
  and `warrant.reuse_attempt`.
- **Aligned with (DEMO):** state ELT programs, NMVTIS, 49 CFR Part 580 (odometer),
  ESIGN / UETA, AAMVA DLDV, UCC Article 9, state motor-vehicle codes, state dealer-
  licensing statutes. Signed Title Evidence Bundles (`aristotle.title-evidence.v1`).
- **15/15 title tests** pass — covers all 7 named demo scenarios (clean MT lien
  release ALLOW; unauthorized signer REFUSE; interstate transfer ESCALATE; revoked
  envelope REFUSE; fraud over threshold REFUSE; title correction ESCALATE; suspended
  dealer license REFUSE), 18-condition refuse sweep, hard interlocks,
  `warrant.reuse_attempt`, dual-control escalate->approve, Title Evidence Bundle
  round-trip, and **GEL chain tamper detection**. No regressions across healthcare 6,
  swarm 8, logistics 6, aviation 7, robotics 7, pipeline 6, mining 6, port 6, water 6,
  grid 6, rail 6, gate-property 2, execution-control 75.

## v0.1.38 - UAV-swarm governance for disconnected operations
- **Swarm-first, not high-altitude-first.** New `shared/execution-control-runtime/src/swarm.ts`
  module: intermittent connectivity is not a corner case — delegated authority must
  remain enforceable locally, safety must degrade predictably, and accountability must be
  provable after the fact. High-altitude balloon / mothership (14 CFR Part 101) is the
  EXTREME STRESS CASE.
- **Primitives:** Swarm Authority Envelope, Disconnected Commit Gate, Mesh Revocation
  Protocol, Flight Warrant Service, Fluidity Token (time-bounded degraded-comms
  authority), Airspace Authority Compiler, Launch Readiness Gate, GEL Mission
  Reconstruction. `SWARM_ADAPTER_CATALOG` exposes 10 typed boundaries;
  `nextSwarmFlightState` realizes the disconnected state machine (connected -> degraded
  -> mesh-relay -> hold-safe -> recover -> evidence-sync). Mission classes: wildfire,
  disaster-response, temporary-comms-mesh, agriculture, range-ops,
  infrastructure-inspection, defense-perimeter, reconnaissance, high-altitude-launch.
- **Gate enforcement:** new `physical_bounds` (swarm size/radius/separation, mesh link
  quality/hops, lost-link seconds, authority sync age, fluidity-token validity, launch
  readiness, recovery plan, balloon position-monitor + envelope) and hard interlocks for
  disable-mesh, override-lost-link-failsafe, bypass-launch-readiness, override-fluidity-
  token, force-payload-release, balloon position-monitor / envelope-protection disable.
- **Built to meet and exceed:** 14 CFR Part 107 + waivers, Part 108 (BVLOS), Part 101
  (unmanned free balloons), Part 89 (Remote ID), Part 91, LAANC, ASTM F3548 (UTM), and
  SORA. Signed Swarm Evidence Bundles (`aristotle.swarm-evidence.v1`) for Mission
  Reconstruction.
- 8/8 swarm tests pass; full regression green: logistics 6, aviation 7, robotics 7,
  pipeline 6, mining 6, port 6, water 6, grid 6, rail 6, gate-property 2,
  execution-control 75.

## v0.1.39 - Healthcare clinical-operations execution-control vertical
- **Healthcare pilot path**: typed adapters (FHIR resource, HL7 message, EHR
  writeback, pharmacy workflow, prior authorization, claims, imaging RIS/PACS,
  medical-device command, patient messaging, research export) -> Canonical
  Governed Actions; clinical and privacy invariants enforced at the gate
  (patient-context hash, consent/TPO basis, clinician privilege, allergy and
  medication-interaction checks, chart lock, device safety limits, alarm posture,
  PHI minimization, claim attestation, de-identification, audit context);
  Healthcare Evidence Bundles preserve hashes and redaction material instead of
  raw PHI by default; a Clinical Ops console workflow; `aristotle healthcare`
  CLI; `examples/healthcare/` + docs (overview, threat model, pilot guide, Ward
  templates).
- **Patient-consequence hardening**: allergy override, controlled-substance
  force-dispense, device alarm/safety-limit disable, patient-record deletion,
  PHI export without consent, claim force-submit, identified research export,
  order force without clinician authority, and patient-context-free EHR mutation
  are hard-refused even when an envelope is misconfigured; medication-list,
  dispense, PHI export, device update, and research export actions require
  plural authority before Warrant issuance.

## v0.1.37 - Trucking and logistics execution-control vertical
- **Logistics pilot path**: typed adapters (TMS dispatch, broker/carrier tender,
  carrier vetting, ELD/HOS, telematics route, WMS release, YMS dock/gate, fuel
  advance, accessorial/payment, cold-chain, hazmat routing, DVIR, customs /
  cross-border) -> Canonical Governed Actions; logistics physical and operational
  invariants enforced at the gate (HOS/ELD freshness, carrier authority,
  insurance, driver qualification, route/geofence, trailer seal, cargo securement,
  temperature range, appointment/dock/gate state, fuel/payment caps, fraud score,
  double-broker risk); Logistics Evidence Bundles; a Logistics Ops console
  workflow; `aristotle logistics` CLI; `examples/logistics/` + docs (overview,
  threat model, pilot guide, ward templates).
- **Freight safety and fraud hardening**: dispatch-over-HOS, ELD disable, carrier
  or driver qualification override, hazmat route override, cold-chain alarm
  override, forced POD/payment release, unbounded fuel advance, forced yard gate,
  double-broker override, and telematics spoof override are hard-refused even when
  an envelope is misconfigured; tender, fuel, payment, hazmat, and cold-chain
  actions require dual control and fail closed when approval state is unavailable.

## v0.1.36 - Robotics / humanoid execution-control vertical
- **Robotics pilot path**: typed adapters (motion-control, manipulation, mobile-base,
  humanoid-locomotion, teleoperation, human-robot-interaction, safety-config, fleet,
  historian) -> Canonical Governed Actions; robotics physical invariants enforced at
  the gate (workcell/zone/operating-mode/state, TCP speed, force/torque/power
  biomechanical limits, separation distance, center-of-mass deviation and step height
  for humanoids, payload, fresh telemetry, and readiness flags for e-stop, protective
  stop, SSM, PFL, collision detection, safety scanner, humanoid balance controller and
  fall protection, teleop link, operator qualification, plus collaborative-mode-when-
  human-present) plus hard interlocks (disable e-stop / protective stop / collision
  detection / safety scanner, override SSM / PFL / safety zone, humanoid balance-
  controller and fall-protection disable); signed Robotics Evidence Bundles with a
  regulatory profile and collaboration risk class; `examples/robotics/` ward, envelope,
  policy, and allow/refuse actions runnable via `execution-control evaluate`; docs
  (overview, ward templates, threat model). Designed to meet and exceed ISO 10218-1/-2,
  ISO/TS 15066, ANSI/RIA R15.06/.08, ISO 3691-4, ISO 13482, and ISO 13849 / IEC 61508.

## v0.1.35 - Aviation / UAV / eVTOL execution-control vertical
- **Aviation pilot path**: typed adapters (UTM/USS, flight-control/autopilot,
  geofence, payload, vertiport, detect-and-avoid, C2-link, Remote ID, ground
  control station, historian) -> Canonical Governed Actions; aviation physical
  invariants enforced at the gate (airspace id/class/operation-volume/flight-state,
  altitude AGL ceiling, groundspeed, battery RTL reserve, wind/visibility/ceiling,
  payload mass, fresh telemetry, and readiness flags for geofence, Remote ID,
  detect-and-avoid, C2 link health, airspace authorization, no-active-TFR,
  VLOS/waiver, RTL availability, vertiport clearance, weather, RPIC qualification)
  plus hard interlocks (disable geofence / detect-and-avoid / Remote ID / return-to-
  home, override airspace authorization / C2 link-loss failsafe / active-TFR, eVTOL
  flight-envelope-protection disable); signed Aviation Evidence Bundles with a
  regulatory profile and SORA risk class; `examples/aviation/` ward, envelope,
  policy, and allow/refuse actions runnable via `execution-control evaluate`; docs
  (overview, ward templates, threat model). Designed to meet and exceed 14 CFR Part
  107/108/91/135, Part 89 (Remote ID), LAANC, ASTM F3548 (UTM), and SORA.

## v0.1.34 - Mining execution-control vertical
- **Mining pilot path**: typed adapters (autonomous-haulage/AHS, ventilation,
  blasting, tailings/TSF, gas-monitoring, hoist, Modbus, DNP3, OPC-UA, historian)
  -> Canonical Governed Actions; mining physical invariants enforced at the gate
  (site/zone/state, methane/CO/oxygen action levels, minimum airflow, haulage
  speed ceiling, tailings pond level & freeboard, hoist load, fresh SCADA, and
  readiness flags for proximity detection, exclusion-zone & personnel clearance,
  ground control, gas monitoring, ventilation, operator qualification) plus hard
  interlocks (disable proximity detection / gas monitoring / ventilation / ground-
  control monitoring / tailings monitoring, disable hoist overspeed protection,
  blast force-initiate); signed Mining Evidence Bundles with a regulatory profile
  (MSHA 30 CFR 56/57/75/77, methane, proximity detection, ISO 17757, ICMM GISTM,
  ground-control plan, blast clearance); `examples/mining/` ward, envelope, policy,
  and allow/refuse actions runnable via `execution-control evaluate`; docs
  (overview, ward templates, threat model). Designed to meet and exceed MSHA 30 CFR
  56/57/75/77, ISO 17757, and ICMM GISTM.
## v0.1.33 - Port and water infrastructure execution-control verticals
- **Water/wastewater pilot path**: typed adapters (SCADA/plant control, PLC/RTU,
  pump station, valve/pressure-zone, chemical dosing, lab/LIMS, historian, AMI,
  tank/reservoir, lift station, UV/disinfection, wastewater discharge) ->
  Canonical Governed Actions; water physical invariants enforced at the gate
  (system/facility/pressure zone/process area, chlorine dose/residual, pH,
  turbidity, pressure, tank/wetwell level, flow, UV intensity, sensor/lab
  freshness, backflow, disinfection, chemical inventory, pump availability,
  valve interlock, discharge permit window, bypass posture); Water Evidence
  Bundles; a Water Ops console workflow; `aristotle water` CLI;
  `examples/water/` + docs (overview, threat model, pilot guide, ward templates).
- **Utility safety hardening**: disinfection disable, chemical overfeed, PLC force
  override, valve force-open, pump run-dry, and bypass force-open are hard-refused
  even when an envelope is misconfigured; chemical/PLC/valve/disinfection/
  discharge actions require dual control and fail closed when approval state is
  unavailable.

## v0.1.32 - Maritime port execution-control vertical
- **Port pilot path**: typed adapters (Terminal Operating System, Port Community /
  EDI, customs hold, VTS/AIS/PNT, crane automation, gate OCR/access, yard tractor,
  reefer, weighbridge/VGM, shore-power, bunkering/hazmat) -> Canonical Governed
  Actions; port physical invariants enforced at the gate (customs/security holds,
  VGM, PNT/AIS freshness, crane exclusion zone, berth conflict, tide/weather,
  truck appointment, driver identity, cold chain, shore-power, hazmat routing,
  vendor remote-session posture); Port Evidence Bundles; a Port Ops console
  workflow; `aristotle port` CLI; `examples/port/` + docs (overview, threat
  model, pilot guide, ward templates).
- **Terminal safety hardening**: crane interlock disable, exclusion-zone override,
  forced customs release, forced gate-open, shore-power forced energization, and
  PNT confidence override are hard-refused even when an envelope is misconfigured;
  crane/VTS/shore-power/hazmat actions require dual control and fail closed when
  approval state is unavailable.

## v0.1.32 - Pipeline (oil & gas / energy) execution-control vertical
- **Pipeline pilot path**: typed adapters (SCADA pump-control, SCADA compressor,
  valve-control, pressure-control, leak-detection/CPM, pig-launcher, Modbus, DNP3,
  OPC-UA, historian) -> Canonical Governed Actions; pipeline physical invariants
  enforced at the gate (segment/system-model/state, MAOP & %-of-MAOP pressure
  ceiling, min pressure, liquid/gas flow caps, fresh SCADA / Control Room
  Management, leak-detection armed, overpressure protection active, ESD ready,
  segment isolation ready, pump primed, operator qualified) plus hard interlocks
  (disable leak detection / overpressure protection / ESD, isolation bypass,
  relief disable, overpressure override, compressor safety-shutdown disable);
  signed Pipeline Evidence Bundles with a regulatory profile (PHMSA 192/195, CRM,
  OQ, Integrity Management, API 1164/1173/RP 1175); `examples/pipeline/` ward,
  envelope, policy, and allow/refuse actions runnable via `execution-control
  evaluate`; docs (overview, ward templates, threat model). Designed to meet and
  exceed 49 CFR 192/195, 192.631/195.446, 192.801/195.501, and the API standards.

## v0.1.31 - Railroad execution-control vertical
- **Railroad pilot path**: typed adapters (Dispatch/CAD, PTC back office, wayside
  signal, switch machine, grade crossing, locomotive telemetry, crew management,
  consist/hazmat, maintenance-of-way, yard automation) -> Canonical Governed
  Actions; rail physical invariants enforced at the gate (territory, movement
  authority, PTC active/fresh, signal aspect, switch proof, train separation,
  work-zone release, bulletin acknowledgement, consist hash, grade crossing
  protection, no conflicting authority); Rail Evidence Bundles; a Rail Ops
  console workflow; `aristotle rail` CLI; `examples/rail/` + docs (overview,
  threat model, pilot guide, ward templates).
- **Rail safety hardening**: PTC disable, enforcement override, signal force-clear,
  and switch force-unlock are hard-refused even when an envelope is misconfigured;
  route/signal/switch/PTC/hazmat actions require dual control and fail closed when
  approval state is unavailable.

## v0.1.30 - Electric-utility grid OT vertical
- **Grid/utility pilot path**: typed adapters (SCADA/EMS/ADMS, IEC 61850, DNP3,
  Modbus, OPC UA, DERMS, relay settings, firmware campaigns, historian writes)
  -> Canonical Governed Actions; grid physical invariants enforced at the gate
  (frequency, voltage, feeder/transformer loading, DER export caps, topology
  model, voltage class, protection state, SCADA freshness, crew clearance, manual
  fallback); grid Evidence Bundles; a Grid console workflow; `aristotle grid` CLI;
  `examples/grid/` + docs (overview, threat model, pilot guide, ward templates).
- **OT safety hardening**: protection-disable actions are refused by the Physical
  Invariant Gater even when an envelope is misconfigured; relay-setting changes
  require dual control and fail closed when approval state is unavailable.

All notable changes to AristotleOS (the Ward/Warrant execution-control boundary,
its operator console, SDK, and CLI). Dates are release tags on the
`ward-warrant-execution-control` branch. The doctrine is unchanged throughout:
*authority before consequence · warrant before execution · evidence after every
decision.*

## v0.1.29 — Autonomous-vehicle fleet vertical + dual-control fail-closed
- **Automotive/ADS pilot path**: typed adapters (ROS2/DDS, AUTOSAR Adaptive, OTA,
  map update, remote assist, fleet mgmt, simulation) → Canonical Governed Actions;
  vehicle-safety physical bounds enforced at the gate (`max_speed_mps`, ODD,
  road classes, map/localization/perception confidence, MRC availability); vehicle
  safety-evidence bundles; an AutomotiveFleet console; `aristotle automotive` CLI;
  `examples/automotive/` + docs (overview, threat model, pilot guide, ward templates).
- **Dual-control hardening**: a dual-controlled action with **no approval store
  configured** now fails closed (`DUAL_CONTROL_STORE_MISSING`) instead of silently
  bypassing plural authority. Full gate green; clean-room clean.

## v0.1.28 — Telecom pilot path (overview doc) + CHANGELOG refresh
- `docs/telecom.md` overview for the telecom autonomous-network pilot; CHANGELOG
  brought current through the dual-control + telecom work. Full gate green (37 suites).

## (telecom) — Telecom autonomous-network pilot path
- Typed carrier adapters (TM Forum Open API, NETCONF/YANG, gNMI/gNOI, O-RAN A1/R1)
  → Canonical Governed Actions; NOC evidence bundles (ticket/operator/redactions);
  carrier-scale benchmark, reconnect-storm reconciliation, and multi-region HA soak;
  `aristotle telecom` CLI + `examples/telecom/` + `docs/telecom-threat-model.md`.

## v0.1.27 — Approvals console
- Operator UI for dual control: a live M-of-N approval queue (vote progress, voters,
  approve/reject) reading `/approvals` with a sample fallback. Additive view.

## v0.1.26 — Dual-control surface
- APL `approve <a> requires N [within <dur>]`; `/approvals` + `/approvals/decide`
  endpoints; `aristotle dual-control` CLI.

## v0.1.25 — Dual control (M-of-N approval)
- The gravest actions get no Warrant on their own ALLOW — they ESCALATE and require
  N distinct approvers (never the requester) within a TTL. Pure state machine +
  file/in-memory ApprovalStore with separation of duties; gate-wired.

## v0.1.24 — Budget / quota governance
- Authority Envelopes can cap cost and/or call count per rolling window; over-budget
  actions are refused (`BUDGET_EXCEEDED`) and recorded. APL `budget` + governor.

## v0.1.23 — Performance pass
- Measured numbers published; cached public-key verification (helps batch chain/bundle
  verify); honest positioning vs a compiled gate (no rewrite).

## v0.1.22 — Cross-agent behavioral detection
- coordinated_denial, peer_anomaly, privilege_escalation, new_capability,
  credential_reuse — fleet-level signals routed into warrant-gated interdiction.

## v0.1.21 — Aristotle Policy Language (APL)
- Typed governance DSL compiling to the existing Ward/Authority manifests; `aristotle
  policy compile|check`.

## v0.1.15–v0.1.20 — Operator surface completeness
- Degradation health endpoint + full SDK coverage (v0.1.15); console degradation badge
  (v0.1.16); Ward Marshal host/process + MCP collectors (v0.1.17), discover CLI
  sources (v0.1.18), generic file-fed collector (v0.1.19); Conflict Inbox CLI (v0.1.20).

## v0.1.20 — Conflict Inbox CLI
- `aristotle conflicts ingest|list|resolve` over a durable file-backed inbox.
  `list` exits non-zero while a conflict is open (ops/CI gate); `resolve` applies
  the attributed state-machine transition. Completes the Conflict Inbox across
  store + endpoints + SDK + console + CLI.

## v0.1.19 — Generic file-fed discovery collector
- `fileObservationCollector` + `extractRecords` ingest an exported inventory JSON
  (CI / SaaS / network / API-gateway) via a field mapping — one collector for every
  export-shaped source. CLI: `ward-marshal discover --from-file <f> --source <s> --map field=key`.

## v0.1.18 — Discovery CLI sources
- `ward-marshal discover` gains `--process` (host/workstation/edge) and `--mcp`
  (MCP tool servers); sources combine, merge, and dedupe.

## v0.1.17 — Host/process + MCP collectors
- `processCollector`/`parseProcessList`/`parsePsText` (a `looksLikeAgent` heuristic
  keeps only candidate agents and extracts LLM egress) and `mcpCollector`/
  `parseMcpInventory` broaden Ward Marshal discovery beyond Kubernetes.

## v0.1.16 — Console surfaces degradation
- The Command Center shows a DEGRADED badge (from `GET /degradation`) when the
  boundary reports an active condition, naming the conditions and fail action.

## v0.1.15 — Degradation health endpoint + full SDK coverage
- `GET /v1/execution-control/degradation` reports live self-assessed health and the
  projected fail action. `@aristotle/os-sdk` now covers shadow, reconcile, conflicts,
  marshal census/behavior, and degradation with typed results.

## v0.1.14 — Self-driving degradation detectors
- `degradation.ts`: ledger-writability canary (on by default), control-plane
  staleness probe (shared with B2/T17), `predicateProbe`/`runWithTimeout` adapters.
  An unavailable ledger short-circuits to a *governed* degraded decision (never a
  500). Makes the B3 fail-mode policy self-driving.

## v0.1.13 — Self-verifying evaluator walkthrough
- `pnpm demo:evaluator`: a narrated, no-services proof of the whole doctrine
  (allow/refuse/escalate/invariant/replay/degraded + offline Evidence Bundle export
  & verify + tamper detection). 15 PASS/FAIL checks; runs in CI as `test:demo`.

## v0.1.12 — Per-Ward criticality fail-mode + gate-HA (B3)
- `fail-mode.ts`: a Ward's criticality (`safety_critical`…`best_effort`) decides the
  fail action under degradation conditions; `DEGRADED_MODE` gate precondition;
  HA-topology docs (stateless replicas over a serialized durable ledger).

## v0.1.11 — Supply-chain hardening (A4)
- Blocking dependency-audit gate (`audit-deps.mjs`; high+critical fail; triage
  allowlist with hard expiry) and a release workflow emitting SLSA build provenance
  + an SBOM attestation, verifiable with `gh attestation verify`.

## v0.1.10 — Durable Conflict Inbox + 5/5 live consoles
- `conflict-inbox.ts` (ingest/list/resolve, idempotent, resolutions survive
  re-ingest) with HTTP endpoints; the Conflict Inbox console reads it live —
  completing all five operator consoles on real backends.

## v0.1.9 — Live operator engines + real console wiring
- Operator engines exposed as operator-gated HTTP endpoints (shadow, reconcile,
  marshal census/behavior) with OpenAPI + server tests; Shadow Mode and Ward
  Marshal consoles render real engine output with labeled sample fallback.

## v0.1.5–v0.1.8 — Defense-hardening batches
- A1 gate property/oracle verification; A2 trusted-time + nonce-bound warrants;
  A3 asymmetric credential minter; B1 attested telemetry; B2 DDIL edge containment;
  B4 mTLS/PIV client-cert auth + admin-key gate; B5 FIPS-mode guard; B6 MLS
  classification labels + CDS boundary.

## v0.1.0–v0.1.4 — Foundation
- The execution-control runtime (Commit Gate, Ed25519 Warrants, hash-chained
  Governance Evidence Ledger, Evidence Bundles), CLI, console, HTTP gateway,
  pluggable durable ledgers (SQLite/Postgres), RBAC/OIDC, revocation, kill switch,
  Ward Marshal, and the security-audit packet.

---

See `docs/readiness-assessment.md` for the current defense-pilot posture and
`docs/defense-readiness.md` for the hardening map (A/B/C tiers).
