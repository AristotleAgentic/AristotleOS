# Aristotle Policy Language (APL) — example.
# Compile to a content-addressed governance manifest:
#   aristotle policy compile examples/policy/montana_drone_range.apl
# Validate only (CI gate):
#   aristotle policy check examples/policy/montana_drone_range.apl
#
# One `ward { ... }` block compiles to one Ward + one Authority Envelope — the same
# typed manifests the Commit Gate, GEL, and Evidence Bundles already consume.

ward "Montana Drone Range" {
  id          montana-drone-range
  domain      drone-swarm-ops
  sovereignty "private-ranch-field-test"
  version     0.1.0
  subject     agent:survey-planner
  criticality safety_critical
  classification CUI caveats "NOFORN"

  # Authority: what the subject may and may not do.
  allow drone.takeoff, drone.scan_area, drone.return_home when telemetry.gps_lock
  deny  drone.disable_geofence, drone.leave_boundary

  # Physical invariants the gate enforces before any irreversible action.
  bound altitude_m <= 120
  bound battery_pct >= 20
  within ranch-test-grid-a
}
