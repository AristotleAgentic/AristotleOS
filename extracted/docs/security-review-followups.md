# Security Review — Follow-ups (ward-warrant-execution-control)

A focused security review of the governance runtime on this branch. The codebase is
strong: the commit gate is fail-closed and consume-before-receipt, the GEL chain is
hash-linked and signature-verified, JWT verification rejects `alg:none`/HMAC, dual
control blocks self-approval, the degradation matrix fails closed, and the ledgers use
parameterized queries. The items below are the genuine gaps found.

## Implemented in this change (verified)

All four are covered by tests that run offline (`node --import tsx --test`):

0. **Issuer→key binding (was the highest-priority recommendation; now closed).**
   `verifyObjectSignatures` gains an optional `allowedKeyIds: ReadonlySet<string>`
   parameter; when provided, ANY signature whose `keyId` is not in the set fails
   verification BEFORE the cryptographic check. Validators now derive that set
   from `mae.signing_keys` via `maeAllowedKeyIds(mae)` and pass it down to the
   four artifact validators (MAE, Ward, Authority Envelope, Warrant). This stops
   a key trusted for tenant B from forging tenant A's artifacts in a multi-tenant
   deployment that shares a global keyring — the gap previously documented at
   `validators.ts:87/155/216/304` and `hash.ts:162`. The fix preserves legacy
   behavior when `signing_keys` is empty so existing fixtures/deployments keep
   working; operators close the gap by populating `signing_keys`.
   Tests: `validators.security.test.ts` stages exactly the cross-tenant forge
   attack at each of the four levels and asserts refusal.

1. **Prototype-pollution hardening in constraint evaluation** —
   `shared/governance-core/src/constraints.ts` `getPath`. The fact record is built from
   attacker-controlled telemetry/context/action parameters; `part in cur` traversed the
   prototype chain, so a request could satisfy/evade an authority predicate via inherited
   keys (`constructor`, `toString`) or `__proto__`-style segments. Now own-property only
   (`hasOwnProperty`) with `__proto__`/`prototype`/`constructor` segments refused.
   Tests: `constraints.security.test.ts`.

2. **Signature verification made unconditional for Ward/Envelope/Warrant** —
   `shared/governance-core/src/validators.ts`. These three carried a redundant
   `(x.signatures ?? []).length > 0 &&` guard before `verifyObjectSignatures`, unlike the
   MAE path which verifies unconditionally. `verifyObjectSignatures` already fails closed
   on an empty set, so the guard only added inconsistency; removed so all four primitives
   verify identically. (41 existing governance-core tests still pass.)

3. **SSRF egress guard on the governed proxy** —
   new `shared/execution-control-runtime/src/egress-guard.ts`, wired into
   `proxy.ts` before any credential is brokered or request sent. By default it refuses
   non-http(s) schemes, the unspecified address, and the link-local range
   `169.254.0.0/16` & `fe80::/10` — which covers the `169.254.169.254` cloud-metadata
   endpoint, the highest-impact SSRF target (IAM credential theft) — plus known metadata
   hostnames. A new `blockPrivateEgress` option additionally refuses loopback / RFC1918 /
   unique-local / localhost for hardened deployments. Loopback stays allowed by default so
   existing local/sidecar use (and the loopback-based proxy tests) is unaffected.
   Tests: `egress-guard.test.ts`.

## Reviewed but NOT implemented here (need design/test-suite coordination)

Left as recommendations because they touch the core trust model or the durable store and
should land with full-suite runs and fixture/spec updates rather than blind edits:

- **Request-level replay + bounded nonce store.** Replay is keyed solely on the single-use
  warrant nonce; `request_id`/`presented_at` are not recorded, and `store.consumedNonces`
  grows unbounded (memory DoS, serialized in snapshots). Add a TTL-bounded `jti`/request-id
  dedupe and prune consumed nonces past warrant expiry. (`store.ts:99,171-179`)
- **Atomic warrant consumption.** `consumeWarrant` check-then-set is correct single-threaded
  but is documented as the seam for a durable store; make it a CAS
  (`UPDATE … WHERE state='Unused'`) and fold the cumulative-spend check into the same
  transaction. (`store.ts:164-182`, `commit-gate.ts:102-146`)
- **Monetary currency/type checks.** Per-warrant amount check ignores currency and treats a
  non-finite/string `amount` as "no amount", bypassing the ceiling. Require matching
  currency and reject a present-but-uninterpretable amount. (`validators.ts:282-284`)
- **`parent_mae_id` lineage** is never validated (constitutional hierarchy unenforced).
- **Revocation list integrity / parse handling.** Revocation files are plain JSON with no
  signature (file write can silently un-revoke) and `loadRevocationList` throws raw on a
  corrupt file; sign the lists and fail closed explicitly on corruption.
  (`revocation.ts:32-40`, `credential-revocation.ts`)
- **JWKS fail-static** keeps the last-good key cache indefinitely; pair with the revocation
  list as the authoritative key-revocation path and pin `alg` per key. (`auth.ts:402-440`)
