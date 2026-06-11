/**
 * @aristotle/kms-keyring
 *
 * KMS-backed keyring for AristotleOS Warrant signing.
 *
 * Closes the shippable portion of ROADMAP_TO_100.md Category 1 "ship a
 * first-party KMS keyring adapter (AWS KMS + Vault) implementing the
 * Keyring interface". The cloud-side integration (network calls, real
 * KMS credentials) is intentionally not bundled — it requires
 * customer-owned infra to test honestly. What ships here:
 *
 *   - KmsKeyring + KmsKeyHandle interfaces. A keyring holds named key
 *     handles; each handle produces an AristotleSigner on demand. The
 *     private key material lives behind the handle (in memory, in KMS,
 *     in Vault, in an HSM, etc.) — it is never returned by value.
 *
 *   - InMemoryKmsKeyring (full implementation). Generates Ed25519
 *     keypairs in memory, keyed by name. Useful for tests, local
 *     development, and as the reference implementation that operators
 *     can use to test their wiring before pointing it at a real KMS.
 *
 *   - AwsKmsKeyringStub + VaultKeyringStub. Implementations of the
 *     KmsKeyring interface that document where AWS KMS / HashiCorp
 *     Vault Transit calls go. They compile cleanly and the public API
 *     shape is real; calling sign() throws a clear error explaining
 *     that the cloud integration is operator-supplied. A future
 *     iteration drops in `@aws-sdk/client-kms` / `node-vault` as
 *     optional peerDeps and turns the stubs into working clients.
 *
 * The key escrow story:
 *
 *   Today the substrate's signers (createEd25519Signer in
 *   @aristotle/execution-control-runtime) accept raw PEM bytes. That
 *   means the OPERATOR is the key custodian — they read the PEM off
 *   disk and pass it in. A KMS-backed deployment never sees the bytes
 *   at all; the keyring is given a key handle (an ARN, a Vault path)
 *   and asks the KMS to sign on its behalf. The substrate's signer
 *   contract (AristotleSigner) doesn't change — only the producer of
 *   the signer does. This package is the producer.
 */

import { generateKeyPairSync } from "node:crypto";
import {
  type AristotleSigner,
  createEd25519Signer,
  deriveKeyId
} from "@aristotle/execution-control-runtime";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * One key in a KMS keyring. The handle knows how to:
 *   - produce an AristotleSigner that satisfies the existing substrate
 *     signing contract (key_id, public_key_pem, sign(message)).
 *   - report whether the underlying key is "real" or a dev/ephemeral
 *     key that must never be trusted in production.
 *
 * The handle does NOT expose the private key material. Implementations
 * may keep it in memory (InMemoryKmsKeyring), or remote it to a KMS /
 * HSM (the AWS / Vault adapters).
 */
export interface KmsKeyHandle {
  /** Stable name within the keyring (e.g. "warrant-signing-key-prod"). */
  readonly name: string;
  /**
   * Stable cryptographic id derived from the public key. Matches the
   * `key_id` format produced by `deriveKeyId()` in the substrate so
   * downstream verifyWarrant code (which already understands key_id)
   * needs no changes.
   */
  readonly keyId: string;
  /** True for keys that are ephemeral / in-memory / dev-only. */
  readonly ephemeral: boolean;
  /** Algorithm tag. Currently always "ed25519"; future iterations may add P-256. */
  readonly algorithm: "ed25519";
  /**
   * SPKI PEM of the public half. Safe to embed in signed artifacts for
   * offline verification.
   */
  readonly publicKeyPem: string;
  /**
   * Produce an AristotleSigner for this handle. The returned signer
   * satisfies the substrate's existing signing contract: callers don't
   * need to know whether the underlying private key is local or remote.
   */
  signer(): AristotleSigner;
}

/**
 * A named collection of KmsKeyHandles. Operators construct one keyring
 * per service (or one per tenant) and let the gate / warrant lifecycle
 * resolve handles by name. Rotation is implemented by adding a new
 * handle and pointing callers at the new name.
 */
export interface KmsKeyring {
  /** Provider tag — "in-memory", "aws-kms", "vault-transit", ... */
  readonly provider: string;
  /** List of key handle names this keyring holds. */
  listKeys(): string[];
  /** Fetch a key handle by name. Throws if not found. */
  getKey(name: string): KmsKeyHandle;
  /**
   * Add a key handle. Implementation-defined: in-memory generates a
   * fresh keypair; cloud adapters import an existing ARN / path.
   */
  addKey(name: string, opts?: AddKeyOptions): KmsKeyHandle;
  /** Remove a key handle. Subsequent getKey() throws. */
  removeKey(name: string): void;
}

