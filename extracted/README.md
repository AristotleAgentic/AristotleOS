# Aristotle Autonomous Governance OS

A service-backed governance operating system prototype behind the fixed Aristotle Autonomous Governance Console operator surface.

AristotleOS is runtime governance for autonomous execution: authority resolution, policy compilation, Commit Gate admissibility, warrant issuance, and evidence finalization before consequential action.

## Try AristotleOS

Install the CLI and run a governed agent in about five minutes:

```bash
npm install -g @aristotle/os-cli      # or: npx @aristotle/os-cli pilot
aristotle pilot                       # self-check the full boundary (PASS/FAIL)
aristotle init                        # scaffold a governed project
aristotle keys generate               # durable Ed25519 signing key
aristotle run -- node aristotle/agent.mjs   # run an agent behind the boundary
```

`aristotle run` boots the execution-control boundary, injects `ARISTOTLE_ENDPOINT`
into your agent, and governs every consequential action: the Commit Gate returns
`ALLOW` / `REFUSE` / `ESCALATE`, issues a single-use **Ed25519-signed Warrant** on
`ALLOW`, and records a tamper-evident Governance Evidence Ledger entry.

No-install browser playground:

```bash
aristotle playground                  # http://127.0.0.1:4178
```

Expose the boundary to MCP-capable agent runtimes:

```bash
aristotle mcp                         # JSON-RPC over stdio
```

Docs:
- [Evaluator quickstart](docs/evaluator-quickstart.md) — prove the boundary offline in ~10 min
- [Getting started](docs/getting-started.md)
- [Execution-control runtime](docs/execution-control-runtime.md)
- [Ward Marshal](docs/ward-marshal.md)
- [Autonomous Network Pilot Guide](docs/autonomous-network-pilot-guide.md)
- [Telecom threat model addendum](docs/telecom-threat-model.md)
- [Autonomous Vehicle Pilot Guide](docs/autonomous-vehicle-pilot-guide.md)
- [Automotive execution-control path](docs/automotive.md)
- [Automotive threat model addendum](docs/automotive-threat-model.md)
- [Electric Utility Pilot Guide](docs/electric-utility-pilot-guide.md)
- [Grid OT execution-control path](docs/grid.md)
- [Grid threat model addendum](docs/grid-threat-model.md)
- [Railroad Operator Pilot Guide](docs/railroad-operator-pilot-guide.md)
- [Rail execution-control path](docs/rail.md)
- [Rail threat model addendum](docs/rail-threat-model.md)
- [Pipeline execution-control path](docs/pipeline.md)
- [Pipeline Ward templates](docs/pipeline-ward-templates.md)
- [Pipeline threat model addendum](docs/pipeline-threat-model.md)
- [Mining execution-control path](docs/mining.md)
- [Mining Ward templates](docs/mining-ward-templates.md)
- [Mining threat model addendum](docs/mining-threat-model.md)
- [Maritime Port Operator Pilot Guide](docs/port-operator-pilot-guide.md)
- [Port execution-control path](docs/port.md)
- [Port threat model addendum](docs/port-threat-model.md)
- [Water Utility Operator Pilot Guide](docs/water-operator-pilot-guide.md)
- [Water execution-control path](docs/water.md)
- [Water threat model addendum](docs/water-threat-model.md)
- [Aviation / UAV / eVTOL execution-control path](docs/aviation.md)
- [Aviation Ward templates](docs/aviation-ward-templates.md)
- [Aviation threat model addendum](docs/aviation-threat-model.md)
- [UAV-swarm governance for disconnected operations](docs/swarm.md)
- [Swarm Ward templates](docs/swarm-ward-templates.md)
- [Swarm threat model addendum](docs/swarm-threat-model.md)
- [Robotics / humanoid execution-control path](docs/robotics.md)
- [Robotics Ward templates](docs/robotics-ward-templates.md)
- [Robotics threat model addendum](docs/robotics-threat-model.md)
- [Trucking and Logistics Operator Pilot Guide](docs/logistics-operator-pilot-guide.md)
- [Logistics execution-control path](docs/logistics.md)
- [Logistics Ward templates](docs/logistics-ward-templates.md)
- [Logistics threat model addendum](docs/logistics-threat-model.md)
- [Healthcare Operator Pilot Guide](docs/healthcare-operator-pilot-guide.md)
- [Healthcare execution-control path](docs/healthcare.md)
- [Healthcare Ward templates](docs/healthcare-ward-templates.md)
- [Healthcare threat model addendum](docs/healthcare-threat-model.md)
- [Aristotle Verified Title Transaction Layer](docs/title.md)
- [Title Ward templates](docs/title-ward-templates.md)
- [Title threat model addendum](docs/title-threat-model.md)
- [Defense readiness roadmap](docs/defense-readiness.md)
- [Crypto posture](docs/crypto-posture.md)
- [Commercial adoption path](docs/commercial-adoption-path.md)
- [Architecture](docs/architecture.md)
- [Deployment runbook](docs/deployment-runbook.md)

