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

export function verifyEd25519(publicKeyPem: string, message: string, signatureBase64: string): boolean {
  try {
    return cryptoVerify(null, Buffer.from(message, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}