export interface AddKeyOptions {
  /** For cloud adapters: the externally-managed key identifier. */
  externalKeyRef?: string;
  /** For in-memory: a fixed key id; if omitted, derived from the public key. */
  forceKeyId?: string;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

/**
 * In-process keyring. Generates Ed25519 keypairs on addKey() and keeps
 * the private half in memory for the lifetime of the keyring instance.
 *
 * Suitable for tests, local development, and as the reference
 * implementation operators can use to validate the KmsKeyring wiring
 * before pointing it at a real KMS. NOT suitable for production secrets
 * — the private key material is in process memory, not in an HSM /
 * cloud KMS. Every handle reports `ephemeral: true`.
 */
export class InMemoryKmsKeyring implements KmsKeyring {
  readonly provider = "in-memory";
  private readonly handles: Map<string, KmsKeyHandle> = new Map();

  listKeys(): string[] { return [...this.handles.keys()]; }

  getKey(name: string): KmsKeyHandle {
    const h = this.handles.get(name);
    if (!h) throw new Error(`InMemoryKmsKeyring: no key named '${name}'`);
    return h;
  }

  addKey(name: string, _opts: AddKeyOptions = {}): KmsKeyHandle {
    if (this.handles.has(name)) throw new Error(`InMemoryKmsKeyring: key '${name}' already exists`);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const keyId = _opts.forceKeyId ?? deriveKeyId(publicPem);
    // Materialize a substrate signer once; share it from every signer()
    // call so the underlying KeyObject isn't reparsed each time.
    const sharedSigner = createEd25519Signer({
      privateKeyPem: privatePem,
      publicKeyPem: publicPem,
      keyId
    });
    const handle: KmsKeyHandle = {
      name,
      keyId,
      ephemeral: true,
      algorithm: "ed25519",
      publicKeyPem: publicPem,
      signer(): AristotleSigner { return sharedSigner; }
    };
    this.handles.set(name, handle);
    return handle;
  }

  removeKey(name: string): void { this.handles.delete(name); }
}

// ---------------------------------------------------------------------------
// AWS KMS — stub
// ---------------------------------------------------------------------------

export interface AwsKmsKeyringOptions {
  /**
   * AWS region the KMS keys live in (e.g. "us-east-1"). Required.
   */
  region: string;
  /**
   * Optional explicit AWS credentials. If omitted, the standard AWS SDK
   * credential chain is used (instance profile, env, ~/.aws/credentials).
   */
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  /**
   * Initial set of (name -> KMS key ARN) bindings. The handle calls
   * KMS:Sign on this ARN for every signing operation; the private key
   * never leaves AWS.
   */
  keys?: Record<string, string>;
}

/**
 * AwsKmsKeyringStub — placeholder implementation that documents where
 * the AWS KMS calls go. The interface is real; the implementation
 * intentionally throws on `signer().sign()` so an operator who wires
 * this in without finishing the integration sees the failure
 * immediately instead of at first warrant issuance.
 *
 * To finish the integration in a future iteration:
 *
 *   1. Add `@aws-sdk/client-kms` as an optional peer dependency.
 *   2. In addKey(), call `KMSClient.send(new DescribeKeyCommand(arn))`
 *      to fetch the public key + key spec.
 *   3. In the returned signer's sign(message), call
 *      `KMSClient.send(new SignCommand({
 *         KeyId: arn,
 *         Message: Buffer.from(message),
 *         MessageType: "RAW",
 *         SigningAlgorithm: "EDDSA"
 *       }))`
 *      and return the resulting `Signature` as base64.
 *
 * Today this stub exists so the package's public surface area is
 * stable, callers can wire the import + construct the keyring, and the
 * AWS-SDK integration is a localized future change instead of an
 * interface change.
 */
export class AwsKmsKeyringStub implements KmsKeyring {
  readonly provider = "aws-kms";
  private readonly opts: AwsKmsKeyringOptions;
  private readonly bindings: Map<string, string> = new Map();

  constructor(opts: AwsKmsKeyringOptions) {
    this.opts = opts;
    for (const [name, arn] of Object.entries(opts.keys ?? {})) this.bindings.set(name, arn);
  }

  listKeys(): string[] { return [...this.bindings.keys()]; }

  getKey(name: string): KmsKeyHandle {
    const arn = this.bindings.get(name);
    if (!arn) throw new Error(`AwsKmsKeyringStub: no binding for '${name}'`);
    return this.handleFor(name, arn);
  }

  addKey(name: string, opts: AddKeyOptions = {}): KmsKeyHandle {
    if (!opts.externalKeyRef) {
      throw new Error("AwsKmsKeyringStub.addKey requires { externalKeyRef: <KMS-key-ARN> }");
    }
    this.bindings.set(name, opts.externalKeyRef);
    return this.handleFor(name, opts.externalKeyRef);
  }

