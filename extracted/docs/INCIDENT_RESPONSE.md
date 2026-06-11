# Incident response runbook

Operator-facing procedures for the substrate's most consequential
failure modes. Companion to [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)
— that document gets you to a production posture; this one tells you
what to do when something inside that posture breaks.

Every procedure here assumes a deployment that follows
PRODUCTION_DEPLOYMENT.md: per-node Ed25519 keys, `productionMode: true`,
multi-witness quorum on revocations, KMS-backed Warrant signer, external
TSA, durable FilesystemNonceStore, mTLS. If your deployment doesn't,
these procedures will only partially apply — but they document what the
substrate makes available regardless.

---

## Severity classification

Use the column counts on the right to triage at-page-load:

| Class | Examples | Time-to-respond | Containment window |
|---|---|---|---|
| **SEV-1 — sovereignty compromise** | Root signing key compromise; Warrant signing key compromise | Immediate (minutes) | All execution must halt until the chain is reissued |
| **SEV-2 — partial trust compromise** | Single witness key compromise; TSA key compromise; KMS unavailable | Hours | Affected pathways degrade gracefully (quorum still holds) |
| **SEV-3 — operational disruption** | Mesh partition lasting beyond Fluidity Token TTL; revocation flood from a single peer; ledger disk full | Hours | Service degradation; no integrity loss |
| **SEV-4 — integrity-detected anomaly** | GEL chain verification failure on an audit; TSA anchor mismatch | Days | No active threat; evidence-only |

---

## SEV-1 — Sovereignty compromise

### S1.A — Root signing key compromise

**Symptom:** the root MAE's private key is known to be in the hands of
a non-authorized party. May be: physical custody loss, KMS audit log
showing unauthorized use, a third party producing valid-looking root
signatures.

**Immediate containment (minutes):**

1. **Halt all gates.** Trigger the operator-side sovereign kill switch.
   The substrate's `evaluateCommitGate` and `evaluateExecutionControl`
   both respect a kill-switch file path (`killSwitchPath` option in
   `EvaluateExecutionControlInput`). Set this on every active service.
2. **Block the compromised key at the edge verifiers.** Every edge's
   `MeshVerifier` allowlist controls which root signatures it accepts.
   Run `verifier.removeTrustAnchor("<compromised-root-id>")` on every
   edge (and witness). This requires operator code-deploy or
   configuration push — the substrate does not auto-deploy because
   that would itself be a sovereign action.
3. **Issue a final revocation under quorum.** Use `revokeWithQuorum`
   with as many witnesses as you can reach, against EVERY currently
   live envelope, with reason `"root-key-compromise"`. Edges that
   still trust the compromised root will see the revocation; edges
   already cut off won't accept new traffic anyway.

**Recovery (hours):**

4. Generate a new root keypair following the
   [PRODUCTION_DEPLOYMENT.md § 1](PRODUCTION_DEPLOYMENT.md) procedure.
5. Distribute the new public key to every node's trust anchor
   allowlist. This is a coordinated push — sequence matters: edges and
   witnesses before the root re-enables itself.
6. Issue fresh envelopes under the new root key.
7. Audit the GEL chain for any decisions admitted under the compromised
   root's signature between the compromise window and the kill-switch
   activation. Each is a candidate for review.

**Verification:**

- Every previously-trusted call to `verifier.trustedSignerIds()` no
  longer includes the old root id.
- No new GEL records with `authority_envelope_id` rooted in the old
  root's MAE.
- All edges respond to `/readyz` with the new trust anchor count.

### S1.B — Warrant signing key compromise

**Symptom:** the Warrant signer's private key is known compromised.

**Immediate containment:**

1. **Add the compromised key id to `revocations`** in
   `WarrantVerifyOptions`. Every `verifyWarrant` call now rejects
   warrants signed by that key with reason `REVOKED`. Push the
   updated revocation list to every verifier.
2. **Rotate the KMS key.** If using `@aristotle/kms-keyring`,
   `keyring.removeKey("warrant-signer-prod")` then add a fresh handle.
3. **Force re-issue of every active Warrant.** Warrants are
   single-use by design (replay-protected via nonces) so this is
   bounded; you don't have a long-lived warrant problem like JWT.

**Recovery + verification:** standard key rotation; the substrate's
trust anchors at the verifier are the canonical source of truth.

