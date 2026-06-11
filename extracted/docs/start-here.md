# Start Here

AristotleOS is the warrant layer for governed autonomous action.

The short version:

```text
Every consequential autonomous action needs a Warrant.
```

AristotleOS evaluates whether a proposed action has authority before it becomes
a consequence. Allowed actions can receive a signed, single-use Warrant bound to
the canonical action hash. Refused actions do not emit through governed
adapters. Decisions, Warrants, refusals, and replay artifacts are written into
evidence that reviewers can inspect.

## The Mental Model

```text
Ward -> Authority Envelope -> Commit Gate -> Warrant -> Execution -> GEL
```

- **Ward**: the protected domain.
- **Authority Envelope**: the scoped delegation.
- **Commit Gate**: the deterministic boundary.
- **Warrant**: signed, single-use authority for one action.
- **GEL**: the evidence ledger for decisions and replay.

## First 20 Minutes

1. Read this page.
2. Run `docs/quickstart.md`.
3. Read `../PROOF_STATUS.md`.
4. Read `../LIMITATIONS.md`.
5. Open a finding using `REVIEWERS.md` if a claim fails.

## What To Review

- Does the Commit Gate decide before execution?
- Can a Warrant be replayed or repurposed?
- Do adapters refuse before emission?
- Can evidence be independently replayed?
- Does disconnected operation stay bounded?
- Are public claims narrower than the implementation?

## Where To Go Next

- `docs/quickstart.md`
- `docs/reviewer-packet.md`
- `docs/framework-adapters.md`
- `docs/templates/catalog.md`
- `docs/COMPARISON.md`
- `docs/WARRANTS.md`
- `docs/GEL.md`
- `docs/MESH.md`
