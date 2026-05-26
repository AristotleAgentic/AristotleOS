# Aristotle Space Launch Vertical

## What it is

Aristotle's runtime governance plane for **consequential space launch operations**: countdown advance, propellant load, igniter arm, ignition, flight termination, payload deploy, range-safety state changes, and downrange-asset coordination. Every action is admitted only with valid authority, satisfied site-specific rules, the Flight Termination System armed and healthy, weather + winds within limits, range-clear declarations, range-commander GO, and a single-use Warrant — producing a hash-chained, signed Evidence Bundle per decision.

**Where it sits in the regime**:

- 14 CFR Part 450 — Launch and Reentry Vehicle Operator Licensing.
- 14 CFR Part 415 / 417 — legacy launch licensing.
- FAA Office of Commercial Space Transportation (AST) license + permit conditions.
- USSF Space Launch Delta range safety (SLD-30 Vandenberg, SLD-45 CCSFS) — range commander authority over flight termination.
- NASA NPR 8715.5 range safety (Wallops, federal launch ranges).
- ITAR USML Cat IV (launch vehicles) + Cat XV (spacecraft) — export-control gating.
- EAR (15 CFR 730-774) where ITAR does not apply.
- FCC Part 25 / Part 87 — ITU radio licensing.
- UN Outer Space Treaty + Registration Convention + Liability Convention at the international layer.

Aristotle does NOT replace the range, the FAA, the operator's flight safety analysis, or the Flight Termination System itself. It governs the **commanded transitions** to those systems before any countdown advance, FTS state change, igniter arm, or payload separation crosses into physical effect, then preserves bound evidence for replay, audit, and incident reconstruction.

## Demonstration only

All shipped `SPACE_JURISDICTION_RULE_PRESETS` (Cape Canaveral, Vandenberg, Wallops, Starbase, Kodiak, Mojave) are **demonstration material**. They illustrate the SHAPE of a deployable launch-site rule pack — they have NOT been reviewed by FAA AST, the relevant USSF Space Launch Delta, NASA range safety, the launch operator's safety org, or counsel. No real launch may rely on these presets. Real deployments require per-range coordination + AST licensee approval + signed Letter of Agreement before any preset can be promoted past `rule_validation_state: "demonstration"`.

## Primitives

- `SPACE_ADAPTER_CATALOG` — 13 typed adapter boundaries the operator UI / docs / tests reason about: range-safety, telemetry, propellant, ignition, flight-termination, guidance, payload, comms-licensing, weather-winds, fts-health, ground-systems, tracking-radar, historian.
- `SpaceRuntimeSnapshot` — what the gate sees about live vehicle + range state. Carries the launch site rule version in effect, current countdown phase, launch window, range-clear / weather / FTS / AFTS / propellant / ITAR / comms posture, range-commander GO state, expected max-Q, hazard area state, tracking radar state, and authority/signer posture.
- Adapter request types — `RangeSafetyRequest`, `PropellantRequest`, `IgnitionRequest`, `FlightTerminationRequest`, `SpacePayloadRequest`, `GroundSystemsRequest`, `CommsLicensingRequest`, `WeatherWindsRequest`, `SpaceHistorianWriteRequest`.
- Action builders — `rangeSafetyToAction`, `propellantToAction`, `ignitionToAction`, `flightTerminationToAction`, `spacePayloadToAction`, `groundSystemsToAction`, `commsLicensingToAction`, `weatherWindsToAction`, `spaceHistorianWriteToAction`, plus the generic `spaceAdapterToAction(input, ctx)`.
- `evaluateSpaceSafetyInvariants(action, ward)` — wraps the shared physical-bounds evaluator.
- `exportSpaceEvidenceBundle()` + `verifySpaceEvidenceBundle()` — wraps the signed execution Evidence Bundle with space context (flight, operator, launch site, site rule version, vehicle class + model, countdown phase, launch window, range commander id, ITAR posture, comms licensing posture, regulatory evidence profile, `rule_validation_state`, pre/post checks, redacted fields).

## Hard interlocks (gate-level, REFUSED regardless of envelope)

- `space.disable_flight_termination` / `fts.disable`
- `space.override_range_safety` / `range_safety.override`
- `space.bypass_collision_avoidance` / `collision_avoidance.disable`
- `space.ignite_outside_window`
- `space.bypass_wind_limits` / `wind_limits.override`
- `space.override_propellant_limits` / `propellant_limits.override`
- `space.bypass_pad_interlocks` / `pad_interlocks.override`
- `space.payload_deploy_outside_primary`

These are refused by the Commit Gate even if an envelope mistakenly allows them — proven by the dedicated hard-interlock tests in `space.test.ts`.

## Site rule presets (DEMONSTRATION)

| Site | Authority | Max surface wind (kts) | FTS req | AFTS req | ITAR pre-clear |
|---|---|---:|---|---|---|
| ccsfs | USSF SLD-45 | 30 | yes | yes (Part 450) | yes |
| vandenberg | USSF SLD-30 | 30 | yes | yes (Part 450) | yes |
| wallops | NASA Wallops Range | 25 | yes | no | yes |
| starbase | FAA AST + USCG | 27 | yes | yes (Part 450) | yes |
| kodiak | Alaska Aerospace | 25 | yes | yes (Part 450) | yes |
| mojave | FAA AST (suborbital/test) | 20 | yes | no | yes |

All preset values are illustrative. The actual limits at each range depend on per-mission flight safety analysis, vehicle class, and current range orders. **Verify with the FAA AST, the relevant Space Launch Delta, and the launch operator's flight safety lead before any preset is promoted.**

## Product positioning

> *Aristotle's Space Launch vertical governs consequential launch, range-safety, and downrange-asset actions before they execute. Each commanded transition must carry valid authority, satisfy site-specific rules, bind required range/weather/FTS/comms/ITAR checks, and produce a warrant-backed evidence record. The result is faster autonomous launch operations with stronger proof of authorization, compliance, and auditability — without replacing the range, the FAA, the operator's safety org, or the Flight Termination System itself.*

For executives:

> *FAA AST, the USSF Space Launch Deltas, NASA range safety, and the operator's safety org govern launch. Aristotle makes the actions an autonomous launch director, ground autonomy, or AI assistant takes through those systems provably authorized.*

See [`space-ward-templates.md`](space-ward-templates.md) and [`space-threat-model.md`](space-threat-model.md).
