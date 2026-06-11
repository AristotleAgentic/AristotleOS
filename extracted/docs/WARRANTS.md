# Warrants

A Warrant is **a single-use, content-bound, signed conveyance for one proposed action**. It is the centerpiece of AristotleOS's authority model.

## Why a Warrant is not a JWT

| Property | JWT (typical bearer) | AristotleOS Warrant |
|---|---|---|
| Reusable until expiry? | Yes | **No** — single-use, marked consumed atomically |
| Bound to a specific action? | No | **Yes** — `canonical_action_hash` is in the signed material |
| Carries a per-issuance nonce? | Optional | **Required** — nonce is signed into material |
| Replay-detection state required? | No | **Yes** — `NonceSeenSet` |
| Single signing key per issuer? | Typically | **Allowlist** in `mae.signing_keys` (closes cross-tenant forge) |
| Verifiable without issuer? | Yes (with public key) | **Yes** (`@aristotle/warrant-verifier`) |

A JWT proves "the holder was authenticated"; a Warrant proves "this exact action was admitted by the gate, and exactly one execution attempt is licensed".

## Warrant material (what gets signed)

```ts
{
  action_type,
  authority_envelope_id,
  canonical_action_hash,
  expires_at,
  issued_at,
  issuer,
  subject,
  ward_id,
  nonce,          // present when issuer supports nonces (default since v0.1.6)
  decision: "ALLOW",
  single_use: true
}
```

The signature covers the stable JSON encoding of these fields. Any tamper to any field breaks verification.

## Lifecycle

```
1. evaluateCommitGate(action) → ALLOW
2. issueWarrant(decision, action, envelope, now, signer, ttlSeconds) → Warrant
3. (caller carries Warrant to the execution boundary — adapter, dispatcher, external service)
4. verifyWarrant(warrant, canonical_action_hash, now, options) → WarrantVerification
   - signature_ok / temporal_ok / single_use_ok / binding_ok
5. consumeWarrant(warrant.warrant_id, gateId, nowIso) — atomic single-shot
   - throws GovernanceError on replay or wrong gate
6. appendGelRecord(...) — hash-chained, signed
7. adapter.emit(operation, authz) — at the transport seam, refuses on drift
```

Each step is independently testable. See `shared/execution-control-runtime/src/warrant-time.test.ts`, `shared/warrant-verifier/src/index.test.ts`, `shared/execution-control-runtime/src/index.test.ts` for the per-step assertions.

## Verification under the public verifier

A third party (insurance carrier, claim auditor, regulator) needs only:
- The `Warrant` artifact.
- The `canonical_action_hash` of the action the Warrant was supposed to authorize.
- The issuer's trusted signing-key allowlist (`trustedKeyIds`).
- Optionally: a revocation list, a clock, a `NonceSeenSet`.

```ts
import { verifyWarrantPublic } from "@aristotle/warrant-verifier";

const result = verifyWarrantPublic(
  { format: "aristotle.warrant-verify-request.v1", warrant, canonical_action_hash, now },
  { trustedKeyIds: ["ed25519:trusted-issuer"] }
);
// result.ok / result.reason
```

The HTTP handler factory (`createVerifierHandler`) gives a stateless server:

```ts
const handler = createVerifierHandler({ trustedKeyIds });
const res = await handler.handle({ method: "POST", url: "/verify", rawBody: JSON.stringify(req) });
// res.status: 200 (ok) | 422 (refuse) | 400 (malformed) | 405 (wrong method)
```

Deploy N replicas; correctness is stateless modulo the optional `NonceSeenSet`.

## Production-grade replay prevention

The bundled `SimpleNonceSeenSet` is an in-memory `Set<string>`. It is **not durable across restart**. For production, the operator must inject a durable implementation that satisfies the `NonceSeenSet` interface:

```ts
export interface NonceSeenSet {
  has(nonce: string): boolean;
}
```

A production implementation typically also exposes `add(nonce)` (e.g., Redis `SETNX`, Postgres `INSERT ... ON CONFLICT DO NOTHING`, DynamoDB conditional put). The verifier itself does not add; the consuming subsystem does.

A future `@aristotle/nonce-store` package will ship Redis + Postgres backends (see `ROADMAP_TO_100.md` Category 1).

## Common attack surfaces and refutations

| Attack | What the substrate refuses | Test |
|---|---|---|
| Replay same Warrant twice | `WARRANT_REPLAYED` (when caller supplies `NonceSeenSet`) | `warrant-verifier::WARRANT_REPLAYED`; `chaos-harness::replay_attempt` |
| Alter action between issuance and execution | `ACTION_HASH_MISMATCH` | `warrant-verifier::ACTION_HASH_MISMATCH` |
| Modify warrant fields (nonce, expires_at, etc.) | `SIGNATURE_MISMATCH` | `warrant-time.test.ts` |
| Use warrant signed by untrusted key | `UNTRUSTED_SIGNING_KEY` | `warrant-verifier::UNTRUSTED_SIGNING_KEY` |
| Use warrant past `expires_at` | `WARRANT_EXPIRED` | `warrant-time.test.ts`; `warrant-verifier::WARRANT_EXPIRED` |
| Use warrant before `issued_at` | `WARRANT_NOT_YET_VALID` | `warrant-time.test.ts` |
| Issuer dates warrant far in future | `WARRANT_NOT_YET_VALID` (clock-skew tolerance default 60s) | `warrant-time.test.ts` |
| Warrant claims excessive lifetime | `WARRANT_LIFETIME_EXCEEDED` (when verifier enforces `maxLifetimeMs`) | `warrant-time.test.ts` |
| Revoke envelope, replay older Warrant under it | `REVOKED` (when `revocations` supplied) | `governance-core/src/test/run.test.ts` |
| Cross-tenant forge (key from tenant B used for tenant A) | `UNTRUSTED_SIGNING_KEY` (allowlist) | `governance-core/src/validators.security.test.ts` |

## How an insurer / auditor / regulator uses a Warrant

The reviewer holds the Warrant + the canonical action hash of the action being investigated. They:

1. Run the public verifier against the Warrant. If `ok: true`, the Warrant was validly issued.
2. Check the Warrant's `canonical_action_hash` against the action they're investigating. If equal, the Warrant authorized exactly that action.
3. Locate the corresponding GEL record (by warrant id); confirm the chain hashes.
4. Optionally run `time-machine` to ask: "Would the new policy have refused this?" The output is auditable evidence of policy evolution.

The whole chain is offline-verifiable. No gate access required.

## What a Warrant does NOT authorize

- Acting on behalf of a *different* subject (subject is signed into material).
- Performing a *different* action (canonical action hash binding).
- Acting after `expires_at`.
- Acting twice (single-use + nonce + consume).
- Acting under a *different* Ward or Envelope (those ids are signed into material).
- Acting after the issuing key has been revoked (when revocations are supplied to the verifier).

## What this section does NOT prove

- That Ed25519 is sufficient against future quantum adversaries (it isn't, eventually; substitute crypto-agile signers when needed).
- That the operator's `NonceSeenSet` is genuinely durable (that's the operator's wiring choice).
- That the canonical serialization the issuer used matches what the verifier uses (it does in this codebase; cross-implementation requires a stable spec — see `ROADMAP_TO_100.md` Category 3).
