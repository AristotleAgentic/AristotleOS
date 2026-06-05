# ADR-0009 — Evidence bundle format for offline verification

**Status:** Accepted

## Context

A reviewer / auditor / insurer / regulator needs to verify a
substrate decision **without** access to the live gate, the live
ledger, or the operator's KMS. They have:
- The decision in question (the GEL record).
- Permission to receive context (Ward, AuthorityEnvelope, signing
  key, the ledger window containing the record).

What format reduces "verify this decision" to a single command they
can run themselves?

## Decision

The substrate's `exportEvidenceBundle` produces an
**EvidenceBundle**: a self-contained JSON document with:
- `bundle_version` — pinned format tag (e.g.,
  `aristotle.execution-evidence.v1`)
- `exported_at` — ISO timestamp
- `ward` — the WardManifest the decision was made under
- `authority_envelope` — the envelope the action was scoped to
- `selected_record` — the GEL record being verified
- `ledger_chain` — the ledger window from the previous-signed root
  to the selected record (enough to verify chain linkage)
- `ledger_tip_hash` — the hash of the last record in the included
  chain
- `signature` — Ed25519 signature over the bundle's hashes by the
  operator's signer, with the signing public key embedded for
  offline verification

The bundle is a single JSON file. A reviewer runs
`verifyEvidenceBundle(bundle)` and gets back
`{ ok: boolean, reason?: string }`. No live infrastructure required.

## Alternatives considered

- **Just hand over the GEL record + signing key.** Rejected. The
  reviewer would have to also fetch the Ward + Envelope + chain
  context separately, and would have to know how to reconstruct
  verification — too operationally heavy.
- **A SQL dump.** Rejected. Reviewers don't want to spin up a
  database to verify a single decision.
- **Markdown / human-readable summary.** Considered as a
  supplement. The bundle is for machine verification; a markdown
  summary can be generated alongside (the reviewer flow's
  `report.md` does this for the 40-asset proof).
- **Multi-file zip.** Rejected. Single-JSON is simpler to hand to
  a reviewer; nothing about the bundle is large enough to warrant
  multi-file.

## Consequences

- The reviewer flow (`examples/reviewer/verify.ts`) is possible
  with this format alone. A reviewer downloads the bundle + the
  reviewer script and runs `node verify.ts bundle.json`.
- Bundles are content-addressed (their hashes are deterministic
  from their contents); two bundles for the same decision under the
  same ward + envelope are byte-identical.
- Operators can ship bundles to insurers / regulators / customers
  as audit artifacts without exposing their live ledger or KMS.
  This is the property that makes "show me you handled my data
  correctly" a one-file answer.
- Bundle format is versioned (`bundle_version` field). Future
  format changes ship as `v2`; verifiers detect and route
  accordingly. The substrate is conservative about format changes —
  a bump implies a deliberate semantics change.
- Bundles include the embedded public key, so a reviewer who only
  has the operator's identity (no out-of-band key distribution)
  can still verify cryptographically. The trust model is "this
  bundle came from the named operator" + "this operator's public
  key matches what's embedded."

## See also

- `shared/execution-control-runtime/src/index.ts` —
  `exportEvidenceBundle`, `verifyEvidenceBundle`
- `examples/reviewer/verify.ts` — the canonical reviewer flow
- `examples/reviewer/REVIEWER.md` — operator-facing review walkthrough
- ADR-0001 (single-use Warrants) — Warrants embedded in bundles
- ADR-0002 (deterministic gate) — decisions are reproducible from bundle inputs
- ADR-0003 (GEL hash chain) — bundle includes the chain window
