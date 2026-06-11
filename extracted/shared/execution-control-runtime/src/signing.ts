import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
  type KeyObject
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Real asymmetric signing for AristotleOS Warrants and Evidence Bundles.
 *
 * AristotleOS-native, independently developed. Ed25519 is used because the rest
 * of the platform (ledger + governance chain trust roots) already standardizes
 * on Ed25519 PKCS8/SPKI PEM keypairs, so warrant signing reuses the same BYO
 * trust-root story.
 */

export type SignatureAlgorithm = "ed25519";

export interface AristotleSigner {
  readonly key_id: string;
  readonly algorithm: SignatureAlgorithm;
  /** SPKI PEM of the public half, embedded in signed artifacts for offline verification. */
  readonly public_key_pem: string;
  /** True for ephemeral dev keys that must never be trusted in production. */
  readonly ephemeral: boolean;
  /** Sign a canonical message, returning a base64 signature. */
  sign(message: string): string;
}

export interface CreateEd25519SignerInput {
  privateKeyPem: string;
  publicKeyPem?: string;
  keyId?: string;
}

const ED25519: SignatureAlgorithm = "ed25519";

/** Stable, content-addressed key id derived from the SPKI public key bytes. */
export function deriveKeyId(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return `ed25519:${createHash("sha256").update(der).digest("hex").slice(0, 32)}`;
}

function normalizePublicKeyPem(key: KeyObject): string {
  return key.export({ type: "spki", format: "pem" }).toString();
}

export function createEd25519Signer(input: CreateEd25519SignerInput): AristotleSigner {
  const privateKey = createPrivateKey(input.privateKeyPem);
  const publicKey = input.publicKeyPem ? createPublicKey(input.publicKeyPem) : createPublicKey(privateKey);
  const public_key_pem = normalizePublicKeyPem(publicKey);
  const key_id = input.keyId ?? deriveKeyId(public_key_pem);
  return {
    key_id,
    algorithm: ED25519,
    public_key_pem,
    ephemeral: false,
    sign(message: string): string {
      return cryptoSign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");
    }
  };
}

export function createEphemeralDevSigner(): AristotleSigner {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const public_key_pem = normalizePublicKeyPem(publicKey);
  return {
    key_id: `ed25519-dev:${deriveKeyId(public_key_pem).split(":")[1]}`,
    algorithm: ED25519,
    public_key_pem,
    ephemeral: true,
    sign(message: string): string {
      return cryptoSign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");
    }
  };
}

let defaultDevSigner: AristotleSigner | undefined;

/**
 * Process-stable ephemeral dev signer. Warrants signed with it are genuinely
 * Ed25519-signed (unforgeable without the in-process private key) but the key
 * is thrown away when the process exits, so it must never be trusted across
 * processes or in production. Use a configured key for anything real.
 */
export function getDefaultDevSigner(): AristotleSigner {
  if (!defaultDevSigner) defaultDevSigner = createEphemeralDevSigner();
  return defaultDevSigner;
}

export interface WarrantSignerEnv {
  ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH?: string;
  ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH?: string;
  ARISTOTLE_WARRANT_SIGNING_KEY_ID?: string;
}

/**
 * Load a configured warrant signer from environment-provided key paths.
 * Returns undefined when no signing key is configured.
 */
export function loadWarrantSignerFromEnv(env: WarrantSignerEnv = process.env as WarrantSignerEnv): AristotleSigner | undefined {
  const privatePath = env.ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH;
  if (!privatePath) return undefined;
  if (!existsSync(privatePath)) {
    throw new Error(`warrant signing private key not found at ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH=${privatePath}`);
  }
  const publicPath = env.ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH;
  if (publicPath && !existsSync(publicPath)) {
    throw new Error(`warrant signing public key not found at ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH=${publicPath}`);
  }
  return createEd25519Signer({
    privateKeyPem: readFileSync(privatePath, "utf8"),
    publicKeyPem: publicPath ? readFileSync(publicPath, "utf8") : undefined,
    keyId: env.ARISTOTLE_WARRANT_SIGNING_KEY_ID
  });
}

