# Space Threat Model (DEMONSTRATION ONLY)

Threats that the Space vertical's invariants and hard interlocks are designed to refuse. Per-deployment threat modeling against the operator's launch safety analysis, spacecraft mission rules, licensing posture, and mission assurance process is required before production use.

## Launch And Range Threats

### T1 - Disable Flight Termination

Action type: `space.disable_flight_termination` / `fts.disable`.

Refused as a hard interlock regardless of envelope. The FTS is range authority; software cannot disarm it through this surface.

### T2 - Override Range Safety Or Ignite Outside Window

Action types: `space.override_range_safety`, `space.ignite_outside_window`, `space.bypass_wind_limits`, `space.override_propellant_limits`, `space.bypass_pad_interlocks`, `space.bypass_collision_avoidance`.

All are refused as hard interlocks. The corresponding non-bypass path still has to pass wind, weather, range-clear, FTS, AFTS, propellant, comms, ITAR, and range-commander bounds.

### T3 - Execute While Range Or Weather Is Unsafe

Conditions such as wind above limit, range not clear, FTS not armed, AFTS not nominal, hazard area not cleared, or range commander GO missing are physical invariant failures. The Commit Gate returns `REFUSE` with `PHYSICAL_INVARIANT_FAILED`.

### T4 - Payload Or Comms Activity Without Clearance

`require_itar_cleared` and `require_comms_licensed` bind export-control and spectrum posture into the Evidence Bundle so audit can confirm pre-clearance was on file at decision time.

## Orbital Mission Threats

### T5 - Disable Safe Mode Or Collision Avoidance

Action types: `space.disable_safe_mode`, `satellite.disable_safe_mode`, `space.disable_collision_avoidance`.

Refused as hard interlocks regardless of envelope. These are not normal policy choices; they remove last-resort recovery and collision-risk controls.

### T6 - Burn With Stale Ephemeris Or Unscreened Conjunction Risk

`max_ephemeris_age_ms`, `require_ephemeris_fresh`, `require_conjunction_screening_clear`, `max_conjunction_probability`, and `min_miss_distance_km` prevent stationkeeping, collision-avoidance, phasing, RPO, or deorbit commands from issuing a Warrant when the orbital picture is stale or unsafe.

### T7 - Transmit Without RF Authorization

Action types: `space.rf_transmit_without_authorization`, `rf.authorization.bypass`, or a normal `rf.transmit.enable` with `rf_authorization_active: false`.

Bypass actions are hard interlocks. Normal RF actions fail physical invariants when the RF authorization flag is not current.

### T8 - Payload Tasking Without Mission Or Export Authority

`require_payload_tasking_authorized` and `require_export_control_clearance` gate payload tasking before command execution. Bypass actions such as `space.payload_task_denied_target` and `space.bypass_export_control` are refused regardless of envelope.

### T9 - Deorbit Or RPO Without Plural Authority

`rpo.approach.execute` and `deorbit.burn.execute` are modeled as dual-control actions in the sample Authority Envelope. Without the required approvals, the Commit Gate returns `ESCALATE`; after approval, a single-use Warrant can be issued and evidence is committed.

## Evidence Threats

### T10 - Tamper With Evidence After Export

`verifySpaceEvidenceBundle` and `verifySpaceOrbitalEvidenceBundle` re-hash the launch/orbital context and chain through to the execution bundle and GEL chain. Substituting a bound field fails verification.

### T11 - Replay A Single-Use Warrant

Handled by shared Warrant verification and the `warrant.reuse_attempt` interlock already present across AristotleOS.

## Residual Risks

- Real range telemetry, range-commander GO, ground-station authority, RF authorization, export-control state, and spacecraft telemetry must come from authenticated operator systems. Aristotle binds and verifies the state it receives; it does not magically authenticate an unsigned upstream feed.
- Real collision-risk, public-risk, debris, casualty-risk, and licensing determinations remain with the operator and regulators. Aristotle gates against approved outputs and preserves evidence.
- The FTS, spacecraft bus, flight-control law, ground-station hardware, RF chain, and payload firmware remain outside this vertical's direct control.