---

## SEV-2 — Partial trust compromise

### S2.A — Single witness key compromise

**Symptom:** one witness's private key is compromised, but the root +
other witnesses remain trustworthy.

**Containment:**

1. Remove the compromised witness's trust anchor from every edge's
   verifier: `verifier.removeTrustAnchor("<witness-id>")`.
2. Confirm `requireRevocationQuorum` on every edge is set such that
   `N >= floor((witnesses_alive - 1) / 2) + 1` after removal. If you
   were running 3 witnesses with quorum=2 and lose 1, you still have
   2 witnesses but quorum=2 means a single remaining witness flake
   blocks revocation. Raise to 2-of-2 if both remaining witnesses are
   reliable; otherwise add a fresh witness first.
3. Mint a fresh witness keypair (PRODUCTION_DEPLOYMENT.md § 1) and
   distribute the public key to all edges before bringing the witness
   back into rotation.

The substrate's quorum-on-revocations defense (commit `5a2111c`) means
a single compromised witness cannot forge revocations — they need
quorum cooperation. This is the threat model the design was built for.

### S2.B — TSA key compromise

**Symptom:** the Timestamp Authority's private key is compromised.
GEL anchors issued under that key are no longer trustworthy as proof
of timestamp.

**Containment:**

1. Stop accepting new anchors from the compromised TSA. Update every
   verifier's TSA public key registry to remove the compromised key.
2. Anchors issued by the compromised key BEFORE the compromise window
   are still valid evidence (you trusted them at the time); anchors
   inside the window are suspect.
3. Mint a new TSA keypair. Going forward, every new GEL record's
   anchor uses the new TSA. Document the rollover timestamp in the
   audit trail so future verification knows which TSA's public key to
   load for any given anchor.

The substrate's `@aristotle/gel-timestamp` package supports anchor-time
verification with operator-supplied TSA public key, so the rollover is
a configuration push, not a data migration.

### S2.C — KMS unavailable

**Symptom:** AWS KMS / Vault / HSM is unreachable; Warrant signing is
failing for every gate.

**Containment:**

The substrate's gate is fail-closed by design — no KMS means no
signed Warrant means no `ALLOW` decision can return. This is intended;
do NOT install a "fallback signer" that bypasses the KMS.

1. Confirm the failure scope: KMS instance down, network partition to
   KMS, IAM role revoked, etc. Each has a different recovery.
2. Notify downstream operators that gates are returning ESCALATE or
   REFUSE. Do not attempt to manually approve actions.
3. Once KMS is restored, gates resume. No state loss; warrants in
   flight that didn't complete simply weren't issued — the action was
   refused, which is the safe failure mode.

---

## SEV-3 — Operational disruption

### S3.A — Mesh partition lasting beyond Fluidity Token TTL

**Symptom:** edge nodes report `FLUIDITY_TOKEN_EXPIRED` on every
evaluate; root is unreachable from the edges; partition has lasted
longer than the configured `ttl_ms`.

**Containment + recovery:**

1. Root issues fresh Fluidity Tokens with longer TTL via
   `root.issueFluidityToken({ edge_id, envelope_id, ttl_ms })`. Push
   them out-of-band to the partitioned edges if direct mesh delivery
   isn't working.
2. Edges with valid Fluidity Tokens resume issuing under
   `root_reachable_at_issue: false`. The disconnected-warrant cap
   (`maxWarrantsWhileDisconnected`) still applies; if the partition
   lasted long enough that the cap was reached, those edges are
   intentionally fail-closed and won't issue more until they reconnect.
3. On heal, the auto-pull (commit `40d6add`) catches up any revocations
   the edge missed. Operators don't need to manually re-gossip.

### S3.B — Revocation flood from a single peer

**Symptom:** rate of inbound revocations from a single peer id is
order-of-magnitude above baseline; valid revocations from other peers
are being delayed.

**Containment:**

1. The substrate's mesh rate limiter (commit `8c82800` extended by
   today's batch) returns 429 once a peer exceeds its bucket. If
   you're not getting 429s, you're not running with `rateLimiter` —
   wire `createMeshRateLimiter({ capacity, refillRatePerSec })` on
   every node that fronts `/mesh`.
