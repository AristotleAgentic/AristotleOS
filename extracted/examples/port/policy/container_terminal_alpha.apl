ward "Container Terminal Alpha Port Operations" {
  id ward-port-terminal-alpha
  domain maritime-terminal-ops
  sovereignty "port-authority-and-terminal-operator-alpha"
  version 0.1.0
  subject agent:terminal-orchestrator
  envelope ae-port-terminal-alpha-001
  issuer "aristotle-port-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "PORT_OPS"
  allow tos.container.release
  allow yard.move.authorize
  allow gate.access.grant
  allow reefer.setpoint.update
  allow weighbridge.vgm.verify
  allow vts.berth.clearance
  allow crane.move.request
  allow shore-power.energize.request
  allow hazmat.route.authorize
  deny port.disable_crane_interlock
  deny crane.override_exclusion_zone
  deny customs.force_release_hold
  deny gate.force_open
  deny shore-power.force_energize
  within terminal-alpha
  budget calls <= 500 per 1h
  approve vts.berth.clearance, crane.move.request, shore-power.energize.request, hazmat.route.authorize requires 2 within 15m
}
