// Secrets-manager-backed warrant/evidence signer (optional, injected-client pattern).
//
// This file imports NO cloud SDK — you inject a `SecretReader`, so AristotleOS has
// no hard dependency on AWS/GCP/Azure/Vault. The signing key lives in your secret
// store (encrypted at rest, IAM-gated, access-audited) instead of as a plaintext
// PEM on the host; it is decrypted into memory once at startup, after which signing
// is in-process and synchronous (satisfying the AristotleSigner contract).
//
// Wire it with your SDK, e.g. AWS Secrets Manager:
//
//   import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
//   const aws = new SecretsManagerClient({});
//   const reader: SecretReader = {
//     getSecret: async (name) => (await aws.send(new GetSecretValueCommand({ SecretId: name }))).SecretString ?? "",
//   };
//   const signer = await createSecretsManagerSigner(reader, {
//     privateKeySecret: "aristotle/warrant-signing-key",
//     keyId: "ed25519:prod-2026q2",
//   });
//   const server = createExecutionControlRuntimeServer({ ward, authorityEnvelope, signer, ... });
//
// For keys that must NEVER leave a hardware boundary (HSM-resident signing), this
// pattern is insufficient — that needs an asynchronous signing path and is tracked
// as roadmap in docs/key-management.md. Do not pretend an in-memory key is HSM-grade.
import {
  type AristotleSigner,
  type KeyMaterialProvider,
  createSignerFromKeyProvider
} from "@aristotle/execution-control-runtime";

/** The one capability this adapter needs from your secrets manager. */
export interface SecretReader {
  getSecret(name: string): Promise<string>;
}

export interface SecretsManagerSignerOptions {
  /** Secret holding the Ed25519 private key (PKCS8 PEM). */
  privateKeySecret: string;
  /** Optional secret holding the SPKI public key PEM; derived from the private key when omitted. */
  publicKeySecret?: string;
  /** Stable key id for GEL attribution / verifier trust pinning. */
  keyId?: string;
}

/** Adapt a SecretReader into the runtime's KeyMaterialProvider. */
export function secretsManagerKeyProvider(reader: SecretReader, options: SecretsManagerSignerOptions): KeyMaterialProvider {
  return {
    keyId: options.keyId,
    getPrivateKeyPem: () => reader.getSecret(options.privateKeySecret),
    getPublicKeyPem: options.publicKeySecret ? () => reader.getSecret(options.publicKeySecret!).then((pem) => pem || undefined) : undefined
  };
}

/** Build a signer whose key is fetched from your secret store at startup. */
export function createSecretsManagerSigner(reader: SecretReader, options: SecretsManagerSignerOptions): Promise<AristotleSigner> {
  return createSignerFromKeyProvider(secretsManagerKeyProvider(reader, options));
}
