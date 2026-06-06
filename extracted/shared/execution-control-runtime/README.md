# @aristotle/execution-control-runtime

The Commit Gate and its supporting runtime. This is the deterministic admissibility evaluator that sits between an agent's proposed action and the wire-level execution of that action.

## What this package does

```
CommitGateInput → evaluateCommitGate → CommitGateDecision
                                         ↓ (if ALLOW)
                                       issueWarrant   → Warrant (Ed25519-signed)
                                         ↓
                                       consumeWarrant → atomic single-shot
                                         ↓
                                       appendGelRecord → hash-chained, signed
```

Public surface (selected — see `src/index.ts` for complete export list):

- **Types**: `WardManifest`, `AuthorityEnvelope`, `CanonicalActionInput`, `CommitGateInput`, `CommitGateDecision`, `Warrant`, `WarrantVerification`, `GelRecord`, `EvaluateExecutionControlInput`, `EvaluateExecutionControlResult`.
- **Evaluator**: `evaluateCommitGate`, `evaluateExecutionControl`, `evaluateExecutionControlAsync`, `evaluatePhysicalInvariants`.
- **Warrant lifecycle**: `issueWarrant`, `verifyWarrant`, `consumeWarrant`, `requireAllowedWarrant`.
- **Canonical serialization**: `canonicalizeAction`, `stableStringify`, `stableNormalize`, `sha256`.
- **GEL**: `appendGelRecord`, `loadGelChain`, `verifyGelChain`, `verifyGelRecords`, `exportEvidenceBundle`, `loadEvidenceBundle`, `verifyEvidenceBundle`.
- **Ledger backends**: `LedgerStore`, `LedgerBackend`, `FileLedgerBackend`, `InMemoryLedgerBackend`, `SqliteLedgerBackend`, `PostgresLedgerBackend`, `AsyncLedgerBackend`, `AsyncLedgerStore`.
- **Signers**: `AristotleSigner`, `createEd25519Signer`, `getDefaultDevSigner`.
- **Server**: `createExecutionControlRuntimeServer`, `executionControlOpenApiSpec`.
- **Policy compiler**: `compilePolicy`, `compileGovernanceManifest`, `diffGovernanceManifests`.

## What the Commit Gate does

`evaluateCommitGate` is a **pure deterministic function**. Same inputs, same decision. It returns one of:

- **ALLOW** + `reason_codes: ["ALLOWED"]` — action is admissible; the runtime should mint a Warrant.
- **REFUSE** + reason codes — action is not admissible. The Warrant is never minted. Reason codes are drawn from `ExecutionControlReasonCode` (stable taxonomy).
- **ESCALATE** + reason codes — action requires human approval (`MANUAL_REVIEW_REQUIRED`, `POLICY_VERSION_MISMATCH`, `RUNTIME_STATE_MISSING`, ...). Caller drives the approval workflow.
- **EXPIRE** + reason codes — temporally exhausted (e.g., `ENVELOPE_EXPIRED`, `FLUIDITY_TOKEN_EXPIRED`). Distinct from REFUSE because the operator can resume by re-arming the token.

The evaluator's decision-tree, in order:

1. Ward present? else `WARD_NOT_FOUND`.
2. Subject in `ward.permitted_subjects`? else `SUBJECT_NOT_IN_WARD`.
3. Degraded-mode signals present? If yes, consult Ward criticality (`fail-mode.ts::resolveFailMode`) — safety-critical Wards fail closed (`REFUSE` or `ESCALATE`).
4. Authority Envelope present? else `ACTION_NOT_ALLOWED`.
5. Envelope's ward_id matches; envelope's subject matches.
6. Runtime register's policy_version matches Ward's policy_version? else `ESCALATE` with `POLICY_VERSION_MISMATCH`.
7. Envelope unexpired? else `REFUSE` with `ENVELOPE_EXPIRED`.
8. Required runtime registers all present? else `ESCALATE` with `RUNTIME_STATE_MISSING`.
9. Action not in `denied_actions`?
10. Action in `allowed_actions`?
11. Envelope constraints pass?
12. Physical invariants pass (geofence, altitude, battery floor, custom bounds)? else `REFUSE` with `PHYSICAL_INVARIANT_FAILED`.
13. Classification (MLS) — Ward & Envelope clearances must dominate the action's data label.
14. ALLOW.

After `reclassifyExpire`, the final decision is `REFUSE` for ordinary refusals or `EXPIRE` if the reason codes match `EXPIRE_REASON_CODES`.

## What the Commit Gate does NOT do

