# Robotics / humanoid execution-control path

## What it is

A robotics vertical for AristotleOS that governs **motion, manipulation, mobile-base,
humanoid-locomotion, teleoperation, human-robot-interaction, safety-config, and fleet**
commands **before** they reach the actuators. Adapters translate ROS-style and controller
requests into Canonical Governed Actions; the Commit Gate returns ALLOW / REFUSE /
ESCALATE / FAIL-CLOSED and issues a single-use Warrant only when the authority chain and
every robot-safety invariant hold. Adapters must verify the Warrant before commanding any
joint, gripper, base, or limb.

Built to **meet and exceed** the governing regimes:

| Regime | Requires | How this vertical exceeds it |
|---|---|---|
| ISO 10218-1/-2, ANSI/RIA R15.06 | E-stop, protective stop, mode selection | `require_estop_functional`, `require_protective_stop_armed`; hard interlocks on disabling either |
| ISO/TS 15066 (collaborative) | Power-and-force limiting, speed-and-separation monitoring | `max_force_n`/`max_torque_nm`/`max_power_w` biomechanical limits, `min_separation_distance_mm`, `require_pfl_active`/`require_ssm_active`; collaborative mode forced whenever a human is present |
| ANSI/RIA R15.08, ISO 3691-4 (AMRs) | Mobile-robot safety, scanners | `require_safety_scanner_active`, separation + speed limits |
| ISO 13482 (service/humanoid) | Stability, fall protection | `require_balance_controller_active`, `require_fall_protection_armed`, `max_com_deviation_mm`, `max_step_height_mm`; hard interlocks on disabling balance / fall protection |
| ISO 13849 / IEC 61508 | Functional safety (PLd/PLe) | Fail-closed gate; safety-rated stops enforced per command |

## Adapter surfaces

`ROBOTICS_ADAPTER_CATALOG`: `motion-control`, `manipulation`, `mobile-base`,
`humanoid-locomotion`, `teleoperation`, `human-robot-interaction`, `safety-config`,
`fleet`, `historian-write` — each with its consequence boundary, required runtime
registers, and regulatory basis.

## What it prevents

Hard interlocks (REFUSE even if an envelope mistakenly allows them):
`robot.disable_estop`, `robot.disable_protective_stop`,
`robot.override_speed_separation_monitoring`, `robot.override_power_force_limiting`,
`robot.disable_collision_detection`, `robot.disable_safety_scanner`,
`robot.override_safety_zone`, `humanoid.disable_balance_controller`,
`humanoid.disable_fall_protection`.

Per-command bounds: TCP speed, force / torque / power (ISO/TS 15066 biomechanical limits),
separation distance (SSM), center-of-mass deviation and step height (humanoid balance),
payload mass, permitted workcell/zone/mode/state, fresh telemetry, and readiness flags
(e-stop, protective stop, SSM, PFL, collision detection, safety scanner, balance
controller, fall protection, teleop link, operator qualification) — plus the rule that a
human present forces collaborative mode.

## How to try it

```bash
npm run test:robotics

# ALLOW: a governed humanoid step in collaborative mode with all safety registers satisfied
npm run aristotle -- execution-control evaluate \
  --ward examples/robotics/ward.humanoid_cell.yaml \
  --envelope examples/robotics/authority_envelope.cell_operator.yaml \
  --action examples/robotics/actions/humanoid_step.json \
  --ledger ./.tmp/robotics.gel.jsonl --now 2026-05-25T15:00:00.000Z

# REFUSE: force above the biomechanical limit / separation breach / human present but not collaborative
#   actions/refuse_force_over_limit.json, refuse_separation_breach.json, refuse_human_present_not_collaborative.json
```

Force application, humanoid locomotion, teleop takeover, and fleet dispatch are
dual-control: they ESCALATE until two authorized parties (e.g. cell supervisor + safety
engineer) sign, then ALLOW.

## Evidence produced

`exportRoboticsEvidenceBundle()` wraps the signed execution Evidence Bundle with robotics
context (operator, control station, workcell, zone, collaboration risk class, and a
`regulatory_evidence_profile` covering ISO 10218, ISO/TS 15066, ANSI/RIA R15.06/.08,
ISO 3691-4, ISO 13482, ISO 13849/IEC 61508, PFL, SSM). `verifyRoboticsEvidenceBundle()`
re-verifies it offline; tampering is detected. See
[robotics-ward-templates.md](robotics-ward-templates.md) and
[robotics-threat-model.md](robotics-threat-model.md).
