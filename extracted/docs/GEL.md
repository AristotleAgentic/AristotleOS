# GEL — Governance Evidence Ledger

GEL is **not a log**. It is a hash-chained, signed evidence record of every Commit Gate decision, with explicit lineage to the Ward, Authority Envelope, and Warrant that produced the decision.

## What GEL is

```ts
interface GelRecord {
  record_id: string;
  previous_hash: string;            // chain link
  record_hash: string;              // sha256 of canonical record material
  timestamp: string;
  ward_id: string;
  subject: string;
  canonical_action_hash: string;
  decision: ExecutionControlDecision;  // ALLOW | REFUSE | ESCALATE | EXPIRE
  reason_codes: ExecutionControlReasonCode[];
  authority_envelope_id?: string;
  warrant_id?: string;
  policy_version?: string;
  request_id?: string;
  trace_context?: TraceContext;
  actor?: GelActor;
  runtime_register_snapshot: RuntimeRegister;
  physical_invariant_result?: PhysicalInvariantResult;
  model_lineage?: { model_id, model_version, model_hash?, prompt_hash? };
  hardware_attestation?: { device_id, source, firmware_hash, boot_chain_hash, captured_at, ... };
  signature?: string;               // signs record_hash
  signature_algorithm?: SignatureAlgorithm;
  signing_key_id?: string;
  signing_public_key?: string;
}
```

Each record's `record_hash` is computed over the canonical encoding of every field except the hash itself and signature fields (`GEL_NON_MATERIAL_FIELDS`). Each record's `previous_hash` references the previous record's `record_hash`. Tampering one record breaks the chain.

## What GEL proves

| Claim | How GEL proves it |
|---|---|
| This decision actually happened | Record exists in the chain, signed by a key in `mae.signing_keys` |
| This decision had the lineage we say it had | `ward_id`, `authority_envelope_id`, `warrant_id` resolve to standing primitives |
| This decision used the policy we say it used | `policy_version` (when present) |
| This decision considered the runtime state we say it considered | `runtime_register_snapshot` (canonical encoding of telemetry / registers) |
| This decision happened in this order relative to others | `previous_hash` chain |
| This evidence has not been tampered with | `verifyGelChain` walks the chain and validates every signature + every `previous_hash` link |
| Insurance / regulator can verify offline | `exportEvidenceBundle` produces a self-contained, signed, replayable bundle |

## What GEL does NOT prove

| Limitation | Mitigation path |
|---|---|
| The signing key was the *legitimate* operator (vs. compromised) | KMS-backed signing; key-compromise detection |
| The timestamp is genuine (vs. backdated by a key-compromised adversary) | External timestamp authority (Sigstore / RFC 3161 TSA) |
| The runtime register snapshot reflects reality (vs. spoofed telemetry) | Hardware attestation; TPM-quoted sensor reads (`hardware_attestation` field accepts caller-supplied content; substrate doesn't bridge to TPM/SGX) |
| The chain hasn't been truncated at the head | External anchoring of head hashes to a public log |
| The agent's *intent* was what the action implies | Out of scope; the gate evaluates capability, not intent |

External timestamp authority integration is the single most impactful hardening for GEL. See `LIMITATIONS.md` §3 and `ROADMAP_TO_100.md` Category 1.

## Lifecycle

```
1. evaluateCommitGate → decision
2. (if ALLOW) issueWarrant
3. appendGelRecord({
     ward_id, subject, canonical_action_hash, decision, reason_codes,
     authority_envelope_id?, warrant_id?, policy_version?,
     runtime_register_snapshot, physical_invariant_result?,
     model_lineage?, hardware_attestation?
   }) — signed, hash-linked
4. (downstream) verifyGelChain(ledgerPath) → { ok, count, failure? }
5. (downstream) exportEvidenceBundle({ ledgerPath, ... }) → portable bundle
6. (third party) verifyEvidenceBundle(bundle, { revocations, trustedKeyIds }) → { ok, failures }
```

Ledger backends:
- `InMemoryLedgerBackend` — tests and demos only.
- `FileLedgerBackend` — append-only JSONL.
- `SqliteLedgerBackend` — single-process durable.
- `PostgresLedgerBackend` (via `@electric-sql/pglite`) — multi-process, ACID, shared replay.

All four pass the same replay-protection contract: `consumeWarrant` is atomic single-shot. See `shared/execution-control-runtime/src/index.test.ts` ledger tests.

## Evidence bundle export

```ts
const bundle = exportEvidenceBundle({
  ledgerPath: "/var/aristotle/gel.jsonl",
  fromRecordId: "rec-...",
  toRecordId: "rec-..."
});
// Bundle includes: chain segment, Wards referenced, Envelopes referenced,
// Warrants referenced, signatures, the bundle's own root hash, signed
// over by the keyring that wrote the records.

const verification = verifyEvidenceBundle(bundle, {
  trustedKeyIds: ["ed25519:trusted-issuer"],
  revocations: revList
});
// verification.ok = true if chain holds, signatures hold, no revoked-key signatures
```

The bundle is the artifact an insurer, auditor, or regulator receives. They run `verifyEvidenceBundle` with their own trust anchors.

## Tamper-detection tests

| Tampering action | Test result | Test path |
|---|---|---|
| Modify one record's field after-the-fact | `record_hash` no longer matches → chain breaks at that record | `chain.test.ts`; `governance-core/src/test/run.test.ts` |
| Remove a record from the middle | `previous_hash` chain breaks | `chain.test.ts` |
| Reorder records | Same — chain breaks | `chain.test.ts` |
| Forge a record with bad signature | `verifyGelChain` returns `ok: false` with `signature_invalid` | `governance-core/src/test/run.test.ts` |
| Replay an evidence bundle from one tenant under a different tenant's gate | Bundle's trust anchors don't match; verification fails | `governance-core/src/test/run.test.ts` |

## Relationship to other observability

GEL is not a substitute for:
- Application logs (debug output, agent reasoning traces).
- Metrics (counters, gauges, histograms).
- Distributed traces (W3C TraceContext is *referenced* by GEL via `trace_context`, but GEL doesn't replace traces).
- Audit logs (those are policy-compliance evidence; GEL is governance-decision evidence).

A complete observability stack pairs GEL with the operator's existing logging / metrics / tracing infrastructure. The `event-stream` package ships webhook + SSE for decision events so a metrics pipeline can subscribe.

## What an external timestamp authority would add

If GEL records were anchored to an external TSA (RFC 3161) or to Sigstore's transparency log:

1. **Backdating becomes detectable** by anyone who reads the TSA's published timestamps.
2. **Truncation-at-the-head becomes detectable** because the head's hash is published outside the operator's control.
3. **Non-repudiation across long time gaps** — useful for insurance and regulatory cases where the dispute is years later.

Sigstore integration is one of the highest-leverage hardening steps available. See `ROADMAP_TO_100.md` Category 1.

## Tests

- `governance-core/src/test/run.test.ts` — 41 tests covering chain verification, evidence bundle export/import, signature verification, tamper detection.
- `shared/execution-control-runtime/src/index.test.ts` — ledger backend tests (SQLite, Postgres, replay protection).
- `chain.test.ts` (root `test:chain` script) — cross-package chain validation.

Run with:
```sh
pnpm test:chain
pnpm --filter @aristotle/governance-core test
```
