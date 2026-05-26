# @aristotle/mavlink-px4

**Govern PX4 / ArduPilot flight commands with AristotleOS.** Real wire-level MAVLink transport that emits only on Warrant verification. The first real hardware-governance adapter in the catalog.

```sh
npm install @aristotle/mavlink-px4 @aristotle/os-sdk
```

## Quickstart against PX4 SITL

```ts
import { AristotleClient } from "@aristotle/os-sdk";
import { MavlinkUdpTransport, governFlightCommand } from "@aristotle/mavlink-px4";

const aos = new AristotleClient({ baseUrl: "http://127.0.0.1:8181", token });

// PX4 SITL default endpoint is udpin:14540 on localhost.
const transport = new MavlinkUdpTransport({
  remote: { host: "127.0.0.1", port: 14540 },
  systemId: 7,
  componentId: 1,
  productionValidated: false   // demo until counsel + range sign-off
});

const result = await governFlightCommand(
  {
    command: "TAKEOFF",
    target_system: 1,
    target_component: 1,
    params: { param7: 50.0 },  // takeoff altitude in meters
    requested_at: new Date().toISOString()
  },
  transport,
  {
    client: aos,
    wardId: "ward-aviation-ops",
    subject: "agent:uav-orchestrator",
    aircraftId: "uav:demo-001",
    allowDemonstrationTransport: true
  }
);

if (result.ok && result.outcome?.ok) {
  console.log("Flight command emitted under warrant", result.outcome.receipt.warrant_id);
} else {
  console.log("REFUSED", result.refusal);
}
```

The orchestrator:

1. Builds a `CanonicalAction` from the flight command (`action_type: "aviation.flight.takeoff"`).
2. Calls `aos.evaluate(action)` — Commit Gate returns ALLOW / REFUSE / ESCALATE.
3. On `ALLOW`, derives a `FlightAuthorization` from the Warrant.
4. Hands `(command, authz)` to the transport, which emits a real MAVLink v2 `COMMAND_LONG` frame to the autopilot.
5. Returns a `FlightSubmissionReceipt` whose `receipt_hash` covers `warrant_id + action_hash + emitted bytes`.

## Decision mapping

| Aristotle Gate | What happens |
|---|---|
| `ALLOW` | Transport emits MAVLink frame; returns `FlightSubmissionReceipt` |
| `REFUSE` | Transport never called; result carries the refusal + gate reason codes |
| `ESCALATE` | Transport never called; result indicates ESCALATE (host's approval workflow takes over) |
| Gate unreachable | Transport never called; returns `GATE_UNREACHABLE` refusal (fail-closed) |
| `production_validated: false` + caller didn't opt in | Returns `DEMONSTRATION_ONLY_BLOCKED` (fail-closed by default) |

## Supported `FlightCommandKind`

| Kind | MAV_CMD | Notes |
|---|---:|---|
| `ARM` | `MAV_CMD_COMPONENT_ARM_DISARM` (400) | `param1: 1` |
| `DISARM` | 400 | `param1: 0` |
| `TAKEOFF` | `MAV_CMD_NAV_TAKEOFF` (22) | `param7`: takeoff altitude (m) |
| `LAND` | `MAV_CMD_NAV_LAND` (21) | |
| `RTL` | `MAV_CMD_NAV_RETURN_TO_LAUNCH` (20) | |
| `GOTO_NED` | `MAV_CMD_DO_REPOSITION` (192) | NED waypoint via params |
| `SET_MODE` | `MAV_CMD_DO_SET_MODE` (176) | |
| `GEOFENCE_ARM` | `MAV_CMD_DO_FENCE_ENABLE` (2003) | |
| `FTS_TRIGGER` | `MAV_CMD_DO_FLIGHTTERMINATION` (185) | Hard-interlocked at the gate by default |

## Transports

- `DemonstrationFlightControlTransport` — records what would have been sent without opening a socket. `production_validated: false`. Used by tests and demo flows.
- `MavlinkUdpTransport` — opens a UDP socket; sends MAVLink v2 framed `COMMAND_LONG` to the autopilot. Tested against a real UDP listener in the test suite. Configurable `productionValidated: true` after counsel + range/operator sign-off.

## MAVLink framing

The package emits **real MAVLink v2 frames** (start byte `0xFD`, X.25-style CRC with `crc_extra=152` for `COMMAND_LONG` msg id 76). The framing is intentionally minimal — just enough to round-trip `COMMAND_LONG` against PX4 SITL. For full MAVLink parsing / heartbeats / parameter ops, pair with `mavlink2-router`, `pymavlink`, or a similar library.

## Tests

12 tests pass against the package source:

- MAVLink v2 framing (start byte, command id offset, ARM uses 400, TAKEOFF uses 22)
- Demonstration transport emits hash-bound receipt; refuses commands outside authz
- **UDP transport sends a real UDP datagram to a real listener and the listener sees a MAVLink v2 frame**
- `productionValidated: true` flag flows through
- Orchestrator: ALLOW emits via transport; REFUSE skips transport; demo-transport refuses without opt-in; `actionTypeFor` overrides default; gate-unreachable fail-closed

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
