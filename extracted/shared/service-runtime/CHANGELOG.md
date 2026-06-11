# Changelog

All notable changes to **@aristotle/service-runtime** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- Service-runtime helpers. Consistent /healthz (liveness) + /readyz (readiness) + /health (legacy) endpoints with structured response bodies that operators wire to k8s probes, plus a small ReadinessChecks builder for composing per-service readiness conditions.

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/service-runtime.