The service-backed console demo (payments remediation, operator approval, warrant
issuance) is also available:

```bash
corepack pnpm install
npm run aristotle:demo                 # http://127.0.0.1:4173/try
```
- [Ward/Warrant Execution-Control Path](docs/execution-control-runtime.md)

Pilot Kubernetes smoke:

```bash
npm run pilot:smoke:kind -- --tag 0.1.0-smoke --keep-port-forward
```

The smoke path builds the image set, installs the Helm chart into kind, then proves the governance boundary with a deferred payments action, one-time warrant issuance after approval, GEL commit, and fail-closed missing-authority behavior.

## Commercial Adoption Path

The Command Center now includes operator surfaces for the enterprise adoption motion:

- policy promotion from draft to shadow to staged to enforced
- operator tabs for Builder, Shadow, Conflicts, Adopt, and Failure
- mission templates for payments, Kubernetes deployment, disconnected drone patrol, and protected record correction
- governed tool gateway posture for HTTP APIs, Kubernetes, shell commands, and robotics buses
- portable Evidence Bundle profile
- policy test harness status
- runtime SLO cards
- failure-mode drills for partitions, stale authority, revocation lag, witness disagreement, and replay divergence

Run the adoption-path validator:

```bash
npm run enterprise:adoption-path
```

The adoption doctrine is simple: authority before consequence, warrant before execution, evidence after every decision.

## Ward Marshal

Ward Marshal adds rogue-agent discovery and warrant-backed interdiction to AristotleOS. It builds a deterministic Agent Census from observed runtime signals, risk-scores undeclared autonomous execution, and routes quarantine, credential revocation, tool disablement, scale-down, or termination through the same Ward, Authority Envelope, Commit Gate, Warrant, and GEL path as any other consequential action. The first real adapters execute Kubernetes workload scale-down, Kubernetes endpoint quarantine via NetworkPolicy, and AristotleOS credential revocation after Warrant verification.

Run the sample:

```bash
npm run ward-marshal:demo
```

Or inspect the inventory first:

```bash
npm run aristotle -- ward-marshal scan \
  --observations examples/ward_marshal/observations.enterprise.json \
  --registry examples/ward_marshal/agent-registry.json
```

Even containment is governed: authority before consequence, warrant before execution, evidence after every intervention. See [docs/ward-marshal.md](docs/ward-marshal.md).

## Telecom Readiness

AristotleOS now includes a carrier pilot path for autonomous network operations. Telecom systems are treated as sources of Canonical Governed Actions; they do not receive special bypass authority. TM Forum Open API, NETCONF/YANG, gNMI/gNOI, and O-RAN A1/R1 surfaces become typed adapter boundaries that execute only after Ward resolution, Authority Envelope validation, Commit Gate admission, Warrant verification, and GEL commit.

Run the telecom slice:

```bash
npm run test:telecom
npm run aristotle -- telecom templates
npm run aristotle -- telecom adapters
npm run aristotle -- telecom benchmark \
  --ward examples/telecom/ward.ran_region_west.yaml \
  --envelope examples/telecom/authority_envelope.noc_change_orchestrator.yaml \
  --count 500
```

The Command Center includes a NOC workflow from "create governed network mission" to "admitted execution" to "telecom Evidence Bundle export." See [docs/autonomous-network-pilot-guide.md](docs/autonomous-network-pilot-guide.md) and [docs/telecom-threat-model.md](docs/telecom-threat-model.md).

## Autonomous Vehicle Readiness

AristotleOS now includes a fleet-safety pilot path for autonomous vehicle companies. ROS 2/DDS, AUTOSAR Adaptive, OTA campaign, HD map update, remote-assist, fleet-management, and simulation surfaces become typed adapter boundaries. They execute only after Ward resolution, Authority Envelope validation, Vehicle Safety Invariant checks, Commit Gate admission, Warrant verification, and GEL commit.

Run the vehicle slice:

```bash
npm run test:automotive
npm run aristotle -- automotive templates
npm run aristotle -- automotive adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/automotive/ward.fleet_region_west.yaml \
  --envelope examples/automotive/authority_envelope.fleet_safety_operator.yaml \
  --action examples/automotive/actions/fleet_vehicle_hold.json \
  --ledger ./.tmp/automotive.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

The Command Center includes a Fleet workflow from "create governed fleet mission" to "admitted execution" to "automotive Evidence Bundle export." See [docs/autonomous-vehicle-pilot-guide.md](docs/autonomous-vehicle-pilot-guide.md), [docs/automotive.md](docs/automotive.md), and [docs/vehicle-ward-templates.md](docs/vehicle-ward-templates.md).

## Electric Utility Readiness

AristotleOS now includes a power-grid pilot path for utility OT operations. SCADA/EMS/ADMS, IEC 61850, DNP3, Modbus, OPC UA, DERMS, relay-setting, firmware campaign, and historian surfaces become typed adapter boundaries. They execute only after Ward resolution, Authority Envelope validation, grid physical invariant checks, Commit Gate admission, Warrant verification, and GEL commit.

Run the grid slice:

```bash
npm run test:grid
npm run aristotle -- grid templates
npm run aristotle -- grid adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/grid/ward.transmission_ops.yaml \
  --envelope examples/grid/authority_envelope.switching_operator.yaml \
  --action examples/grid/actions/scada_breaker_open.json \
  --ledger ./.tmp/grid.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

