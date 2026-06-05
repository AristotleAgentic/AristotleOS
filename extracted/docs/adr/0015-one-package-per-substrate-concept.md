# ADR-0015 — One package per substrate concept

**Status:** Accepted

## Context

The substrate is a monorepo with 14+ shared packages. It would have
been easier to ship one big package — `@aristotle/core` — that
exports everything. Many substrates take that path; the result is a
single import line for consumers and a single semver for the
maintainer to bump.

The substrate didn't.

## Decision

**Each substrate concept gets its own package**, with its own
semver, its own peer dependency boundary, and its own
substitutability story:

| Package | Concept |
|---|---|
| `@aristotle/governance-core` | Substrate primitives (Ward / Envelope / Warrant / GEL chain types + validators) |
| `@aristotle/execution-control-runtime` | The Commit Gate decision function + signing + evidence |
| `@aristotle/mesh-runtime` | Root / Witness / Edge mesh nodes |
| `@aristotle/nonce-store` | Durable Warrant replay protection |
| `@aristotle/kms-keyring` | KMS-backed Warrant signing |
| `@aristotle/gel-timestamp` | External timestamp anchor interface |
| `@aristotle/gel-archive` | GEL retention + archive/restore |
| `@aristotle/adapter-sdk` | Generic adapter contract |
| `@aristotle/service-runtime` | /healthz + /readyz helper |
| `@aristotle/observability-otel` | OTel SDK adapter |
| `@aristotle/mcp-server` | AristotleOS as an MCP server |
| `@aristotle/policy-pipeline` | APL compile → OCI bundle |
| `@aristotle/tenant-onboarding` | Tenant lifecycle |
| `@aristotle/chaos-harness` | Chaos / failure-mode scenarios |
| `@aristotle/scenario-engine` | Scenario scripting on the mesh |
| `@aristotle/time-machine` | Counterfactual replay |
| `@aristotle/warrant-verifier` | Standalone public Warrant verifier |
| `@aristotle/replay-artifact` | Published replay format |
| `@aristotle/event-stream` | Webhook + SSE event delivery |
| `@aristotle/trial-engine` | Substrate-internal trial harness |

## Alternatives considered

- **One package: `@aristotle/core` with everything.** Rejected.
  Consumers who want only the gate (e.g., an MCP server embedding)
  would pay the cost of every dep. A KMS keyring change would bump
  the version of the gate. Substitutability dies: an operator who
  wants Redis instead of file-backed nonce store has to fork the
  whole monorepo to swap one piece.
- **Package per service.** Rejected. Services are deployable units;
  packages are conceptual units. A package can be used by multiple
  services (mesh-runtime is used by meta-authority-registry +
  witness-service + agent-os) and can also be used by NO service
  (warrant-verifier is a standalone primitive).
- **Package per layer (`@aristotle/runtime`, `@aristotle/network`,
  `@aristotle/operator`).** Considered. The boundaries are
  conceptual not layered — a KMS keyring is a "runtime" concept
  for the signer + an "operator" concept for key custody. Layer-
  boundary packages are arbitrary; concept-boundary packages
  match how operators reason about substitution.

## Consequences

- **Substitutability is real.** An operator who wants Redis-backed
  nonces drops in a Redis adapter implementing the
  `NonceSeenSet` interface; the substrate doesn't know or care.
  Same for KMS (drop in Vault adapter), TSA (drop in Sigstore
  adapter), tracer (drop in OTel SDK adapter).
- **Semver granularity is real.** A breaking change in
  `@aristotle/gel-archive` doesn't bump `@aristotle/governance-core`.
  Downstream consumers upgrade what they use, not the whole world.
- **Maintenance cost is real too.** 20+ packages means 20+ build
  configs, 20+ test scripts, 20+ CHANGELOGs (in principle; in
  practice the maintainer tracks them collectively). The
  workspace tooling (`pnpm -r`, `corepack pnpm` filters) keeps
  this manageable.
- **Dependency graph stays sane** because the boundaries match
  the concepts. The substrate's dependency direction is "primitive
  packages have no dependencies on operator packages." Operator-
  facing packages (service-runtime, observability-otel, kms-keyring)
  depend on the primitive packages, not the other way around.
- **Discoverability cost.** A new consumer has to know which
  package they need. The substrate mitigates this with
  `docs/COMPARISON.md`, the package descriptions, and the
  `@aristotle/os-cli` which surfaces the most common operator
  flows without requiring deep package knowledge.
- **Test isolation comes for free.** Each package's tests run
  against just its surface area. Cross-cutting invariants
  (refusal-before-emission across all adapters; mesh reconciliation
  spec; reviewer flow) live in their own test packages
  (`@aristotle/tests-cross-adapter`, `docs/specs/`,
  `examples/reviewer/`) and assert across boundaries explicitly.

## See also

- All shared/ + packages/ directories — the per-concept boundary in concrete
- ADR-0008 (OCI policy bundles) — substitutability principle applied to policy
- ADR-0014 (adapter production_validated) — substitutability principle applied to transports
- `docs/COMPARISON.md` — operator-facing "which package do I need" guide
- This is the last ADR in the planned 15. Future ADRs document
  new design decisions as they're made; the next number is 0016.
