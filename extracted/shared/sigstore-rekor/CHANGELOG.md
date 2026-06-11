# Changelog

All notable changes to **@aristotle/sigstore-rekor** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- Sigstore Rekor transparency-log client. Implements the TimestampAuthority interface by posting hashedrekord entries to a Rekor server (default: public Sigstore Rekor) and capturing the returned logIndex + UUID + signed entry timestamp in the anchor.

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/sigstore-rekor.
