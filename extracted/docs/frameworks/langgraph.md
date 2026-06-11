# Governing LangGraph Tool Calls

Goal: make a LangGraph node cross AristotleOS before a consequential tool call.

## Boundary

The graph can plan, branch, and reason. AristotleOS should sit immediately before
the node or tool invocation that causes an external consequence.

## Adapter Pattern

- Add a gate node before consequential tool nodes.
- Build the Canonical Governed Action from graph state and tool arguments.
- Route `ALLOW` to execution, `REFUSE` to a refusal path, and `ESCALATE` to a
  human/operator path.
- Store Warrant and GEL identifiers back into graph state for downstream audit.

## Review Questions

- Does every consequential edge pass through the gate node?
- Are graph retries bound to fresh Warrant checks?
- Can stale graph state replay an old Warrant?
