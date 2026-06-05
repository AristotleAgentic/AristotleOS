# ADR-0011 — HTTP gateway is the only network boundary

**Status:** Accepted

## Context

The substrate's primitives are functions: `evaluateCommitGate`,
`issueWarrant`, `verifyWarrant`, `appendGelRecord`, the mesh
`MeshNode.direct()` fast path. None of them does I/O. They are
testable, deterministic, and embeddable.

But a real deployment must expose a network surface. The question:
where does network live?

## Decision

**One package owns the network surface: `@aristotle/http-gateway`.**

Every service that exposes HTTP wraps the substrate primitives via
the gateway's typed contract. The substrate packages themselves —
`@aristotle/execution-control-runtime`, `@aristotle/governance-core`,
`@aristotle/mesh-runtime`, etc. — never directly `import "node:http"`
in their primary primitives. (Mesh-runtime has its own intra-mesh
HTTP server, but that's a different concern: peer-to-peer gossip
with the same Ed25519 trust layer; not a customer-facing API.)

The gateway:
- Owns wire-level contract definitions (request shapes, response
  shapes, OpenAPI surface).
- Owns authentication (API keys, OIDC, mTLS — pluggable via
  middleware).
- Owns rate limiting, body size caps, content-type validation at
  the HTTP layer (separate from the mesh-runtime's
  `MeshNode.onRequest` hardening, which is for intra-mesh traffic).
- Translates substrate exceptions into HTTP status codes
  consistently.
- Is the ONE place to look when reasoning about "what URL does what,
  with what auth, with what error shape."

Substrate primitives stay HTTP-free; consumers of the substrate
include the gateway when they want network exposure and don't include
it when they don't (CLI usage, in-process embedding, tests).

## Alternatives considered

- **Every primitive package ships its own HTTP wrapper.** Rejected.
  Surface area explodes; consistency drifts; authentication
  configuration has to be re-applied per package.
- **The substrate is HTTP-only — primitives are inaccessible
  except through HTTP.** Rejected. Embedding the gate in-process
  (e.g., inside an MCP server, or a CLI like `@aristotle/os-cli`)
  is a first-class use case; forcing those callers to spin up a
  local HTTP server is overhead.
- **GraphQL / gRPC as the network surface.** Considered. REST/HTTP
  is the lowest common denominator that every consumer in every
  language already supports. Adding GraphQL or gRPC remains
  possible as additional layers — they'd live in their own
  packages, with the same "one package owns the network surface
  type" discipline.

## Consequences

- The substrate's "what URL exists" surface is auditable in one
  place. There's no scattered HTTP code across packages where
  an authentication gap or a contract drift could hide.
- Operators who don't want a network surface (e.g., embedded in a
  larger application) just don't include the gateway. Substrate
  primitives work without it.
- CLI tools (`@aristotle/os-cli`) call substrate primitives
  directly; they don't proxy through the gateway. Same trust
  model, different transport.
- mTLS, source-IP allowlists, reverse-proxy fronting — these all
  live in front of the gateway (operator deploys it behind their
  preferred ingress), not inside it. The gateway provides hooks
  (`httpClient` override, `urlFor` override on mesh-runtime) but
  doesn't ship a TLS configuration of its own.
- The mesh-runtime's separate `/mesh` HTTP server is intentional.
  Intra-mesh traffic has different trust + protocol assumptions
  than customer-facing API traffic; keeping them in separate
  packages keeps the threat models clean.

## See also

- `adapters/http-gateway/` — the only place customer-facing HTTP surface lives
- `shared/mesh-runtime/src/index.ts` — intra-mesh HTTP, distinct from above
- ADR-0006 (mesh role separation) — intra-mesh trust model
- ADR-0010 (productionMode) — production lockdown applies at every HTTP boundary