2. If the flooder is a legitimately-trusted peer (insider attack or
   compromised peer), treat as SEV-2 single-peer compromise and
   follow S2.A.
3. The replay cache (commit `7640a80`) automatically drops re-played
   revocation messages. Sustained novel-but-bogus revocations get
   through the replay cache (each is novel) but the quorum check
   drops them (commit `5a2111c`).

### S3.C — GEL ledger disk full

**Symptom:** `appendGelRecord` throws ENOSPC.

**Containment:**

1. Run `archiveGelChain` (commit `7640a80` adjacent; new in today's
   batch) to move the oldest records to a separate archive file. The
   active ledger shrinks; new appends resume.
2. If disk is genuinely full and you can't archive in place, the
   substrate's gate fails closed (it can't write evidence). This is
   the correct behavior — you do not want to admit actions whose
   evidence trail is going to /dev/null.
3. Move the archive file to colder storage. Re-validate with
   `verifyArchivedChain(archivePath)`.

---

## SEV-4 — Integrity-detected anomaly

### S4.A — GEL chain verification failure on an audit

**Symptom:** a scheduled `verifyGelRecords` call returns
`{ ok: false, failure: "record N hash mismatch" }` or `"previous_hash
mismatch"`.

**Investigation:**

1. The substrate's `verifyGelRecords` semantics: any single-byte
   mutation to any material field on any record produces a chain
   failure. The hash chain + per-record signature is designed to
   catch every mutation category (see `gel.mutation.test.ts` for the
   M1–M6 catalog).
2. A chain failure means one of three things has happened:
   a. The ledger file was tampered with after-the-fact (intentional or
      accidental).
   b. The ledger backend's persistence layer corrupted a record.
   c. A bug in the substrate's record-writing path.
3. Identify the failing record index. Inspect that record vs. an
   evidence-bundle export of the same record (if you have one) to
   determine which field changed. The discrepancy is your audit
   evidence.
4. If you have a clean backup, restore from the backup. If not, the
   chain is broken at record N — every record after N has an
   uncertain provenance from the substrate's perspective. Treat as
   SEV-2 (the audit-trail integrity is partially compromised).

### S4.B — TSA anchor mismatch

**Symptom:** `verifyTimestampAnchor(record_hash, anchor, tsa_pubkey)`
returns `{ ok: false, reason: "..." }` on a record where it previously
verified.

The substrate distinguishes four anchor-failure modes (see
`@aristotle/gel-timestamp` tests):
- `record_hash mismatch (anchor witnessed a different record)` — the
  anchor doesn't belong to this record. Possibly anchor was swapped.
- `TSA key id mismatch` — the TSA public key supplied isn't the one
  that signed this anchor. Possibly key rotation, possibly wrong key.
- `signature verification failed` — bytes match, key matches, but the
  signature doesn't. Possibly tampering with `timestamp` field.
- `unsupported anchor kind` — anchor was issued under a format this
  verifier doesn't understand. Add the implementation.

Each reason is a different procedure. Document which one fired and
proceed accordingly.

---

## Cross-cutting: communication during an incident

The substrate is silent — it doesn't email or page anyone. Operators
must wire that to their own incident-management tooling. Recommended:

- `/readyz` reports 503 with a structured `checks` array when any of
  its checks fail. Wire to Prometheus / DataDog / etc. for paging.
- OTel spans on the gate (commit `a558292`) carry decision +
  reason_codes; alert on a sudden drop in ALLOW rate or surge in
  REFUSE.
- The mesh ingress logs all rejections (429, 409, 503, 413, 415, 400)
  with structured `{ ok: false, reason }` bodies. Alert on rates of
  any of these.
- Witness `getQuorumRejectedCount()` and edge `getAutoPullCount()` are
  metrics-friendly counters. Scrape them.

---

## What this runbook does NOT cover

- Specific cloud-provider IAM procedures (revoke role, rotate STS, etc.).
- Specific Kubernetes / Nomad / Docker procedures for restarting workloads.
- Customer-specific communication or regulatory disclosure obligations.

Those are operator-environment-specific and unsafe to default here.

---

## See also

- [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) — getting to a production posture in the first place
- [LIMITATIONS.md](../LIMITATIONS.md) — what the substrate intentionally does NOT defend against
- [THREAT_MODEL.md](THREAT_MODEL.md) — the threat surface this runbook responds to
