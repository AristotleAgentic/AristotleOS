# Water Infrastructure Execution-Control Path

AristotleOS now includes a water and wastewater execution-control vertical for
utilities, treatment plants, pump stations, distribution systems, lift stations,
lab/compliance workflows, and discharge-sensitive operations.

The doctrine does not change:

> Authority before consequence. Warrant before execution. Evidence after every decision.

## What It Is

The water path turns consequential utility activity into Canonical Governed
Actions. An automation, agent, optimizer, or workflow engine can propose an
action, but the action must pass Ward resolution, Authority Envelope validation,
Water Safety Invariant checks, Commit Gate admission, Warrant issuance, and GEL
commit before it reaches SCADA, PLC/RTU, pump, valve, dosing, lab/LIMS,
historian, tank/reservoir, lift-station, UV, AMI, or discharge systems.

AristotleOS does not replace SCADA, PLCs, lab systems, treatment-process
controls, licensed operators, engineering judgment, or emergency procedures. It
governs proposed autonomous or automated actions before those systems receive
consequence-bearing commands.

## Adapter Boundaries

The first water adapter catalog includes:

- SCADA / plant control: `scada.process.setpoint`, `scada.alarm.ack`
- PLC / RTU: `plc.register.write`, `rtu.output.operate`
- Pump station: `pump.speed.set`, `pump.start.request`
- Valve / pressure zone: `valve.position.set`, `zone.pressure.adjust`
- Chemical dosing: `chemical.dose.adjust`, `chlorine.feed.set`
- Lab / LIMS: `lims.sample.accept`, `compliance.result.publish`
- Historian / compliance: `historian.record.write`, `compliance.marker.append`
- AMI / metering: `ami.service.disconnect`, `meter.event.write`
- Tank / reservoir: `tank.level.setpoint`, `reservoir.transfer.authorize`
- Lift station: `lift.pump.start`, `wetwell.level.setpoint`
- UV / disinfection: `uv.intensity.set`, `disinfection.release.authorize`
- Wastewater discharge: `discharge.release.authorize`, `wastewater.bypass.authorize`

## Water Safety Invariants

The Commit Gate now understands water-specific physical and operational
invariants. Examples:

- water system, facility, pressure zone, and process area must match the Ward
- chlorine dose must remain below the Ward maximum
- chlorine residual, pH, turbidity, pressure, tank level, flow, and UV intensity
  must remain inside declared bounds
- SCADA/lab/sensor evidence must be fresh enough for the action
- backflow risk must be clear before valve or pressure-zone actions
- disinfection must be active before release-sensitive actions
- chemical inventory must be verified before dosing actions
- pump availability and valve interlock state must be proven
- discharge permit windows must be open and bypass must not be active
- forbidden vendor remote sessions can fail the Ward closed

Hard interlocks refuse even if an Authority Envelope mistakenly allows them:

- `water.disable_disinfection`
- `chemical.force_overfeed`
- `plc.force_override`
- `valve.force_open`
- `pump.force_run_dry`
- `wastewater.bypass.force_open`

## Evidence

Water Evidence Bundles wrap ordinary GEL/Warrant evidence with utility context:
utility, water system, facility, operations center, asset, process area, pressure
zone, work order, discharge permit, process snapshot, standards profile,
pre-checks, post-checks, and redaction manifest.

Run:

```bash
npm run aristotle -- water templates
npm run aristotle -- water adapters
npm run aristotle -- execution-control evaluate \
  --ward examples/water/ward.drinking_water_plant.yaml \
  --envelope examples/water/authority_envelope.water_operator.yaml \
  --action examples/water/actions/allow_pump_speed_adjust.json \
  --ledger ./.tmp/water.gel.jsonl
```

## What It Prevents

This vertical is designed to stop or escalate:

- autonomous chemical overfeed
- disinfection disablement or unsafe treatment release
- pump or valve actions with stale telemetry
- pressure-zone changes under backflow uncertainty
- discharge outside a permit window
- bypass-sensitive wastewater actions without evidence
- PLC/RTU writes without manual fallback and operator attribution
- compliance record writes without replayable decision context

## Developer Use

Developers should use `shared/execution-control-runtime/src/water.ts` to
translate water-system intents into Canonical Governed Actions. Real adapters
must verify the returned Warrant before touching SCADA, PLC, pump, valve,
dosing, lab, historian, tank, UV, AMI, lift-station, or discharge interfaces.
