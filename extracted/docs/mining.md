# Mining execution-control path

## What it is

A mining vertical for AristotleOS that governs **autonomous-haulage, ventilation, blasting,
tailings, gas-monitoring, and hoist** commands **before** they reach the field. Adapters
translate AHS / SCADA / ICS requests into Canonical Governed Actions; the Commit Gate
returns ALLOW / REFUSE / ESCALATE / FAIL-CLOSED and issues a single-use Warrant only when
the authority chain and every mining safety invariant hold. Adapters must verify the
Warrant before sending any field command.

Built to **meet and exceed** the governing regimes:

| Regime | Requires | How this vertical exceeds it |
|---|---|---|
| MSHA 30 CFR 56/57/75/77 | Ventilation, ground control, hoisting, blasting controls | Hard interlocks + per-command readiness checks at the gate |
| 30 CFR 75.323 (methane) | Action levels for methane | `max_methane_pct` enforced per command; gas monitoring must be armed |
| 30 CFR 75.1732 (proximity detection) | Proximity detection on mobile machines | Hard interlock on disabling proximity detection; `require_proximity_detection` |
| ISO 17757 (autonomous machines) | Exclusion zones, object detection | `require_exclusion_zone_clear` + speed ceiling before any AHS movement |
| ICMM GISTM (tailings) | TSF surveillance & freeboard | `max_tailings_pond_level_m`, `min_tailings_freeboard_m`, piezometer monitoring; hard interlock on disabling monitoring |

## Adapter surfaces

`MINING_ADAPTER_CATALOG`: `autonomous-haulage`, `ventilation-control`, `blasting-control`,
`tailings-control`, `gas-monitoring`, `hoist-control`, `modbus`, `dnp3`, `opc-ua`,
`historian-write` — each with its consequence boundary, required runtime registers, and
regulatory basis.

## What it prevents

Hard interlocks (REFUSE even if an envelope mistakenly allows them):
`mining.disable_proximity_detection`, `mining.disable_gas_monitoring`,
`mining.disable_ventilation`, `mining.disable_ground_control_monitoring`,
`mining.disable_tailings_monitoring` / `piezometer.disable`,
`hoist.disable_overspeed_protection`, `blast.force_initiate`.

Per-command bounds: methane / CO / oxygen, minimum airflow, haulage speed ceiling,
tailings pond level & freeboard, hoist load, permitted site/zone/state/asset-type, fresh
SCADA, and readiness flags (proximity detection, exclusion zone clear, personnel cleared,
ground control stable, gas monitoring on, ventilation on, operator qualified).

## How to try it

```bash
npm run test:mining

# ALLOW: an autonomous haul-truck movement authority with all safety registers satisfied
npm run aristotle -- execution-control evaluate \
  --ward examples/mining/ward.open_pit.yaml \
  --envelope examples/mining/authority_envelope.control_room.yaml \
  --action examples/mining/actions/haulage_move.json \
  --ledger ./.tmp/mining.gel.jsonl --now 2026-05-25T15:00:00.000Z

# REFUSE: methane above the action level
npm run aristotle -- execution-control evaluate \
  --ward examples/mining/ward.open_pit.yaml \
  --envelope examples/mining/authority_envelope.control_room.yaml \
  --action examples/mining/actions/refuse_methane_over_limit.json \
  --ledger ./.tmp/mining.gel.jsonl --now 2026-05-25T15:00:00.000Z

# REFUSE: haul-truck movement while the exclusion zone is not clear
npm run aristotle -- execution-control evaluate \
  --ward examples/mining/ward.open_pit.yaml \
  --envelope examples/mining/authority_envelope.control_room.yaml \
  --action examples/mining/actions/refuse_exclusion_zone_breach.json \
  --ledger ./.tmp/mining.gel.jsonl --now 2026-05-25T15:00:00.000Z
```

Blast initiation, tailings decant, and hoist movement are dual-control: they ESCALATE
until two qualified approvers sign, then ALLOW.

## Evidence produced

`exportMiningEvidenceBundle()` wraps the signed execution Evidence Bundle with mining
context (operator, control room, site, zone, system model, ground-hazard level, and a
`regulatory_evidence_profile` covering MSHA Parts 56/57/75/77, methane, proximity
detection, ISO 17757, ICMM GISTM, ground-control plan, blast clearance).
`verifyMiningEvidenceBundle()` re-verifies it offline; tampering is detected. See
[mining-ward-templates.md](mining-ward-templates.md) and
[mining-threat-model.md](mining-threat-model.md).
