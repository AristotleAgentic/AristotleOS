# Changelog

All notable changes to **@aristotle/gel-timestamp** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- External timestamp anchoring for GEL records. TimestampAuthority interface + LocalTimestampAuthority (filesystem-backed, Ed25519-signed (record_hash, ts) tuples) + verifyTimestampAnchor helper.

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/gel-timestamp.
