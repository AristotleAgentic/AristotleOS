import { createPublicKey, timingSafeEqual, verify as verifySignature, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Operator access control for the AristotleOS execution-control boundary.
 *
 * Two credential models, resolved to a single Principal:
 *   1. Role-scoped static tokens (OperatorCredential) — a bearer token mapped to
 *      a fixed role + operator identity. Compared in constant time.
 *   2. OIDC bearer tokens — a compact JWS from a trusted issuer, verified against
 *      configured asymmetric keys. The `sub` claim becomes the operator identity;
 *      a roles claim (optionally re-mapped) becomes the role.
 *
 * The Principal's identity is written into the Governance Evidence Ledger so every
 * decision and operator action is attributable and non-repudiable. JWT
 * verification is deliberately hardened against the classic pitfalls: `alg:none`
 * and HMAC algorithms are rejected outright (no symmetric verification path
 * exists, so there is no alg-confusion vector), the key type must match the
 * declared alg, and `kid` selection is required when multiple keys are configured.
 */

export type OperatorRole = "viewer" | "operator" | "admin";
export const OPERATOR_ROLES: readonly OperatorRole[] = ["viewer", "operator", "admin"] as const;
const ROLE_RANK: Record<OperatorRole, number> = { viewer: 1, operator: 2, admin: 3 };

export function isOperatorRole(value: unknown): value is OperatorRole {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLE_RANK, value);
}

/** True when `have` is at least as privileged as `need`. */
export function roleSatisfies(have: OperatorRole, need: OperatorRole): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}

/** Highest-privilege role in the list, or undefined when the list is empty. */
export function maxRole(roles: OperatorRole[]): OperatorRole | undefined {
  return roles.reduce<OperatorRole | undefined>((best, role) => (best && ROLE_RANK[best] >= ROLE_RANK[role] ? best : role), undefined);
}

export type AuthMethod = "api-key" | "token" | "oidc" | "mtls";

/** The authenticated operator behind a request. Written to the GEL as the actor. */
export interface Principal {
  subject: string;
  role: OperatorRole;
  auth: AuthMethod;
  /** OIDC issuer (iss), when authenticated via OIDC. */
  issuer?: string;
  /** Static-token label or JWT `kid`, for attribution. */
  key_id?: string;
}

/** A role-scoped static bearer token. */
export interface OperatorCredential {
  token: string;
  role: OperatorRole;
  /** Identity attributed to actions taken with this token. */
  subject: string;
  /** Human-readable label / key id (never the token itself) for the audit trail. */
  label?: string;
}

export type JwtAlg = "RS256" | "RS384" | "RS512" | "ES256" | "ES384" | "ES512" | "EdDSA";

/** Allowlisted, asymmetric-only algorithms. The absence of any HMAC/`none` entry
 *  is load-bearing: it removes the alg-confusion and unsigned-token attack paths. */
const ALG_PARAMS: Record<JwtAlg, { hash: string | null; keyType: KeyObject["asymmetricKeyType"]; dsaEncoding?: "ieee-p1363" }> = {
  RS256: { hash: "sha256", keyType: "rsa" },
  RS384: { hash: "sha384", keyType: "rsa" },
  RS512: { hash: "sha512", keyType: "rsa" },
  ES256: { hash: "sha256", keyType: "ec", dsaEncoding: "ieee-p1363" },
  ES384: { hash: "sha384", keyType: "ec", dsaEncoding: "ieee-p1363" },
  ES512: { hash: "sha512", keyType: "ec", dsaEncoding: "ieee-p1363" },
  EdDSA: { hash: null, keyType: "ed25519" }
};

export interface OidcKey {
  /** Required when more than one key is configured; matched against the JWT header `kid`. */
  kid?: string;
  /** When set, the token's `alg` must equal this. */
  alg?: JwtAlg;
  /** SPKI PEM of the issuer's signing public key. */
  publicKeyPem: string;
}

/** A live source of verification keys (e.g. a cached, periodically-refreshed JWKS). */
export interface OidcKeyStore {
  /** Current keys (synchronous; read on the verification hot path). */
  keys(): OidcKey[];
  /** Refresh the cache from the source (e.g. re-fetch the JWKS endpoint). */
  refresh(): Promise<void>;
}

export interface OidcConfig {
  /** Expected `iss` claim. */
  issuer: string;
  /** When set, the token `aud` must include one of these. */
  audience?: string | string[];
  /** Static verification keys (the issuer's JWKS, materialized as PEMs). Optional when `keyStore` is set. */
  keys?: OidcKey[];
  /** Live JWKS source (e.g. createJwksKeyStore({ uri })). Keys here are merged with `keys` and refresh on rotation. */
  keyStore?: OidcKeyStore;
  /** Claim carrying the role/group(s); defaults to "roles". */
  rolesClaim?: string;
  /** Map raw claim values (e.g. IdP group names) to AristotleOS roles. */
  roleMap?: Record<string, OperatorRole>;
  /** Role granted to a verified identity when no claim value maps to a role. */
  defaultRole?: OperatorRole;
  /** Clock-skew tolerance in seconds for exp/nbf (default 60). */
  clockSkewSec?: number;
}

