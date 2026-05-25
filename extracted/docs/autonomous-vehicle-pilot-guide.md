# Autonomous Vehicle Pilot Guide

This guide describes a narrow, defensible pilot for an autonomous vehicle company
or fleet operator.

## Pilot objective

Prove that AristotleOS can govern consequential vehicle-adjacent actions before
execution:

- fleet hold / return-to-base
- OTA campaign staging
- map activation
- remote-assist pull-over command
- simulation replay
- refusal of safety-envelope disablement or speed-envelope violations

## Pilot topology

```text
Autonomy or fleet agent
-> AristotleOS execution-control boundary
-> Commit Gate + Vehicle Safety Invariants
-> Warrant verifier
-> vehicle adapter boundary
-> GEL + Automotive Evidence Bundle
```

The first pilot should run in simulation or a closed test fleet. The adapter can
point at mock ROS 2, AUTOSAR, OTA, map, and remote-assist clients while preserving
the exact typed interface and Warrant verification pattern.

## Acceptance gates

1. `fleet.vehicle.hold` receives `ALLOW`, a Warrant, and a GEL record.
2. `refuse_speed_envelope_violation.json` receives `REFUSE` with
   `PHYSICAL_INVARIANT_FAILED`.
3. `ota.campaign.stage` receives `ESCALATE` without an approval store.
4. `ota.campaign.stage` receives `ALLOW` only after M-of-N dual control.
5. Automotive Evidence Bundle verification returns `ok`.
6. The Fleet Safety Console shows the workflow from mission to Warrant to evidence
   export.

## Commands

```bash
npm run test:automotive
npm run aristotle -- automotive templates
npm run aristotle -- execution-control evaluate \
  --ward examples/automotive/ward.fleet_region_west.yaml \
  --envelope examples/automotive/authority_envelope.fleet_safety_operator.yaml \
  --action examples/automotive/actions/fleet_vehicle_hold.json \
  --ledger ./.tmp/automotive.gel.jsonl
```

## Evidence package

For a pilot review, export:

- Ward Manifest
- Authority Envelope
- APL policy
- action JSON
- Warrant if admitted
- GEL record and ledger verification
- Automotive Evidence Bundle
- Shadow Mode report
- Conflict Inbox report for any disconnected edge replay

## Production hardening still required

- integrate real ROS 2/DDS and AUTOSAR clients behind Warrant verification
- attach fleet identity and device attestation
- bind map and software signatures to trusted release keys
- run reconnect-storm and soak tests at fleet scale
- integrate SIEM/SOC alerting for refused and escalated vehicle actions
- run formal safety-case review before public-road enforcement
