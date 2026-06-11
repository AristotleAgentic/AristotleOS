# ADR-0016 — Three SDK patterns (Adapter / Response / Handler)

**Status:** Accepted

## Context

`@aristotle/adapter-sdk` started as a generalization of one pattern:
adapters that build a CanonicalAction, evaluate it via the gate, and
emit on a transport on ALLOW (`governThroughAdapter`). That covered
the 7 protocol adapters (mavlink-px4, modbus, dnp3, opcua, bacnet,
ros2, k8s-admission).

But not every governed integration emits on a transport. Two more
shapes turned up:

1. **Response-shaped adapters** — receive a request, return a
   response synchronously, no out-of-band transport. The Kubernetes
   admission webhook is the canonical example: the API server hands
   the adapter an `AdmissionReviewRequest`, the adapter MUST return
   an `AdmissionReviewResponse` immediately.
2. **Handler-shaped adapters** — wrap a caller-supplied function
   (typically an LLM framework's tool handler). The substrate gates
   the invocation; on ALLOW the original function runs; on REFUSE the
   framework gets a typed error. The 5 framework adapters
   (langchain, vercel-ai, mastra, openai-agents, claude-agents) +
   the new `@aristotle/sdk-anthropic` all follow this shape.

Conflating these into a single API forces every consumer to model
their concept as a transport. That's the wrong leak.

## Decision

`@aristotle/adapter-sdk` ships **three** orchestrator functions, one
per shape:

| Function | Shape | Reference adapter |
|---|---|---|
| `governThroughAdapter` | Transport-shaped (gate → emit on wire) | `@aristotle/modbus-adapter`, the other 5 protocol adapters |
| `governThroughResponse` | Response-shaped (gate → return synchronous response) | `@aristotle/k8s-admission` |
| `governThroughHandler` | Handler-shaped (gate → invoke caller-supplied function) | `@aristotle/langchain`, the other 4 framework adapters |

Each shares the same fail-closed pipeline:
- `client.evaluate(action)`
- HTTP error → `GATE_HTTP_<status>`
- Network error → `GATE_UNREACHABLE`
- Non-ALLOW decision → `GATE_REFUSED` (with the decision attached)
- ALLOW without Warrant → `MISSING_WARRANT` (defensive)
- Pattern-specific terminal step

The closed `AdapterRefusalCode` enum is shared across all three. The
adapter-author burden is exactly one function (build the
CanonicalAction) plus one terminal callback (emit / build response /
invoke handler). Everything else is the SDK.

## Alternatives considered

- **One SDK function with mode flag.** Rejected. A `mode: "transport" |
  "response" | "handler"` parameter forces every shape's type signature
  into the same generic envelope, which then needs runtime
  branching at the callsite. Three concrete functions are clearer at
  the type level and let TypeScript narrow without runtime checks.
- **Three separate SDK packages.** Rejected. Same fail-closed pipeline,
  same refusal codes, same authorization shape — splitting the package
  would forces three versions of the closed-set enum to drift over
  time. One package, three functions = one source of truth.
- **Framework-specific SDKs (langchain-sdk, anthropic-sdk, etc.)**
  Rejected. Each framework adapter would have to re-derive the
  fail-closed pipeline. We already shipped that mistake once (every
  framework adapter had its own pipeline pre-SDK); the conformance
  test caught the drift.

## Consequences

- Third-party adapter authors pick the shape that matches their
  integration. The substrate's docs (`@aristotle/adapter-sdk`'s
  jsdoc) document which pattern fits which shape with the
  first-party reference for each.
- The closed `AdapterRefusalCode` enum applies across all three. A
  consumer dispatcher can write one `switch (refusal.code)` block
  that handles every refusal from every adapter the substrate ever
  ships.
- The cross-adapter conformance test (`@aristotle/tests-cross-
  adapter`) covers all three patterns. Adding a fourth pattern in
  the future would require: a new SDK function, a new reference
  adapter migrated to it, and conformance coverage.
- Backward compat: adapters built against `governThroughAdapter`
  before `governThroughResponse` + `governThroughHandler` shipped
  still work unchanged. The SDK appends; it doesn't replace.

## See also

- `shared/adapter-sdk/src/index.ts` — all three functions
- ADR-0014 (`production_validated: false` default) — discipline applied at the transport pattern; the other two patterns inherit through closed-enum sharing
- `@aristotle/modbus-adapter`, `@aristotle/k8s-admission`, `@aristotle/langchain` — first-party references, one per pattern