  removeKey(name: string): void { this.bindings.delete(name); }

  private handleFor(name: string, arn: string): KmsKeyHandle {
    const provider = this.provider;
    const region = this.opts.region;
    return {
      name,
      keyId: `aws-kms:${region}:${arn}`,
      ephemeral: false,
      algorithm: "ed25519",
      publicKeyPem: "",
      signer(): AristotleSigner {
        return {
          key_id: `aws-kms:${region}:${arn}`,
          algorithm: "ed25519",
          public_key_pem: "",
          ephemeral: false,
          sign(_message: string): string {
            throw new Error(
              `${provider} signer for '${name}' is a stub. ` +
              `Wire @aws-sdk/client-kms KMS:Sign on key ${arn} in region ${region} to complete the integration. ` +
              `See @aristotle/kms-keyring/src/index.ts AwsKmsKeyringStub doc comment.`
            );
          }
        };
      }
    };
  }
}

// ---------------------------------------------------------------------------
// HashiCorp Vault Transit — stub
// ---------------------------------------------------------------------------

export interface VaultKeyringOptions {
  /** Vault server URL, e.g. "https://vault.internal:8200". */
  endpoint: string;
  /** Vault token. Production should source from Vault Agent / AppRole. */
  token: string;
  /** Optional mount path for the Transit engine. Defaults to "transit". */
  mountPath?: string;
  /**
   * Initial set of (name -> Vault Transit key name) bindings. The handle
   * calls /transit/sign/<key>/ed25519 for every signing operation.
   */
  keys?: Record<string, string>;
}

/**
 * VaultKeyringStub — placeholder for the HashiCorp Vault Transit
 * integration. Same shape as AwsKmsKeyringStub: real interface, stub
 * sign() that documents the wire-up.
 *
 * To finish the integration in a future iteration:
 *
 *   1. Add `node-vault` as an optional peer dependency (or use the
 *      Vault HTTP API directly via Node's fetch).
 *   2. In addKey(), GET /v1/<mount>/keys/<key> to fetch the latest
 *      version's public key (the response includes a base64
 *      ed25519 public key under .data.keys.<version>.public_key).
 *   3. In the signer's sign(message), POST to
 *      /v1/<mount>/sign/<key>/ed25519 with
 *      { input: base64(message), prehashed: false, key_version: <v> }
 *      and return .data.signature (already base64).
 */
export class VaultKeyringStub implements KmsKeyring {
  readonly provider = "vault-transit";
  private readonly opts: VaultKeyringOptions;
  private readonly bindings: Map<string, string> = new Map();

  constructor(opts: VaultKeyringOptions) {
    this.opts = opts;
    for (const [name, transitKey] of Object.entries(opts.keys ?? {})) this.bindings.set(name, transitKey);
  }

  listKeys(): string[] { return [...this.bindings.keys()]; }

  getKey(name: string): KmsKeyHandle {
    const transit = this.bindings.get(name);
    if (!transit) throw new Error(`VaultKeyringStub: no binding for '${name}'`);
    return this.handleFor(name, transit);
  }

  addKey(name: string, opts: AddKeyOptions = {}): KmsKeyHandle {
    if (!opts.externalKeyRef) {
      throw new Error("VaultKeyringStub.addKey requires { externalKeyRef: <vault-transit-key-name> }");
    }
    this.bindings.set(name, opts.externalKeyRef);
    return this.handleFor(name, opts.externalKeyRef);
  }

  removeKey(name: string): void { this.bindings.delete(name); }

  private handleFor(name: string, transit: string): KmsKeyHandle {
    const provider = this.provider;
    const mount = this.opts.mountPath ?? "transit";
    const endpoint = this.opts.endpoint;
    return {
      name,
      keyId: `vault-transit:${mount}/${transit}`,
      ephemeral: false,
      algorithm: "ed25519",
      publicKeyPem: "",
      signer(): AristotleSigner {
        return {
          key_id: `vault-transit:${mount}/${transit}`,
          algorithm: "ed25519",
          public_key_pem: "",
          ephemeral: false,
          sign(_message: string): string {
            throw new Error(
              `${provider} signer for '${name}' is a stub. ` +
              `Wire POST ${endpoint}/v1/${mount}/sign/${transit}/ed25519 to complete the integration. ` +
              `See @aristotle/kms-keyring/src/index.ts VaultKeyringStub doc comment.`
            );
          }
        };
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Convenience: resolve a substrate signer from a keyring + name. Lets the
// rest of the substrate stay ignorant of which provider is in use.
// ---------------------------------------------------------------------------

export function resolveSigner(keyring: KmsKeyring, name: string): AristotleSigner {
  return keyring.getKey(name).signer();
}
