# Adapter Validation

This document is the honest assessment of where each protocol adapter stands. Read it before integrating any adapter against real equipment.

The default position for every adapter in this repo is **`production_validated: false`**. The orchestrator (`governXxx`) refuses to emit unless the caller explicitly opts in to a demonstration transport (`allowDemonstrationTransport: true`) or wires a production-validated transport.

This is not pessimism. It is honesty: none of these adapters have been tested against real safety-critical equipment by this project. Each operator must perform that integration testing themselves.

---

## Validation matrix

| Adapter | Protocol | Transport type | Tested behavior | Production validated? | Known limits | Next validation step |
|---|---|---|---|---|---|---|
| `@aristotle/mavlink-px4` | MAVLink v2 over UDP | `MavlinkUdpTransport` (real `node:dgram` socket) | • Bit-correct MAVLink v2 frame for COMMAND_LONG (msg id 76, crc_extra 152)<br>• Real UDP datagram sent to a real local listener<br>• `productionValidated: true` flag flows through<br>• `governFlightCommand` ALLOW emits via transport; REFUSE skips; gate-unreachable fail-closes<br>• 13 tests | **No** | • Test listener is a `node:dgram` socket in the test process, NOT a PX4 SITL / autopilot<br>• Framing is intentionally minimal: COMMAND_LONG only<br>• No heartbeats, parameter ops, or full MAVLink ecosystem | PX4 SITL integration test: launch SITL in CI, send TAKEOFF, observe vehicle response |
| `@aristotle/ros2-bridge` | ROS2 over rosbridge WebSocket | `RosbridgeWebsocketTransport` (caller-supplied `WsLike`) | • JSON op sent via injected socket<br>• Refuses targets outside `permitted_targets`<br>• Refuses when socket isn't open<br>• `governRosMessage` ALLOW emits; REFUSE skips<br>• 9 tests | **No** | • No real `ros2 daemon` integration<br>• Caller wires the actual WebSocket client | Integration test against `rosbridge_server` running in a Docker container |
| `@aristotle/opcua-adapter` | OPC-UA NodeId writes + method calls | `DemonstrationOpcUaTransport` + `OpcUaShimTransport` (caller-supplied writer) | • Hash-bound receipt for writes<br>• Refuses `node_id` outside `permitted_node_ids`<br>• Writer rejection → TRANSPORT_REJECTED<br>• `governOpcUaOperation` orchestrator paths<br>• 7 tests | **No** | • No `node-opcua` integration<br>• Demonstrates the governance pattern, not the OPC-UA stack | Integration test with `node-opcua` server fixture |
| `@aristotle/dnp3-adapter` | DNP3 outstation controls (CROB + analog AO) | `DemonstrationDnp3Transport` + `Dnp3ShimTransport` (caller-supplied sender) | • Hash-bound receipt for breaker trip<br>• Refuses `point_index` outside `permitted_point_indexes`<br>• Sender error → TRANSPORT_REJECTED<br>• `governDnp3Control` ALLOW/REFUSE paths<br>• 7 tests | **No** | • No real DNP3 RTU integration<br>• Demonstrates the four canonical FC writes (CROB/AO select_then_operate / direct_operate) | Integration test with `opendnp3` outstation fixture |
| `@aristotle/modbus-adapter` | Modbus TCP register + coil writes (FC 5/6/15/16) | `DemonstrationModbusTransport` + `ModbusShimTransport` (caller-supplied sender) | • Hash-bound receipt for FC 6 register write + FC 5 coil write<br>• Refuses addresses outside `permitted_register_addresses` / `permitted_coil_addresses`<br>• Per-address `max_register_value` cap enforced<br>• Malformed values refused (out-of-range u16, empty values[], write_property with multiple writes)<br>• Sender error → TRANSPORT_REJECTED<br>• 14 tests | **No** | • No real PLC integration<br>• Demonstrates the four write classes (single/multiple × register/coil) | Integration test with `node-modbus-serial` server or pymodbus fixture |
| `@aristotle/bacnet-adapter` | BACnet WriteProperty / WritePropertyMultiple | `DemonstrationBacnetTransport` + `BacnetShimTransport` (caller-supplied sender) | • Hash-bound receipt for setpoint write (analog_value, priority 10)<br>• Refuses objects outside `permitted_object_ids`<br>• Refuses priority above `max_priority` (BACnet: lower number = higher priority)<br>• Refuses priorities outside 1..16<br>• Refuses `write_property` with multiple writes (must use `write_property_multiple`)<br>• Sender error → TRANSPORT_REJECTED<br>• 13 tests | **No** | • No real BAS integration<br>• Covers seven object types (analog/binary/multistate × value/output + schedule) | Integration test with `node-bacnet` fixture |
| `@aristotle/k8s-admission` | Kubernetes AdmissionReview v1 | `createAdmissionHandler` (HTTP handler factory) | • ALLOW → 200 with warrant id as warning<br>• REFUSE → 403 with reason in `status.reason`<br>• ESCALATE → 409 (default) or 202 (when `escalateBlocksAdmission: false`)<br>• Gate-unreachable → 503 (fail-closed)<br>• Default subject derives from `userInfo.username`<br>• Recursive image extraction from Pod / Deployment / Job templates<br>• `privileged: true` surfaces in params<br>• Malformed JSON → 400 / MalformedRequest<br>• 10 tests | **No** | • Not deployed against a real cluster's API server in tests<br>• TLS termination is caller's responsibility | Integration test in a `kind` cluster with a real admission webhook configuration |

