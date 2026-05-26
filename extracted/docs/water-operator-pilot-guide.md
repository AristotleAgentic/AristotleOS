# Water Utility Operator Pilot Guide

This guide is the first pilot path for a drinking-water or wastewater utility.
It is designed to prove governed autonomous execution without replacing plant
control systems.

## Pilot Goal

Show that AristotleOS can admit a safe pump adjustment, refuse unsafe chemical
or disinfection actions, escalate missing telemetry, require dual control for
high-consequence actions, and export a Water Evidence Bundle.

## Pilot Architecture

```text
Agent or optimizer intent
  -> Canonical Governed Action
  -> Water Ward
  -> Authority Envelope
  -> Runtime Register Snapshot
  -> Water Safety Invariants
  -> Commit Gate
  -> Warrant on ALLOW
  -> SCADA/PLC/pump/valve/dosing adapter
  -> GEL record
  -> Water Evidence Bundle
```

## One-Command Local Slice

```bash
npm run test:water
```

Then inspect the templates:

```bash
npm run aristotle -- water templates
npm run aristotle -- water adapters
```

Evaluate a safe pump action:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/water/ward.drinking_water_plant.yaml \
  --envelope examples/water/authority_envelope.water_operator.yaml \
  --action examples/water/actions/allow_pump_speed_adjust.json \
  --ledger ./.tmp/water.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

Evaluate a refused chemical action:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/water/ward.drinking_water_plant.yaml \
  --envelope examples/water/authority_envelope.water_operator.yaml \
  --action examples/water/actions/refuse_chlorine_overfeed.json \
  --ledger ./.tmp/water-refuse.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z
```

## Evidence Export

```bash
npm run aristotle -- water evidence export \
  --ward examples/water/ward.drinking_water_plant.yaml \
  --envelope examples/water/authority_envelope.water_operator.yaml \
  --ledger ./.tmp/water-refuse.gel.jsonl \
  --out ./.tmp/water-evidence.json \
  --utility west-municipal-water \
  --system west-water-system \
  --facility west-treatment-plant \
  --ops-center west-water-control \
  --asset PUMP-WEST-2 \
  --asset-type pump \
  --process-area distribution \
  --pressure-zone west-zone-a \
  --work-order WO-WATER-0525-11 \
  --permit NPDES-WEST-001 \
  --chlorine 0.8 \
  --ph 7.3 \
  --turbidity 0.08 \
  --pressure 62 \
  --tank-level 66 \
  --flow 12.4 \
  --redact customer_id
```

## Pilot Acceptance

- Safe pump action returns `ALLOW` and a Warrant.
- Chlorine overfeed returns `REFUSE`.
- Backflow-sensitive valve action returns `REFUSE`.
- Missing turbidity returns `ESCALATE`.
- Disinfection disable returns `REFUSE` even if misconfigured as allowed.
- Dual-control chemical action does not mint a Warrant until two distinct
  approvals exist.
- Water Evidence Bundle verifies.

## Production Notes

- Put AristotleOS at the adapter boundary, not inside PLC ladder logic.
- Verify Warrant at the last software hop before the SCADA/PLC action.
- Keep manual fallback and emergency procedures independent.
- Keep plant operators and water-quality staff as explicit approvers for
  high-consequence actions.
- Treat evidence export as compliance and incident material, with redaction by
  default.
