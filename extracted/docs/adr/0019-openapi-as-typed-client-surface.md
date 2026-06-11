# ADR-0019 — OpenAPI is the typed-client surface

**Status:** Accepted

## Context

The substrate exposes its HTTP gateway as the network-facing
contract (ADR-0011). Operators integrate by calling those routes
— from any language, from CI, from custom dashboards, from other
services. The question: what's the canonical description of those
routes, and how do consumers in other languages build a typed
client?

## Decision

`adapters/http-gateway/openapi.json` is the **single source of
truth** for the HTTP gateway's wire contract.

- **OpenAPI 3.1 (JSON form).** 3.1 because it aligns OpenAPI's
  schema dialect with JSON Schema 2020-12 — the dialect the
  substrate's typed payloads already use.
- **JSON form** because every operator's tooling reads JSON
  natively; YAML adds a parser dependency for no information gain.
- **Hand-curated**, not auto-extracted from code. The reasons:
  (a) the gateway's routes are stable enough that hand-curation is
  tractable; (b) auto-extraction tools (express-openapi,
  swagger-jsdoc, etc.) introduce a build-time dep and runtime
  reflection cost we don't want; (c) the spec is part of the
  product surface — the substrate maintainer reviewing a spec diff
  is a feature, not a cost.

Distribution:

- `@aristotle/gateway-client` ships the OpenAPI JSON as both a
  static file and an embedded `OPENAPI_SPEC` constant. Operators
  who want type-safe access install it; the package re-exports the
  existing `AristotleClient` (from `@aristotle/os-sdk`) which is
  itself the OpenAPI-conforming TypeScript client.
- Non-TypeScript consumers feed the OpenAPI JSON to their
  language's preferred generator (`openapi-generator`, `oapi-codegen`,
  `oats`, etc.) and get a client in their language. The substrate
  doesn't ship those clients; the spec is the contract.

CI discipline: every change to the gateway's routes MUST update
`openapi.json` in the same PR. The substrate's tests assert the
spec contains every route the client calls (the gateway-client
test sweeps spec.paths for the known operation set).

## Alternatives considered

- **gRPC.** Rejected. gRPC has a richer type system but operator
  reach is narrower; not every consumer wants to ship protobuf
  tooling. The substrate's primary integration shape is "REST from
  any language" and OpenAPI is the universal way to type that.
- **GraphQL.** Rejected. GraphQL's strength is flexible queries
  against rich graphs; the substrate's API surface is a small set
  of fixed operations (evaluate, replay, governance manifest, ...)
  where GraphQL adds query-planning complexity for no benefit.
- **OpenAPI 3.0 (older).** Rejected. 3.1's JSON Schema alignment
  matters for the substrate's nested action schemas (CanonicalAction
  has recursive payload validation).
- **Generate the OpenAPI from the TypeScript types.** Considered.
  `zod-to-openapi`, `tsoa`, similar tools work. We didn't take this
  path because the spec is the contract that downstream consumers
  in other languages depend on — auto-generation makes the spec
  reactive to incidental type changes rather than deliberate
  contract decisions.

## Consequences

- Adding an endpoint is a deliberate two-step: add the route to
  the gateway code AND update `openapi.json`. Tests fail loudly if
  the substrate's known operation set diverges from the spec.
- Removing or renaming an endpoint is a breaking change to the
  spec, which is a breaking change to every downstream client.
  Forces operators to rev intentionally rather than discover at
  runtime.
- The spec is the public artifact for procurement / diligence
  conversations. "Show me your API" is a one-file answer.
- `@aristotle/gateway-client` is a thin re-export package. Its
  value is the bundled spec + the convention that "this is the
  package your operators install for typed access." It intentionally
  doesn't add another HTTP client implementation; the existing
  `AristotleClient` is the implementation.

## See also

- `adapters/http-gateway/openapi.json` — the spec
- `packages/gateway-client/` — TS distribution package
- `packages/os-sdk/src/index.ts` — `AristotleClient`, the in-repo
  OpenAPI-conforming client
- ADR-0011 (HTTP gateway is the only network boundary) — the
  boundary this spec describes
