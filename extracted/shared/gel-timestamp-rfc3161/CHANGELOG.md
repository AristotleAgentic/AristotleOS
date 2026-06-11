# Changelog

All notable changes to **@aristotle/gel-timestamp-rfc3161** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- RFC 3161 Time-Stamp Protocol client. Implements the TimestampAuthority interface from @aristotle/gel-timestamp by posting an ASN.1 DER-encoded TimeStampReq to a configured TSA endpoint and storing the returned TimeStampToken as an opaque blob in the anchor.

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/gel-timestamp-rfc3161.
