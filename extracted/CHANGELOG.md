# Changelog

All notable changes to AristotleOS (the Ward/Warrant execution-control boundary,
its operator console, SDK, and CLI). Dates are release tags on the
`ward-warrant-execution-control` branch. The doctrine is unchanged throughout:
*authority before consequence · warrant before execution · evidence after every
decision.*

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
