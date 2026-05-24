# Cryptographic posture

AristotleOS signs Warrants, Evidence, sandbox/interdiction receipts, and minted
credentials with **Ed25519**, and hash-chains evidence with **SHA-256** — both
modern, well-regarded primitives. This document states the posture honestly for an
evaluator.

## Algorithms

| Use | Algorithm |
|-----|-----------|
| Warrant / GEL / evidence / receipt signing | Ed25519 |
| Minted credentials (preferred) | Ed25519 (`createEd25519CredentialMinter`) |
| Minted credentials (single-trust-domain/dev) | HMAC-SHA256 |
| Evidence hash chain / content addressing | SHA-256 |
| OIDC operator tokens | asymmetric-only JWS (RS/ES/EdDSA); `alg:none`/HMAC rejected |

## FIPS

`node:crypto` links OpenSSL. It reports FIPS **only** when Node is built/linked
against a **FIPS 140-3 validated** OpenSSL module and FIPS mode is enabled. The
algorithms above are FIPS-approvable, but **approvable ≠ validated** — validation is
a property of the *module you deploy*, not of this source tree (Tier C).

**Enforcement:** set `ARISTOTLE_REQUIRE_FIPS=1` and the boundary **refuses to resolve
a signing key** (fails closed at boot) unless `crypto.getFips() === 1`. This prevents
accidentally running a FIPS-required workload on a non-validated provider. It does
**not** make a non-validated build compliant.

```bash
# fails closed unless Node is running a FIPS-validated OpenSSL in FIPS mode
ARISTOTLE_REQUIRE_FIPS=1 aristotle execution-control serve ...
```

## Post-quantum / CNSA

Not yet addressed. Ed25519 is not on the CNSA 2.0 PQC track; a migration to an
approved PQC signature suite is roadmap, not implemented. The signer is an injectable
interface (`AristotleSigner`), so a PQC or HSM-backed signer can be dropped in without
touching the gate.

## Key custody

See `docs/key-management.md`. Keys can be file, env, or managed-secret-store backed;
HSM-resident (key-never-in-memory) signing requires an async signing path and is
explicit roadmap (Tier C).
