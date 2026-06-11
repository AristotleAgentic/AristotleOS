# Published Replay Artifact — 40-asset disconnected swarm

This document is the human-readable companion to `published.replay.json`. A non-developer reviewer should be able to read it and understand exactly what happened in the scenario, what the numbers mean, and what they prove.

**This is a deterministic simulation.** It is NOT a hardware deployment. It does NOT involve real autopilots, real RF, real flight controllers, or real GPS. It involves 43 in-process node objects communicating over an in-process registry (the same code paths that handle real TCP sockets in the cross-process test). The scenario's value is that the runtime's authority logic behaves correctly under partition, revocation, recovery, and reconciliation — properties that hold whether you run them on one machine or forty.

---

## What the scenario does

```
1 ROOT node          (issues envelopes + revocations + Fluidity Tokens)
+ 2 WITNESS nodes    (mirror state, gossip revocations)
+ 40 EDGE nodes      (one per autonomous asset; each runs a Disconnected Commit Gate)
= 43 governance-mesh nodes
```

It runs four phases, in order. Each phase exercises a different property of the mesh.

| Phase | What happens | What it proves |
|---|---|---|
| 1. Nominal | All 43 nodes connected. Each of the 40 assets evaluates one action; the root reachable, gate ALLOWs, warrants issued. | The mesh works under healthy conditions. |
| 2. Partition | Half the swarm (assets 0–19) loses its connection to root AND witness-A. A quarter of the swarm (assets 0–9) additionally loses witness-B — fully isolated. The other half stays fully connected. Every asset evaluates another action. | Disconnected operation under bounded Fluidity Token authority. |
| 3. Revocation under partition | Root revokes the envelopes for assets 0–9 (the fully-isolated subset). Witnesses receive the revocation. Each of the 10 revoked assets evaluates one more action. | Revocation reaches witness-reachable assets but cannot reach fully-isolated assets — those continue to ALLOW under their not-yet-expired Fluidity Tokens. |
| 4. Heal + reconcile | All partitions heal. Every asset reconciles its locally-issued decisions against root. Root flags any warrant issued AFTER its envelope was revoked. | Conflict detection is sound; no decisions are lost. |

The scenario is implemented at `examples/mesh/swarm-partition-40-asset.ts`. It runs in ~500 ms on a modern laptop.

---

## What the published artifact contains

```json
{
  "format": "aristotle.replay-artifact.v1",
  "scenario_id": "swarm-partition-40-asset",
  "scenario_version": "1.0.0",
  "inputs": { "assetCount": 40, "fluidityTtlMs": 1500 },
  "report": { ... see below ... },
  "report_hash":   "sha256:8b379ea543a8b72aad81b8c4be37bc3c054209dfd8bd04e15e03c51a9d952ce2",
  "artifact_hash": "sha256:5e1adb1b303f66f300a43d24d4e2cdd1601c68cc3b4e823227100e1b1d2620c1",
  "provenance":    { "producer": "...", "produced_at": "...", "notes": "..." }
}
```

The two hashes are independent gates:
- `report_hash` is the SHA-256 of the report's stable JSON encoding. A reviewer's local re-run must produce the same `report_hash` for the scenario to be deemed reproducible.
- `artifact_hash` is the SHA-256 of the whole artifact (minus the hash field itself). Catches tampering of any field — source, inputs, provenance, or report.

---

## What the report numbers mean

