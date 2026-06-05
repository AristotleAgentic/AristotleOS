# ADR-0024 — 5+5 vertical overlay shipping pattern

**Status:** Accepted

## Context

ADR-0018 established that per-vertical configuration ships as Helm
overlays, not chart logic. The remaining question: which verticals,
in what shipping order, with what docs discipline?

The substrate could:
- Ship one vertical overlay at a time, when the operator demand for
  that vertical is loud.
- Ship every vertical at once, accepting that some will get less
  per-vertical operator validation than others.
- Batch by vertical category (industrial OT vs autonomy vs
  enterprise IT) and ship per batch.

## Decision

**Ship verticals in batches of 5**, with the first 5 chosen by
"highest commercial significance the substrate can credibly
demonstrate today" and subsequent batches widening the coverage.

Batch 1 (shipped earlier): pipeline, aviation, grid, healthcare,
telecom. Each is a domain where the substrate's adapter set already
includes a relevant protocol adapter or framework adapter and where
the doctrine table (sovereignty, retention, demonstration-only
labeling) has a clear answer.

Batch 2 (this batch): rail, water, port, mining, automotive.
Selected because each is a meaningful adjacent vertical to one of
batch 1 — rail extends from grid SCADA discipline; water extends
from grid + healthcare regulatory posture; port extends pipeline +
logistics; mining extends pipeline + autonomy; automotive extends
aviation autonomy.

Discipline per overlay:
- Header documents vertical name, doctrine alignment (one-line),
  compliance reference (DEMONSTRATION ONLY label preserved), last
  reviewed date.
- Field structure mirrors the existing 5: `global.vertical`,
  `mesh.{revocationQuorum, productionMode, rateLimit, replayCache}`,
  `gel.{retention, timestamp, archive}`, `adapters`, `resources`.
- Compose with `values-hardened.yaml`: `helm install -f
  values-hardened.yaml -f values-<vertical>.yaml`.
- One entry per overlay in `README-VERTICALS.md`'s summary table +
  a "Vertical posture summary" section explaining the trade-offs.

## Alternatives considered

- **Ship one giant batch covering every conceivable vertical.**
  Rejected. The overlays exist to be operator-helpful, not
  exhaustive. An overlay for a vertical the substrate can't
  credibly demonstrate is a credibility liability.
- **Operator-supplied overlays only (substrate ships zero).**
  Rejected by ADR-0018 — the substrate's shipped overlays are the
  documented baseline; operators are free to override.
- **One-overlay-per-PR pacing.** Considered. Spreads the
  documentation work over time but means the substrate's vertical
  coverage stays sparse for longer. Batches let the operator-
  facing `README-VERTICALS.md` table grow in steps that match the
  substrate's actual reach.

## Consequences

- The substrate ships 10 vertical overlays after this batch (5
  from batch 1, 5 from batch 2). Batch 3, if shipped, brings the
  total to 15 — automotive, aerospace, finance, defense, energy
  trading are the natural batch-3 candidates.
- Each overlay's docs include the per-vertical regulatory
  references with DEMONSTRATION ONLY labeling. This is the
  substrate's standard practice for compliance text; ADRs 14 +
  this one make it explicit.
- The Helm chart itself stays vertical-agnostic. Adding overlays
  doesn't bump the chart's semver.
- Operators can compose multiple vertical overlays where
  appropriate (e.g., grid + telecom for a utility's
  telecom-extended SCADA), but the substrate's docs don't endorse
  any specific composition — the operator owns the doctrine choice
  for their actual deployment.
- Future overlays follow the same 5-at-a-time pattern unless
  there's a substrate-internal reason to break it.

## See also

- `charts/aristotle-governance-os/values-{pipeline,aviation,grid,healthcare,telecom,rail,water,port,mining,automotive}.yaml`
- `charts/aristotle-governance-os/README-VERTICALS.md`
- ADR-0018 (per-vertical Helm overlays, not vertical-aware chart) — the originating decision
- ADR-0014 (adapters default `production_validated: false`) — the demonstration-only labeling discipline these overlays inherit
