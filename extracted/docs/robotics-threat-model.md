# Robotics / humanoid threat model addendum

Scope: an AI agent or autonomy stack proposing robot commands through an AristotleOS
robotics adapter. The Commit Gate is the boundary; nothing reaches an actuator without a
verified single-use Warrant.

## Assets

- Physical: the robot (industrial arm / cobot / AMR / humanoid), its end effector and
  payload, people sharing the workspace, and surrounding equipment.
- Governance: the cell's Ward, the operator Authority Envelope, issued Warrants, and the
  tamper-evident GEL evidence ledger.

## Primary threats and controls

| # | Threat | Control |
|---|---|---|
| T1 | Excessive contact force/torque/power on a human | `max_force_n` / `max_torque_nm` / `max_power_w` (ISO/TS 15066); `require_pfl_active`; hard interlock on overriding PFL |
| T2 | Robot moves too fast / too close to a person | `max_tcp_speed_mm_s`, `min_separation_distance_mm`; `require_ssm_active`; hard interlock on overriding SSM |
| T3 | Operating near a human in a non-collaborative mode | `require_collaborative_mode_when_human_present` (human present ⇒ mode must be collaborative) |
| T4 | E-stop / protective stop defeated | `require_estop_functional`, `require_protective_stop_armed`; hard interlocks on disabling either |
| T5 | Collision / intrusion not detected | `require_collision_detection_active`, `require_safety_scanner_active`; hard interlocks on disabling them |
| T6 | Humanoid loss of balance / fall | `require_balance_controller_active`, `max_com_deviation_mm`, `max_step_height_mm`, `require_fall_protection_armed`; hard interlocks on disabling balance / fall protection |
| T7 | Unsafe teleop takeover | `teleop.takeover` is dual-control; `require_teleop_link_healthy` |
| T8 | Overload / wrong zone / wrong mode | `max_payload_kg`, `permitted_robot_zones`, `permitted_operating_modes`, `permitted_robot_states` |
| T9 | Acting on stale telemetry | `max_telemetry_age_ms` |
| T10 | Unqualified operator | `require_operator_qualified` |
| T11 | Warrant replay or evidence tampering | single-use Warrant consumed before receipt; signed, hash-chained GEL; offline-verifiable bundle |
| T12 | Infrastructure degraded | `criticality: safety_critical` ⇒ fail-closed (REFUSE) on degradation |

## Operational recommendations (exceeding the minimum)

- Dual control for force application, humanoid locomotion, teleop takeover, and fleet
  dispatch; short Warrant TTLs.
- Keep PFL, SSM, collision detection, safety scanner, e-stop, and protective stop required
  on every command; for humanoids also require balance controller and fall protection.
- Set force/separation limits per body region and task per ISO/TS 15066.
- Export and archive a Robotics Evidence Bundle (with collaboration risk class) for every
  command for ISO 10218 / ISO/TS 15066 conformity records.
