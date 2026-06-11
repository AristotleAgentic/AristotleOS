# Governing OpenAI Agents Actions

Goal: govern consequential tool calls made from an OpenAI Agents-style runtime.

## Boundary

The agent may plan freely. AristotleOS controls the point where a tool call would
mutate state, move money, alter infrastructure, send a message, or trigger an
external workflow.

## Adapter Pattern

1. Wrap consequential tools with an AristotleOS gate.
2. Convert the planned tool call into a Canonical Governed Action.
3. Evaluate Ward, Authority Envelope, runtime registers, and invariants.
4. Execute only after `ALLOW` and Warrant issuance when required.
5. Record the decision and execution evidence.

## Review Questions

- Are non-consequential read-only tools separated from consequential tools?
- Can the agent call the original tool outside the wrapper?
- Are operator approvals represented as scoped authority, not standing power?
