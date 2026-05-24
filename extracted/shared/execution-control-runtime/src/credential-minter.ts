import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CredentialRevocationList,
  credentialRevocationReason,
  sha256,
  stableStringify
} from "./index.js";

/**
 * Call-site short-lived credential minting.
 *
 * The credential broker injects pre-existing static secrets into a forwarded call.
 * This goes further: instead of holding a long-lived secret, an agent receives a
 * **short-lived, scoped, Warrant-bound** credential minted at the moment of an
 * authorized action — so a leaked token is narrow in scope and expires on its own,
 * and a credential whose ref is on the Ward Marshal revocation list is refused at
 * verification. Mint only after the Commit Gate returns ALLOW and the Warrant
 * verifies; the minted credential's lifetime should not exceed the Warrant's.
 *
 * The built-in minter is a real HMAC-SHA256 short-lived token (deterministic,
 * offline-verifiable). For cloud STS / Vault dynamic secrets, implement the
 * `CredentialMinter` interface with an injected client — AristotleOS imports no
 * cloud SDK.
 */

export interface MintRequest {
  subject: string;
  /** Scopes the credential grants, e.g. ["warehouse:read", "slack:post"]. */
  scope: string[];
  /** Target audience/system the credential is valid for. */
  audience?: string;
  ttlSeconds: number;
  /** The Warrant that authorized this issuance — the credential exists only because of it. */
  warrantId: string;
  now?: string;
}

export interface MintedCredential {
  credential_ref: string;
  /** Opaque bearer material; present it to the audience, never log it. */
  token: string;
  subject: string;
  scope: string[];
  audience?: string;
  warrant_id: string;
  issued_at: string;
  expires_at: string;
  algorithm: "hmac-sha256";
  signing_key_id?: string;
}

export interface CredentialMinter {
  readonly algorithm: string;
  mint(request: MintRequest): Promise<MintedCredential> | MintedCredential;
}

interface TokenClaims {
  credential_ref: string;
  subject: string;
  scope: string[];
  audience?: string;
  warrant_id: string;
  issued_at: string;
  expires_at: string;
}

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function hmac(secret: Buffer, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export interface HmacMinterOptions {
  /** Symmetric signing secret. Keep it server-side; never ship it to agents. */
  secret: string | Buffer;
  signingKeyId?: string;
}

/** A real HMAC-SHA256 short-lived credential minter (deterministic, offline-verifiable). */
export function createHmacCredentialMinter(options: HmacMinterOptions): CredentialMinter {
  const secret = typeof options.secret === "string" ? Buffer.from(options.secret, "utf8") : options.secret;
  if (secret.length < 16) throw new Error("credential minter secret must be at least 16 bytes");
  return {
    algorithm: "hmac-sha256",
    mint(request: MintRequest): MintedCredential {
      if (request.ttlSeconds <= 0) throw new Error("ttlSeconds must be positive");
      if (!request.scope.length) throw new Error("a minted credential must carry at least one scope");
      const issuedAt = request.now ?? new Date().toISOString();
      const expiresAt = new Date(Date.parse(issuedAt) + request.ttlSeconds * 1000).toISOString();
      const scope = [...request.scope].sort();
      const credential_ref = `cred-${sha256(stableStringify({ subject: request.subject, scope, audience: request.audience, warrant_id: request.warrantId, issued_at: issuedAt })).slice(0, 24)}`;
      const claims: TokenClaims = { credential_ref, subject: request.subject, scope, audience: request.audience, warrant_id: request.warrantId, issued_at: issuedAt, expires_at: expiresAt };
      const payload = b64url(stableStringify(claims));
      const token = `${payload}.${hmac(secret, payload)}`;
      return { credential_ref, token, subject: request.subject, scope, audience: request.audience, warrant_id: request.warrantId, issued_at: issuedAt, expires_at: expiresAt, algorithm: "hmac-sha256", signing_key_id: options.signingKeyId };
    }
  };
}

export interface VerifyMintedCredentialOptions {
  secret: string | Buffer;
  now?: string;
  /** When set, the token's audience must equal this. */
  audience?: string;
  /** Ward Marshal credential revocation list; a revoked credential_ref is refused. */
  revocations?: CredentialRevocationList;
}

export type MintedCredentialVerification =
  | { ok: true; claims: TokenClaims }
  | { ok: false; reason: string };

/** Verify a minted credential: signature (timing-safe), expiry, audience, revocation. */
export function verifyMintedCredential(token: string, options: VerifyMintedCredentialOptions): MintedCredentialVerification {
  const secret = typeof options.secret === "string" ? Buffer.from(options.secret, "utf8") : options.secret;
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed credential" };
  const [payload, signature] = parts;
  const expected = hmac(secret, payload);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return { ok: false, reason: "signature mismatch" };

  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenClaims;
  } catch {
    return { ok: false, reason: "unparseable credential claims" };
  }

  const now = options.now ? Date.parse(options.now) : Date.now();
  if (now >= Date.parse(claims.expires_at)) return { ok: false, reason: "credential expired" };
  if (options.audience !== undefined && claims.audience !== options.audience) return { ok: false, reason: "audience mismatch" };
  const revoked = credentialRevocationReason(options.revocations, claims.credential_ref);
  if (revoked) return { ok: false, reason: `credential revoked: ${revoked.reason}` };

  return { ok: true, claims };
}
