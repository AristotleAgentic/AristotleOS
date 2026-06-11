# ADR-0013 — The substrate ships no UI

**Status:** Accepted

## Context

A governance product needs operator visibility: who issued what,
when, with what reasons. The natural shape is a UI — a dashboard,
a list view, a per-decision drill-down. Many comparable systems
make the UI their main surface.

The substrate's repo intentionally does not.

The `apps/console-ui` and `apps/website` directories exist (for
local demo + the static landing page), but the substrate's
canonical interface is its APIs + its evidence formats. Operators
build their own UIs on top.

## Decision

**The substrate ships APIs + evidence formats; UIs are
operator-supplied.**

Specifically:
- The substrate publishes the GEL record format, the evidence
  bundle format, the replay artifact format, the OpenAPI schema
  of the HTTP gateway.
- Reviewers / auditors / operators consume those through their
  own UIs (Grafana, Splunk, Datadog, custom React dashboards,
  Notion + scripts, whatever they already operate).
- The `apps/console-ui` is a development convenience for the
  local control plane and a vertical-hub demo, not the
  production operator interface.

## Alternatives considered

- **Ship a first-party operator dashboard.** Rejected. A UI is
  an opinion: which charts, which alerts, which workflows. Every
  operator wants different ones; building a UI biases the substrate
  toward whichever shape the maintainer happened to prefer. The
  underlying primitives (decisions + evidence) are sufficient for
  operators to build the UI THEY need.
- **Ship a UI framework + example dashboards.** Considered. Adds
  surface area to maintain that doesn't help anyone whose existing
  ops tooling doesn't match the framework's assumptions. The
  per-vertical templates in `docs/` cover the "show me what a
  dashboard could look like for X" question without taking on
  framework debt.
- **Make the GEL records queryable via a substrate-shipped SQL
  layer.** Considered. The substrate's `LedgerBackend` interface
  supports operator-supplied SQL backends (Postgres, SQLite); the
  substrate doesn't ship its own query layer because operators
  already have one in their data platform.

## Consequences

- The substrate stays small. The maintainer doesn't owe operators
  a UI maintenance commitment.
- Operators build UIs against stable JSON formats (the GEL record
  schema, the evidence bundle schema). Format versioning is the
  contract; UI changes are local.
- The reviewer flow (`pnpm reviewer:verify`) is CLI-only — a
  reviewer doesn't need to spin up a UI to verify a decision.
- The local `apps/console-ui` is intentionally limited. It's a
  development tool, not a production dashboard. The 9-service
  control plane it visualizes is for local debugging.
- Operators who want a hosted UI as a service can build one on
  top — the substrate's APIs + formats are sufficient.
- If a UI ever becomes a substrate concern (because an unmissable
  consensus emerges about what every operator wants), it would
  ship in its own package (`@aristotle/operator-console`) with
  the same "operator can opt out" discipline applied to other
  substrate packages.

## See also

- `apps/console-ui/` — development convenience (NOT the operator dashboard)
- `apps/website/` — the static landing page
- `adapters/http-gateway/` — the API surface operator UIs build against
- ADR-0011 (HTTP gateway) — the boundary UIs consume
- ADR-0009 (evidence bundle format) — the format reviewer-facing UIs surface
