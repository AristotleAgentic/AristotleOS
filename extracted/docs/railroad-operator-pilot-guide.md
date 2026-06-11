# Railroad Operator Pilot Guide

This guide describes a practical AristotleOS pilot for railroads.

## Pilot Goal

Demonstrate governed autonomous rail execution from proposed movement authority
to Commit Gate decision, Warrant issuance, adapter execution, GEL commit, and
Rail Evidence Bundle export.

## Recommended First Use Case

Start with a dispatch assistant that proposes a movement authority on a simulated
PTC-governed subdivision.

Pilot actions:

- issue movement authority
- synchronize PTC authority material
- request signal route clear
- request switch alignment
- acknowledge crew bulletin
- validate consist/hazmat route
- release maintenance-of-way work zone

## Pilot Flow

1. Create governed rail mission.
2. Load Rail Ward and dispatcher Authority Envelope.
3. Feed runtime registers from a simulator or exported dispatch/PTC snapshot.
4. Run in Shadow Mode against recent or simulated dispatch decisions.
5. Promote to staged enforcement for non-vital adapter dry runs.
6. Admit allowed movement authority and issue a single-use Warrant.
7. Refuse conflicting authority, PTC disable, and unproven switch cases.
8. Export Rail Evidence Bundle.
9. Replay the GEL chain and verify bundle integrity offline.

## One-Command Local Slice

```bash
npm run test:rail
npm run aristotle -- execution-control evaluate \
  --ward examples/rail/ward.subdivision_west.yaml \
  --envelope examples/rail/authority_envelope.dispatcher.yaml \
  --action examples/rail/actions/allow_movement_authority.json \
  --ledger ./.tmp/rail.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

## Evidence Export

```bash
npm run aristotle -- rail evidence export \
  --ward examples/rail/ward.subdivision_west.yaml \
  --envelope examples/rail/authority_envelope.dispatcher.yaml \
  --ledger ./.tmp/rail.gel.jsonl \
  --out ./.tmp/rail-evidence.json \
  --railroad northstar-rail \
  --ops-center west-dispatch \
  --territory west-subdivision \
  --subdivision "West Subdivision" \
  --milepost-from 12.4 \
  --milepost-to 18.9 \
  --train NSR-4521 \
  --symbol M-WEST-4521 \
  --locomotive NSR-8842 \
  --authority MA-2026-0525-019 \
  --dispatcher dispatcher:west-desk-a \
  --crew crew:4521 \
  --consist sha256:consist-4521-a \
  --route route-west-main-1 \
  --track main-1
```

## Pilot Success Criteria

- allowed movement authority returns `ALLOW`
- conflicting authority returns `REFUSE`
- missing PTC runtime state returns `ESCALATE`
- PTC disable returns `REFUSE`
- signal clear and switch align require dual control
- every decision commits to GEL
- exported Rail Evidence Bundle verifies offline

## Production Promotion Checklist

- trusted telemetry source for PTC, switch, signal, grade crossing, consist, and crew state
- signed runtime registers or attested telemetry
- hardened operator identity and dual-control policy
- clock discipline
- fail-closed evidence storage
- simulator replay coverage
- host/tenant Ward federation for tenant railroad operations
- documented separation from vital PTC and signal certification boundary