| Field | Value | What it means |
|---|---:|---|
| `total_assets` | 40 | Number of autonomous-asset edge nodes in the scenario. |
| `phase1_allow` | 40 | Phase 1 nominal: all 40 assets received a Warrant for their proposed action. |
| `phase1_other` | 0 | Phase 1: nothing else happened. No REFUSE, no EXPIRE, no ESCALATE. |
| `phase2_allow` | 40 | Phase 2 under partition: all 40 assets still ALLOWed their next action — partitioned-half ran under Fluidity Tokens, connected-half ran normally. |
| `phase2_refuse` | 0 | No assets refused. |
| `phase2_expire` | 0 | No Fluidity Tokens expired during the phase-2 window (TTL is 1500ms; phase happens immediately after partition). |
| `phase3_witness_half_refused` | 0 | Of the 10 revoked-envelope assets: those reachable via witness-B would have refused with `ENVELOPE_REVOKED`. In this configuration, all 10 revoked assets are in the *fully-isolated* subset, so 0 reach witness-B in time. |
| `phase3_isolated_half_allowed` | 10 | The 10 revoked-and-fully-isolated assets cannot see the revocation; they continue to ALLOW under their (still valid) Fluidity Tokens. |
| `phase4_reconciled_clean` | 30 | After heal: 30 assets had their locally-issued decisions reconciled without conflict. |
| `phase4_reconciled_conflicts` | 10 | The 10 fully-isolated assets reconciled with conflict — they issued Warrants *after* root had revoked their envelopes. The conflict count matches the revocation count exactly. |
| `total_warrants_issued` | 90 | 40 (phase 1) + 40 (phase 2) + 10 (phase 3 isolated half) = 90. |
| `total_revocations` | 10 | Phase 3 revocations issued by root. |

The interesting numbers are the conflict count and the warrants issued during isolation. Together they show:

1. **Partition tolerance is real:** the 10 fully-isolated assets kept operating under their Fluidity Tokens for the entire partition window.
2. **The cost is auditable:** the 10 conflicts make explicit which decisions need operator review post-heal. Nothing is hidden.
3. **The runtime accounts for every decision:** `phase4_reconciled_clean + phase4_reconciled_conflicts ≥ total assets that issued anything locally`. There are no lost decisions.

---

## What this artifact does NOT prove

- It does not prove anything about real hardware. No autopilot, no GPS, no RF, no flight controller is involved.
- It does not prove the system scales beyond 40 assets — that's a benchmarking question, not a correctness question.
- It does not prove anything about network reliability under adversarial conditions — the partition is scripted, not real.
- It does not prove the cryptographic signatures hold against quantum adversaries — Ed25519 is conventional today.

It proves: the runtime's authority logic produces deterministic, reproducible counters under a defined partition / revocation / heal / reconcile cycle. That is the substrate property. Real deployment is the operator's responsibility.

---

## How to verify it yourself

```sh
git clone https://github.com/AristotleAgentic/AristotleOS
cd AristotleOS/extracted
corepack pnpm@10.32.1 install
pnpm reviewer:verify
```

The reviewer flow's **Stage 3** runs this scenario locally and computes the report hash. **Stage 4** loads `published.replay.json` and asserts your local hash matches the published hash byte-for-byte.

If you'd rather see just this artifact's verification path:

```sh
node --import tsx --test examples/mesh/published.replay.test.ts
```

Three checks — file parses, hash matches, four-gate verifier passes.

If the report numbers above ever diverge from what your local run produces, either the scenario code has drifted or your environment is non-deterministic. Both cases are reported in `verifyReplayArtifact()`'s output.

---

## How to regenerate the artifact

If the scenario code legitimately changes (new test case, additional phase, etc.), bump `scenario_version` in `examples/mesh/publish-replay-artifact.ts` and re-run:

```sh
node --import tsx examples/mesh/publish-replay-artifact.ts
```

This writes a new `published.replay.json` with new hashes. The old artifact remains valid as proof of the *previous* scenario logic — `verifyReplayArtifact()`'s `version_ok` gate catches version drift.

---

## Related documents

- `examples/reviewer/REVIEWER.md` — the 20-minute reviewer flow that includes this scenario as Stage 3 + 4.
- `PROOF_STATUS.md` — the per-claim evidence table.
- `THREAT_MODEL.md` Category D — mesh-specific threats and mitigations.
- `LIMITATIONS.md` §5 — what the scenario does NOT model (real network partitions, edge auto-pull of missed revocations).
- `shared/mesh-runtime/README.md` — the protocol the scenario exercises.
