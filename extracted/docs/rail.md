# Railroad Execution-Control Path

AristotleOS governs autonomous and automated rail operations before they become
movement, dispatch, PTC, wayside, yard, maintenance, or consist consequences.

It does not replace PTC, signal logic, interlockings, dispatcher authority, or
other vital railroad systems. It sits before those systems as an execution
governance boundary: authority before rail consequence, warrant before command
execution, evidence after every decision.

## What It Is

The rail path turns railroad operational requests into Canonical Governed
Actions. The Commit Gate evaluates those actions against a Rail Ward, Authority
Envelope, runtime register snapshot, rail safety invariants, dual-control
approval state, revocation state, and evidence ledger posture.

Supported adapter surfaces:

- Dispatch / CAD
- PTC back office
- Wayside signal
- Switch machine
- Grade crossing
- Locomotive / onboard telemetry
- Crew management
- Consist and hazmat routing
- Maintenance-of-way
- Yard automation

## Why It Exists

Railroads operate with territory, movement authority, dispatcher accountability,
host/tenant interoperability, track occupancy, PTC enforcement, wayside signal
state, switch proof, train consist, work-zone protection, and audit obligations.
Generic agent controls do not understand those boundaries.

AristotleOS adds a deterministic execution-control layer so autonomous rail
systems cannot issue consequential commands merely because a tool credential is
available.

## Runtime Position

Canonical path:

Intent -> Canonical Rail Action -> Rail Ward -> Authority Envelope -> Runtime
Register Snapshot -> Rail Safety Invariants -> Commit Gate -> Warrant -> Adapter
Execution -> Governance Evidence Ledger -> Replay / Audit

## What It Prevents

- Movement authority outside territory
- Conflicting authority
- Route lineup without switch proof
- Signal clear while aspect or route state is unsafe
- PTC cut-out or enforcement override
- Work-zone movement before release
- Grade crossing movement without protection
- Hazmat routing without route validation
- Stale PTC telemetry
- Dispatch action without dispatcher identity
- Autonomous rail action without regulator-readable evidence

## Developer Use

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

## Evidence Produced

Rail Evidence Bundles include:

- Ward and Authority Envelope material
- selected GEL record
- Warrant, when issued
- movement authority id
- railroad, territory, subdivision, route, track, and milepost limits
- train id, symbol, locomotive, consist hash, dispatcher, and crew reference
- PTC status
- pre/post checks
- redaction manifest
- offline-verifiable hashes

## Boundary Statement

The adapter is never the authority. It is an execution boundary that may proceed
only after the Commit Gate admits the action and the Warrant verifies against the
canonical rail action hash.
