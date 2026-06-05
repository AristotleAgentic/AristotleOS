# Aristotle Space Vertical

## What It Is

Aristotle's Space vertical governs consequential space operations before they cross into physical, orbital, spectrum, or range effect.

It now covers two connected subdomains:

- Launch and range safety: countdown advance, propellant load, igniter arm, ignition, flight termination, payload deploy, range-safety state changes, and downrange-asset coordination.
- Orbital mission operations: satellite commanding, TT&C uplink, stationkeeping, collision-avoidance burns, RF transmission, payload tasking, ground-station contact, conjunction assessment, RPO, deorbit, and mission historian writes.

Every action is admitted only with valid authority, satisfied site/orbit rules, physical invariants, a single-use Warrant, and a GEL record. Launch actions bind range, weather, FTS, AFTS, ITAR, comms, and range-commander evidence. Orbital actions bind ephemeris, conjunction, RF authorization, ground-station authority, payload authorization, safe-mode, collision-avoidance, power, thermal, deorbit, and export-control evidence.

## Where It Sits

Aristotle does not replace the range, the FAA, the operator's flight safety analysis, the Flight Termination System, the spacecraft bus, or the ground-station network. It governs commanded transitions to those systems before any launch, range-safety, TT&C, RF, payload, maneuver, RPO, or deorbit action executes.

Relevant public regimes and operating frames include:

- 14 CFR Part 450 - Launch and Reentry Vehicle Operator Licensing.
- 14 CFR Part 415 / 417 - legacy launch licensing.
- FAA Office of Commercial Space Transportation license and permit conditions.
- USSF Space Launch Delta range safety.
- NASA NPR 8715.5 range safety.
- ITAR USML Category IV and XV.
- EAR where ITAR does not apply.
- FCC Part 25 / Part 87 and ITU radio coordination.
- Space Policy Directive-3 / SSA.
- IADC debris mitigation.
- NOAA remote-sensing licensing where applicable.
- UN Outer Space Treaty, Registration Convention, and Liability Convention.

## Demonstration Only

All shipped launch-site presets and orbital demo Wards are demonstration material. They illustrate the shape of deployable rule packs; they have not been reviewed by FAA AST, the relevant Space Launch Delta, NASA range safety, the operator safety org, ground-station licensing counsel, spectrum counsel, export-control counsel, or mission assurance.

No real launch or spacecraft command may rely on these presets. Real deployments require per-range and per-mission coordination, operator approval, counsel review, signed authority, and promotion out of demonstration state.

## Primitives

- `SPACE_ADAPTER_CATALOG`: launch and orbital adapter boundaries, including range-safety, propellant, ignition, FTS, ground systems, TT&C, orbit maneuver, RF/spectrum, payload tasking, ground station, conjunction screening, RPO, deorbit/reentry, and historian.
- `SpaceRuntimeSnapshot`: live vehicle and range state for launch actions.
- `SpaceOrbitalRuntimeSnapshot`: live spacecraft and orbital state for satellite actions.
- Launch action builders: `rangeSafetyToAction`, `propellantToAction`, `ignitionToAction`, `flightTerminationToAction`, `spacePayloadToAction`, `groundSystemsToAction`, `commsLicensingToAction`, `weatherWindsToAction`, `spaceHistorianWriteToAction`, `spaceAdapterToAction`.
- Orbital action builders: `orbitManeuverToAction`, `rfTransmissionToAction`, `payloadTaskingToAction`, `groundStationContactToAction`, `conjunctionAssessmentToAction`, `rendezvousProximityToAction`, `deorbitReentryToAction`, `spaceOrbitalHistorianWriteToAction`, `spaceOrbitalAdapterToAction`.
- `evaluateSpaceSafetyInvariants(action, ward)`: wraps the shared physical-bounds evaluator.
- `exportSpaceEvidenceBundle()` and `verifySpaceEvidenceBundle()`: launch evidence export.
- `exportSpaceOrbitalEvidenceBundle()` and `verifySpaceOrbitalEvidenceBundle()`: orbital mission evidence export.

## Hard Interlocks

Launch interlocks refused regardless of envelope:

- `space.disable_flight_termination` / `fts.disable`
- `space.override_range_safety` / `range_safety.override`
- `space.bypass_collision_avoidance`
- `space.ignite_outside_window`
- `space.bypass_wind_limits`
- `space.override_propellant_limits`
- `space.bypass_pad_interlocks`
- `space.payload_deploy_outside_primary`

Orbital interlocks refused regardless of envelope:

- `space.disable_safe_mode` / `satellite.disable_safe_mode`
- `space.disable_collision_avoidance`
- `space.disable_conjunction_screening` / `conjunction_screening.disable`
- `space.rf_transmit_without_authorization` / `rf.authorization.bypass`
- `space.force_deorbit_without_approval` / `deorbit.override`
- `space.payload_task_denied_target` / `payload.targeting.override`
- `space.bypass_export_control` / `export_control.bypass`
- `space.disable_evidence`
- `satellite.force_burn_without_warrant`

## Example Configs

Launch:

- `examples/space/ward.ccsfs_launch_ops.yaml`
- `examples/space/authority_envelope.launch_orchestrator.yaml`
- `examples/space/policy/ccsfs_launch_ops.apl`

Orbital:

- `examples/space/ward.orbital_ops.yaml`
- `examples/space/authority_envelope.mission_controller.yaml`
- `examples/space/policy/orbital_ops.apl`

## Product Positioning

FAA AST, the Space Launch Deltas, NASA range safety, spectrum authorities, export-control regimes, ground-station operators, and mission operators govern space. Aristotle makes the actions an autonomous launch director, ground autonomy, mission agent, or AI assistant takes through those systems provably authorized before consequence.

See `space-ward-templates.md` and `space-threat-model.md`.
