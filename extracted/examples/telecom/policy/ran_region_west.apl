ward "RAN Region West" {
  id ward-ran-region-west
  domain autonomous-network-ran
  sovereignty "csp-west-market-network-operations"
  version 0.1.0
  subject agent:noc-change-orchestrator
  envelope ae-telecom-noc-change-001
  issuer "aristotle-telecom-root"
  expires "2026-12-31T23:59:59Z"
  criticality mission_critical
  classification CUI caveats "CPNI"

  allow tmf.service-order.patch, tmf.trouble-ticket.update when telemetry.change_ticket, telemetry.maintenance_window, telemetry.noc_operator, telemetry.precheck_passed
  allow netconf.edit-config, gnmi.set, oran.a1.policy.put when telemetry.change_ticket, telemetry.maintenance_window, telemetry.noc_operator, telemetry.precheck_passed
  deny ran.cell.shutdown, lawful_intercept.modify, subscriber.bulk_export

  within ran-market-west
  budget calls <= 2500 per 1h
  approve netconf.edit-config, oran.a1.policy.put requires 2 within 15m
}
