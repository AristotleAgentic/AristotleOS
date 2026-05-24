# Key management & rotation

AristotleOS signs Warrants and Evidence Bundles with **Ed25519**. Every signed
artifact embeds the signer's SPKI public key, so verification is **offline** and
does not depend on a key server. The signer is an injectable interface
(`AristotleSigner`), so where the private key lives is your decision.

```
sign(message) -> base64 signature      // synchronous, in-process
public_key_pem                          // embedded in the artifact for offline verify
key_id                                  // written to the GEL as the signing identity
```

## Custody tiers (weakest → strongest)

| Tier | How | Key at rest | Use |
|------|-----|-------------|-----|
| Ephemeral dev | `getDefaultDevSigner()` | in-memory, discarded on exit | local dev only — **refused in production** by `requireProductionSigner` / `aristotle preflight` |
| File | `ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH` (PKCS8 PEM) | plaintext file on the host | small/single-node deployments with disk-level controls |
| **Managed secret store** | `createSignerFromKeyProvider` / `examples/signers/` | encrypted at rest in a secrets manager / KMS, IAM-gated, access-audited | **recommended** for pilots and production |

### Managed secret store (recommended)

Move the signing key off the local filesystem into a secret store (AWS Secrets
Manager, GCP Secret Manager, Azure Key Vault, HashiCorp Vault) or a KMS envelope.
The key is fetched and decrypted into memory **once at startup**; signing is then
synchronous and in-process. AristotleOS imports **no cloud SDK** — you inject the
fetch:

```ts
import { createSecretsManagerSigner } from "./examples/signers/secrets-manager-signer.js";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const aws = new SecretsManagerClient({});
const signer = await createSecretsManagerSigner(
  { getSecret: async (name) => (await aws.send(new GetSecretValueCommand({ SecretId: name }))).SecretString ?? "" },
  { privateKeySecret: "aristotle/warrant-signing-key", keyId: "ed25519:prod-2026q2" }
);
// pass `signer` to createExecutionControlRuntimeServer / governSandboxExecution / evaluateExecutionControl
```

This protects the key **at rest** (encrypted, IAM-gated, audited) instead of as a
plaintext PEM on the host.

### HSM-resident signing (roadmap — not implemented)

The strongest custody keeps the private key **inside an HSM/KMS and never in
process memory**; the host sends a digest and gets back a signature. AristotleOS's
`AristotleSigner.sign()` is **synchronous**, while every cloud KMS/HSM sign API is
asynchronous, so this requires an async signing path through the gate/ledger. That
path is **explicit roadmap and is not implemented** — we do not pretend an
in-memory key is HSM-grade. Until then, the managed-secret-store tier is the
recommended posture.

## Rotation

Verification trusts a key by the public key embedded in each artifact, optionally
**pinned** via `trustedKeyIds` (warrant/receipt/evidence verification). Rotation is
therefore a dual-key overlap, with **no break in the hash-chained ledger** (old
records stay valid under the old embedded key):

1. **Provision** a new keypair (`aristotle keys generate`) and store it (new
   `key_id`, e.g. `ed25519:prod-2026q3`).
2. **Trust both**: add the new `key_id`/public key to every verifier's
   `trustedKeyIds` (and any auditor's trust list) while keeping the old one.
3. **Cut over** signing to the new key (point the secret/path at the new key).
4. **Drain**: keep trusting the old key until all single-use Warrants signed by it
   have expired (≥ the configured warrant TTL) and any long-lived Evidence Bundles
   have been archived/verified.
5. **Retire** the old `key_id` from the trust lists. If the old key is *compromised*
   (not merely aged out), additionally **revoke** it (`aristotle revoke key <id>`)
   so the gate fails closed for anything still bearing it.

Keep a separate, secured **break-glass admin** path (see `docs/ACCESS_CONTROL.md`)
so rotation can proceed even if the primary IdP/secret store is briefly unavailable.

## Verify

- `aristotle preflight` reports the signer and refuses ephemeral keys under
  `NODE_ENV=production`.
- Offline-verify any artifact with the embedded public key
  (`aristotle execution-control evidence verify`, `verifyWarrant`,
  `verifyGelChain`) — no key server required.
