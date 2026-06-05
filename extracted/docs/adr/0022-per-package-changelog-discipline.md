# ADR-0022 — Per-package CHANGELOG discipline

**Status:** Accepted

## Context

The substrate ships 40+ packages, each with its own published
artifact. Until this batch, every "what changed" question routed
through the repo-level `CHANGELOG.md` — a narrative document that
captures the substrate's evolution as a whole.

That works for substrate-internal review. It doesn't work for
operators consuming a specific package via npm: they install
`@aristotle/nonce-store`, want to know what's in v0.1.0, and the
answer is "scroll through 700 lines of repo-wide narrative."

## Decision

**Every published package gets its own `CHANGELOG.md`** following
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
format. The repo-level `CHANGELOG.md` stays as the substrate-wide
narrative — when the substrate ships a coordinated cross-package
batch, the narrative lives there.

Per-package format:

```markdown
# Changelog

All notable changes to **@aristotle/<name>** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — YYYY-MM-DD

### Added
- <one-line description per substantive feature>

### Notes
- Initial published surface area.
```

Every PR that touches a published package MUST update that package's
`CHANGELOG.md`. A future CI check could enforce this; for now it's
discipline.

The repo-level `CHANGELOG.md` keeps a 1-line summary referencing the
per-package CHANGELOGs for detail.

## Alternatives considered

- **Keep one repo-level CHANGELOG only.** Rejected. Operators
  installing one package don't want to wade through the others.
  npm clients (the npm CLI, GitHub release pages, packagephobia,
  bundlephobia) all expect per-package CHANGELOGs.
- **Auto-generate per-package CHANGELOGs from git history.**
  Considered. Tools (`changesets`, `release-please`) do this well.
  Rejected for the initial pass because the substrate's history
  predates the discipline — the entries would be unhelpful. Future
  bumps could adopt `changesets` once the per-package files are in
  place.
- **Single SOURCE OF TRUTH file per package + generate the rest.**
  Considered. Marginally cleaner but adds tooling. Each
  `CHANGELOG.md` is short enough to maintain by hand.

## Consequences

- 40 new files (one per published package). Each starts at 0.1.0
  (or 0.2.0 for os-sdk) with an honest description of the initial
  surface area lifted from the package's `description` field.
- Future bumps update one file: the package being bumped. Repo-
  level `CHANGELOG.md` gets a one-line summary referencing the
  per-package detail.
- Operators reading a package on npm see what they need without
  cross-referencing.
- The per-package files are roughly 20 lines each — low maintenance
  cost, high operator clarity.
- If a future tool (changesets) lands, it ingests the existing
  per-package files as its baseline. No migration cost.

## See also

- `CHANGELOG.md` (repo-level) — substrate-wide narrative
- `<package>/CHANGELOG.md` — per-package detail (each of 40 packages)
- ADR-0015 (one package per substrate concept) — same boundary principle
- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) — format spec
