ward "West Freight Network Operations" {
  id ward-logistics-network-west
  domain trucking-logistics-dispatch
  sovereignty "shipper-carrier-broker-network-west"
  version 0.1.0
  subject agent:logistics-dispatch-orchestrator
  envelope ae-logistics-dispatch-001
  issuer "aristotle-logistics-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "LOGISTICS_OPS"
  allow tms.load.dispatch
  allow broker.load.tender
  allow carrier.vetting.approve
  allow eld.hos.attest
  allow route.reroute.authorize
  allow wms.cargo.release
  allow yms.dock.assign
  allow fuel.advance.authorize
  allow accessorial.approve
  allow coldchain.setpoint.update
  allow hazmat.route.authorize
  allow dvir.vehicle.release
  deny logistics.dispatch_over_hos
  deny eld.disable
  deny carrier.vetting.override
  deny driver.qualification.override
  deny hazmat.route.override
  deny coldchain.temp_alarm.override
  deny pod.force_accept
  deny payment.force_release
  deny fuel.unbounded_advance
  deny yard.force_gate_open
  deny load.double_broker.override
  within west-freight-network
  budget calls <= 500 per 1h
  approve broker.load.tender, fuel.advance.authorize, accessorial.approve, payment.carrier.release, hazmat.route.authorize, coldchain.setpoint.update requires 2 within 15m
}