export interface JwtClaims {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  [claim: string]: unknown;
}

export type JwtVerifyResult =
  | { ok: true; claims: JwtClaims; alg: JwtAlg; kid?: string }
  | { ok: false; reason: string };

function b64urlToBuffer(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

function parseJson<T>(buffer: Buffer): T | undefined {
  try {
    return JSON.parse(buffer.toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * Verify a compact JWS against the OIDC config. Returns the claims on success.
 * Validates signature, issuer, audience (when configured), and exp/nbf with skew.
 */
export function verifyJwt(token: string, config: OidcConfig, nowSec: number = Math.floor(Date.now() / 1000)): JwtVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed JWT" };
  const [headerSeg, payloadSeg, signatureSeg] = parts;

  const header = parseJson<{ alg?: string; kid?: string; typ?: string }>(b64urlToBuffer(headerSeg));
  if (!header) return { ok: false, reason: "unparseable JWT header" };
  const alg = header.alg;
  if (typeof alg !== "string" || !Object.prototype.hasOwnProperty.call(ALG_PARAMS, alg)) {
    return { ok: false, reason: `unsupported or disallowed alg: ${String(alg)}` };
  }
  const algKey = alg as JwtAlg;
  const params = ALG_PARAMS[algKey];

  // Combine statically-configured keys with any live JWKS cache.
  const candidateKeys = [...(config.keys ?? []), ...(config.keyStore?.keys() ?? [])];
  let key: OidcKey | undefined;
  if (typeof header.kid === "string") {
    key = candidateKeys.find((candidate) => candidate.kid === header.kid);
    if (!key) {
      // Unknown kid may be a freshly-rotated JWKS key; refresh in the background so
      // the next attempt succeeds. This attempt still fails closed.
      if (config.keyStore) void config.keyStore.refresh();
      return { ok: false, reason: `no configured key for kid ${header.kid}` };
    }
  } else if (candidateKeys.length === 1) {
    key = candidateKeys[0];
  } else {
    return { ok: false, reason: "kid required when multiple verification keys are configured" };
  }
  if (key.alg && key.alg !== algKey) return { ok: false, reason: "token alg does not match configured key alg" };

  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(key.publicKeyPem);
  } catch {
    return { ok: false, reason: "invalid configured verification key" };
  }
  if (publicKey.asymmetricKeyType !== params.keyType) {
    return { ok: false, reason: `key type ${String(publicKey.asymmetricKeyType)} is incompatible with alg ${algKey}` };
  }

  const signature = b64urlToBuffer(signatureSeg);
  const signingInput = Buffer.from(`${headerSeg}.${payloadSeg}`, "ascii");
  let valid: boolean;
  try {
    valid = params.hash === null
      ? verifySignature(null, signingInput, publicKey, signature)
      : verifySignature(params.hash, signingInput, params.dsaEncoding ? { key: publicKey, dsaEncoding: params.dsaEncoding } : publicKey, signature);
  } catch {
    return { ok: false, reason: "signature verification error" };
  }
  if (!valid) return { ok: false, reason: "signature mismatch" };

  const claims = parseJson<JwtClaims>(b64urlToBuffer(payloadSeg));
  if (!claims) return { ok: false, reason: "unparseable JWT claims" };

  const skew = config.clockSkewSec ?? 60;
  if (claims.iss !== config.issuer) return { ok: false, reason: "issuer mismatch" };
  if (typeof claims.exp === "number" && nowSec > claims.exp + skew) return { ok: false, reason: "token expired" };
  if (typeof claims.nbf === "number" && nowSec + skew < claims.nbf) return { ok: false, reason: "token not yet valid" };
  if (config.audience !== undefined) {
    const want = Array.isArray(config.audience) ? config.audience : [config.audience];
    const have = claims.aud === undefined ? [] : Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!want.some((entry) => have.includes(entry))) return { ok: false, reason: "audience mismatch" };
  }

  return { ok: true, claims, alg: algKey, kid: header.kid };
}

/** Resolve the role for a verified token from its roles claim, honoring roleMap and defaultRole. */
export function resolveRoleFromClaims(claims: JwtClaims, config: OidcConfig): OperatorRole | undefined {
  const claimName = config.rolesClaim ?? "roles";
  const raw = claims[claimName];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const roles: OperatorRole[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const mapped = config.roleMap?.[value];
    if (mapped) roles.push(mapped);
    else if (isOperatorRole(value)) roles.push(value);
  }
  return maxRole(roles) ?? config.defaultRole;
}

export interface AuthConfig {
  /** Legacy single shared key; treated as a full-access (admin) credential. */
  apiKey?: string;
  /** Role-scoped static bearer tokens. */
  operators?: OperatorCredential[];
  /** OIDC bearer-token verification. */
  oidc?: OidcConfig;
  /** mTLS / client-certificate (PIV/CAC) auth. */
  cert?: CertAuthConfig;
  /** When true, the standing static admin `apiKey` is refused — forcing token/OIDC/mTLS.
   *  Recommended in production; the api-key is a single high-value static credential. */
  requireStrongAuth?: boolean;
}

/** A presented client certificate (from a terminating proxy/ingress or a TLS-terminating boundary). */
export interface ClientCertificate {
  /** DN subject, e.g. "CN=alice.doe.1234567890,OU=PKI,O=U.S. Government,C=US". */
  subject: string;
  /** Subject Alternative Names — e.g. a PIV UPN ("alice@agency.mil") or a SPIFFE URI. */
  sans?: string[];
  /** Lowercase hex SHA-256 fingerprint of the DER certificate. */
  fingerprint?: string;
  /** Whether the chain was cryptographically verified by the terminator. */
  verified?: boolean;
}

export interface CertAuthRule {
  /** Exact CN match (from the subject DN). */
  cn?: string;
  /** Regex matched against any SAN (e.g. a UPN domain, a SPIFFE path). */
  sanRegex?: string;
  /** Exact fingerprint pin. */
  fingerprint?: string;
  role: OperatorRole;
  /** Identity attributed to the actor; defaults to the cert CN, else first SAN, else the DN. */
  subject?: string;
}

export interface CertAuthConfig {
  rules: CertAuthRule[];
  /** Require a verified chain (default true). */
  requireVerified?: boolean;
  /** When set, the cert fingerprint must be in this allowlist (pinning). */
  trustedFingerprints?: string[];
}

export type AuthOutcome =
  | { status: "anonymous" }
  | { status: "authenticated"; principal: Principal }
  | { status: "rejected"; reason: string }
  | { status: "forbidden"; reason: string; subject: string };

/** True when any authentication method is configured (i.e. /v1 requires credentials). */
export function authEnabled(config: AuthConfig): boolean {
  return Boolean(config.apiKey || (config.operators && config.operators.length > 0) || config.oidc || (config.cert && config.cert.rules.length > 0));
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Extract the presented credential from an Authorization: Bearer / X-API-Key header. */
export function presentedCredential(headers: Record<string, string | string[] | undefined>): string | undefined {
  const authRaw = headers["authorization"];
  const auth = Array.isArray(authRaw) ? authRaw[0] : authRaw;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const apiKeyRaw = headers["x-api-key"];
  const apiKeyHeader = Array.isArray(apiKeyRaw) ? apiKeyRaw[0] : apiKeyRaw;
  if (typeof apiKeyHeader === "string" && apiKeyHeader.length > 0) return apiKeyHeader;
  return undefined;
}

/**
 * Resolve a presented credential to a Principal. Static tokens and the legacy API
 * key are matched in constant time; OIDC JWTs are verified and mapped to a role.
 */
export function resolvePrincipal(presented: string | undefined, config: AuthConfig, nowSec?: number): AuthOutcome {
  if (presented === undefined || presented === "") return { status: "anonymous" };

  for (const credential of config.operators ?? []) {
    if (constantTimeEquals(presented, credential.token)) {
      return { status: "authenticated", principal: { subject: credential.subject, role: credential.role, auth: "token", key_id: credential.label } };
    }
  }

  if (config.apiKey && constantTimeEquals(presented, config.apiKey)) {
    if (config.requireStrongAuth) {
      return { status: "rejected", reason: "static admin api key is disabled (requireStrongAuth); use a token, OIDC, or mTLS" };
    }
    return { status: "authenticated", principal: { subject: "api-key", role: "admin", auth: "api-key" } };
  }

  if (config.oidc && presented.split(".").length === 3) {
    const verified = verifyJwt(presented, config.oidc, nowSec);
    if (!verified.ok) return { status: "rejected", reason: verified.reason };
    const sub = typeof verified.claims.sub === "string" ? verified.claims.sub : undefined;
    if (!sub) return { status: "rejected", reason: "token missing sub claim" };
    const role = resolveRoleFromClaims(verified.claims, config.oidc);
    if (!role) return { status: "forbidden", reason: "verified identity has no role mapping", subject: sub };
    return {
      status: "authenticated",
      principal: { subject: sub, role, auth: "oidc", issuer: typeof verified.claims.iss === "string" ? verified.claims.iss : undefined, key_id: verified.kid }
    };
  }

  return { status: "rejected", reason: "unrecognized credential" };
}

/** Extract the CN value from a DN subject string. */
export function certCommonName(subject: string): string | undefined {
  const match = /(?:^|,)\s*CN=([^,]+)/i.exec(subject);
  return match ? match[1].trim() : undefined;
}

/**
 * Resolve a presented client certificate (mTLS / PIV / CAC) to a Principal. The cert
 * is supplied by the TLS terminator (ingress/mesh did mTLS and forwarded the verified
 * peer cert, or the boundary terminated TLS itself). Rules map CN / SAN / fingerprint
 * to a role + attributed identity; an unverified or unpinned cert is rejected.
 */
export function resolvePrincipalFromCert(cert: ClientCertificate | undefined, config: CertAuthConfig): AuthOutcome {
  if (!cert) return { status: "anonymous" };
  if ((config.requireVerified ?? true) && !cert.verified) {
    return { status: "rejected", reason: "client certificate chain was not verified" };
  }
  if (config.trustedFingerprints && (!cert.fingerprint || !config.trustedFingerprints.includes(cert.fingerprint))) {
    return { status: "rejected", reason: "client certificate fingerprint is not trusted" };
  }
  const cn = certCommonName(cert.subject);
  for (const rule of config.rules) {
    if (rule.cn !== undefined && rule.cn !== cn) continue;
    if (rule.fingerprint !== undefined && rule.fingerprint !== cert.fingerprint) continue;
    if (rule.sanRegex !== undefined) {
      let re: RegExp;
      try { re = new RegExp(rule.sanRegex); } catch { continue; }
      if (!(cert.sans ?? []).some((san) => re.test(san))) continue;
    }
    const subject = rule.subject ?? cn ?? cert.sans?.[0] ?? cert.subject;
    return { status: "authenticated", principal: { subject, role: rule.role, auth: "mtls", key_id: cert.fingerprint } };
  }
  return { status: "forbidden", reason: "client certificate matched no role rule", subject: cn ?? cert.subject };
}

// ---------------------------------------------------------------------------
// Live JWKS: import a JSON Web Key Set and keep it refreshed
// ---------------------------------------------------------------------------

type JwkEntry = JsonWebKey & { kid?: string; alg?: string; use?: string };

/** Convert a single JWK into an OidcKey (SPKI PEM + kid/alg) for verification. */
export function jwkToOidcKey(jwk: JwkEntry): OidcKey {
  const publicKeyPem = createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "pem" }).toString();
  const alg = typeof jwk.alg === "string" && Object.prototype.hasOwnProperty.call(ALG_PARAMS, jwk.alg) ? (jwk.alg as JwtAlg) : undefined;
  return { kid: jwk.kid, alg, publicKeyPem };
}

