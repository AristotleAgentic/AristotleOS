# UAV-swarm governance for disconnected operations

## What it is

Aristotle's swarm vertical is the runtime expression of the doctrine that intermittent
connectivity is not a corner case: **delegated authority must remain enforceable locally,
safety must degrade predictably, and accountability must be provable after the fact.**
It governs UAV swarms across BVLOS, mesh-relay, and disconnected operations — wildfire,
disaster response, agriculture, temporary comms mesh, critical-infrastructure inspection,
range ops, defense perimeter — with **high-altitude balloon / mothership treated as the
extreme stress case (Part 101), not the default**.

Single-aircraft Part-107 aviation lives in [aviation.md](aviation.md); this module is the
swarm layer above it.

## The primitives

| Primitive | Role |
|---|---|
| **Swarm Authority Envelope** | Mission envelope for an orchestrated swarm |
| **Disconnected Commit Gate** | Decision admissibility under degraded backhaul |
| **Mesh Revocation Protocol** | Authority withdrawal propagated through the mesh |
| **Flight Warrant Service** | Per-unit signed, time-bounded authorization to execute |
| **Fluidity Token** | Time-bounded degraded-comms authority — expires unless reconfirmed |
| **Airspace Authority Compiler** | Compiles COAs, waivers, launch windows, controlled-airspace permissions, lost-link behaviors, weather minima, and recovery plans into machine-readable authority |
| **Launch Readiness Gate** | Pre-launch authority + checklist + recovery-plan activation |
| **GEL Mission Reconstruction** | After-action signed evidence reconstruction |

## Disconnected flight state machine

```
preflight -> connected -> degraded -> mesh-relay -> hold-safe -> recover / RTL / land -> evidence-sync
```

The orchestrator can use `nextSwarmFlightState(current, signals)` to compute the next
safe state. Conservative rules: fluidity-token expired ⇒ hold-safe; lost-link beyond the
authorized window ⇒ hold-safe; C2 down but mesh healthy ⇒ mesh-relay; everything down ⇒
hold-safe; recovery required from hold-safe ⇒ recover.

## Mission classes

| Class | Notes |
|---|---|
| `wildfire`, `disaster-response` | Default — incident-command-driven swarms in degraded comms |
| `temporary-comms-mesh` | UAVs deployed *as* a mesh relay for ground operations |
| `agriculture`, `range-ops` | Long-loiter, remote-area autonomy under waiver |
| `infrastructure-inspection` | BVLOS pipeline/grid/rail inspection |
| `defense-perimeter`, `reconnaissance` | Restricted-airspace ops with formal authority chains |
| `high-altitude-launch` | **Stress case (Part 101).** If Aristotle can govern that, it can govern everything else |

## What it prevents

Hard interlocks that REFUSE even if mistakenly allowed: `swarm.disable_mesh`,
`swarm.disable_revocation_propagation`, `swarm.override_lost_link_failsafe`,
`swarm.bypass_launch_readiness`, `swarm.override_fluidity_token`,
`swarm.disable_evidence_ledger`, `swarm.force_payload_release_without_authorization`,
`balloon.disable_position_monitor`, `balloon.override_envelope_protection`.

Per-command bounds the gate enforces: swarm size, swarm radius, unit separation, worst-case
battery SoC, mesh link quality, mesh hops, lost-link seconds, authority-sync age, fluidity
token validity, launch-readiness approval, recovery-plan active, mesh-relay healthy,
geofence/DAA/Remote ID/airspace authorization/TFR/weather — and (Part 101 stress) balloon
position-monitor active and within envelope.

## Built to meet and exceed

| Regime | Where it shows up |
|---|---|
| 14 CFR Part 107 (+ waivers, e.g. >400 ft AGL) | `max_altitude_agl_ft`, `waiver_id` in evidence |
| 14 CFR Part 108 (BVLOS, proposed) | `require_airspace_authorization`, mesh + fluidity, recordkeeping |
| 14 CFR Part 101 (unmanned free balloons) | `require_balloon_position_monitor_active`, `require_balloon_within_envelope` |
| 14 CFR Part 89 (Remote ID) | `require_remote_id_broadcasting` |
| Part 91, LAANC, ASTM F3548 (UTM), SORA | airspace authority compiler, risk classes |

## How to try it

```bash
npm run test:swarm
npm run aristotle -- execution-control evaluate \
  --ward examples/swarm/ward.wildfire_swarm.yaml \
  --envelope examples/swarm/authority_envelope.incident_commander.yaml \
  --action examples/swarm/actions/swarm_mission_tick.json \
  --ledger ./.tmp/swarm.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

The provided refuse fixtures exercise the three load-bearing disconnected-operation
failure modes: `refuse_lost_link_timeout.json`, `refuse_fluidity_token_expired.json`, and
`refuse_mesh_unhealthy.json`.

## Evidence produced

`exportSwarmEvidenceBundle()` wraps the signed execution Evidence Bundle with mission
context (operator, control station, mission class, swarm id, mission id, COA, waiver,
RPIC, SORA risk class, regulatory profile, pre/post checks). `verifySwarmEvidenceBundle()`
re-verifies it offline. See [swarm-ward-templates.md](swarm-ward-templates.md) and
[swarm-threat-model.md](swarm-threat-model.md).
