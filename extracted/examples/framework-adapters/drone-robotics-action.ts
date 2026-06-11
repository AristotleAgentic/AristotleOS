// Drone / robotics action adapter.
//
// Physical actions are gated on Physical Invariants (altitude / boundary / battery)
// in addition to authority. The actuator command is issued only on ALLOW + verified
// Warrant; an out-of-bounds takeoff is refused with PHYSICAL_INVARIANT_FAILED.
// Run: npx tsx examples/framework-adapters/drone-robotics-action.ts
import { governToolCall, type ToolCall } from "./govern.js";
import { droneBinding } from "./_fixtures.js";

void (async () => {
  const inBounds: ToolCall = {
    name: "drone.takeoff", callId: "takeoff-ok",
    arguments: { unit: "unit-7", altitude_m: 80, boundary_id: "zone-a", battery_pct: 90 }
  };
  const ok = await governToolCall(inBounds, droneBinding, ({ warrant }) => ({ actuator: "takeoff", under_warrant: warrant.warrant_id }));
  console.log(`${ok.decision} — in-bounds takeoff`, ok.status === "executed" ? `(warrant ${ok.warrant.warrant_id})` : "");

  const outOfBounds: ToolCall = {
    name: "drone.takeoff", callId: "takeoff-bad",
    arguments: { unit: "unit-7", altitude_m: 400, boundary_id: "zone-a", battery_pct: 90 } // exceeds max_altitude_m 120
  };
  const refused = await governToolCall(outOfBounds, droneBinding, () => "actuator must not fire");
  console.log(`${refused.decision} — out-of-bounds takeoff`, "reason_codes" in refused ? refused.reason_codes : "");
})();
