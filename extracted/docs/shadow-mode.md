# Shadow Mode — safe rollout profiling

Shadow Mode answers one question before you enforce: **"What would AristotleOS have
done?"** It runs your proposed actions through the *real* Commit Gate and reports
what it would ALLOW, REFUSE, or ESCALATE — **without touching the live system**.

This is the bridge from "installed" to "enforcing": observe first, fix the gaps it
surfaces, then promote to enforcement with confidence.

## What concrete weakness this solves

Teams hesitate to put a hard gate in front of production agents because they can't
predict what it will block. Shadow Mode removes that risk: you see the exact
refusals, escalations, reason codes, and missing prerequisites against your real
Ward and Authority Envelope, on real traffic, before a single action is blocked.

## The observe-only guarantee

- Each action is evaluated against an **ephemeral in-memory ledger** — the live
  Governance Evidence Ledger is never written, and single-use replay state is never
  consumed.
- Shadow Mode **never mutates** the Ward or Authority Envelope and never weakens
  policy. It emits *findings*, not edits. Any change you make in response is a
  separate, explicit, reviewed action (an operator-approved governance diff).

## Run it

```bash
aristotle execution-control shadow \
  --ward ward.yaml --envelope envelope.yaml \
  --actions proposed-actions.json \
  [--revocations revocations.json] [--now <iso>] [--out report.json]
```

`proposed-actions.json` is an array of Canonical Governed Actions, or of
`{ "action": {...}, "runtime_register": {...} }` entries. The command prints a
rollout summary and **exits non-zero when not rollout-ready**, so a promotion
pipeline can gate on it.

Programmatic: `profileShadowMode({ ward, authorityEnvelope, actions, signer, now })`
returns a `ShadowReport`; `verifyShadowEvidence(report)` verifies the evidence.

## What the report contains

- **Decisions**: counts of would-ALLOW / would-REFUSE / would-ESCALATE.
- **Reason codes**: histogram across the batch.
- **`would_block` / `would_escalate`**: the specific actions, with reason codes.
- **Findings**:
  - `missing_runtime_registers` — actions that would escalate for missing state.
  - `revoked_authority` — actions bound to revoked keys/envelopes.
  - `physical_near_misses` — actions that passed but sit within the margin of a
    physical bound (altitude/battery), worth attention before enforcing.
- **Warrant eligibility** per action (a would-ALLOW yields a single-use Warrant).
- **Rollout readiness**: `ready` (heuristic — true when nothing would escalate),
  `allow_rate`, and ranked `blockers`.
- **Evidence**: a real, signed, **GEL-compatible** chain (ephemeral) that verifies
  with `verifyShadowEvidence` / `aristotle execution-control audit verify`, and a
  replayable `traces` list.

## Rollout workflow

1. Capture a representative batch of the actions your agents will take.
2. Run Shadow Mode against the Ward/Envelope you intend to enforce.
3. Read the blockers: add the missing Runtime Registers, fix envelope scope, or
   correct the action shapes — as **reviewed governance changes**, never by
   silently widening authority.
4. Re-run until `READY` (no escalations; acceptable refusals are deliberate).
5. Promote to enforcement (`aristotle run` / `execution-control serve`). Now the
   same decisions are binding and every one is written to the live, signed GEL.

Shadow Mode is observe-only by definition; promotion to enforcement is the
deliberate, separate step. Authority before consequence — confirmed before it bites.
