# Changelog

All notable changes to **@aristotle/sigstore-rekor-verify** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- SET signature + inclusion-proof validation companion to @aristotle/sigstore-rekor. Verifies a Rekor TimestampAnchor signedEntryTimestamp against a caller-supplied Rekor public key + checks the inclusion proof against the published log root.

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/sigstore-rekor-verify.
