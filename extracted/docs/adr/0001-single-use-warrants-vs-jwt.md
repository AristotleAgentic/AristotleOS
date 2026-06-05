# ADR-0001 — Single-use Warrants instead of JWT-style bearer tokens

**Status:** Accepted

## Context

AristotleOS gates require an authorization artifact at the moment of
execution. The obvious off-the-shelf choice is JWT: cryptographically
signed, statelessly verifiable, well-tooled in every language. We
chose not to use JWT.

The execution-control problem isn't authentication ("who is this
caller?") — it's per-action authorization ("may this exact action
happen now?"). The properties JWT optimizes for (long lifetime,
stateless verification, multi-consumer reuse) are exactly the
properties that make replay attacks easy.

## Decision

The substrate issues **Warrants** that are:

1. **Single-use.** A Warrant carries a `nonce` that the verifier
   records via `seenNonces`. The second verifyWarrant call with the
   same nonce returns `WARRANT_REPLAYED`.

2. **Action-bound.** The Warrant signs over a canonical hash of the
   exact action it authorizes (`canonical_action_hash`). Substituting
   a different action under the same Warrant invalidates the
   signature.

3. **Envelope-scoped.** The Warrant references the AuthorityEnvelope
   it was issued under. An envelope revocation invalidates every
   Warrant chained to it; the next verifyWarrant call returns
   `REVOKED`.

4. **Short-lived.** Default 60 seconds; `warrantTtlSeconds` is the
   issuer's input but the verifier's `maxLifetimeMs` is the cap.

5. **Issuer-key-pinned.** The verifier's `trustedKeyIds` allowlist
   controls which signing keys can issue acceptable Warrants. Adding
   a fresh signer requires an explicit allowlist update.

## Alternatives considered

- **JWT (RFC 7519).** Rejected. Replay is the operator's problem;
  there is no first-party action-binding; revocation is operationally
  hard (denylist or short TTL); the bearer model doesn't compose with
  envelope-scoped revocation.
- **OAuth 2 access tokens.** Rejected for the same reasons as JWT,
  plus OAuth's threat model is "user delegates to client app over
  HTTP" — wrong shape for execution-control of agentic / cyber-physical
  systems.
- **Macaroons.** Considered. The first-party caveats mechanism is
  attractive but the constraint vocabulary AristotleOS needs (Ward,
  AuthorityEnvelope, FluidityToken) is rich enough that Macaroons
  would just become a transport for a higher-level shape we'd
  define anyway. Skipped to avoid the indirection.
- **Capability tokens à la Object-capability systems.** Considered.
  Similar concerns to Macaroons: AristotleOS already has its own
  scoping primitives, and capability semantics weren't the missing
  piece.

## Consequences

- Every verifier needs durable nonce storage in production
  (`@aristotle/nonce-store`'s `FilesystemNonceStore` or Redis /
  Postgres backends). The cost is one disk write per accepted
  Warrant.
- Warrants don't compose with HTTP API token caches. A consumer can't
  "log in once and use the token for an hour" — they get a Warrant
  per action. This is intentional; it's the property we wanted.
- Verifiers must reject Warrants whose `signing_key_id` isn't in
  their trust anchor allowlist. This is operationally heavier than
  JWT's "trust any JWKS-published key" model. The trade is explicit:
  more friction per key rotation in exchange for no silent
  trust-anchor sprawl.
- Action canonicalization (`canonical_action_hash`) requires a
  deterministic stringification of the action's params. The substrate
  ships `stableStringify` for this; consumers who construct actions
  in non-trivial shapes need to use it consistently.

## See also

- [docs/WARRANTS.md](../WARRANTS.md) — Warrant lifecycle in detail
- [docs/COMPARISON.md § JWT](../COMPARISON.md#jwt-rfc-7519) — line-by-line comparison
- [LIMITATIONS.md § 1](../../LIMITATIONS.md#1-production-grade-key-management) — KMS-backed signing
- `@aristotle/nonce-store` — durable replay-protection backend
- ADR-0002 (deterministic gate) — Warrants are only meaningful because the gate that issues them is deterministic and replayable
