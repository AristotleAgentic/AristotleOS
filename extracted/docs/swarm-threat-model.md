# Swarm threat model addendum

Scope: an AI agent or orchestrator commanding a UAV swarm in disconnected operations.
The Commit Gate is the boundary; nothing reaches a unit without a verified Flight Warrant.

## Assets

- Physical: swarm units (multirotor / fixed-wing / VTOL / eVTOL / balloon-mothership),
  payloads, ground control stations, mesh-relay infrastructure, and any people, structures,
  or habitats in the operations volume.
- Governance: the mission's Ward, the operations-center Authority Envelope, the Swarm
  Authority Envelope, issued Flight Warrants, Fluidity Tokens, compiled Airspace
  Authority artifacts, and the tamper-evident GEL Mission Reconstruction ledger.

## Primary threats and controls

| # | Threat | Control |
|---|---|---|
| T1 | Swarm executes after backhaul is lost beyond its authorized window | `max_lost_link_seconds` + `require_fluidity_token_valid` — gate forces hold-safe |
| T2 | Local authority extended indefinitely without re-attestation | Fluidity Token expiry; the gate refuses on `fluidity_token_valid !== true` |
| T3 | Mesh-relay degraded but swarm continues to actuate | `require_mesh_relay_healthy`, `min_mesh_link_quality`, `max_mesh_hops` |
| T4 | Mission abort fails to reach every unit | `mesh.revocation.propagate` is admitted under degraded comms; `swarm.disable_revocation_propagation` is a hard interlock |
| T5 | Launch without readiness approval or recovery plan | `require_launch_readiness_approved` + `require_recovery_plan_active`; `swarm.bypass_launch_readiness` is a hard interlock |
| T6 | Lost-link failsafe overridden | `swarm.override_lost_link_failsafe` hard interlock |
| T7 | Unauthorized payload release | `swarm.payload.release` is dual-controlled; `swarm.force_payload_release_without_authorization` is a hard interlock; ops-over-people authorization checked |
| T8 | Geofence / Remote ID / DAA disabled mid-mission | Aviation hard interlocks (geofence/DAA/Remote ID disable) carry into swarm; required flags enforced per-command |
| T9 | Airspace authority lapses (TFR pops up) | `require_no_active_tfr`, `require_airspace_authorization`, recompile on update |
| T10 | Balloon position monitor disabled (Part 101) | `require_balloon_position_monitor_active`; `balloon.disable_position_monitor` is a hard interlock |
| T11 | Replay of a captured Warrant on another unit | Per-unit single-use Flight Warrants; chain-bound to the act; consumed before receipt |
| T12 | Repudiation of mission decisions in disconnected ops | GEL Mission Reconstruction: every decision (and the local-first ones) signed, chained, and offline-verifiable |

## Fail-closed posture

Swarm Wards should be `safety_critical`. Under any unresolved degradation — fluidity-token
expired, mesh-relay unhealthy with no peers, lost-link beyond window — the gate REFUSES
new actuation. The state machine helper (`nextSwarmFlightState`) routes the swarm into
`hold-safe` or `recover` rather than admitting ungoverned work.

## Operational recommendations (exceeding the minimum)

- Keep Fluidity Token TTLs **short** (seconds to a few minutes); refresh on every
  successful authority sync.
- Compile a recovery plan **before** launch and require it to remain active for the entire
  mission (`require_recovery_plan_active`).
- Use dual-control for launch, recovery, payload release, and any balloon op.
- For high-altitude launches treat Part 101 monitoring as load-bearing; never relax the
  `require_balloon_position_monitor_active` flag.
- Export and archive a Swarm Evidence Bundle for every mission, including the disconnected
  segments — this is the auditable substrate for Part 108 recordkeeping.