/**
 * Resolve the signer for a runtime: a configured key when present, otherwise a
 * process-stable ephemeral dev key. In production, callers should require a
 * configured signer (see requireProductionSigner).
 */
export function resolveWarrantSigner(env: WarrantSignerEnv = process.env as WarrantSignerEnv): AristotleSigner {
  return loadWarrantSignerFromEnv(env) ?? getDefaultDevSigner();
}

export function requireProductionSigner(signer: AristotleSigner): AristotleSigner {
  if (signer.ephemeral) {
    throw new Error(
      "refusing to sign Warrants with an ephemeral dev key in production. " +
      "Generate a keypair with `aristotle keys generate` and set ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH."
    );
  }
  return signer;
}

// ---------------------------------------------------------------------------
// Managed key custody: load the signing key from a secrets manager / KMS
// ---------------------------------------------------------------------------

/**
 * An async source of signing key material (e.g. a secrets manager such as AWS
 * Secrets Manager / GCP Secret Manager / HashiCorp Vault, or a KMS envelope
 * decrypt). The private key PEM is materialized into memory once at startup and
 * then signing is in-process — so the key is protected *at rest* (encrypted,
 * IAM-gated, audited) rather than sitting as a plaintext file on the host.
 *
 * Note: this does NOT keep the private key inside an HSM during signing. For keys
 * that must never leave a hardware boundary, an asynchronous signing path is
 * required (the AristotleSigner.sign() contract is synchronous) — that is
 * explicit roadmap, documented in docs/key-management.md, not implemented here.
 */
export interface KeyMaterialProvider {
  /** Fetch the Ed25519 private key as PKCS8 PEM. */
  getPrivateKeyPem(): Promise<string>;
  /** Optionally fetch the SPKI public key PEM; derived from the private key when omitted. */
  getPublicKeyPem?(): Promise<string | undefined>;
  /** Stable key id for attribution; derived from the public key when omitted. */
  keyId?: string;
}

/**
 * Build a signer from an injected key-material provider. The key is resolved once
 * (await at startup) and signing is then synchronous and in-process, satisfying
 * the AristotleSigner contract. Use this to move warrant/evidence signing keys off
 * the local filesystem and into a managed secret store. AristotleOS imports no
 * cloud SDK — you inject the fetch (see examples/signers/).
 */
export async function createSignerFromKeyProvider(provider: KeyMaterialProvider): Promise<AristotleSigner> {
  const privateKeyPem = await provider.getPrivateKeyPem();
  if (!privateKeyPem || !privateKeyPem.includes("PRIVATE KEY")) {
    throw new Error("key-material provider returned an empty or non-PEM private key");
  }
  const publicKeyPem = provider.getPublicKeyPem ? await provider.getPublicKeyPem() : undefined;
  return createEd25519Signer({ privateKeyPem, publicKeyPem, keyId: provider.keyId });
}

// Parsing a PEM into a KeyObject is the dominant cost of verification; the same
// public keys recur across thousands of warrant/GEL/bundle verifications. Cache the
// parsed key by its PEM. Behaviour is unchanged (identical key ⇒ identical result);
// the cache is bounded so churned/ephemeral keys can't grow it without limit.
const PUBLIC_KEY_CACHE_LIMIT = 512;
const publicKeyCache = new Map<string, KeyObject>();

function parsedPublicKey(publicKeyPem: string): KeyObject {
  const cached = publicKeyCache.get(publicKeyPem);
  if (cached) return cached;
  const key = createPublicKey(publicKeyPem);
  if (publicKeyCache.size >= PUBLIC_KEY_CACHE_LIMIT) publicKeyCache.clear();
  publicKeyCache.set(publicKeyPem, key);
  return key;
}

export function verifyEd25519(publicKeyPem: string, message: string, signatureBase64: string): boolean {
  try {
    return cryptoVerify(null, Buffer.from(message, "utf8"), parsedPublicKey(publicKeyPem), Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}