The Command Center includes a Grid workflow from "create governed switching mission" to "admitted execution" to "grid Evidence Bundle export." See [docs/electric-utility-pilot-guide.md](docs/electric-utility-pilot-guide.md), [docs/grid.md](docs/grid.md), and [docs/grid-ward-templates.md](docs/grid-ward-templates.md).

## Railroad Readiness

AristotleOS now includes a railroad pilot path for governed rail operations. Dispatch/CAD, PTC back office, wayside signal, switch machine, grade crossing, locomotive telemetry, crew management, consist/hazmat, maintenance-of-way, and yard automation surfaces become typed adapter boundaries. They execute only after Ward resolution, Authority Envelope validation, Rail Safety Invariant checks, Commit Gate admission, Warrant verification, and GEL commit.

Run the rail slice:

```bash
npm run test:rail
npm run aristotle -- rail templates
npm run aristotle -- rail adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/rail/ward.subdivision_west.yaml \
  --envelope examples/rail/authority_envelope.dispatcher.yaml \
  --action examples/rail/actions/allow_movement_authority.json \
  --ledger ./.tmp/rail.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

The Command Center includes a Rail workflow from "create governed movement mission" to "admitted execution" to "rail Evidence Bundle export." See [docs/railroad-operator-pilot-guide.md](docs/railroad-operator-pilot-guide.md), [docs/rail.md](docs/rail.md), and [docs/rail-ward-templates.md](docs/rail-ward-templates.md).

## Pipeline Readiness

AristotleOS includes a pipeline (oil & gas / energy) pilot path for governed pump,
compressor, valve, pressure, leak-detection (CPM), and pig operations. SCADA / ICS
protocol requests become typed adapter boundaries (`PIPELINE_ADAPTER_CATALOG`) and
execute only after Ward resolution, Authority Envelope validation, Pipeline Safety
Invariant checks (MAOP/pressure, flow, segment/state, CRM SCADA freshness, leak-detection
armed, overpressure protection, ESD ready, segment isolation, pump primed, operator
qualified), Commit Gate admission, Warrant verification, and GEL commit. It is built to
meet and exceed 49 CFR 192/195, Control Room Management (192.631/195.446), Operator
Qualification (192.801/195.501), and API 1164/1173/RP 1175.

Run the pipeline slice:

```bash
npm run test:pipeline
npm run aristotle -- execution-control evaluate \
  --ward examples/pipeline/ward.transmission_segment.yaml \
  --envelope examples/pipeline/authority_envelope.operations_center.yaml \
  --action examples/pipeline/actions/pump_start.json \
  --ledger ./.tmp/pipeline.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

`refuse_overpressure.json` (pressure above MAOP) and `refuse_leak_detection_offline.json`
(CPM offline) demonstrate fail-closed refusals. See [docs/pipeline.md](docs/pipeline.md),
[docs/pipeline-ward-templates.md](docs/pipeline-ward-templates.md), and
[docs/pipeline-threat-model.md](docs/pipeline-threat-model.md).

## Mining Readiness

AristotleOS includes a mining pilot path for governed autonomous-haulage, ventilation,
blasting, tailings, gas-monitoring, and hoist operations. AHS / SCADA / ICS requests
become typed adapter boundaries (`MINING_ADAPTER_CATALOG`) and execute only after Ward
resolution, Authority Envelope validation, Mining Safety Invariant checks (methane/CO/
oxygen, airflow, haulage speed, tailings pond level & freeboard, proximity detection,
exclusion-zone & personnel clearance, ground control, ventilation, fresh SCADA, operator
qualification), Commit Gate admission, Warrant verification, and GEL commit. It is built
to meet and exceed MSHA 30 CFR 56/57/75/77 (incl. 75.323 methane and 75.1732 proximity
detection), ISO 17757, and ICMM GISTM.

