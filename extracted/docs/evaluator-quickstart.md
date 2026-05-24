# Evaluator quickstart — prove the boundary in ~10 minutes (offline)

For a reviewer who wants to verify the core claim — *nothing consequential happens
without authority, and everything that happens is provable* — without standing up a
cluster. Everything here runs **air-gapped**; no network calls.

Prereqs: Node ≥ 22.5, pnpm (this is a pnpm workspace; `npm install` is intentionally
blocked — see the guard message). `corepack enable && corepack pnpm install`.

## 0. The narrated walkthrough (one command)
```bash
corepack pnpm demo:evaluator
```
A narrated, self-verifying tour of the whole doctrine over the real code paths, with
no services and no network: it admits a governed action (Warrant + signed evidence),
refuses what it must (denied / out-of-envelope / unsafe / replay), fails closed for a
safety-critical Ward under degradation, exports an offline Evidence Bundle, then
**tampers with the evidence and shows verification fail**. Prints PASS/FAIL per step
and exits non-zero if any governance invariant does not hold (so it runs in CI too,
as `pnpm test:demo`). Start here — it's the fastest end-to-end "is it real" signal.

## 1. One-command self-check of the whole boundary
```bash
npm run aristotle -- pilot
```
Runs the full gate end-to-end (canonicalize → Commit Gate → Warrant → signed GEL →
evidence verify) and prints PASS/FAIL per boundary check.

## 2. Watch it ALLOW, then REFUSE
```bash
# ALLOW: in-bounds action → signed Warrant + evidence
npm run aristotle -- execution-control evaluate \
  --ward examples/execution_control/ward.montana_drone_test_range.yaml \
  --envelope examples/execution_control/authority_envelope.survey_planner.yaml \
  --action examples/execution_control/actions/allow_takeoff.json \
  --ledger ./.tmp/eval.gel.jsonl --now 2026-05-21T14:00:00.000Z

# REFUSE: a geofence-disable / out-of-bounds action is refused with reason codes,
# and NO warrant is issued. Edit the action's altitude_m above the Ward ceiling and re-run.
```

## 3. Verify the evidence offline — without trusting the service
```bash
npm run aristotle -- execution-control evidence verify --bundle ./.tmp/evidence-bundle.json
npm run aristotle -- execution-control audit verify --ledger ./.tmp/eval.gel.jsonl
```
The Evidence Bundle is self-contained and signature/chain-verifiable with only the
embedded public key. Tamper one byte of the ledger and re-run — verification fails.

## 4. Prove the high-assurance properties
```bash
npm run test:gate-property      # 4000 randomized cases vs an independent spec oracle
npm run test:attestation        # forged telemetry is overridden by device-attested ground truth
npm run soak:execution-control  # sustained load: no latency drift, no leak, chain intact
```

## Replay / idempotency contract (read this before integrating)

Replay protection keys on the **canonical action hash**, which includes the action's
`request_id`. Practical consequences:

- Re-submitting the **exact same action with the same `request_id`** is refused as a
  replay (`REPLAY_DETECTED`) — this is the idempotency guarantee.
- A legitimately *repeated* operation (e.g. "read sensor" twice) **must carry a fresh
  `request_id`** (a nonce), or it will read as a replay. Treat `request_id` as a
  per-attempt nonce, not a static label.
- Replay protection can be disabled per evaluation (`--no-replay-protection` /
  `replayProtection: false`) for idempotent read paths.

## What's product vs. demo today (so nothing surprises you)

- **The CLI and the runtime library are the product** — fully exercised above.
- **The operator console** is largely a presentational surface over sample data; the
  Governance Builder surface is wired to the live gateway with a labeled fallback.
  Evaluate the boundary via the CLI/SDK, not the console, for now.

See also: `docs/auditor-guide.md`, `docs/THREAT_MODEL.md`, `docs/defense-readiness.md`.
