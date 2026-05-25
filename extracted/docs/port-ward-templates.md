# Port Ward Templates

Port templates live under `examples/port`.

## Container Terminal Ward

`examples/port/ward.container_terminal_alpha.yaml` binds:

- port and terminal ids
- berth, yard block, and gate allowlists
- cargo and hazmat classes
- TOS, OT, gate, and vessel-interface zones
- VGM, customs, security, inspection, PNT, AIS, crane, shore-power, gate, and
  operator identity invariants

## Authority Envelope

`examples/port/authority_envelope.terminal_orchestrator.yaml` scopes
`agent:terminal-orchestrator` to port operations such as:

- `tos.container.release`
- `yard.move.authorize`
- `gate.access.grant`
- `reefer.setpoint.update`
- `vts.berth.clearance`
- `crane.move.request`
- `shore-power.energize.request`
- `hazmat.route.authorize`

It explicitly denies hard interlock bypass actions and requires dual-control for
crane, VTS, shore-power, customs-release, and hazmat-routing actions.

## Sample Decisions

- `allow_container_release.json`: ALLOW and Warrant when holds are clear and
  runtime state is complete.
- `refuse_customs_hold_release.json`: REFUSE because a customs hold is active.
- `refuse_crane_exclusion_zone.json`: REFUSE because the crane exclusion zone is
  not clear.
- `escalate_missing_pnt_state.json`: ESCALATE because required PNT runtime state
  is missing.
- `refuse_force_gate_open.json`: REFUSE because forced gate opening is a hard
  port interlock violation.

## Policy Language

`examples/port/policy/container_terminal_alpha.apl` is the Aristotle Policy
Language representation of the same Ward / Authority posture. Use:

```bash
npm run aristotle -- policy check examples/port/policy/container_terminal_alpha.apl
```
