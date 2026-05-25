# Autonomous vehicle execution-control path

Autonomous vehicle systems change physical state. AristotleOS treats every fleet,
OTA, map, remote-assist, ROS 2, AUTOSAR, and simulation request as a source of a
Canonical Governed Action. The vehicle stack does not receive standing machine
power. The Commit Gate admits or refuses the action before the command reaches a
vehicle boundary.

## What it is

The automotive path adds vehicle-native adapter surfaces, Ward templates, Vehicle
Safety Invariants, and an Automotive Evidence Bundle. It preserves the same
runtime doctrine as the rest of AristotleOS:

- authority before consequence
- Warrant before execution
- evidence after every decision

## Runtime placement

```text
Vehicle intent
-> Canonical Governed Action
-> Fleet Ward
-> Authority Envelope
-> Vehicle Safety Invariants
-> Commit Gate
-> Dual-control approval when required
-> single-use Warrant
-> adapter execution
-> GEL + Automotive Evidence Bundle
```

## Adapter surfaces

`AUTOMOTIVE_ADAPTER_CATALOG` describes the current typed boundaries:

| Adapter | Consequence boundary |
|---|---|
| `ros2-dds` | ROS 2 / DDS command topics and autonomy stack behavior requests |
| `autosar-adaptive` | AUTOSAR Adaptive service invocations |
| `ota-campaign` | OTA image staging, activation, rollback, and rollout waves |
| `map-update` | HD map activation and ODD-bound map material changes |
| `remote-assist` | Human-assisted pull-over, hold, resume, and recovery commands |
| `fleet-management` | Dispatch, hold, return-to-base, and service eligibility |
| `simulation` | Scenario admission, replay, and regression evidence |

## What it prevents

- OTA rollout without vehicle state, safety case, and dual-control approval
- remote-assist commands without session identity or MRC availability
- map activation outside the declared ODD
- vehicle commands above the Ward speed envelope
- actions when map, localization, or perception confidence drops below threshold
- attempts to disable the safety envelope or minimum-risk-condition path

## How to try it

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

Then export a safety evidence bundle:

```bash
npm run aristotle -- automotive evidence export \
  --ward examples/automotive/ward.fleet_region_west.yaml \
  --envelope examples/automotive/authority_envelope.fleet_safety_operator.yaml \
  --ledger ./.tmp/automotive.gel.jsonl \
  --out ./.tmp/automotive-evidence.json \
  --fleet fleet-west \
  --vehicle AV-1042 \
  --operator operator:fleet-safety-west \
  --scope sf-soma-odd \
  --odd sf-soma-daylight \
  --software AVOS-2026.05.25 \
  --map 2026.05.25 \
  --safety-case SC-AV-WEST-2026-001
```

## Evidence produced

The Automotive Evidence Bundle wraps the standard AristotleOS Evidence Bundle with
fleet, vehicle, ODD, safety-case, software, map, operator, pre-check, post-check,
standards, and redaction context. The result is offline-verifiable and points back
to the exact GEL record and Warrant material.