- It does not perform IO. The gate has no side effects in `evaluateCommitGate`.
- It does not run the agent. The agent runs in the host's process; the gate adjudicates a proposed action.
- It does not modify the action. It receives `CanonicalActionInput` and either authorizes the exact action (via Warrant) or refuses.
- It does not perform telemetry validation. The agent reports telemetry; the gate evaluates the reported values against envelope requirements. **The substrate does not verify the telemetry source.** Pair with hardware attestation if you require source verification.

## Lifecycle

### Evaluation lifecycle

```ts
const decision = evaluateCommitGate({
  ward, authorityEnvelope, action, runtimeRegister, now, degradedConditions
});
if (decision.decision !== "ALLOW") return refuseToCaller(decision);
const warrant = issueWarrant(decision, action, envelope, now, signer, ttlSeconds);
```

### Warrant lifecycle

```ts
// Issued by gate
const warrant: Warrant = issueWarrant(...);

// Held by the consuming subsystem until execution boundary
// At boundary:
const verification = verifyWarrant(warrant, canonicalActionHash, now, {
  trustedKeyIds: [...],
  revocations: revList,
  maxClockSkewMs: 60_000,
  maxLifetimeMs: 900_000,
  seenNonces: nonceSet
});
if (!verification.ok) refuseEmission(verification.reason);

// Atomic single-shot consumption (replay protection)
const proof = ledgerStore.consumeWarrant(warrant.warrant_id, gateId, nowIso);

// Append to GEL
appendGelRecord({ ... });

// Emit at transport seam
transport.emit(operation, authz);
```

### GEL lifecycle

Each record is hash-chained: `record.previous_hash === priorRecord.record_hash`. The chain is verifiable offline via `verifyGelChain` (against a ledger path) or `verifyGelRecords` (against an in-memory array).

Evidence bundles bundle GEL records + Wards + Envelopes + Warrants into a signed, content-addressed artifact. `verifyEvidenceBundle` walks the bundle and confirms every chain link, signature, and revocation status against a caller-supplied revocation list.

## Threat model

This package is the *highest-value attack surface* in the repo. The threat model is enumerated in `THREAT_MODEL.md` at the repo root. Highlights specific to this package:

- **Stolen signing key** → key compromised; rotate via `tenant-onboarding::rotateTenantKey`; production should use KMS-backed signing.
- **Replayed Warrant** → `consumeWarrant` is atomic and single-shot; bundled in-memory `NonceSeenSet` is not durable across restart; production requires a durable nonce store.
- **Altered action after Warrant issuance** → Warrant binds to `canonical_action_hash`; verifier recomputes; mismatch refuses.
- **GEL tampering** → hash chain breaks; verifier detects. External timestamp authority would harden this against a key-compromised adversary.
- **Stale policy bundle** → `POLICY_VERSION_MISMATCH` → ESCALATE.

## Integration contract

A caller integrating this runtime must:

1. Construct or load a `WardManifest` (one per protected domain).
2. Construct or load `AuthorityEnvelope`(s) for each subject + Ward.
3. For each proposed action, call `evaluateCommitGate(...)`.
4. On ALLOW, mint a Warrant via `issueWarrant(...)`.
5. Carry the Warrant to the execution boundary (adapter / transport).
6. At the boundary, verify (`verifyWarrant`) and consume (`consumeWarrant`).
7. Append the GEL record via `appendGelRecord(...)` (synchronous through the ledger backend).
8. Emit the operation via the adapter's transport.

The `executionControlOpenApiSpec()` describes the HTTP surface for callers who want to host the gate as a service.

## Production hardening requirements

Before relying on this package in production:

| Requirement | Status | See |
|---|---|---|
| KMS-backed signing | Caller-supplied today; no first-party adapter | `LIMITATIONS.md` §1 |
| Durable nonce store | `InMemoryLedgerBackend` (test), `SqliteLedgerBackend` (single-process), `PostgresLedgerBackend` (multi-process) ship | `LIMITATIONS.md` §1 |
| External timestamp authority | Not integrated | `LIMITATIONS.md` §3 |
| Operator runbook | Not shipped | `ROADMAP_TO_100.md` |
| Pen test / audit | Not performed | `LIMITATIONS.md` §2 |

## Tests

75+ in `src/index.test.ts` plus per-vertical and per-feature suites (see `PROOF_STATUS.md` for the per-claim mapping). Run with:

```sh
pnpm --filter @aristotle/execution-control-runtime test
```

Full root suite includes 51 `test:*` scripts; see root `package.json`. The high-leverage subset for this package is exposed via:

```sh
pnpm test:core
```

## License

BUSL-1.1. See `LICENSE`, `NOTICE`, and the repository root `LICENSING.md`.
