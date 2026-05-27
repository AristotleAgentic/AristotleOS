# VERSIONING

Release posture and version conventions for AristotleOS.

## Current state

The repo is in **pre-1.0**. All shipped packages are at version `0.1.x`. The root workspace tracker is at `0.1.33`.

Pre-1.0 means:
- The runtime primitives (Ward, AuthorityEnvelope, Warrant, CommitGate, GELRecord) are stable enough that the reviewer flow proves them end-to-end.
- The package surface is allowed to change in non-additive ways between minor versions.
- The cross-package wire formats (`canonical_action_hash`, `bundle_hash`, `report_hash`, the `aristotle.*.v1` format tags) follow semantic versioning at the format level — a `v1` tag will not change shape without becoming `v2`.

## Format tags

The repo defines several stable wire-format tags that are versioned independently of npm package versions. These survive package refactoring without breaking artifact consumers.

| Tag | Source | Notes |
|---|---|---|
| `aristotle.policy-bundle.v1` | `policy-pipeline/src/index.ts::BUNDLE_FORMAT` | Signed policy bundle |
| `aristotle.replay-artifact.v1` | `replay-artifact/src/index.ts::ARTIFACT_FORMAT` | Content-addressed scenario replay |
| `aristotle.counterfactual-sweep.v1` | `time-machine/src/index.ts::SWEEP_ARTIFACT_FORMAT` | Counterfactual sweep result |
| `aristotle.execution-control-event.v1` | `event-stream/src/index.ts::EVENT_FORMAT` | Decision/warrant/GEL event |
| `aristotle.warrant-verify-request.v1` | `warrant-verifier/src/index.ts::REQUEST_FORMAT` | Public verifier request |
| `aristotle.warrant-verify-response.v1` | `warrant-verifier/src/index.ts::RESPONSE_FORMAT` | Public verifier response |
| `aristotle.reviewer-report.v1` | `examples/reviewer/verify.ts::REVIEWER_FORMAT` | Reviewer verification report |
| `aristotle.governance-manifest.v1` | `execution-control-runtime/src/builder.ts::GovernanceManifest.manifest_version` | Compiled governance manifest |

If any of these formats changes shape, the tag becomes `v2`. Consumers must detect format mismatch on read and fail rather than silently misinterpret.

## Pipeline version

`@aristotle/policy-pipeline` ships a separate `PIPELINE_VERSION` constant that identifies the compilation pipeline itself. The signed policy bundle records this; `verifyPolicyBundle` checks that a recompile under the same pipeline_version produces byte-identical manifest hashes.

Current value: `aristotle.policy-pipeline.v1.0.0` (see `shared/policy-pipeline/src/index.ts::PIPELINE_VERSION`).

## Scenario version

The 40-asset disconnected-swarm scenario carries its own version constant for replay-artifact verification.

Current value: `1.0.0` (see `examples/mesh/publish-replay-artifact.ts::SCENARIO_VERSION`).

## Node engine requirements

All shipped packages require Node.js 18+ (some lints check 22+). The root `package.json` declares `"engines": { "node": ">=22.5", "pnpm": ">=10" }`. The reviewer flow has been validated on Node 22.x and Node 24.x.

## Package manager

`corepack` + pnpm `10.32.1` is the pinned package manager. Root `package.json` declares `"packageManager": "pnpm@10.32.1"`. `scripts/enforce-pnpm.mjs` runs `preinstall` to refuse install under npm/yarn.

## Why everything is 0.1.x

The version number is held back deliberately. The substrate has good test posture but lacks the external validation (audit, customer deployment, certification) that would justify a 1.0 commitment to API stability for safety-critical use.

A 1.0 release would require:
- External security audit complete (see LIMITATIONS.md §2)
- At least one named pilot deployment running for ≥ 90 days (LIMITATIONS.md §6)
- Production KMS / HSM integration shipped as a first-party package (LIMITATIONS.md §1)
- A versioned spec published for the Warrant and GEL wire formats independent of this codebase (ROADMAP_TO_100.md §3)
- Stable cross-package wire format with at least three independent third-party integrations

Until those exist, the current packages remain pre-1.0 even when they are individually stable.

## Release cadence

The repo currently uses tagged release batches recorded in `CHANGELOG.md`. The most recent batches (v0.1.60 → v0.1.65) tracked the substrate audit closure to 100%.

A release batch lands as:
1. Per-batch CHANGELOG entry with section headers per substrate audit item.
2. Commits pushed to `ward-warrant-execution-control` (the active development branch).
3. Regression sweep across all touched packages (sequential, to avoid port races).
4. PROOF_STATUS.md updated when claims change.

See `RELEASE_CHECKLIST.md` for the full release procedure.

## Versioning of test artifacts

`examples/mesh/published.replay.json` carries `scenario_version: "1.0.0"`. If the scenario logic changes such that re-running it produces different counters, the version bumps and a new artifact is published. Old artifacts remain valid for verification against the old logic — `verifyReplayArtifact`'s `version_ok` gate catches version drift.

## Internal version drift

The root `package.json` workspace tracker (currently `0.1.33`) is older than the most-recently-touched package versions. This is intentional: the tracker reflects when the workspace last had a global release, while individual packages move forward independently.

Future cleanup: bump root version on every batch release for clarity. Tracked in `ROADMAP_TO_100.md` § Category 4 (Diligence readiness).
