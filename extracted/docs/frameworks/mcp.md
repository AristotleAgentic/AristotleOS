# Governing MCP Tools

Goal: place AristotleOS at the boundary before an MCP tool call becomes a
consequence.

## Boundary

An MCP client or agent proposes a tool call. AristotleOS should evaluate a
Canonical Governed Action before the tool handler emits the real side effect.

## Minimum Adapter Contract

- Build a canonical action from tool name, arguments, subject, target, and Ward.
- Resolve the relevant Authority Envelope.
- Call the Commit Gate.
- Emit only on `ALLOW` with a valid Warrant when a Warrant is required.
- Write refusal, escalation, Warrant, and execution evidence to GEL.

## Review Questions

- Can a tool call bypass the adapter?
- Are arguments canonicalized before hashing?
- Does refusal happen before the tool handler performs the side effect?
- Does the evidence record include the tool name, target, subject, and decision?