```bash
npm run test:mining
npm run aristotle -- execution-control evaluate \
  --ward examples/mining/ward.open_pit.yaml \
  --envelope examples/mining/authority_envelope.control_room.yaml \
  --action examples/mining/actions/haulage_move.json \
  --ledger ./.tmp/mining.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

`refuse_methane_over_limit.json` and `refuse_exclusion_zone_breach.json` demonstrate
fail-closed refusals; blast initiation, tailings decant, and hoist movement are
dual-control. See [docs/mining.md](docs/mining.md),
[docs/mining-ward-templates.md](docs/mining-ward-templates.md), and
[docs/mining-threat-model.md](docs/mining-threat-model.md).

## Aviation / UAV / eVTOL Readiness

AristotleOS includes an aviation pilot path for governed UAV and eVTOL operations.
UTM/USS, flight-control/autopilot, geofence, payload, detect-and-avoid, C2-link, Remote
ID, and vertiport requests become typed adapter boundaries (`AVIATION_ADAPTER_CATALOG`)
and execute only after Ward resolution, Authority Envelope validation, Aviation Safety
Invariant checks (altitude AGL ceiling, groundspeed, battery RTL reserve, wind/visibility/
ceiling, airspace class/volume/state, geofence active, Remote ID broadcasting, DAA active,
C2 link healthy, airspace authorization, no active TFR, VLOS/waiver, RTL available,
weather within limits, RPIC certificated), Commit Gate admission, Warrant verification,
and GEL commit. It is built to meet and exceed 14 CFR Part 107/108/91/135, Part 89 (Remote
ID), LAANC, ASTM F3548 (UTM), and SORA.

```bash
npm run test:aviation
npm run aristotle -- execution-control evaluate \
  --ward examples/aviation/ward.bvlos_corridor.yaml \
  --envelope examples/aviation/authority_envelope.rpic.yaml \
  --action examples/aviation/actions/waypoint_flight.json \
  --ledger ./.tmp/aviation.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

`refuse_altitude_ceiling.json`, `refuse_active_tfr.json`, and
`refuse_geofence_inactive.json` demonstrate fail-closed refusals; takeoff, payload
release, eVTOL vertiport clearance, and UTM authorization are dual-control. See
[docs/aviation.md](docs/aviation.md),
[docs/aviation-ward-templates.md](docs/aviation-ward-templates.md), and
[docs/aviation-threat-model.md](docs/aviation-threat-model.md).

## UAV Swarm — Disconnected Operations

AristotleOS's UAV-swarm vertical is the runtime expression of the doctrine that
intermittent connectivity is not a corner case: delegated authority must remain
enforceable locally, safety must degrade predictably, and accountability must be provable
after the fact. The vertical is **UAV-swarm-first, not high-altitude-first** — wildfire,
disaster response, agriculture, infrastructure inspection, defense perimeter, and
temporary comms-mesh are the normal operating set; **high-altitude balloon / mothership
(Part 101) is treated as the extreme stress case**.

Core primitives (`SWARM_ADAPTER_CATALOG`): Swarm Orchestrator, Mesh Relay, Airspace
Authority Compiler, Launch Readiness Gate, Flight Warrant Service, Mission
Reconstruction, Fluidity Token Service, Payload Coordination, Balloon Mothership,
Historian. A disconnected flight state machine carries the swarm through *connected →
degraded → mesh-relay → hold-safe → recover → evidence-sync*. Built to meet and exceed
14 CFR Part 107 + waivers, Part 108 (BVLOS), Part 101 (free balloons), Part 89 (Remote
ID), Part 91, LAANC, ASTM F3548 (UTM), and SORA.

```bash
npm run test:swarm
npm run aristotle -- execution-control evaluate \
  --ward examples/swarm/ward.wildfire_swarm.yaml \
  --envelope examples/swarm/authority_envelope.incident_commander.yaml \
  --action examples/swarm/actions/swarm_mission_tick.json \
  --ledger ./.tmp/swarm.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

`refuse_lost_link_timeout.json`, `refuse_fluidity_token_expired.json`, and
`refuse_mesh_unhealthy.json` demonstrate the three load-bearing disconnected-operation
refusals; launch, recovery, payload release, and balloon ops are dual-control. See
[docs/swarm.md](docs/swarm.md), [docs/swarm-ward-templates.md](docs/swarm-ward-templates.md),
and [docs/swarm-threat-model.md](docs/swarm-threat-model.md).

## Robotics / Humanoid Readiness

AristotleOS includes a robotics pilot path for governed industrial-arm, collaborative-
cobot, AMR, and **humanoid** operations. Motion, manipulation, mobile-base, humanoid-
locomotion, teleoperation, human-robot-interaction, safety-config, and fleet requests
become typed adapter boundaries (`ROBOTICS_ADAPTER_CATALOG`) and execute only after Ward
resolution, Authority Envelope validation, Robotics Safety Invariant checks (TCP speed,
force/torque/power biomechanical limits, separation distance, center-of-mass deviation and
step height for humanoids, payload, operating mode/zone/state, e-stop, protective stop,
SSM, PFL, collision detection, safety scanner, balance controller, fall protection,
operator qualification, and collaborative-mode-when-human-present), Commit Gate admission,
Warrant verification, and GEL commit. It is built to meet and exceed ISO 10218-1/-2,
ISO/TS 15066, ANSI/RIA R15.06/.08, ISO 3691-4, ISO 13482, and ISO 13849 / IEC 61508.

```bash
npm run test:robotics
npm run aristotle -- execution-control evaluate \
  --ward examples/robotics/ward.humanoid_cell.yaml \
  --envelope examples/robotics/authority_envelope.cell_operator.yaml \
  --action examples/robotics/actions/humanoid_step.json \
  --ledger ./.tmp/robotics.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

