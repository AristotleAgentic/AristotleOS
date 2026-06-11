# ADR-0023 — Framework adapters as a collective SDK migration

**Status:** Accepted

## Context

The substrate ships 6 framework adapters that all wrap caller-supplied
tool handlers with the gate: `@aristotle/langchain`, `vercel-ai`,
`mastra`, `openai-agents`, `claude-agents`, `sdk-anthropic`.

Pre-migration, each adapter had its own implementation of the same
fail-closed pipeline: evaluate → ALLOW check → MISSING_WARRANT
guard → invoke handler → catch handler exception → format error.
Identical logic, six copies, six places drift could occur.

The substrate already had `governThroughAdapter` (transport-shaped,
ADR-0014) and `governThroughResponse` (response-shaped, used by
`@aristotle/k8s-admission`). The third pattern,
`governThroughHandler`, was added to `@aristotle/adapter-sdk`
specifically for the framework adapter shape.

## Decision

**All 6 framework adapters migrate to `governThroughHandler` as a
single collective batch**, not one at a time. Migration discipline:

1. Public API stays IDENTICAL: every function name, parameter
   shape, error class, error message text preserved verbatim.
2. Tests stay UNCHANGED: not a single test file edited; the
   migration is a pure refactor of internal implementation.
3. Migration order: `langchain` first (reference + small surface),
   then the other 5 follow.
4. Conformance: the cross-adapter conformance test
   (`@aristotle/tests-cross-adapter`) asserts the substrate-wide
   invariants (refusal-before-emission, SDK contract shape) hold
   across all 6 post-migration.

## Alternatives considered

- **Migrate adapters one at a time, in different batches.**
  Rejected. The substrate's value proposition includes "one
  consistent gate contract across every adapter shape." Letting
  some adapters use the SDK and others remain hand-rolled
  preserves the drift this migration is meant to fix.
- **Migrate but allow each adapter to diverge in error shape.**
  Rejected. The whole point of the SDK is the closed
  `AdapterRefusalCode` enum. Each adapter mapping the closed codes
  back to its framework's error vocabulary is the operator-facing
  contract; the underlying enum is the substrate's contract.
- **Build a separate `@aristotle/framework-adapter-sdk` instead of
  extending `@aristotle/adapter-sdk`.** Rejected. The shared
  pipeline (evaluate → ALLOW → handler / emit / response) is the
  same; splitting the SDK by adapter shape would fragment the
  closed `AdapterRefusalCode` enum, which is exactly the drift
  source the SDK exists to prevent.

## Consequences

- Adding a new framework adapter is now: install
  `@aristotle/adapter-sdk`, call `governThroughHandler`, map the
  closed-set refusal codes. No re-derivation of the pipeline.
- A breaking change to the SDK's `HandlerContext` shape is now a
  6-package-coordinated bump. Conscious migration cost, but the
  alternative is silent drift across 6 hand-rolled pipelines.
- Future framework adapters (LangGraph, Pydantic AI, Bee Agent
  Framework, etc.) start at the SDK pattern from day one. The
  migration cost is paid once.
- The `governThroughHandler` test suite in
  `@aristotle/adapter-sdk` is the substrate-wide guarantee for the
  pipeline behavior. Each framework adapter's tests then verify
  the framework-specific mapping (langchain throws
  `ToolGovernanceError` on REFUSE; vercel-ai returns its own
  error structure; etc.).
- Per-framework error-class shapes are preserved exactly. The
  consumer-facing API doesn't change because the SDK doesn't
  change it — the SDK is the inside of the function body.

## See also

- `@aristotle/adapter-sdk` — `governThroughHandler` + related types
- `packages/langchain` — the reference migration
- `packages/vercel-ai`, `mastra`, `openai-agents`, `claude-agents`, `sdk-anthropic` — the rest
- `@aristotle/tests-cross-adapter` — substrate-wide invariant tests
- ADR-0016 (three SDK patterns) — the shape this fits into
