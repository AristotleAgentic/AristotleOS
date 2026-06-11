# Console UI — AristotleOS Command Center

A mission-control / fighter-HUD governance dashboard for AristotleOS. It is a
command surface for runtime AI governance: it shows, at a glance, what is active,
what authority exists, what is being requested, and whether the system is safe to
trust — and lets an operator act at the commit boundary.

Run locally:
- `corepack pnpm install` (repo root) — this is a pnpm workspace
- `corepack pnpm --filter @aristotle/console-ui dev`
- open `http://localhost:4173` → **Command Center**

The Vite dev server proxies `/health`, `/operator/*`, and `/v1/*` to the gateway at
`http://localhost:8080` (override with `VITE_GATEWAY_PROXY_TARGET`).

## Dashboard architecture

All command-center code lives under `src/command-center/`. It is a self-contained
module wired into `src/main.tsx` as the **Command Center** view.

| Layer | File(s) | Responsibility |
|-------|---------|----------------|
| Design system | `theme.css` | Scoped (`.ac-root`) mission-control tokens, panels, status primitives, drawers, timelines, charts — dark-first, zero external CSS framework. |
| Domain model | `types.ts` | TypeScript types for every governance primitive (Ward, Authority Envelope, Commit Request, Warrant lifecycle, Ledger record, …). Single source of truth shared by mock + real data. |
| Mock data | `mockData.ts` | Realistic AristotleOS data (4 wards, agents, commit requests with full register/invariant/step detail, a hash-chained ledger, mesh topology, physical channels) + deterministic short-hash helper. |
| State | `store.ts` | Zustand store: snapshot, requests, ledger, pipeline telemetry, selection, a 2s **live simulation** tick, and operator actions. |
| Service | `service.ts` | Thin layer over the gateway (`gateway-contract.ts`). Probes `/health` + chain metrics and flips the snapshot to `live`; falls back to mock. This is the seam to wire real services. |
| Primitives | `primitives.tsx` | Reusable, strongly-typed building blocks: `Panel`, `Badge`, `StatusDot`, `Metric`, `RingGauge`, `Sparkline` (hand-rolled SVG), `Drawer`, `ConfirmAction`, domain→tone mappers, formatters. |

### Sections (one component each)
1. `CommandHeader` — mission status band: mode, posture, wards/agents/commits, warrants/refusals/escalations, ledger integrity, kill switch, gate-pipeline latency.
2. `MeshView` — live SVG governance mesh (wards, gates, agents, ledger, witness, revocation) with status rings + hover cards.
3. `CommitGateConsole` — the hero panel: live commit requests with risk, decision, warrant + ledger status.
4. `WarrantLifecycle` — inspectable request→authority→invariants→gate→warrant→evidence→reconciliation timeline, registers, invariants.
5. `WardBrowser` — Meta Authority Envelope → Wards → Authority Domains → Envelopes hierarchy + detail.
6. `LedgerExplorer` — hash-linked evidence table, record detail, and a chain view.
7. `ReplayTimeMachine` — scrub governance history; see authority validity, propagation, partitions at time T.
8. `SimulationPanel` — counterfactual outcomes (revoke, retry, partition, latency, physical violation).
9. `PhysicalInvariantPanel` — hardware interlock channels, software↔physical agreement, interlock events.
10. `OperatorActionBar` — confirm-gated operator commands (pause ward, revoke envelope, reconcile, degraded mode, kill switch, export evidence, escalate).

`CommandCenter.tsx` composes the shell (header + rail nav + section switch + drawers + toasts) and drives the live tick.

### Wiring real data
Replace the mock seeds in `store.ts` with calls through `service.ts` (the
`gateway-contract.ts` endpoints already exist). Decision/state types in `types.ts`
are the contract; keep responses in that shape and the UI needs no changes.

Gateway contract: `src/gateway-contract.ts`.