`refuse_force_over_limit.json`, `refuse_separation_breach.json`, and
`refuse_human_present_not_collaborative.json` demonstrate fail-closed refusals; force
application, humanoid locomotion, teleop takeover, and fleet dispatch are dual-control. See
[docs/robotics.md](docs/robotics.md),
[docs/robotics-ward-templates.md](docs/robotics-ward-templates.md), and
[docs/robotics-threat-model.md](docs/robotics-threat-model.md).

## Maritime Port Readiness

AristotleOS now includes a maritime port pilot path for governed terminal operations. Terminal Operating System, Port Community / EDI, customs hold, VTS/AIS/PNT, crane automation, gate OCR/access, yard tractor, reefer, weighbridge/VGM, shore-power, and bunkering/hazmat surfaces become typed adapter boundaries. They execute only after Ward resolution, Authority Envelope validation, Port Safety Invariant checks, Commit Gate admission, Warrant verification, and GEL commit.

Run the port slice:

```bash
npm run test:port
npm run aristotle -- port templates
npm run aristotle -- port adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/port/ward.container_terminal_alpha.yaml \
  --envelope examples/port/authority_envelope.terminal_orchestrator.yaml \
  --action examples/port/actions/allow_container_release.json \
  --ledger ./.tmp/port.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

The Command Center includes a Port workflow from "create governed terminal mission" to "admitted execution" to "port Evidence Bundle export." See [docs/port-operator-pilot-guide.md](docs/port-operator-pilot-guide.md), [docs/port.md](docs/port.md), and [docs/port-ward-templates.md](docs/port-ward-templates.md).

## Water Infrastructure Readiness

AristotleOS now includes a water and wastewater pilot path for governed utility operations. SCADA/plant control, PLC/RTU, pump station, valve/pressure-zone, chemical dosing, lab/LIMS, historian, AMI, tank/reservoir, lift-station, UV/disinfection, and wastewater discharge surfaces become typed adapter boundaries. They execute only after Ward resolution, Authority Envelope validation, Water Safety Invariant checks, Commit Gate admission, Warrant verification, and GEL commit.

Run the water slice:

```bash
npm run test:water
npm run aristotle -- water templates
npm run aristotle -- water adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/water/ward.drinking_water_plant.yaml \
  --envelope examples/water/authority_envelope.water_operator.yaml \
  --action examples/water/actions/allow_pump_speed_adjust.json \
  --ledger ./.tmp/water.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

The Command Center includes a Water workflow from "create governed treatment mission" to "admitted execution" to "water Evidence Bundle export." See [docs/water-operator-pilot-guide.md](docs/water-operator-pilot-guide.md), [docs/water.md](docs/water.md), and [docs/water-ward-templates.md](docs/water-ward-templates.md).

## Trucking and Logistics Readiness

AristotleOS now includes a trucking and logistics pilot path for governed freight operations. TMS dispatch, broker/carrier tender, ELD/HOS, telematics route changes, WMS release, YMS dock/gate, fuel advances, accessorial/payment approval, cold-chain, hazmat routing, DVIR, and cross-border workflows become typed adapter boundaries. They execute only after Ward resolution, Authority Envelope validation, Logistics Safety Invariant checks, Commit Gate admission, Warrant verification, and GEL commit.

Run the logistics slice:

```bash
npm run test:logistics
npm run aristotle -- logistics templates
npm run aristotle -- logistics adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/logistics/ward.network_west.yaml \
  --envelope examples/logistics/authority_envelope.dispatch_orchestrator.yaml \
  --action examples/logistics/actions/allow_load_dispatch.json \
  --ledger ./.tmp/logistics.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

The Command Center includes a Logistics workflow from "create governed load mission" to "admitted dispatch" to "logistics Evidence Bundle export." See [docs/logistics-operator-pilot-guide.md](docs/logistics-operator-pilot-guide.md), [docs/logistics.md](docs/logistics.md), and [docs/logistics-ward-templates.md](docs/logistics-ward-templates.md).

## Aristotle Verified Title Transaction Layer

AristotleOS now includes a vehicle title and registration pilot path that governs
consequential title, lien, registration, and DMV-document actions **before** they cross
into legal effect. Vitu, CVR, Dealertrack, DDI Technology, and Reynolds & Reynolds move
bits to government endpoints; **this layer proves every consequential title action was
authorized, state-rule compliant, fraud-checked, and audit-ready before it executed.**

Adapter surfaces (`TITLE_ADAPTER_CATALOG`): ELT lien, title transaction, registration,
digital signature, dealer workflow, lender workflow, DMV submission, fraud check, NMVTIS,
historian. Designed to align with (DEMONSTRATION ONLY — not legal advice): state ELT
programs, NMVTIS, 49 CFR Part 580 (odometer), ESIGN/UETA, AAMVA DLDV, UCC Article 9, and
state motor-vehicle codes. `JURISDICTION_RULE_PRESETS` ships sample rule sets for **MT,
OR, CA, TX, FL**.

```bash
npm run test:title
npm run aristotle -- execution-control evaluate \
  --ward examples/title/ward.mt_lender_ops.yaml \
  --envelope examples/title/authority_envelope.title_orchestrator.yaml \
  --action examples/title/actions/allow_lien_release_clean_mt.json \
  --ledger ./.tmp/title.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

