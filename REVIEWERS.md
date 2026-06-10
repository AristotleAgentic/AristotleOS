# AristotleOS Request for Reviewers

AristotleOS is seeking external technical, security, academic, and domain review.
The goal is not applause. The goal is to make the boundary claims falsifiable,
reproducible, and useful for institutions that need autonomous systems to act
under accountable authority.

## Claims We Want Tested

1. Commit Gate enforcement happens before consequential execution.
2. A Warrant is scoped to one canonical action and cannot be safely repurposed.
3. Refused and escalated actions do not emit through governed adapters.
4. Governance Evidence Ledger records are hash-chained, replayable, and
   suitable for offline verification.
5. Disconnected or partitioned operation remains bounded by delegated authority
   and reconciles without silent permission drift.
6. Documentation and demos do not overclaim certification, field validation, or
   safety-critical readiness.

## Review Tracks

| Track | Good reviewer fit | Starting point |
| --- | --- | --- |
| Runtime enforcement | distributed systems, security engineering, agent runtime maintainers | `extracted/shared/execution-control-runtime` |
| Cryptographic evidence | applied cryptography, audit systems, provenance logging | `extracted/shared/governance-core`, `extracted/shared/gel-*` |
| Agent integrations | LangGraph, LangChain, CrewAI, OpenAI Agents, MCP, AutoGen, SDK maintainers | `extracted/packages/*` |
| Robotics and edge | robotics, drones, industrial control, disconnected systems | mesh runtime and partition scenarios |
| Governance and policy | AI governance, public-sector technology, safety assurance | docs, examples, and claims review |

## Twenty-Minute Review Path

```sh
git clone https://github.com/AristotleAgentic/AristotleOS
cd AristotleOS/extracted
corepack pnpm@10.32.1 install
pnpm reviewer:verify
```

Then read:

- `extracted/examples/reviewer/REVIEWER.md`
- `extracted/PROOF_STATUS.md`
- `extracted/LIMITATIONS.md`
- `extracted/VALIDATION_MATRIX.md`
- `extracted/ROADMAP_TO_100.md`

## What To Send Back

Useful feedback includes:

- a reproducible failing case;
- a missing invariant;
- an overbroad website or README claim;
- a bypass path around the Commit Gate;
- an adapter that logs instead of refusing before emission;
- a Warrant binding weakness;
- an evidence record that cannot be independently replayed;
- a security report through the process in `SECURITY.md`; or
- a pull request with a targeted fix.

## Community Posture

AristotleOS uses MPL-2.0 for the public core so reviewers and collaborators can
inspect, modify, and distribute improvements while keeping changes to covered
source files open under MPL-2.0 when distributed.

Commercial services, hosted deployments, enterprise support, and implementation
work can exist around the open code without reducing the public review surface.
