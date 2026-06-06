# AristotleOS — 20-minute reviewer verification

This directory contains everything a skeptical technical reviewer needs to verify the core AristotleOS claim end-to-end. **No marketing surface. No optional reading. Just the substrate.**

Time budget:
- Reading this document: **~5 minutes**
- One-time setup (clone + install): **~5–10 minutes**
- Running the verification: **~10 seconds of compute, ~30 seconds wall clock**

If everything passes, you will have independently verified four claims, in series, against the actual source code.

---

## The claim, in one sentence

> Every consequential action by an autonomous agent passes through a signed, replayable authority chain — Ward → Authority Envelope → Warrant → Commit Gate → GEL Record — and the chain is real, hash-bound, partition-tolerant, and reproducibly auditable by a third party.

---

## How to run

```sh
git clone https://github.com/AristotleAgentic/AristotleOS
cd AristotleOS/extracted
corepack pnpm@10.32.1 install

# Run the verification (writes JSON to stdout, summary to stderr)
node --import tsx examples/reviewer/verify.ts

# Or as a test runner (one assertion per check)
node --import tsx --test examples/reviewer/verify.test.ts
```

Expected output, last lines on stderr:

```
AristotleOS reviewer verification: PASS
  total checks:  18
  passed:        18
  failed:        0
  duration:      ~500 ms

  Stage 1  Commit Gate                  4/4
  Stage 2  Public Warrant Verifier      5/5
  Stage 3  40-Asset Swarm Scenario      5/5
  Stage 4  Replay Artifact              4/4
```

Exit code: `0` on PASS, `1` if any check failed (the JSON report on stdout lists exactly which check and why).

---

## What you'll have verified

Four stages, eighteen individual checks. Each check is a single observable predicate the reviewer can re-run by hand.

### Stage 1 — Commit Gate (`shared/execution-control-runtime/src/index.ts`)

Build a fresh Ward + Authority Envelope, then run three actions through the gate:

| Check | What's asserted |
|---|---|
| `1a.allow-path` | A legitimate action (`demo.actuate`) is **ALLOWed** with reason code `ALLOWED`. The decision carries a stable `canonical_action_hash`. |
| `1b.refuse-action-not-allowed` | An action whose type is not in `envelope.allowed_actions` is **REFUSED** with `ACTION_NOT_ALLOWED`. |
| `1c.refuse-subject-not-in-ward` | An action with a subject not in `ward.permitted_subjects` is **REFUSED** with `SUBJECT_NOT_IN_WARD`. |
| `1d.warrant-issued` | A signed Warrant minted for the ALLOWed action **binds to the same canonical_action_hash** the gate returned. `single_use: true`, signed Ed25519, nonce present. |

The Warrant produced here flows into Stage 2.

### Stage 2 — Public Warrant Verifier (`shared/warrant-verifier/src/index.ts`)

The Warrant from Stage 1, validated by a standalone verifier that only holds the warrant + canonical action hash + the issuer's trust anchors. No access to the gate or any private state.

| Check | What's asserted |
|---|---|
| `2a.verify-happy` | Verifier returns `ok: true` with format tag `aristotle.warrant-verify-response.v1`. |
| `2b.verify-tamper-detected` | Mutating the warrant's nonce produces `SIGNATURE_MISMATCH`. |
| `2c.untrusted-signing-key` | A trustedKeyIds allowlist that doesn't include the signer's key id produces `UNTRUSTED_SIGNING_KEY`. |
| `2d.action-hash-mismatch` | A verify against a different canonical_action_hash produces `ACTION_HASH_MISMATCH`. |
| `2e.http-handler-200` | The verifier's HTTP handler returns `200` with `ok: true` for the same warrant. |

### Stage 3 — 40-asset swarm scenario (`examples/mesh/swarm-partition-40-asset.ts`)

Spin up a real ROOT + 2 WITNESS + 40 EDGE mesh (in process via `bindRegistry`), and run the four-phase scenario: nominal → partition → revocation-under-partition → heal + reconcile.

| Check | What's asserted |
|---|---|
| `3a.phase1-allowed-all-40` | Every one of the 40 assets receives a Warrant under nominal flight. `phase1_other === 0`. |
| `3b.phase2-no-losses` | Under partition, every phase-2 evaluation resolves into exactly one of ALLOW / REFUSE / EXPIRE — sums to 40. |
| `3c.phase3-revoked-10-resolve` | 10 envelopes are revoked; their phase-3 evaluations split into witness-reachable (REFUSED) + fully-isolated (still ALLOWed under Fluidity Token). The 10 sum holds. |
| `3d.phase4-reconciliation-accounting` | The reconciliation step accounts for every locally-issued decision (clean + conflicting). |
| `3e.report-hash-is-stable-sha256` | The deterministic counters hash to a stable `sha256:...` value. |

### Stage 4 — Published replay artifact (`examples/mesh/published.replay.json`)

The crown jewel. A file shipped in this repo claims:

- `scenario_id`: `swarm-partition-40-asset`
- `scenario_version`: `1.0.0`
- `report_hash`: `sha256:8b379ea543a8b72aad81b8c4be37bc3c054209dfd8bd04e15e03c51a9d952ce2`
- `artifact_hash`: `sha256:5e1adb1b303f66f300a43d24d4e2cdd1601c68cc3b4e823227100e1b1d2620c1`

The reviewer's job is to confirm those hashes correspond to a scenario that **really runs in your environment, in your hands**.

