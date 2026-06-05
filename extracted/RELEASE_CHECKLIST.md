# Release Checklist

Run through every item before tagging a release. Skip nothing.

## Before the release commit

### Tests
- [ ] `pnpm reviewer:verify` — all 18 checks PASS.
- [ ] `pnpm reviewer:test` — all reviewer-runner tests PASS.
- [ ] `pnpm test:core` — governance-core, execution-control-runtime, mesh-runtime, warrant-verifier, replay-artifact all PASS.
- [ ] `pnpm test:protocol-adapters` — all 7 protocol adapters PASS.
- [ ] `pnpm test:framework-adapters` — agent-framework worked examples PASS.
- [ ] `pnpm test:mesh` — mesh-runtime + chaos-harness + scenario-engine PASS.
- [ ] `pnpm test:tenancy` — tenant-onboarding + policy-pipeline + time-machine + event-stream PASS.
- [ ] Published replay artifact verifier PASSes: `node --import tsx --test examples/mesh/published.replay.test.ts`.
- [ ] No new `test.skip` / `test.only` / `test.todo` introduced.

### Diligence docs
- [ ] `PROOF_STATUS.md` updated to reflect any new / changed / removed claims.
- [ ] `LIMITATIONS.md` reviewed — any new limitation introduced this batch? Documented?
- [ ] `THREAT_MODEL.md` reviewed — any new threat surface? Documented?
- [ ] `VALIDATION_MATRIX.md` updated for any new capability.
- [ ] `ARCHITECTURE.md` updated if a primitive's lifecycle changed.
- [ ] `ROADMAP_TO_100.md` updated for any item that moved.
- [ ] `CHANGELOG.md` has a new release-batch entry with substrate-audit-style structure.

### Code hygiene
- [ ] No new marketing language in commits or docs (see CONTRIBUTING.md "What we reject").
- [ ] No new `productionValidated: true` defaults on transports unless the operator integration test backs them.
- [ ] No new external endorsement, customer, audit, or certification claims.
- [ ] Package versions bumped consistently where modified.
- [ ] Root `package.json` version bumped to reflect the release batch.

### Security
- [ ] `SECURITY.md` reviewed — any new disclosure path or contact change?
- [ ] No new dependency without owner-approved license review; copyleft and source-available terms require explicit approval.
- [ ] Signing-key handling code touched? Pair-reviewed.

## Release artifacts

- [ ] Tag the release: `git tag -a v0.1.<N> -m "v0.1.<N> — <short summary>"`.
- [ ] Push the tag: `git push origin v0.1.<N>`.
- [ ] Generate the SBOM: `pnpm sbom > sbom-v0.1.<N>.json` (script exists at `scripts/generate-sbom.mjs`).
- [ ] Generate a clean source archive: `git archive --format=zip --prefix=AristotleOS-v0.1.<N>/ HEAD:extracted -o AristotleOS-v0.1.<N>.zip`.
- [ ] (Optional) Sign artifacts with cosign or npm provenance.
- [ ] (Optional) Publish updated packages to npm.

## After the release commit

- [ ] CI runs green on the release commit. If a job is `continue-on-error` (currently only `legacy-cli-typecheck`), document its status in the release notes.
- [ ] Verify `pnpm proof:status` on a fresh clone produces the expected summary.
- [ ] Verify the headline numbers in `scripts/proof-status.mjs` still match (test file count, test() count, reviewer-check count). Update if drifted.
- [ ] Open a PROOF_STATUS row review issue if any claim's evidence path moved.

## Release notes structure

Write the CHANGELOG entry with sections matching the substrate audit framing:

```
## v0.1.<N> — <theme>

### #<item-number> <Audit item name> (<previous %> → <new %>)
- One bullet per concrete change.
- Test count for each new / changed package.
- Honest scope. No "production-grade", "certified", "audited".

### What this batch does NOT change
- Document explicit non-changes if they might be misread.

### Regression posture
- N tests green across M packages, sequential to avoid port races.
- Pre-existing flakes documented.
```

## When NOT to release

Do not tag a release if:

- Any of the test commands above fail (other than the documented pre-existing CLI typecheck flake, which is excluded from `test:all`).
- `PROOF_STATUS.md` and the actual code disagree about a claim's evidence path.
- A new marketing-style claim slipped in.
- The reviewer flow's output format changed without updating `examples/reviewer/REVIEWER.md` and the expected-output section.
- The published replay artifact's `report_hash` no longer matches a local re-run (this is a hard fail; either the scenario broke or the artifact is stale).

## Branching

The active development branch is `ward-warrant-execution-control`. Releases are tagged from that branch. There is no separate `main` branch yet; when one is introduced, merges land via PR with the CI gate (`.github/workflows/ci.yml`) required.
