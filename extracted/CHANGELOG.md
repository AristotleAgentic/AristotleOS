# Changelog

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