`refuse_unauthorized_signer.json` and `refuse_revoked_envelope.json` demonstrate fail-
closed refusals; transfer, correction, interstate registration, and DMV submission are
dual-controlled. See [docs/title.md](docs/title.md),
[docs/title-ward-templates.md](docs/title-ward-templates.md), and
[docs/title-threat-model.md](docs/title-threat-model.md).

> **Demonstration only.** All shipped jurisdiction rules and sample data are
> demonstration material; validate with counsel before any production use.

## Ward/Warrant Execution-Control Path

This AristotleOS component is independently developed. It may discuss Faramesh as a public example of the broader runtime authorization and execution-control category, but it does not copy Faramesh source code, documentation, examples, schemas, tests, comments, file names, repository structure, policy syntax, branding, or expressive material. AristotleOS is not affiliated with, certified by, sponsored by, or endorsed by Faramesh.

It canonicalizes a proposed action, evaluates it through a Ward and Authority Envelope at the Commit Gate, returns `ALLOW`, `ESCALATE`, or `REFUSE`, issues a single-use Warrant only on `ALLOW`, and appends the decision to a hash-linked Governance Evidence Ledger.

Run the demo:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/execution_control/ward.montana_drone_test_range.yaml \
  --envelope examples/execution_control/authority_envelope.survey_planner.yaml \
  --action examples/execution_control/actions/allow_takeoff.json \
  --ledger ./.tmp/gel.jsonl \
  --now 2026-05-21T14:00:00.000Z
