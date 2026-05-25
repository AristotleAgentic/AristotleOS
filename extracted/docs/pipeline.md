# Oil & gas pipeline execution-control path

## What it is

A pipeline vertical for AristotleOS that governs **pump, compressor, valve, pressure,
leak-detection, and pig** commands **before** they reach the field. Adapters translate
SCADA / ICS protocol requests into Canonical Governed Actions; the Commit Gate decides
ALLOW / REFUSE / ESCALATE / FAIL-CLOSED and issues a single-use Warrant only when the
full authority chain and every pipeline safety invariant hold. Adapters never operate
equipment directly — they must verify the Warrant before sending any field command.

It is built to **meet and exceed** the governing regimes:

| Regime | What it requires | How this vertical exceeds it |
|---|---|---|
| 49 CFR 192 / 195 (MAOP/MOP, overpressure protection) | Operate within MAOP; overpressure protection | Hard interlock on overpressure-protection disable; pressure & %-of-MAOP ceiling enforced **per command** with margin |
| 49 CFR 192.631 / 195.446 (Control Room Management) | Accurate, timely SCADA; alarm integrity | Stale SCADA (`max_telemetry_age_ms`, `require_pipeline_scada_fresh`) **blocks** the command |
| 49 CFR 192.801 / 195.501 (Operator Qualification) | Qualified personnel for covered tasks | `require_operator_qualified` attestation enforced at the gate |
| 49 CFR 195.134 / 195.444, API RP 1175 (leak detection) | CPM leak detection program | Hard interlock on leak-detection disable; `require_leak_detection_armed` before consequential acts |
| API 1164 (SCADA security) | Access control, integrity | Per-action authority chain, signed Warrants, tamper-evident ledger |
| API 1173 (Pipeline SMS) | Management-of-change, evidence | Every decision is a signed GEL record; dual control for high-consequence acts |

## Runtime placement

```
agent / control app
      │  pipeline adapter request (SCADA / pump / valve / pressure / CPM / pig)
      ▼
*ToAction()  ──►  Commit Gate (evaluateExecutionControl)
                       │  authority chain + physical invariants + dual control
                       ▼
                  ALLOW + single-use Warrant ──► adapter verifies Warrant ──► field
                  REFUSE / ESCALATE / FAIL-CLOSED ──► no field command, signed evidence
```

## Adapter surfaces

`PIPELINE_ADAPTER_CATALOG` enumerates the typed boundaries: `scada-pump-control`,
`scada-compressor`, `valve-control`, `pressure-control`, `leak-detection`,
`pig-launcher`, `modbus`, `dnp3`, `opc-ua`, `historian-write`. Each declares its
consequence boundary, required runtime registers, and the regulatory clauses it serves.

## What it prevents

Hard safety interlocks that REFUSE even if an envelope mistakenly allows them:
`pipeline.disable_leak_detection`, `pipeline.disable_overpressure_protection`,
`pipeline.disable_esd` / `esd.override`, `pipeline.isolation.bypass`,
`pressure.relief.disable`, `pump.overpressure_override`,
`compressor.safety_shutdown_disable`.

Bounds enforced per command: pressure over MAOP (`max_pressure_psig`,
`max_pressure_pct_maop`), pressure too low (`min_pressure_psig`), flow over capacity
(`max_flow_bbl_per_day`, `max_flow_mmscfd`), wrong segment / system model / state /
asset type, stale SCADA, and the readiness flags (leak detection armed, overpressure
protection active, ESD ready, segment isolation ready, pump primed, operator qualified).

## How to try it

```bash
# unit tests (adapter builders, fixtures drive the gate, interlocks, dual control, evidence)
npm run test:pipeline

# ALLOW: a governed pump start within MAOP with all safety registers satisfied
npm run aristotle -- execution-control evaluate \
  --ward examples/pipeline/ward.transmission_segment.yaml \
  --envelope examples/pipeline/authority_envelope.operations_center.yaml \
  --action examples/pipeline/actions/pump_start.json \
  --ledger ./.tmp/pipeline.gel.jsonl \
  --now 2026-05-25T15:00:00.000Z

# REFUSE: a pressure setpoint above MAOP
npm run aristotle -- execution-control evaluate \
  --ward examples/pipeline/ward.transmission_segment.yaml \
  --envelope examples/pipeline/authority_envelope.operations_center.yaml \
  --action examples/pipeline/actions/refuse_overpressure.json \
  --ledger ./.tmp/pipeline.gel.jsonl --now 2026-05-25T15:00:00.000Z

# REFUSE: a pump start while leak detection (CPM) is offline
npm run aristotle -- execution-control evaluate \
  --ward examples/pipeline/ward.transmission_segment.yaml \
  --envelope examples/pipeline/authority_envelope.operations_center.yaml \
  --action examples/pipeline/actions/refuse_leak_detection_offline.json \
  --ledger ./.tmp/pipeline.gel.jsonl --now 2026-05-25T15:00:00.000Z
```

## Evidence produced

`exportPipelineEvidenceBundle()` wraps the signed execution Evidence Bundle with pipeline
context (operator, control room, segment, system model, HCA impact, and a
`regulatory_evidence_profile` covering PHMSA 192/195, Control Room Management, Operator
Qualification, Integrity Management, API 1164/1173/RP 1175). `verifyPipelineEvidenceBundle()`
re-verifies it offline; tampering is detected. See
[pipeline-ward-templates.md](pipeline-ward-templates.md) and
[pipeline-threat-model.md](pipeline-threat-model.md).
