# Auditor's guide

Audience: auditors, regulators, CISOs, and compliance officers assessing whether an
autonomous system's consequential actions were authorized — and whether the proof
holds up independently.

AristotleOS binds governance at the **execution boundary**: an agent must obtain a
decision from the **Commit Gate** before a consequential action, and only an
`ALLOW` yields a single-use, signed **Warrant**. Every decision is written to a
hash-chained, signed **Governance Evidence Ledger (GEL)**, and any decision can be
exported as a self-contained, **offline-verifiable Evidence Bundle**.

This guide explains exactly what each artifact proves, how to verify it yourself,
and — importantly — what is *outside* the guarantee.

## What each artifact proves

### Warrant
A Warrant is an Ed25519 signature over the canonical action material. It proves:

- An authorized decision (`ALLOW`) was made for **this exact action** — the
  `canonical_action_hash` binds the Warrant to the action's content; a different
  action cannot reuse the signature.
- It was issued by a **specific signing key** (`signing_key_id`, with the public
  key embedded for offline checks).
- It is **single-use** and **time-bounded** (`single_use`, `expires_at`).

It does **not** prove the action was actually executed — only that execution was
authorized. Execution proof is the sandbox receipt (below) or your downstream logs.

### Governance Evidence Ledger (GEL)
The GEL is an append-only, hash-chained log of decision records, each optionally
Ed25519-signed. It proves:

- **Order and integrity**: each record commits to the previous record's hash, so
  any insertion, deletion, or edit breaks the chain.
- **Completeness of the decision**: ward, subject, decision, reason codes, policy
  version, runtime-register snapshot, and (when present) the operator `actor`,
  `request_id`, and W3C `trace_context`.
- **Attribution**: who authorized it (operator identity via RBAC/OIDC) and how it
  correlates to your traces.

### Evidence Bundle
A portable JSON document containing the selected GEL record, the full ledger chain
to that point, the Warrant, the Ward Manifest, the Authority Envelope, content
hashes, and an optional bundle-level Ed25519 attestation. It proves the whole
decision **offline**, with no access to the running system.

### Sandbox Execution Receipt
When execution runs through an AristotleOS sandbox, the signed receipt is
hash-bound to the `warrant_id`, the `canonical_action_hash`, and the GEL
`record_id`. It proves **what actually ran** under a specific authorization
(command, exit status, captured output, truncation/timeout), tamper-evidently.

## Verify it yourself (offline)

```bash
# 1. Verify the ledger's hash chain (and per-record signatures).
aristotle execution-control audit verify --ledger gel.jsonl

# 2. Verify a portable Evidence Bundle with no access to the system.
aristotle execution-control evidence verify --bundle bundle.json

# 3. Pin trusted keys: reject anything not signed by an approved key id.
aristotle execution-control evidence verify --bundle bundle.json --trusted-key-ids ed25519:<id>

# 4. Verify against a revocation list (see below).
aristotle execution-control evidence verify --bundle bundle.json --revocations revocations.json

# 5. Verify a sandbox execution receipt and its binding to the Warrant.
aristotle sandbox receipt verify --receipt receipt.json --warrant warrant.json
```

Verification recomputes every hash and checks every signature against the embedded
public keys. **You do not need to trust AristotleOS to verify AristotleOS** —
distribute the signing public key(s) out of band and pin them.

## How revocation affects verification

A compromised signing **key**, a withdrawn **Authority Envelope**, or a single bad
**Warrant** can be revoked. With a revocation list supplied:

- The gate refuses to issue against a revoked key/envelope (`AUTHORITY_REVOKED`).
- Verifiers reject any Warrant or Evidence Bundle bound to a revoked id
  (`REVOKED`), even if its signature is otherwise valid.

So a Warrant that verified yesterday can correctly fail verification today if its
key/envelope/id was revoked — that is the intended, conservative behavior.

## How single-use / replay works

Each `ALLOW` admits one canonical action. An identical, previously-admitted action
is refused as `REPLAY_DETECTED`. With the Postgres ledger, replay state is shared
across boundary instances, so replays are refused consistently in active-active
deployments. This makes the single-use guarantee real, not advisory.

## What failure means

If `audit verify` or `evidence verify` reports failure, **do not trust the
record**: the chain, a signature, a hash, a key pin, or a revocation check did not
hold. A failure is dispositive — investigate the artifact's provenance.

## What is outside the guarantee

State these plainly; they bound what the cryptography can attest:

- **Policy correctness.** AristotleOS proves an action matched the configured Ward/
  Authority Envelope. It does not prove the *policy itself* was correct — that is a
  governance/authoring concern. Review the Ward Manifests and Authority Envelopes.
- **The boundary must be in the path.** Guarantees cover actions that go through the
  Commit Gate. Out-of-band actions (an agent calling an API the boundary never
  saw) are not governed. Architecturally ensure consequential actions are routed
  through the boundary (proxy/credential broker prevents the agent from holding
  standing credentials).
- **Key custody.** The signing private key is the root of trust. If it leaks,
  forged Warrants are possible until the key is revoked. Custody is the operator's
  responsibility (HSM/KMS/secret manager recommended).
- **Local sandbox isolation.** `LocalProcessSandboxProvider` is a development
  provider (process-level limits), not a kernel boundary; for untrusted code use a
  real isolating provider. The receipt's *integrity* still holds regardless.
- **Clock trust.** Expiry checks depend on the verifier's clock; large skew
  affects `expires_at` evaluation (a small tolerance is applied for tokens).
- **Transport security.** TLS is expected to be terminated by your ingress/mesh.
- **No third-party security audit yet.** The cryptography uses Node's standard
  `node:crypto` Ed25519 primitives; an external review has not yet been performed
  (see [AUDIT_SCOPE.md](AUDIT_SCOPE.md) — this repository is prepared to commission
  one).

## Where to look

- Control summary & disclosure: [../SECURITY.md](../SECURITY.md)
- Threat model: [THREAT_MODEL.md](THREAT_MODEL.md)
- Audit scope / target-of-evaluation: [AUDIT_SCOPE.md](AUDIT_SCOPE.md)
- Access control & attribution: [ACCESS_CONTROL.md](ACCESS_CONTROL.md)
- Component inventory (SBOM): [`../sbom.json`](../sbom.json)
