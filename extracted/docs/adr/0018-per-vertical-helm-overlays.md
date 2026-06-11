# ADR-0018 — Per-vertical Helm overlays, not a vertical-aware chart

**Status:** Accepted

## Context

The substrate's Helm chart (`charts/aristotle-governance-os`) is one
chart that deploys the 9-service control plane. Operators across
verticals (pipeline, aviation, grid, healthcare, telecom, ...) have
genuinely different operational profiles: different mesh quorum
sizing, different GEL retention windows, different sovereignty
disciplines (regulator-imposed), different scale.

Two ways to ship this:
1. **One chart that's vertical-aware.** A `vertical: pipeline` value
   that the chart's templates read and dispatch on. One chart, many
   behaviors.
2. **One chart, many overlays.** Per-vertical `values-<vertical>.yaml`
   files that the operator composes with `helm install -f
   values-<vertical>.yaml`. Chart stays vertical-agnostic; overlays
   carry the doctrine.

## Decision

**Overlays, not vertical-aware chart logic.**

Each vertical ships as a separate `values-<vertical>.yaml` file:

```
charts/aristotle-governance-os/
├── values.yaml                  # vertical-agnostic defaults
├── values-hardened.yaml         # security baseline (composes with verticals)
├── values-kind-smoke.yaml       # CI: brings up under kind
├── values-pipeline.yaml         # oil & gas — quorum 3, GEL 7y, demo blocked
├── values-aviation.yaml         # UAV — quorum 2, GEL 90d, partition-tolerant
├── values-grid.yaml             # electric grid — quorum 3, GEL 7y, NERC CIP
├── values-healthcare.yaml       # clinical — quorum 2, GEL 7y, HIPAA
├── values-telecom.yaml          # 5G/NEF — quorum 3, GEL 1y, high throughput
└── README-VERTICALS.md          # overlay strategy + per-vertical posture summaries
```

Operators compose: `helm install -f values-hardened.yaml -f
values-pipeline.yaml ...`

Each overlay's header documents:
- Vertical name
- Doctrine alignment (one-line)
- Compliance reference (one-line; demonstration-only labeling
  preserved)
- Last reviewed date

Each overlay sets a `global.vertical` label that templates can
surface to operators via configmap, useful for "which posture is
this cluster running?" audits.

## Alternatives considered

- **Vertical-aware chart with a `vertical:` value.** Rejected. The
  chart's templates would have to encode each vertical's profile
  in conditionals, drifting whenever any vertical's posture changes.
  Templates stay vertical-agnostic; overlays carry the doctrine.
- **One Helmfile per vertical.** Considered. Helmfile is a
  higher-level orchestrator that some operators don't use. Plain
  `-f values-<vertical>.yaml` works with vanilla `helm install`
  and meets every operator's tooling.
- **Helm chart per vertical.** Rejected. Duplicates the template
  surface, drift across charts is silent, operators have to
  rediscover what's specific to their vertical vs. what's shared.
- **Operator-owned overlays only (substrate ships no overlays).**
  Rejected. Every operator would have to re-derive sensible
  vertical-defaults. The substrate's shipped overlays are the
  documented baseline; operators are free to override anything.

## Consequences

- Adding a new vertical is one `values-<vertical>.yaml` + an entry
  in `README-VERTICALS.md`. No chart template changes; no semver
  bump of the chart itself.
- Verticals that share traits (e.g., grid + pipeline both want
  quorum 3 + 7-year retention) share overlay structure but don't
  share files. The substrate accepts that duplication as the cost
  of operator-legible per-vertical doctrine.
- Operators who deploy across multiple verticals install separate
  releases per vertical (one namespace per vertical, typically).
  The chart supports it; the overlays are intentionally orthogonal
  to namespace.
- Compose order matters: `values.yaml < values-hardened.yaml <
  values-<vertical>.yaml`. Documented in `README-VERTICALS.md`.
- Helm template lint covers every overlay in CI when chart-touching
  PRs run (the helm-kind workflow's matrix covers the
  vertical-agnostic + hardened composition; per-vertical
  validation against a real kind cluster is operator-side work).

## See also

- `charts/aristotle-governance-os/README-VERTICALS.md` — operator-facing strategy
- `charts/aristotle-governance-os/values-{pipeline,aviation,grid,healthcare,telecom}.yaml`
- ADR-0015 (one package per concept) — same principle applied to chart values
- `.github/workflows/helm-kind.yml` — chart smoke testing
- `docs/PRODUCTION_DEPLOYMENT.md` — operator-facing deployment guidance