```

Run it as a local execution-control daemon:

```bash
npm run execution-control:dev
```

Then submit an action from another terminal:

```bash
npm run execution-control:submit:allow
```

Export and verify a portable Evidence Bundle:

```bash
npm run execution-control:evidence:demo
npm run execution-control:evidence:verify
```

The runtime also publishes `GET /openapi.json` so agent adapters can discover the execution-boundary contract.

Sandboxed execution: `governSandboxExecution` runs a command in a sandbox **only
after ALLOW + a verified Warrant**, sealing the result into a signed Execution
Receipt hash-bound to the Warrant and GEL record. A built-in
`LocalProcessSandboxProvider` (allowlist/timeout/output-cap/cwd/env) ships in-box;
E2B/Daytona/Modal/Riza adapters use an injected-client pattern (no SDK
dependency). `aristotle sandbox run|providers|receipt verify`. See
[docs/sandboxes.md](docs/sandboxes.md).

Shadow Mode: observe what the boundary *would* ALLOW/REFUSE/ESCALATE on real
traffic — against an ephemeral ledger, never the live one, never weakening policy —
to de-risk rollout before enforcing. `aristotle execution-control shadow ...`
produces a GEL-compatible report with rollout readiness. See
[docs/shadow-mode.md](docs/shadow-mode.md).

Observability: pass W3C trace context (`traceparent`) into a governed action and
it is stamped into the signed GEL record; inject an OpenTelemetry-shaped tracer for
spans around each decision phase; scrape `/metrics` for decision/reason-code/
latency/failure series. No OTel dependency. See
[docs/observability.md](docs/observability.md).

Operator access control at the boundary: authenticate `/v1` with an API key,
role-scoped `--operator` tokens, or OIDC (`--oidc-config`); roles
`viewer < operator < admin` are enforced per route, the operator identity is
written into the signed ledger, and admin-only kill switch / revocation are exposed
at `POST /v1/execution-control/admin/{kill,revoke}`. See
[docs/ACCESS_CONTROL.md](docs/ACCESS_CONTROL.md). (This is distinct from the
service-mesh gateway operator RBAC documented under "Operator RBAC" below.)

## Stack
- Node.js 20
- TypeScript
- Express
- Docker Compose

## Services
- governance-kernel
- policy-compiler
- evidence-ledger
- meta-authority-registry
- simulation-engine
- authority-router
- witness-service
- execution-gate
- agent-os
- http-gateway

## Agent OS
`agent-os` adds the AI runtime layer that this repo was missing. It manages mission orchestration, agent registration, workspace sessions, tool leases, and mission memory behind the existing governance mesh.

Runtime persistence:
- `agent-os` persists mission, workspace, lease, agent, and memory state to `AGENT_OS_STATE_PATH`
- `evidence-ledger` persists committed and counterfactual replay history to `EVIDENCE_LEDGER_STATE_PATH`

Execution loop:
- mission advancement can now seed execution tasks, dispatch them to agents, and emit execution receipts
- the console surfaces both the execution queue and recent execution receipts through the live gateway snapshot
- execution task queueing, dispatch, completion, and halt events are now committed into the evidence ledger for durable audit
- each execution task now performs a governance pass before dispatch and completion by compiling mission policy, validating an authority envelope, evaluating admissibility, and requesting a warrant
- pre-execution task dispatch now also passes through an explicit commit-point execution gate so kill-switch state, identity legitimacy, authority approval, and telemetry satisfaction are checked at the execution boundary
- blocked governance decisions are persisted in task state, emitted as receipts, and surfaced in the console with policy, envelope, and warrant references when available
- approved completions now continue through witness verification, execution-gate decisioning, and finality certificate emission before the task is treated as fully closed
- on restart, `agent-os` now reconciles persisted runtime state by re-queuing in-flight tasks, revoking expired or closed-mission leases, normalizing workspace posture, and recording recovery events in both memory and the ledger
- long-running execution now renews active leases on task claim/heartbeat, re-queues stale work when heartbeats lapse, and caps retries with a configurable attempt budget

Gateway routes:
- `GET /ready`
- `GET /metrics`
- `GET /operator/os/state`
- `GET /operator/os/missions`
- `POST /operator/os/agents`
- `POST /operator/os/workspaces`
- `POST /operator/os/missions`
- `POST /operator/os/missions/:missionId/advance`
- `POST /operator/os/reconcile`
- `GET /operator/os/tasks/next`
- `POST /operator/os/tasks/:taskId/claim`
- `POST /operator/os/tasks/:taskId/heartbeat`
- `POST /operator/os/tasks/:taskId/complete`
- `POST /operator/os/tasks/:taskId/retry`
- `GET /operator/os/tasks/:taskId/actions`
- `POST /operator/os/tasks/:taskId/actions`
- `POST /operator/os/tasks/:taskId/actions/:actionId/execute`
- `POST /operator/os/leases/:leaseId/renew`

## Quick start
This is a **pnpm workspace** (it uses the `workspace:` protocol; `npm install`/`yarn`
will fail fast with a guide to pnpm). `pnpm-lock.yaml` is the single source of truth.
```bash
cp .env.example .env
corepack enable
corepack pnpm install   # use pnpm — npm cannot resolve workspace: deps
corepack pnpm dev
```

Local control plane:
- `npm run local:up` builds the workspace, starts the runtime services in dependency order, waits for health checks, serves the built console, and writes process logs under `logs/local-control-plane/`
- `npm run local:status` shows service health, URLs, and recorded process IDs
- `npm run local:down` stops the services started by the local supervisor
- the local supervisor uses `SERVICE_DISCOVERY_MODE=local`, enables the Ward/Warrant chain in shadow mode by default, and persists local state under `data/`
- use `npm run local:up -- --no-build` when the workspace is already built and you only need a fast restart

Dashboard canvas:
- the operator dashboard now runs as a Vite app from `apps/console-ui`
- after `npm run dev`, open `http://localhost:4173`
- the canvas proxies live service calls to the gateway on `http://localhost:8080`
- the command deck now includes deployable-specific operator surfaces for agents, ground vehicles, aerial drones, infrastructure, robotics, industrial systems, cyber operations, maritime systems, and assurance
- deployable surfaces are served by the control plane at `GET /operator/deployables` so domain views stay aligned with the same governance kernel
- set `OPERATOR_API_KEY` in `.env` to require a credential on `/operator/*`
- set `OPERATOR_SESSION_ENFORCEMENT=true` and `OPERATOR_SESSION_SECRET` to require short-lived signed bearer sessions on `/operator/*`
- set `VITE_OPERATOR_API_KEY` for the console app when you want the browser dashboard to authenticate automatically
- set `VITE_OPERATOR_ACTOR` when you want dashboard-issued governance actions to carry a stable enterprise operator identity
- set `VITE_OPERATOR_ROLE` when you want dashboard requests to carry an explicit enterprise operator role

Gateway production preflight:
- when `NODE_ENV=production`, the gateway now refuses to start unless critical enterprise controls are configured
- production boot requires:
  - `OPERATOR_API_KEY`
  - `OPERATOR_SESSION_SECRET` when `OPERATOR_SESSION_ENFORCEMENT=true`
  - `SERVICE_DISCOVERY_MODE` not equal to `local`
  - explicit `EVIDENCE_LEDGER_STATE_PATH`
  - explicit `AGENT_OS_STATE_PATH`
- `GET /health` now includes gateway preflight posture and checks
- `GET /ready` is the strict readiness gate: it fails with `503` when preflight fails or any critical governance upstream is unavailable
- `GET /metrics` exposes Prometheus-compatible readiness, fail-closed, upstream health, upstream latency, and active governance halt gauges
- `GATEWAY_CRITICAL_SERVICES` can narrow or expand the comma-separated critical upstream set used by `/ready`
- `GATEWAY_READINESS_TIMEOUT_MS` controls per-upstream readiness probe timeout
- `ALLOW_INSECURE_PRODUCTION_BOOT=true` exists only as an emergency override and should not be used for normal enterprise deployment

