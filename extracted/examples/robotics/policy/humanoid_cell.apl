ward "Humanoid Collaborative Cell A" {
  id ward-robotics-humanoid-cell
  domain robotics-humanoid-ops
  sovereignty "operator-robotics-authority"
  version 0.1.0
  subject agent:robot-ops-orchestrator
  envelope ae-robotics-operations-001
  issuer "aristotle-robotics-ops-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "ROBOTICS_OPS"

  allow motion.move, motion.trajectory.execute, manipulation.grasp, humanoid.step.execute, humanoid.posture.set, hri.handover, historian.record.write when telemetry.asset_id, telemetry.workcell_id, telemetry.robot_zone, telemetry.operating_mode, telemetry.estop_functional, telemetry.protective_stop_armed, telemetry.ssm_active, telemetry.pfl_active, telemetry.collision_detection_active, telemetry.safety_scanner_active, telemetry.operator_qualified, telemetry.operator_id
  allow manipulation.force.apply, humanoid.locomotion.start, teleop.takeover, fleet.dispatch when telemetry.asset_id, telemetry.workcell_id, telemetry.robot_zone, telemetry.operating_mode, telemetry.estop_functional, telemetry.ssm_active, telemetry.pfl_active, telemetry.collision_detection_active, telemetry.safety_scanner_active, telemetry.operator_qualified, telemetry.operator_id
  deny robot.disable_estop, robot.disable_protective_stop, robot.override_speed_separation_monitoring, robot.override_power_force_limiting, robot.disable_collision_detection, robot.disable_safety_scanner, humanoid.disable_balance_controller, humanoid.disable_fall_protection

  within cell-humanoid-a
  budget calls <= 600 per 1h
  approve manipulation.force.apply, humanoid.locomotion.start, teleop.takeover, fleet.dispatch requires 2 within 10m
}
