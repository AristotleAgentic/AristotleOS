# Single-drone readiness contract

Status: **not cleared for flight**. Local software checks and UDP loopback tests
do not establish physical safety, autopilot acceptance, or exactly-once flight
effects. No aircraft was contacted or armed during this hardening work.

## Implemented boundary

`governFlightCommand` snapshots the proposed command before asynchronous gate
evaluation. It rejects unknown or malformed parameters, broadcast/wrapped target
IDs, contradictory ARM/DISARM parameters, forced arm/disarm, and GOTO_NED on the
COMMAND_LONG transport. GOTO_NED previously mapped to DO_REPOSITION, which is
not a local NED position command. ARM now defaults param1 to 1, not 0.

Production-marked transports require both `effectBoundary` and `safetyInterlock`.
Use `createDurableAdapterBoundary` from execution-control-runtime with a
`SqliteEffectStore`, a configured Ward, and pinned issuer keys. Supply a stable
`operationId` for the business operation; reuse it on every retry. All competing
dispatchers must share the same database. Do not substitute a new operation ID
to bypass an unresolved attempt.

The boundary verifies the signed Warrant, atomically reserves the operation and
consumes its nonce, and writes signed GEL events before emission. A receipt or
exception finishes as EFFECT_UNKNOWN. The returned `effect_attempt_id` identifies
the attempt for signed reconciliation. Accounting failure leaves IN_FLIGHT and
must not cause a blind retry. Existing reconciliation verifies the observer's
signature, binding, freshness, and settled finality.

`SingleDroneSafetyInterlock` requires trusted, fresh telemetry for the configured
aircraft and target IDs; an enabled operator; valid position, geofence, and
autopilot failsafe posture; and finite battery/altitude values. It checks the
command age, command allowlist, takeoff ceiling, and landed state for arm/disarm.
Low battery or excessive altitude does not by itself block LAND/RTL. Missing or
stale state still blocks autonomous dispatch. Independent pilot recovery remains
outside this application and must remain available.

The configured `takeoffAltitudeReference` must match the commissioned autopilot's
COMMAND_LONG semantics. AMSL interpretation requires trusted home AMSL altitude.
The loopback fixture uses a synthetic relative-home interpretation; it is not
evidence that PX4 or ArduPilot will interpret those bytes that way. Coordinate
semantics, target geofence enforcement, and vehicle-specific command handling
must be verified against the selected firmware before flight.

The interlock is evaluated immediately before calling the transport. It is not a
continuous onboard monitor: scheduling, socket setup, and network delay can
separate that check from autopilot receipt. This increment does not implement
authenticated telemetry collection, command ACK correlation, or an onboard
deadline/lease verifier. The UDP transport is a low-level primitive; direct use
can bypass orchestration. Network/credential isolation must ensure the governed
boundary is the only autonomous command source.

## What the local test establishes

`pnpm test:single-drone` uses a local UDP listener, real gate signing, a durable
effect store, and synthetic telemetry. Concurrent same-operation calls and a
reopened database produce one datagram; stale telemetry prevents another send.
It establishes bounded local dispatch ownership. UDP duplication, autopilot
retries/reboots, and physical effects are outside that proof.

Exactly-once effects require a receiver that durably deduplicates a stable
operation identity and commits that identity atomically with its effect. This
COMMAND_LONG transport carries no such receiver transaction. Do not represent
MAVLink sequence numbers, a local send callback, COMMAND_ACK, or observed motion
as a generic exactly-once guarantee.

## Evidence still required for this aircraft

- Identify PX4/ArduPilot, firmware version, airframe, companion computer, command
  and telemetry endpoints, and the isolated simulator or propeller-off bench.
- Pin and validate the autopilot protocol/profile, altitude and coordinate
  semantics, target identity, telemetry origin and freshness, and command ACK
  correlation. Test delayed and duplicate messages and autopilot restarts.
- Demonstrate independent RC/manual override, onboard geofence, link-loss and
  battery failsafes, and safe behavior when the governance process crashes,
  storage fails, the operator disables autonomy, or telemetry becomes stale.
- Exercise signed reconciliation against authoritative vehicle observations;
  preserve unknown outcomes when the evidence cannot exclude delayed execution.
- Bind the reviewed policy, software build, firmware, vehicle identity, simulator
  results, bench results, and operator approval into the flight-test record.

The existing opt-in PX4 transport smoke test must not count skipped execution or
UDP silence as success. It only permits a local simulator endpoint and now fails
when opted in without incoming MAVLink-shaped traffic. It still does not prove
command acknowledgement or aircraft motion. The single-drone loopback test is
the local governance regression; actual simulator/bench commissioning remains
separate.

Protocol references: [MAVLink command protocol](https://mavlink.io/en/services/command.html),
[common command definitions](https://mavlink.io/en/messages/common.html).
