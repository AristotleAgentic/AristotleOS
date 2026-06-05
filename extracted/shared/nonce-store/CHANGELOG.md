# Changelog

All notable changes to **@aristotle/nonce-store** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- Durable replay-protection nonce store implementing the NonceSeenSet interface from @aristotle/execution-control-runtime with in-memory + filesystem-backed (append-only JSONL) backends and TTL eviction.

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/nonce-store.
