# ADR-0014 — Adapters default `production_validated: false`

**Status:** Accepted

## Context

Every protocol adapter the substrate ships (DNP3, Modbus, BACnet,
OPC-UA, ROS2, MAVLink, k8s-admission) controls real-world systems
when its `*Transport` actually emits on the wire. A misconfigured
adapter could write to a real PLC, command a real autopilot, or
mutate a real Kubernetes resource — with consequences ranging from
"wrong setpoint" to "physical harm."

The substrate must default to the safe failure mode. The question
is: what's the safe failure mode at the adapter layer?

## Decision

**Every adapter transport reports `production_validated: false` by
default.** The orchestrator (`governXxx` or `governThroughAdapter`)
refuses to emit on the wire unless either:
1. The transport explicitly reports `production_validated: true`
   (set by the implementor after operator + range sign-off), OR
2. The caller explicitly passes `allowDemonstrationTransport: true`.

The transport's `production_validated` field is a runtime
declaration the implementor controls — flipping it to `true`
requires modifying the transport's constructor. It's not an env
var, not a runtime toggle, not a config-file knob: it's code-as-
authorization that the operator's adapter integration has been
validated for production.

`@aristotle/adapter-sdk` formalizes this in the
`AristotleAdapterTransport<Op, Authz, Receipt>` interface; every
first-party adapter satisfies it (proven by the conformance test
in `@aristotle/tests-cross-adapter`).

## Alternatives considered

- **Default `production_validated: true`.** Rejected. Catastrophic
  silent failure on integration with new hardware. The operator
  would have to actively opt OUT of production behavior for every
  demo / test / staging deployment — wrong default direction.
- **Make production_validated env-var controlled.** Rejected. Env
  vars get copy-pasted between environments. The substrate has
  already had to introduce productionMode lockdown for the mesh
  for the same reason; the adapter layer should follow the same
  principle.
- **No production_validated field; orchestrator always emits.**
  Rejected. Removes the only layer of substrate-side protection
  for misconfigured demo transports reaching production.
- **Make `allowDemonstrationTransport` default true.** Rejected.
  Same as defaulting production_validated true — wrong direction.

## Consequences

- Adapter consumers who fail to set `allowDemonstrationTransport:
  true` see a fail-closed `DEMONSTRATION_ONLY_BLOCKED` refusal.
  This is the substrate refusing to silently emit on the wire.
- Adapter implementors who promote a transport to
  `production_validated: true` are making an explicit statement
  in code. Code review of that change is the gate.
- Demo deployments (CI, local development, smoke tests) work
  cleanly with `allowDemonstrationTransport: true` — the failure
  mode only fires when an operator forgets the flag on a
  production-style deployment.
- Documenting which transport classes are production-validated is
  the operator's job. The substrate's `docs/ADAPTER_VALIDATION.md`
  matrix captures the first-party state (currently: zero
  transports are production-validated in the shipped substrate;
  every first-party transport is intentionally demo-mode).
- Third-party adapters built on `@aristotle/adapter-sdk` inherit
  this behavior automatically — they extend the same interface.
- This pairs with ADR-0010 (productionMode mesh lockdown):
  productionMode at the mesh layer + production_validated at the
  adapter layer = end-to-end fail-closed on misconfiguration.

## See also

- `@aristotle/adapter-sdk` — interface + governThroughAdapter
- `tests/cross-adapter/src/refusal-before-emission.test.ts` — proves the invariant across all 7 adapters
- `docs/ADAPTER_VALIDATION.md` — current production_validated state per adapter
- [LIMITATIONS.md § 8](../../LIMITATIONS.md#8-adapter-wire-level-validation) — operator-facing acknowledgment
- ADR-0010 (productionMode) — mesh-layer counterpart of this discipline
