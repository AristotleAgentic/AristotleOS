# Maritime Port Execution-Control Path

AristotleOS now includes a port-industry execution-control vertical for container
terminals, harbor operations, gate automation, cranes, cold-chain cargo, customs
holds, and shore-side OT systems.

The doctrine does not change:

> Authority before consequence. Warrant before execution. Evidence after every decision.

## What It Is

The port path turns consequential terminal activity into Canonical Governed
Actions. A terminal automation, AI agent, or workflow engine can propose an
action, but the action must pass Ward resolution, Authority Envelope validation,
Port Safety Invariant checks, Commit Gate admission, Warrant issuance, and GEL
commit before it reaches a TOS, crane boundary, gate system, VTS-facing workflow,
reefer system, shore-power controller, or customs-release workflow.

AristotleOS does not replace terminal operating systems, vessel traffic services,
customs systems, PLC safety logic, or port security systems. It governs proposed
autonomous or automated actions before those systems receive consequence-bearing
commands.

## Adapter Boundaries

The first port adapter catalog includes:

- Terminal Operating System: `tos.container.release`, `tos.yard-move.authorize`
- Port Community / EDI: `edi.manifest.submit`, `pcs.release-notice.publish`
- Customs / Hold Release: `customs.hold.release`, `security.hold.release`
- VTS / AIS / PNT: `vts.berth.clearance`, `ais.track.attest`
- Crane Automation: `crane.move.request`, `crane.job.assign`
- Gate OCR / Access: `gate.access.grant`, `gate.appointment.update`
- Yard Tractor / AGV: `yard.move.authorize`, `yard.route.assign`
- Reefer / Cold Chain: `reefer.setpoint.update`, `reefer.alarm.ack`
- Weighbridge / VGM: `weighbridge.vgm.verify`, `weight.hold.apply`
- Shore Power: `shore-power.energize.request`, `shore-power.isolate.request`
- Bunkering / Hazmat: `hazmat.route.authorize`, `bunkering.operation.authorize`

## Port Safety Invariants

The Commit Gate now understands port-specific physical and operational
invariants. Examples:

- customs/security/inspection holds must be clear before release
- verified gross mass must be present before container release
- crane exclusion zones must be clear before crane movement
- berth conflicts must be absent before vessel/berth clearance
- PNT confidence and AIS freshness must meet Ward thresholds
- truck appointment and driver identity must be verified at gates
- cold-chain validity must hold before reefer changes
- shore-power lockout, isolation, and fire watch must be proven
- vendor remote sessions can be forbidden during OT actions

Hard interlocks refuse even if an Authority Envelope mistakenly allows them:

- `port.disable_crane_interlock`
- `crane.override_exclusion_zone`
- `customs.force_release_hold`
- `gate.force_open`
- `shore-power.force_energize`
- `pnt.override_confidence`

## Evidence

Port Evidence Bundles wrap the ordinary GEL/Warrant evidence with terminal
context: port, facility, terminal, berth, yard block, gate, container, vessel,
booking, bill of lading, release order, cargo profile, standards profile,
pre-checks, post-checks, and redaction manifest.

Run:

```bash
npm run aristotle -- port templates
npm run aristotle -- port adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/port/ward.container_terminal_alpha.yaml \
  --envelope examples/port/authority_envelope.terminal_orchestrator.yaml \
  --action examples/port/actions/allow_container_release.json \
  --ledger ./.tmp/port.gel.jsonl
```

## What It Prevents

This vertical is designed to stop or escalate:

- autonomous release of cargo under customs or security hold
- unsafe crane moves while exclusion zones are not clear
- berth clearance under stale PNT/AIS or conflicting berth state
- gate opening without appointment and identity validation
- shore-power energization without lockout/fire-watch state
- hazmat routing without an approved segregation route
- vendor remote sessions issuing OT commands without bounded authority

## Developer Use

Developers should use `shared/execution-control-runtime/src/port.ts` to translate
port-system intents into Canonical Governed Actions. Real adapters must verify
the returned Warrant before touching TOS, gate, crane, VTS, reefer, weighbridge,
or shore-power interfaces.
