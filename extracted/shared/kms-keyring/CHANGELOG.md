# Changelog

All notable changes to **@aristotle/kms-keyring** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- KMS-backed keyring for Warrant signing. Defines KmsKeyring + KmsKeyHandle interfaces abstracting away where the private key actually lives, and produces AristotleSigner instances the gate already consumes. Ships InMemoryKmsKeyring + AwsKmsKeyring / VaultKeyring stubs.

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/kms-keyring.
