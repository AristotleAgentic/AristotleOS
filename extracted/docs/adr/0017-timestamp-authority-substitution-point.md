# ADR-0017 — TimestampAuthority is the substitution point for external time

**Status:** Accepted

## Context

GEL records carry an operator-asserted timestamp. The operator
controls the signing key, so they can backdate or forward-date
records — caught only by an external party who anchored the record
when it was actually written. The substrate's defense is the
`TimestampAuthority` interface: bind each record's hash to a
witness whose key the operator does NOT control.

The question this ADR answers: where does that substitution point
live, and what's the contract every TSA implementation satisfies?

## Decision

A single interface in `@aristotle/gel-timestamp` is the substitution
point for ALL external timestamp anchoring:

```ts
interface TimestampAuthority {
  readonly kind: string;          // "local-ed25519" | "rfc3161" | "sigstore-rekor" | future
  readonly keyId: string;
  readonly publicKeyPem: string;  // or pointer for non-PEM trust
  anchor(recordHash: string): Promise<TimestampAnchor> | TimestampAnchor;
}

interface TimestampAnchor {
  kind: string;
  timestamp: string;
  tsa_key_id: string;
  record_hash: string;
  signature: string;              // opaque per-kind bytes (base64 envelope)
}
```

Every implementation is its own package:

| Implementation | Kind | Package | Verification companion |
|---|---|---|---|
| Local Ed25519 (filesystem) | `local-ed25519` | `@aristotle/gel-timestamp` | Built in to `verifyTimestampAnchor` |
| RFC 3161 (IETF Time-Stamp Protocol) | `rfc3161` | `@aristotle/gel-timestamp-rfc3161` | `@aristotle/gel-timestamp-rfc3161-verify` (X.509 chain) |
| Sigstore Rekor (transparency log) | `sigstore-rekor` | `@aristotle/sigstore-rekor` | `@aristotle/sigstore-rekor-verify` (SET + inclusion proof) |

A future fourth (e.g., `@aristotle/gel-timestamp-roughtime` for the
Roughtime protocol) would add: one anchor package + one verify
package + a new `kind` tag in the enum. Zero substrate changes.

## Alternatives considered

- **Make `LocalTimestampAuthority` the only shipped impl; document
  that operators write their own.** Rejected. Most operators
  reasonably want RFC 3161 or Sigstore Rekor; making them
  rediscover the integration is wasteful + drift-prone.
- **Single mega-package shipping every TSA implementation.**
  Rejected. RFC 3161 needs ASN.1 / X.509; Sigstore needs HTTPS
  Rekor client + Merkle tree math. Per-package isolation lets each
  evolve independently + lets operators install only what they use.
- **Bundle verification into the anchor package.** Rejected. The
  authority's job is "post a witness"; the verifier's job is
  "check the witness against a trust root." Splitting them lets
  the verifier ship the trust-root parts (X.509 chain validation,
  Rekor inclusion-proof math) without forcing the authority client
  to carry that weight.

## Consequences

- Operators can mix TSAs per ledger or per record class. One
  tenant's GEL anchors to RFC 3161 for legal non-repudiation; an
  internal-only tenant uses LocalTimestampAuthority; a public-trust
  tenant uses Rekor. All produce the same `TimestampAnchor` shape.
- The substrate's `verifyTimestampAnchor` dispatches on `kind`. New
  kinds are recognized when the operator imports the corresponding
  `inspect*Anchor` helper from the kind's package. Unknown kinds
  produce `unsupported anchor kind: <kind>` — caught at audit time,
  not silently accepted.
- Operators who change TSA mid-stream produce records with mixed
  `kind` values. The GEL chain doesn't care; the verifier handles
  each per its kind. No rehash needed.
- Future hardening: an operator could chain anchors (`anchor`
  return value carries another anchor in `signature`). The substrate
  doesn't ship this today; the interface is shaped to accept it
  if/when needed.

## See also

- `@aristotle/gel-timestamp` — interface + local impl + dispatcher
- `@aristotle/gel-timestamp-rfc3161` — RFC 3161 client
- `@aristotle/gel-timestamp-rfc3161-verify` — chain validation
- `@aristotle/sigstore-rekor` — Rekor client
- `@aristotle/sigstore-rekor-verify` — SET + inclusion proof
- ADR-0003 (GEL hash chain) — anchored chain is the integrity layer
- ADR-0015 (one-package-per-concept) — per-TSA-package isolation
- [LIMITATIONS § 3](../../LIMITATIONS.md#3-external-timestamp-authority--interface-ships-real-tsa-wiring-is-operator-supplied)