---

## What "production validated" would mean

For any adapter to flip its default to `productionValidated: true`, the operator must satisfy at minimum:

1. **End-to-end integration test against a real implementation of the protocol** (not a test fixture). Examples: PX4 SITL for MAVLink; opendnp3 outstation for DNP3; node-opcua server for OPC-UA.
2. **Drift detection coverage of every parameter the operator's actions can vary.** If the adapter authorizes write to register 40001 but the runtime can vary the *value* without recomputing the canonical action hash, that's a drift escape.
3. **Refusal-before-emission coverage of every refusal class.** Each of the `*_OUTSIDE_AUTHZ`, `*_OVER_LIMIT`, and `MALFORMED_OPERATION` codes must have a test that asserts `transport.emit` was not called.
4. **Operator/range/counsel sign-off** for safety-critical equipment.
5. **A documented incident response procedure** for misbehavior.

This bar is set by the operator's safety regime, not by this repository.

---

## The refusal-before-emission invariant

The single most important invariant of the adapter layer is:

> **If the gate refuses, the transport's `emit()` is never called.**

Every adapter's test suite verifies this for the operations it implements. There is no cross-adapter test today that asserts this invariant simultaneously across all 7 adapters — it's a per-adapter property. A planned addition (see `ROADMAP_TO_100.md` § Category 1) is a single regression test that:
1. Constructs each adapter with a transport whose `emit()` throws if called.
2. Runs a REFUSE-yielding action through each `governXxx()`.
3. Asserts no `emit()` was thrown.

For now, the per-adapter coverage is the evidence.

---

## Wording guidelines

When writing about adapters in commits, READMEs, or external materials:

| Don't say | Say instead |
|---|---|
| "production-grade MAVLink adapter" | "protocol-level governance adapter for MAVLink" |
| "tested against real flight hardware" | "tested against a local UDP listener; PX4 SITL integration pending" |
| "first hardware-governance adapter for autopilots" | "first shipped MAVLink governance adapter with end-to-end wire-level test" |
| "certified for safety-critical use" | "not certified; operator must perform integration testing and obtain sign-off" |
| "drop-in production replacement" | "demonstration transport with a documented production hardening path" |

The substrate doesn't need to oversell. Honest scope is more credible than overstated capability.
