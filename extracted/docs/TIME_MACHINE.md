# Time Machine — Counterfactual Replay

Time Machine takes a historical Commit Gate decision (recorded in a GEL record) and re-evaluates it against an alternate policy world. It answers questions like:

- *"Would our new policy have refused this incident's action?"*
- *"If we tighten this Ward's altitude ceiling, how many historical ALLOWs flip to REFUSE?"*
- *"For a denied claim, what would the new policy have done?"*

## What it proves

| Claim | Evidence |
|---|---|
| Same historical record + same policy world = same decision (deterministic) | `time-machine/src/index.test.ts` "original replay reproduces historical ALLOW" |
| Tightening an envelope's `allowed_actions` flips ALLOW to REFUSE for excluded actions | "counterfactual that removes action from envelope flips ALLOW to REFUSE" |
| Policy version mismatch triggers ESCALATE in the counterfactual | "counterfactual reports policy_version mismatch as ESCALATE" |
| Sweep across many records reports per-transition counters (ALLOW_to_REFUSE: N) | "runCounterfactualSweep: ALLOW_to_REFUSE transition count" |
| The CLI exits non-zero when flipped count exceeds threshold | `time-machine/src/cli.test.ts` "exits 1 when flipped > max-flipped" |
| Tampering historical inputs is detected via the `original_reproduces_historical` drift flag | "original_reproduces_historical false when ward/envelope inputs don't match record" |

## What it does NOT prove

- It does not prove the alternate policy is *correct* — only that the alternate policy's *evaluation* of a historical action is consistent.
- It does not modify the historical GEL record. GEL is append-only; counterfactual replay is a side computation.
- It does not validate the historical record's authenticity — that's GEL's job (`verifyGelChain`).

## Public API

```ts
import { runCounterfactual, runCounterfactualSweep } from "@aristotle/time-machine";

const diff = runCounterfactual({
  action,
  originalWard, originalEnvelope, originalRuntimeRegister,
  historicalRecord,
  counterfactuals: [
    { name: "v2-tighter", ward: WARD_V2, authorityEnvelope: ENV_V2 }
  ]
});
// diff.original_reproduces_historical: bool   (drift detector)
// diff.original: { decision, reason_codes, canonical_action_hash }
// diff.historical: { decision, reason_codes, canonical_action_hash, record_id, timestamp }
// diff.counterfactuals: [{ name, decision, reason_codes,
//                          changed_from_original: { decision_changed, added_reason_codes, removed_reason_codes },
//                          raw }]
// diff.decisions_flipped: int

const sweep = runCounterfactualSweep({
  records: [/* historical GEL records */],
  resolveAction: (rec) => actionArchive.get(rec.record_id) ?? null,
  resolveOriginal: (rec) => ({ ward: wards[rec.ward_id], envelope: envs[rec.authority_envelope_id] }),
  counterfactual: { name: "tighter-v2", ward: WARD_V2, envelope: ENV_V2 }
});
// sweep.flipped: [{ record_id, historical_decision, counterfactual_decision }]
// sweep.transitions: { "ALLOW_to_REFUSE": N, "REFUSE_to_ALLOW": M, ... }
```

## CLI

```sh
aristotle-counterfactual --plan plan.json --out sweep.json [--max-flipped N] [--quiet]
```

- Plan format: `{ records, actions, originals, counterfactual }`.
- Exit `0` if `flipped <= max-flipped` (default 0).
- Exit `1` if `flipped > max-flipped` — CI-friendly: "fail the build if any historical decision would have flipped".
- Exit `2` on usage error.

Tested in `time-machine/src/cli.test.ts` (9 tests).

## How auditors / regulators / insurers use it

**Insurance claim audit.** Carrier holds a denied claim's evidence bundle. Carrier asks: "Under the policy in effect today (different from the one in effect at the time of incident), what would the decision have been?" Run `runCounterfactual` with today's policy world; observe whether the decision flips.

**Regulator incident review.** Regulator examines an incident's GEL chain. Regulator wants: "If we mandate stricter ceiling X, how many decisions flip?" Run `runCounterfactualSweep` across the relevant time window with a hypothetical Ward that includes ceiling X.

**Operator policy-change CI gate.** Operator about to roll out a new policy. CI runs `aristotle-counterfactual --plan last-quarter.json --counterfactual new-policy.json --max-flipped 0`. Build fails if any historical decision would have flipped under the new policy. Operator reviews the flips before deciding to proceed, override, or pull the policy change.

**Incident root-cause review.** After an incident, operator wants to test variants of the policy that would have prevented it. Run `runCounterfactualSweep` against the incident window with each variant; observe which variants would have refused the originating action.

## Drift detection

Every `runCounterfactual` call also produces `original_reproduces_historical: boolean`. This flips false when the caller-supplied "original" inputs don't reproduce the recorded decision. Either:

- The caller's archive of the original Ward / Envelope is wrong.
- The gate's evaluation logic has changed since the record was written (the gate's semantics drifted).
- The record itself is corrupted (compare with `verifyGelChain`).

Treat `original_reproduces_historical: false` as a load-bearing diagnostic. Investigate before trusting the counterfactual result.

## Sweep serialization + comparison

```ts
const artifact = serializeSweep(sweepResult);
// { format: "aristotle.counterfactual-sweep.v1", generated_at, result }

const loaded = loadSweep(JSON.parse(rawFile));

const summary = summarizeSweep(sweepResult);
// "counterfactual 'v2': 5/10 resolved records flipped [ALLOW_to_REFUSE: 5]"

const comparison = compareSweeps([sweepA, sweepB, sweepC]);
// { total_resolved_records, rows: [{ name, flipped, transitions }] sorted by flipped desc }
```

A quarter's counterfactual sweep can be packaged, transmitted, and re-loaded. The format tag ensures consumers detect schema mismatch on read.

## What's NOT in scope

- Time Machine does not modify GEL records, regenerate Warrants, or rewrite history. It reads historical records and produces side computations.
- Time Machine does not enforce its results — it reports flips. The operator decides whether to act on a flip.
- Time Machine does not validate the historical record's signature — that's `verifyGelChain`'s job. Run that first if signature integrity is in question.
- Time Machine does not access GEL records over the network. It takes a `records: GelRecord[]` array. Loading the array from disk / database is the caller's responsibility.

## Tests

20 tests total (11 library + 9 CLI). Run:

```sh
pnpm --filter @aristotle/time-machine test
```
