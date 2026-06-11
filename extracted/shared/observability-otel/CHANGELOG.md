# Changelog

All notable changes to **@aristotle/observability-otel** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- First-party OpenTelemetry tracer adapter. Wraps any structurally-OTel-shaped Tracer as an AristotleTracer so the substrate gate spans land in your OTel-compatible backend (Tempo, Jaeger, Honeycomb, Langfuse, LangSmith, Phoenix, Datadog, AWS X-Ray) without forcing @opentelemetry/api as a hard dep.

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/observability-otel.
