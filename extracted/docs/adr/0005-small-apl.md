# ADR-0005 — Small Aristotle Policy Language

**Status:** Accepted

## Context

The substrate needed some policy surface area. The two obvious
extremes:

- **Embed a general-purpose policy language** (Rego, Cedar, Casbin,
  a JS DSL with eval). Maximum expressiveness; consumers can write
  arbitrary policy; the language becomes a focal point of the
  substrate.
- **Hand-roll JSON / YAML schemas for specific decisions.** Minimum
  expressiveness; every new policy shape is a substrate code change.

Both extremes had failure modes. A rich language becomes the
substrate's identity — operators ask "what's a Rego policy that does
X?" instead of "what's an AristotleOS policy that does X?" and
substrate-specific concepts (Ward, AuthorityEnvelope, Fluidity Token)
get smeared into a general-purpose tool. Hand-rolled JSON becomes
operationally brittle as new domains arrive.

## Decision

The substrate ships **Aristotle Policy Language (APL)** — a small,
declarative, intentionally limited DSL.

What APL supports:
- `ward "..." { ... }` blocks with `id`, `domain`, `subject`,
  `criticality`, `classification`, `version`
- `allow A, B, C` and `allow A when telemetry.X`
- `deny A, B`
- `bound altitude_m <= 120` style numeric constraints
- `within <boundary-id>`

What APL does NOT support (and won't):
- Cross-ward references / inheritance
- Macros / reusable rule fragments
- Custom predicate functions
- Importable type libraries
- Rich rule composition (intersection / union / conditional escalation)

For policies that exceed APL's surface, the substrate's primary
exposure is **TypeScript code that constructs `WardManifest` and
`AuthorityEnvelope` directly**. The full type system + the
substrate's validators are available; APL is the convenience layer
for the simple 80%.

## Alternatives considered

- **Embed Rego (Open Policy Agent).** Rejected as the substrate
  default. The Rego language becomes the focal point; the
  substrate's primitives (Ward, AuthorityEnvelope, FluidityToken)
  become attributes the policy author has to learn separately. Rego
  is also a non-trivial dependency to take. Operators who want Rego
  can write their evaluator to produce `WardManifest` /
  `AuthorityEnvelope` from Rego and feed it to the gate; that's a
  caller-side choice.
- **Embed Cedar (AWS).** Same reasoning — and Cedar adds AWS Lambda
  Authorizer-shaped assumptions that don't generalize to cyber-
  physical or agentic workloads.
- **Casbin-style RBAC/ABAC config.** Considered. Casbin's model is
  rich for principal/resource/action triples but doesn't naturally
  express envelopes, partition behavior, or quorum requirements.
- **Visual editor (low-code policy)**. Rejected. The substrate's
  primary users are operators with thousands of lines of policy and
  versioned configuration — low-code makes the trivial cases easy
  and the non-trivial cases impossible.
- **Pure JSON Schema.** Considered as the policy surface. Rejected
  because JSON Schema lacks the conditional logic (`when telemetry.X`)
  needed to express even the simple cases cleanly.

## Consequences

- The substrate's identity is the **primitives** (Ward, Envelope,
  Warrant, Commit Gate, GEL), not the language. Operators learn the
  primitives first; APL is a convenience for expressing the simple
  shape, not the canonical interface.
- For non-trivial policies, operators construct `WardManifest` /
  `AuthorityEnvelope` programmatically in TypeScript. This is more
  code than a Rego policy but it's typed, debuggable, and uses the
  same primitives the gate evaluates against. No translation layer.
- The APL compiler stays small: `shared/execution-control-runtime/src/policy-dsl.ts`
  is ~500 lines, no parser library dependency, no lexer state
  machine. Anyone can read it in an afternoon.
- New language features face a HIGH bar — they need to be motivated
  by multiple real policies, not "Rego does this so we should too."
  The default answer to a feature request is "use TypeScript."
- The `@aristotle/policy-pipeline` package wraps APL compilation with
  provenance, content addressing, deterministic signing, and
  reproducibility verification. That's the operator-facing build
  pipeline for policies; APL is the input format.
- Migration story for Rego / Cedar users: write a small translator
  that produces `WardManifest` / `AuthorityEnvelope` JSON, then feed
  the JSON to the gate. The substrate doesn't try to be Rego-with-
  different-syntax.

## See also

- `shared/execution-control-runtime/src/policy-dsl.ts` — the compiler
- `@aristotle/policy-pipeline` — build pipeline + signed bundles
- [docs/APL.md](../APL.md) — what compiles today
- [docs/COMPARISON.md § OPA](../COMPARISON.md#opa-open-policy-agent) — line-by-line comparison with OPA
- ADR-0002 (deterministic gate) — policy evaluation must be deterministic; APL's small surface helps prove this
- [LIMITATIONS.md § 9](../../LIMITATIONS.md#9-apl-is-intentionally-small) — explicit acknowledgment that APL is small by design