| Check | What's asserted |
|---|---|
| `4a.artifact-parses` | The artifact file exists, parses, and has the expected `scenario_id@scenario_version`. |
| `4b.local-report-hash-matches-published-report-hash` | Stage 3's locally-recomputed report hash equals the file's `report_hash`. |
| `4c.verify-replay-artifact-all-gates` | The full `verifyReplayArtifact` function passes all four gates: `artifact_hash_ok`, `report_hash_ok`, `scenario_reproducible`, `version_ok`. |
| `4d.field-by-field-equality` | Every numeric counter (phase1_allow, phase2_refuse, total_warrants_issued, etc.) is identical between the local run and the published report. |

---

## Reading the JSON output

The structured report on stdout has a stable format:

```json
{
  "format": "aristotle.reviewer-report.v1",
  "generated_at": "2026-05-26T15:00:00.000Z",
  "total_time_ms": 514,
  "totals": { "checks": 18, "passed": 18, "failed": 0 },
  "stages": [
    {
      "stage": 1,
      "name": "Commit Gate",
      "checks": [
        {
          "name": "1a.allow-path",
          "ok": true,
          "evidence": {
            "decision": "ALLOW",
            "reason_codes": ["ALLOWED"],
            "canonical_action_hash": "sha256:...",
            "policy_version": "1.0.0"
          }
        }
        // ... 3 more checks
      ]
    }
    // ... 3 more stages
  ]
}
```

Every check's `evidence` is the minimal observation needed to reproduce the check independently. If you want to dig:

```sh
# Pretty-print just the failures
node --import tsx examples/reviewer/verify.ts | jq '.stages[].checks[] | select(.ok == false)'

# Or just the canonical action hashes the gate emitted
node --import tsx examples/reviewer/verify.ts | jq '.stages[0].checks[0].evidence.canonical_action_hash'
```

---

## How to verify each individual claim against the source

If you don't trust the wrapper, check the underlying primitives directly. Every claim above resolves to a small, focused piece of source code:

| Claim | Source |
|---|---|
| Commit Gate decision logic | `shared/execution-control-runtime/src/index.ts` → `evaluateCommitGate()` (around line 2360) |
| Warrant signing + verifying | same file → `issueWarrant()` + `verifyWarrant()` (around line 2461 / 2521) |
| Public verifier | `shared/warrant-verifier/src/index.ts` — pure wrapper, ~150 lines |
| 40-asset scenario | `examples/mesh/swarm-partition-40-asset.ts` — ~240 lines |
| Mesh runtime (ROOT/WITNESS/EDGE) | `shared/mesh-runtime/src/index.ts` |
| Replay artifact format | `shared/replay-artifact/src/index.ts` |
| Published artifact contents | `examples/mesh/published.replay.json` |

Each shared package also has its own dedicated test suite under `src/index.test.ts` — run any of them in isolation:

```sh
corepack pnpm@10.32.1 --filter @aristotle/execution-control-runtime test   # 75 tests
corepack pnpm@10.32.1 --filter @aristotle/warrant-verifier test            # 11 tests
corepack pnpm@10.32.1 --filter @aristotle/replay-artifact test             # 10 tests
corepack pnpm@10.32.1 --filter @aristotle/mesh-runtime test                # 22 tests
```

---

## What this verification does NOT prove

Honesty about scope:

- It does **not** prove the policy DSL (APL) compiles arbitrary policies correctly — that's covered by `@aristotle/execution-control-runtime`'s 75-test suite, not this reviewer flow.
- It does **not** validate the hardware adapters' wire protocols (MAVLink frame format, Modbus FC encoding, etc.) — those have their own tests under `packages/*/src/index.test.ts`.
- It does **not** test the multi-tenant control plane's full lifecycle (audit + federate + rotate) — see `@aristotle/tenant-onboarding`'s 29-test suite.
- The signing keys in Stages 1–2 are ephemeral Ed25519 pairs generated for the run; the published artifact in Stage 4 is the only persistent cryptographic artifact and it's content-addressed, not signed by an external authority.

What this flow proves is the **core authority chain**: that a Warrant is real, that it binds to a canonical action, that a partition-tolerant mesh can issue and reconcile Warrants across 40 assets, and that the published replay artifact captures a reproducible scenario you can verify independently.

That's the foundation. Everything else builds on it.

---

## If something fails

The JSON report's `stages[].checks[]` array names every failed check with a `failure` field explaining what didn't hold. The `evidence` field shows exactly what was observed. Common failure modes:

| Symptom | Likely cause |
|---|---|
| Stage 3 hash differs from Stage 4's published hash | Either the scenario isn't deterministic in your environment (filesystem / timer / OS quirk) or the source has drifted from when the artifact was published. The `4b` check is the canary. |
| Stage 4 `scenario_reproducible: false` | Same diagnosis. Compare `local_report_hash` and `published_report_hash` in `4b.evidence`. |
| Stage 2 `2b.verify-tamper-detected` fails | The Ed25519 signature path is broken on your system. Check `node --version >= 18`. |
| Stage 1 `1d.warrant-issued` evidence shows `warrant_id: undefined` | `issueWarrant()` returned undefined; the decision wasn't ALLOW. Check `1a` first. |

For deeper diagnostic info, the JSON report's structure mirrors the stage / check layout you see in the stderr summary.

---

## License

BUSL-1.1 for substrate material. See the repository root `LICENSE`, `LICENSING.md`, and workspace `NOTICE`.
