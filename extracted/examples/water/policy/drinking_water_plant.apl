ward "West Drinking Water Treatment Plant" {
  id ward-water-plant-west
  domain water-treatment-distribution-ops
  sovereignty "municipal-water-authority-west"
  version 0.1.0
  subject agent:water-ops-orchestrator
  envelope ae-water-ops-001
  issuer "aristotle-water-root"
  expires "2026-12-31T23:59:59Z"
  criticality safety_critical
  classification CUI caveats "WATER_OPS"
  allow pump.speed.set
  allow pump.start.request
  allow valve.position.set
  allow chemical.dose.adjust
  allow chlorine.feed.set
  allow scada.process.setpoint
  allow historian.record.write
  allow lims.sample.accept
  allow tank.level.setpoint
  allow uv.intensity.set
  deny water.disable_disinfection
  deny chemical.force_overfeed
  deny plc.force_override
  deny valve.force_open
  deny pump.force_run_dry
  within west-water-system
  budget calls <= 300 per 1h
  approve chemical.dose.adjust, chlorine.feed.set, valve.position.set, plc.register.write, disinfection.release.authorize requires 2 within 15m
}