Core validation:
- `npm run validate:core`
- runs a live end-to-end governance validation against the gateway
- checks governed dispatch with route context, scoped kill-switch blocking, replay memory for sovereign halt, and counterfactual reroute branch artifacts
- override the target gateway with `GATEWAY_BASE_URL=http://host:port npm run validate:core`
- if operator auth is enabled, export the same `OPERATOR_API_KEY` before running `npm run validate:core`
- set `OPERATOR_ACTOR` if you want validation-driven operator actions to be attributed consistently in ledger evidence
- set `OPERATOR_ROLE` if role enforcement is enabled and you want validation to act as a permitted role

Runtime benchmarking:
- `npm run benchmark:runtime`
- exercises the governance-core execution boundary in process without requiring a running service mesh
- measures warrant issuance, admissibility commit-gate evaluation, fail-closed missing-warrant handling, revocation blocking, GEL append throughput, and replay/hash-chain verification
- writes machine-readable JSON plus a Markdown operator report under `reports/`
- tune sample size with `npm run benchmark:runtime -- --iterations 5000 --warmup 500 --out reports/runtime-benchmark.json`

Operator RBAC:
- set `OPERATOR_ROLE_ENFORCEMENT=true` to enforce operator roles at the gateway
- `OPERATOR_READ_ROLES` controls which roles may use read-only `/operator/*` routes
- `OPERATOR_MUTATION_ROLES` controls which roles may mutate the governance plane
- `OPERATOR_READ_ACTORS` optionally allowlists named operator actors for read routes
- `OPERATOR_MUTATION_ACTORS` optionally allowlists named operator actors for mutation routes
- `OPERATOR_DEFAULT_ROLE` is used when no `x-operator-role` header is supplied
- `OPERATOR_SESSION_ENFORCEMENT=true` requires callers to mint a signed session at `POST /operator/auth/session` before using `/operator/*`
- `OPERATOR_SESSION_SECRET` signs those bearer sessions
- `npm run enterprise:keys` generates an Ed25519 ledger keypair under `./secrets`
- set `EVIDENCE_LEDGER_SIGNING_PRIVATE_KEY_PATH` and `EVIDENCE_LEDGER_SIGNING_PUBLIC_KEY_PATH` to move immutable evidence from HMAC signing to asymmetric Ed25519 signing
- `npm run enterprise:backup` snapshots the governed durable state into `./backups`
- `npm run enterprise:restore` restores the latest snapshot back into the governed state paths
- `npm run enterprise:drill` runs a non-destructive disaster recovery drill: backup plus restore verification
- by default:
  - `viewer`, `operator`, and `admin` may read
  - `operator` and `admin` may mutate

Or:
```bash
docker compose up --build
```

Enterprise stack:
- use `.env.production.example` as the starting template for production promotion
- Kubernetes production manifests live under `manifests/k8s/`: apply `namespace.yaml`, create a real `aristotle-runtime-secrets` Secret using `production-secrets.example.yaml` as the contract, then apply `control-plane.yaml`, `network-policy.yaml`, `gateway-deployment.yaml`, and `observability.yaml`
- Pilot cluster installs use the Helm chart under `charts/aristotle-governance-os` through `npm run pilot:install -- --tag <immutable-image-tag>`; see `docs/pilot-install.md`
- `npm run stack:up` builds and starts the full service mesh plus the dashboard
- `npm run stack:down` stops the stack
- `npm run stack:logs` tails the full stack logs
- `npm run enterprise:preflight` enforces enterprise-safe production configuration before boot
- `npm run enterprise:contracts` verifies that gateway fail-closed readiness, metrics, Compose healthchecks, Kubernetes control-plane manifests, namespace pod-security posture, network policy boundaries, Prometheus scrape/alert contracts, probes, resources, durable state, and security context stay wired
- `npm run enterprise:ui-safety` verifies that the operator console keeps visible readiness gates, mutation blocks, scoped halt validation, confirmation prompts, and mission/agent form validation wired
- `npm run enterprise:release-manifest` emits a hashed release manifest and Markdown summary under `reports/`; set `RELEASE_MANIFEST_SIGNING_SECRET` to sign it with HMAC
- `npm run enterprise:verify` runs enterprise preflight plus full stack and constitutional verification
- `npm run stack:smoke` verifies gateway health/preflight, deployment posture, deployable catalog, operator reachability, assurance report availability, and dashboard reachability
- `npm run stack:verify` runs both deployment smoke validation and the deeper constitutional runtime validation
- the compose stack now includes:
  - health checks for every governance service
  - startup dependency gating on healthy upstream services
  - `restart: unless-stopped`
  - a containerized `console-ui` on `http://localhost:4173`
- operational deployment and recovery guidance now lives in `docs/deployment-runbook.md`
