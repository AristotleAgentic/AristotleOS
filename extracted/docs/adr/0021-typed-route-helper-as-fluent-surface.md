# ADR-0021 — Typed-route helper as fluent surface (not generator output)

**Status:** Accepted

## Context

`@aristotle/gateway-client` ships the OpenAPI 3.1 spec and re-exports
`AristotleClient` (the substrate's canonical OpenAPI-conforming
client). That covers two consumer needs: machine-readable spec for
external tooling, and a TypeScript client for direct calls.

A third need surfaced from operators: a stable, IDE-discoverable
fluent surface — `routes.evaluate(action)` instead of remembering
which `client` method maps to which OpenAPI operation. Two ways to
ship this:

1. Run `openapi-generator` against the spec at build time and ship
   the generated client.
2. Hand-write a thin typed-routes wrapper over `AristotleClient`.

## Decision

**Hand-written typed-route helper.** Ships as `createTypedRoutes(client)`
returning a `TypedRoutes` object whose methods (`evaluate`, `replay`,
`compileGovernance`, `diffGovernance`, `explainPolicy`,
`shadowReplay`, `health`) map 1:1 to the OpenAPI operations.

Implementation guards against os-sdk version drift: if a method the
typed routes expect is absent on the underlying client, the call
returns a rejected promise with a clear diagnostic. The substrate's
gateway-client test suite walks every route to assert the mapping
holds.

## Alternatives considered

- **openapi-generator output.** Rejected. The generator's TypeScript
  output ships ~500 KB of boilerplate (typed model classes, axios
  binding, runtime serializer, configuration class). For a small,
  stable operation set the generated surface is over-budget; the
  hand-written wrapper covers the same operations in ~150 lines.
- **No typed-routes helper at all.** Rejected. Operators repeatedly
  hit "which client method matches which OpenAPI operation" friction.
  The wrapper removes the friction at one stable surface.
- **Auto-generate the wrapper from the spec at build time.** Considered.
  Adds a build-time generator dep + makes the wrapper reactive to
  incidental spec changes. The OpenAPI spec is the contract; the
  wrapper is a deliberate, reviewable selection of which operations
  to surface (we don't expose every internal route). Hand-written
  is the right shape.
- **Embed the spec types into the wrapper's signatures via
  openapi-typescript.** Considered. That tool's generated TypeScript
  types are good but operators install another dep. The substrate's
  os-sdk already ships typed input/output shapes; reusing them
  matches the rest of the ecosystem.

## Consequences

- Operators get IDE autocomplete on `routes.<operation>` — no need
  to read the OpenAPI spec to find the right method name.
- The wrapper is the substrate's "canonical operation set" — adding
  an operation here is deliberate; the OpenAPI spec lists every
  route but only the canonical ones get a typed-routes binding.
  Internal / experimental routes stay off the typed surface.
- The wrapper's tests assert every method on `TypedRoutes`
  delegates to a real method on `AristotleClient`. A breaking
  change in os-sdk that renames `evaluate` is caught by the
  gateway-client test sweep.
- Future operations are added in three places: the OpenAPI spec
  (the contract), `AristotleClient` (the implementation), and the
  typed-routes wrapper (the fluent surface). Each PR that adds a
  route touches all three intentionally.

## See also

- `packages/gateway-client/src/routes.ts` — implementation
- `packages/gateway-client/src/routes.test.ts` — delegation tests
- `adapters/http-gateway/openapi.json` — spec
- ADR-0019 (OpenAPI as typed-client surface) — the contract this wrapper consumes
- ADR-0011 (HTTP gateway is the only network boundary) — what these routes call
