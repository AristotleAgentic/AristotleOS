# Changelog

All notable changes to **@aristotle/k8s-admission** are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning 2.0.0](https://semver.org/).

## [Unreleased]

(none)

## [0.1.0] — 2026-06-05

### Added
- Govern Kubernetes AdmissionReview requests. Maps cluster-API mutations into Commit Gate decisions; refuses unauthorized workloads before they reach the API server.

### Changed
- Initial published surface area; no prior shape to break.

### Notes
- Initial published surface area for @aristotle/k8s-admission.
