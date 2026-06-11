# Changelog

All notable changes to **@aristotle/gel-timestamp-rfc3161-verify** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- X.509 chain validation companion to @aristotle/gel-timestamp-rfc3161. Verifies the TimeStampToken embedded in a TimestampAnchor against a caller-supplied CA bundle, using Node built-in crypto.X509Certificate (no library dependency).

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/gel-timestamp-rfc3161-verify.