/** Import a JWKS document into OidcKeys, skipping non-signing and unconvertible keys. */
export function importJwks(jwks: { keys?: JwkEntry[] }): OidcKey[] {
  return (jwks.keys ?? [])
    .filter((jwk) => jwk.use === undefined || jwk.use === "sig")
    .map((jwk) => { try { return jwkToOidcKey(jwk); } catch { return undefined; } })
    .filter((key): key is OidcKey => key !== undefined);
}

export interface JwksKeyStoreOptions {
  /** JWKS endpoint URI (e.g. https://idp/.well-known/jwks.json). */
  uri: string;
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Cache lifetime in seconds; a keys() read past this triggers a background refresh. Default 300. */
  ttlSec?: number;
}

/**
 * A live JWKS-backed OidcKeyStore. `keys()` is synchronous (serves the cache and
 * triggers a non-blocking refresh when stale); `refresh()` re-fetches. A failed
 * fetch keeps the last-good cache (fail-static) rather than dropping all keys.
 * Call `refresh()` once at startup so the first verification has keys.
 */
export function createJwksKeyStore(options: JwksKeyStoreOptions): OidcKeyStore {
  const ttlMs = (options.ttlSec ?? 300) * 1000;
  const fetchImpl = options.fetchImpl ?? fetch;
  let cached: OidcKey[] = [];
  let fetchedAt = 0;
  let inflight: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const res = await fetchImpl(options.uri, { headers: { accept: "application/json" } });
        if (!res.ok) return;
        const doc = (await res.json()) as { keys?: JwkEntry[] };
        const keys = importJwks(doc);
        if (keys.length > 0) { cached = keys; fetchedAt = Date.now(); }
      } catch {
        // Keep the last-good cache; verification continues with current keys.
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  return {
    keys() {
      if (Date.now() - fetchedAt > ttlMs) void refresh();
      return cached;
    },
    refresh
  };
}
