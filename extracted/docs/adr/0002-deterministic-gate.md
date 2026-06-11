# ADR-0002 — Deterministic Commit Gate decision function

**Status:** Accepted

## Context

The Commit Gate decides whether an action may execute. It runs at
the boundary between "the agent / process has decided what it wants
to do" and "the action actually happens." Every governance property
the substrate provides — auditability, replay, evidence — rests on
the gate's decision being reproducible.

A non-deterministic gate (one whose decision depends on
wall-clock-keyed cache state, external API responses, randomness,
etc.) cannot be replayed. Without replayability, the substrate
collapses: GEL records become "what we observed" instead of "what
the policy decided"; the reviewer flow can't independently verify a
decision after the fact; a counterfactual-replay primitive (Time
Machine) is structurally impossible.

## Decision

`evaluateCommitGate` is a **pure function** of:
- `ward: WardManifest`
- `authorityEnvelope: AuthorityEnvelope`
- `action: CanonicalActionInput`
- `runtimeRegister?: RuntimeRegister`
- `now: string` (ISO timestamp)

Same inputs → same outputs, byte-identical. No I/O, no randomness, no
ambient state. The signing layer (`evaluateExecutionControl`,
`issueWarrant`) is the only stage that introduces non-determinism (a
fresh random nonce per Warrant); that's contained and the warrant
shape is still recoverable.

The substrate's `gate.property.test.ts` runs 4000 randomized cases
against an independent oracle implementation and asserts byte-equal
agreement. Determinism is a tested invariant, not an aspiration.

## Alternatives considered

- **Side-effecting gate with internal cache.** Rejected. The cache
  would be wall-clock-keyed; replay would diverge.
- **Network policy evaluation (call out to OPA / Cedar / Auth0).**
  Rejected. Even with deterministic policy data, a network call is a
  non-determinism source under partition / latency / failure-mode
  variation. Out-of-process policy is fine as a transport; the
  decision function itself stays in-process.
- **Stochastic policy ("ALLOW 95% of these").** Rejected. The
  substrate's audit story is "operators can review every decision
  the policy made"; stochasticity makes that meaningless.
- **Time-varying policy ("ALLOW if it's during business hours").**
  Partially supported via `runtime_register_snapshot` — the gate is
  still deterministic on its inputs, but those inputs include
  caller-supplied time-context fields. The gate doesn't read the
  wall clock itself.

## Consequences

- The substrate's reviewer flow (`examples/reviewer/verify.ts`) is
  possible. Every decision can be re-evaluated from the GEL record
  + original Ward + AuthorityEnvelope and produce the same answer.
- Counterfactual replay (`@aristotle/time-machine`) is possible: feed
  a historical action through a different Ward and see what would
  have happened.
- Property-based testing is high-leverage. We can generate thousands
  of randomized cases and assert oracle agreement; flake is
  impossible by construction.
- Time-of-day policies require the caller to inject time as data
  (via `runtime_register_snapshot`), not for the gate to read the
  clock. This shifts a small burden to callers but eliminates a
  whole class of replay-divergence bugs.
- Network policy lookups (e.g., dynamic feature flags) require the
  caller to fetch the data and pass it in. The gate can't reach out
  during evaluation.

## See also

- `shared/execution-control-runtime/src/gate.property.test.ts` — 4000-case property test
- `shared/execution-control-runtime/src/gate.replay-property.test.ts` — replay invariants
- ADR-0001 (single-use Warrants) — single-use Warrants depend on this being deterministic; otherwise the audit story unravels
- ADR-0003 (GEL hash chain) — the hash chain only means something because the decisions are reproducible
- `@aristotle/time-machine` — counterfactual primitive that exists *because* the gate is deterministic
