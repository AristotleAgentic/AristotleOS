# Robotics Ward templates

Each template is a `physical_bounds` profile for a class of robot operation. All are
`criticality: safety_critical` (fail-closed under degradation). Copy
`examples/robotics/ward.humanoid_cell.yaml` and adjust.

## Industrial arm (caged, automatic)

Speed/force ceilings with e-stop and protective stop; no humans in the cell.

```yaml
physical_bounds:
  permitted_asset_types: [industrial-arm]
  permitted_operating_modes: [automatic, t1-reduced-speed]
  max_tcp_speed_mm_s: 2000
  require_estop_functional: true
  require_protective_stop_armed: true
  require_collision_detection_active: true
  require_operator_qualified: true
```

## Collaborative cobot (ISO/TS 15066)

Power-and-force limiting and speed-and-separation monitoring; collaborative mode whenever
a human is present.

```yaml
physical_bounds:
  permitted_asset_types: [cobot]
  permitted_operating_modes: [automatic, t1-reduced-speed, collaborative]
  max_force_n: 140        # quasi-static biomechanical limit (body-region dependent)
  max_torque_nm: 40
  max_power_w: 80
  min_separation_distance_mm: 500
  require_pfl_active: true
  require_ssm_active: true
  require_safety_scanner_active: true
  require_collaborative_mode_when_human_present: true
```

## AMR / mobile base

Scanner-gated navigation with separation and speed limits.

```yaml
physical_bounds:
  permitted_asset_types: [amr]
  min_separation_distance_mm: 750
  max_tcp_speed_mm_s: 1500   # base speed proxy
  require_safety_scanner_active: true
  require_collision_detection_active: true
  require_estop_functional: true
```

## Humanoid (default example)

Adds balance and fall protection with center-of-mass and step-height bounds; locomotion is
dual-control.

```yaml
physical_bounds:
  permitted_asset_types: [humanoid]
  max_com_deviation_mm: 60
  max_step_height_mm: 200
  max_force_n: 140
  min_separation_distance_mm: 500
  require_balance_controller_active: true   # ISO 13482
  require_fall_protection_armed: true
  require_pfl_active: true
  require_ssm_active: true
  require_collaborative_mode_when_human_present: true
  require_operator_qualified: true
# envelope: humanoid.locomotion.start + manipulation.force.apply under dual_control;
#           humanoid.disable_balance_controller / disable_fall_protection are hard interlocks
```

## Sample Authority Envelopes

See `examples/robotics/authority_envelope.cell_operator.yaml`. Put high-consequence acts
(`manipulation.force.apply`, `humanoid.locomotion.start`, `teleop.takeover`,
`fleet.dispatch`) under `dual_control`, and list every safety-disable action type under
`denied_actions` (they are also hard interlocks at the gate — defense in depth).
