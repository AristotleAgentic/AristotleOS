# Space Launch — Threat Model (DEMONSTRATION ONLY)

Threats that the vertical's invariants + hard interlocks are designed to refuse. Per-deployment threat modeling against the operator's flight safety analysis is required before any production use.

## T1 — Adversary asks the autonomous launch director to disable Flight Termination

Action type: `space.disable_flight_termination` / `fts.disable`.
Refused as a **hard interlock** in `evaluatePhysicalInvariants` regardless of envelope. The FTS is the range commander's last-resort authority; software cannot disarm it via this surface.

## T2 — Adversary asks to override range safety / ignite outside window / bypass wind limits

Action types: `space.override_range_safety`, `space.ignite_outside_window`, `space.bypass_wind_limits`, `space.override_propellant_limits`, `space.bypass_pad_interlocks`, `space.bypass_collision_avoidance`.
All refused as hard interlocks. The corresponding "non-bypass" path (`space.ignite` etc.) still has to pass the site rule pack's wind/weather/range/FTS bounds + dual control.

## T3 — Adversary submits a `space.ignite` while wind exceeds site limit, range is not clear, FTS not armed, or range commander has not issued GO

Each of these conditions is a separate bound check (`max_surface_wind_kts`, `require_range_clear`, `require_fts_armed`, `require_range_commander_go`). REFUSE returned with `PHYSICAL_INVARIANT_FAILED` and the specific reason in the detail field; proven by individual REFUSE tests.

## T4 — Adversary submits ITAR-controlled payload or comms activity without pre-clearance

`require_itar_cleared: true` and `require_comms_licensed: true` on the bounds, plus regulatory evidence profile entries `ITAR_USML_IV`, `ITAR_USML_XV`, `FCC_PART_25` get bound into the Evidence Bundle so audit can confirm pre-clearance was on file at decision time.

## T5 — Adversary tampers with the Evidence Bundle after export

`verifySpaceEvidenceBundle` re-hashes the space context and chains through to the execution bundle's hash + GEL chain. Substituting a field (e.g. range_commander_id) fails verification — proven by the tamper test in `space.test.ts`.

## T6 — Adversary replays a single-use Warrant

Handled by the shared `warrant.reuse_attempt` hard interlock (already in place across all verticals).

## T7 — Adversary attempts a payload deploy outside the primary insertion orbit

Action type: `space.payload_deploy_outside_primary`. Refused as a hard interlock. The non-bypass path (`space.payload_deploy`) is dual-controlled (2 approvers).

## T8 — Adversary spoofs range-commander GO

The space vertical's snapshot carries `range_commander_go: boolean`; in production this MUST be sourced from a signed range telemetry feed, NOT from operator-supplied state. The gate does not itself authenticate the range commander; that's the operator's responsibility. The bound enforcement here is defense-in-depth.

## T9 — Adversary attempts to ship a fictional or stale rule pack to production

The `rule_validation_state` field on `SpaceEvidenceContext` carries one of `"demonstration"` / `"operator-validated"` / `"counsel-reviewed"` / `"range-coordinated"`. Bundle exports with `"demonstration"` are explicitly labeled in evidence so an auditor can detect a demo rule pack reaching production. Operators must signed-promote past `"demonstration"` before any real launch.

## Out of scope (NOT covered by this vertical)

- The Flight Termination System hardware/firmware itself.
- The range's tracking, telemetry, and command (TT&C) systems.
- ITAR clearance issuance (handled by State Department / DDTC).
- FCC / ITU radio licensing (handled by FCC).
- Vehicle GNC / autopilot — Aristotle governs commanded transitions, not flight-control law.
- Public-risk Ec/Pc computation — that's the operator's flight safety analysis (this vertical references the result but does not compute it).
