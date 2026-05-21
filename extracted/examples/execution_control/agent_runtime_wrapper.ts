import {
  type CanonicalActionInput,
  consumeWarrant,
  requireAllowedWarrant,
  submitGovernedAction
} from "@aristotle/execution-control-runtime";

async function executeDroneTakeoff(action: CanonicalActionInput) {
  const result = await submitGovernedAction({
    endpoint: "http://127.0.0.1:8181/v1/execution-control/evaluate",
    action
  });

  const warrant = requireAllowedWarrant(result);
  consumeWarrant(warrant, result.canonical_action_hash);

  return {
    executed: true,
    boundary: "commit-gate",
    warrant_id: warrant.warrant_id,
    target: action.target
  };
}

void executeDroneTakeoff({
  action_id: "act-drone-takeoff-wrapper-001",
  ward_id: "montana-drone-test-range",
  subject: "agent:survey-planner",
  action_type: "drone.takeoff",
  target: "drone-swarm/unit-7",
  params: {
    altitude_m: 80,
    boundary_id: "ranch-test-grid-a",
    battery_pct: 87
  },
  requested_at: new Date().toISOString(),
  request_id: "req-wrapper-001",
  telemetry: {
    gps_lock: true
  }
}).then((receipt) => {
  console.log(JSON.stringify(receipt, null, 2));
});
