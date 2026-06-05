# ADR-0012 — Replay artifact as third-party-verifiable evidence

**Status:** Accepted

## Context

The substrate's reviewer flow proves the gate, the Warrant verifier,
the 40-asset disconnected-swarm scenario, and a replay artifact.
The last one is the most operationally consequential — it claims
that a chaos / scenario / mesh trace can be **independently
re-executed and verified** by a third party who didn't run the
original scenario.

For that claim to mean anything, the substrate has to publish a
data format that:
- Captures every input the scenario consumed.
- Is reproducible bit-for-bit when re-run.
- Has its own integrity envelope (operator can't ship a "verified"
  artifact whose contents have been swapped).

## Decision

The substrate ships **published replay artifacts**: JSON documents
produced by `@aristotle/replay-artifact` that wrap a deterministic
scenario report with:

- `format` — pinned tag (e.g., `aristotle.replay.published.v1`)
- `scenario_spec` — the inputs that produced the report
- `report` — the full scenario output
- `report_hash` — sha256 of the canonicalized report
- `provenance` — who built it, when, against which substrate version
- `reproducibility` — substrate version, Node version, OS family
- `signature` — Ed25519 signature over `(format, report_hash,
  reproducibility)` material

Verification (in `examples/mesh/published.replay.test.ts` and
referenced by the reviewer flow):
1. Parse the artifact.
2. Re-run the scenario from `scenario_spec`.
3. Compute the canonicalized report's sha256.
4. Assert it equals `report_hash`.
5. Verify the signature.

Each step is independently failing — a tampered report doesn't
match `report_hash`; a tampered `report_hash` doesn't match the
signature; a substrate version mismatch produces a different report
hash; etc.

## Alternatives considered

- **Just publish the scenario JSON.** Rejected. No integrity
  envelope; no provenance; reviewer has no signal that the JSON
  matches what the substrate would have produced.
- **Sign the report directly without a hash field.** Rejected.
  Signature verification requires reconstructing the exact bytes
  that were signed, which means we need a canonical serialization
  the reviewer can re-derive. The intermediate `report_hash` is
  the canonical handle.
- **Use OCI artifact format (like the policy bundles).** Considered.
  OCI is the right shape for policy where operators want registry
  tooling. For a replay artifact a reviewer downloads once and
  verifies, plain JSON is operationally lighter.

## Consequences

- The substrate can credibly claim "any third party can reproduce
  this result themselves" because the artifact format is published,
  the verification is in the repo, and the reviewer flow ties it
  to the headline claim.
- Substrate version changes that alter scenario outputs are
  caught by the reproducibility envelope — the artifact's pinned
  version vs. the reviewer's local substrate version. If they
  disagree, the artifact is from a different revision and that's
  surfaced.
- Reviewers don't need to trust the publisher's word about what
  the scenario produced; they re-run from `scenario_spec`. The
  signature only proves "this published artifact wasn't swapped
  in flight"; the report integrity is in re-execution.
- Artifact JSON files are part of the audit story —
  `examples/mesh/published.replay.json` ships in-repo and is
  verified on every CI run via `published.replay.test.ts`.

## See also

- `@aristotle/replay-artifact` — package + tests
- `examples/mesh/published.replay.json` — the canonical shipped artifact
- `examples/mesh/published.replay.test.ts` — CI verification on every PR
- `examples/reviewer/REVIEWER.md` — reviewer flow walkthrough
- ADR-0002 (deterministic gate) — reproducibility presupposes determinism
- ADR-0009 (evidence bundle format) — adjacent format for per-decision evidence
