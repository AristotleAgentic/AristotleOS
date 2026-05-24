# Operator access control (RBAC) & OIDC

The AristotleOS execution-control boundary authenticates and authorizes the
operators behind its `/v1` API, and writes the authenticated identity into the
signed Governance Evidence Ledger (GEL) so every decision and operator action is
attributable and non-repudiable.

This complements the cryptographic trust model (Ed25519 Warrants, hash-chained
GEL): RBAC governs *who may operate the boundary*, while the signing key governs
*what authority can be minted*. The two are independent — neither weakens if the
other is misconfigured.

## Roles

| Role | Can do | Routes |
|------|--------|--------|
| `viewer` | Read posture & evidence | `GET context`, `audit/tail`, `audit/verify`, `metrics` |
| `operator` | Request decisions | the above + `POST evaluate`, `POST proxy` |
| `admin` | Operator actions | the above + `POST admin/kill`, `POST admin/revoke` |

Roles are ordered `viewer < operator < admin`; a higher role satisfies any lower
requirement. A request with no credential gets `401`; a valid credential with an
insufficient role gets `403`. `/health`, `/openapi.json`, and the Prometheus
`/metrics` endpoint stay open for liveness/scraping.

## Credential models

Configure any combination (they are checked in this order: static token, API key,
then OIDC). Authentication is *enabled* whenever at least one is configured.

### 1. Single API key (simplest)

```bash
aristotle execution-control serve ... --api-key "$ARISTOTLE_OPERATOR_API_KEY"
```

Grants full **admin** access. Env: `ARISTOTLE_OPERATOR_API_KEY`. Compared in
constant time. Best for a single trusted operator or a break-glass key.

### 2. Role-scoped static tokens

```bash
aristotle execution-control serve ... \
  --operator "viewer:tok-readonly:dashboards@corp" \
  --operator "operator:tok-ops:alice@corp" \
  --operator "admin:tok-root:root@corp:break-glass"
```

Spec: `role:token[:subject[:label]]`. Repeatable. The `subject` is the identity
attributed in the GEL; the optional `label` is a non-secret key id for the audit
trail. Env alternative: `ARISTOTLE_OPERATORS` as a JSON array of
`{ token, role, subject, label? }`, or a `;`-separated list of specs.

Clients present the token as `Authorization: Bearer <token>` or `X-API-Key: <token>`.

### 3. OIDC bearer tokens (SSO)

```bash
aristotle execution-control serve ... --oidc-config oidc.json
```

`oidc.json` (live JWKS — recommended; keys fetched from the IdP and auto-rotated):

```json
{
  "issuer": "https://idp.corp/",
  "audience": "aristotle-boundary",
  "jwksUri": "https://idp.corp/.well-known/jwks.json",
  "jwksTtlSec": 300,
  "rolesClaim": "groups",
  "roleMap": { "platform-admins": "admin", "sre": "operator", "all-staff": "viewer" },
  "defaultRole": null,
  "clockSkewSec": 60
}
```

…or with statically materialized keys (air-gapped / pinned PEMs):

```json
{
  "issuer": "https://idp.corp/",
  "audience": "aristotle-boundary",
  "keys": [
    { "kid": "2026-key-a", "alg": "RS256", "publicKeyFile": "secrets/idp-2026a.pem" }
  ],
  "rolesClaim": "groups",
  "roleMap": { "platform-admins": "admin", "sre": "operator", "all-staff": "viewer" },
  "defaultRole": null,
  "clockSkewSec": 60
}
```

`jwksUri` and `keys` may both be set — keys from both sources are merged, and a
token whose `kid` is unknown triggers a background JWKS refresh (the current
request still fails closed). At least one of the two is required.

The boundary verifies the compact JWS, then maps the token to a role:

- The token `sub` becomes the operator identity (written to the GEL).
- The `rolesClaim` value(s) are mapped via `roleMap`; values that are already
  `viewer`/`operator`/`admin` map directly. The highest matched role wins.
- If nothing maps and `defaultRole` is unset, the verified identity is **forbidden**
  (`403`) — a valid SSO token alone does not grant access.

Each static key may carry `publicKeyPem` inline or a `publicKeyFile` path (resolved
relative to the working directory). Env: `ARISTOTLE_OIDC_CONFIG=<path>`.

#### Live JWKS

When `jwksUri` is set, the boundary fetches the issuer's JWK Set, converts each
signing key (`use:"sig"` or unspecified; encryption keys are skipped) to a
verification key, and caches it. The cache is primed once at startup and refreshed
in the background when it ages past `jwksTtlSec` (default 300s) or when a token
arrives with an unrecognized `kid` (a rotated signing key). Refresh is **fail-static**:
a JWKS fetch error keeps the last-good keys rather than dropping all of them, so a
transient IdP outage does not lock out every operator. The verification hot path is
synchronous — it never blocks on a network call.

#### OIDC hardening

- **Asymmetric only.** Allowed algs: `RS256/384/512`, `ES256/384/512`, `EdDSA`.
  `alg:none` and all HMAC algs are rejected — there is no symmetric verification
  path, so there is no `alg:none` or alg-confusion vector.
- The key's type must match the token's `alg` (enforced for both static and JWKS keys).
- `kid` is required when more than one verification key is available.
- `iss` must match; `aud` is enforced when configured; `exp`/`nbf` are checked with
  `clockSkewSec` tolerance.

### 4. mTLS / PIV / CAC client certificates

For environments that authenticate with client certificates (DoD PKI, PIV/CAC,
SPIFFE), map a verified peer certificate to a role with `resolvePrincipalFromCert`.
The cert comes from the TLS terminator (an ingress/mesh that did mTLS and forwarded
the verified peer cert, or a TLS-terminating boundary):

```ts
const outcome = resolvePrincipalFromCert(clientCert, {
  rules: [
    { sanRegex: "@army\\.mil$", role: "operator" },           // PIV UPN domain → operator
    { cn: "DOE.JANE.A.1234567890", role: "admin" }            // a specific identity → admin
  ],
  requireVerified: true,                                       // reject unverified chains (default)
  trustedFingerprints: ["<sha256-hex>"]                        // optional pinning
});
// outcome.principal.auth === "mtls"; subject defaults to the cert CN; key_id is the fingerprint
```

Rules match on CN, a SAN regex, and/or an exact fingerprint; an unverified or
unpinned cert is rejected, and a cert matching no rule is **forbidden** (a valid cert
alone does not grant access). The attributed identity is written to the signed GEL
like any other principal.

#### Disable the standing admin key in production

The legacy `apiKey` is a single high-value static credential. Set
`requireStrongAuth: true` and it is **refused** — forcing token, OIDC, or mTLS:

```jsonc
{ "apiKey": "<break-glass-only>", "requireStrongAuth": true }  // api-key path now rejected
```

Keep a break-glass admin credential in a secrets manager, but prefer short-lived
OIDC/mTLS sessions for routine admin.

## Operator actions (admin only)

These turn the previously file-only kill switch and revocation into
access-controlled, attributed HTTP actions. They require the `admin` role and are
**disabled unless authentication is configured** (an open/dev boundary never
exposes a network kill switch).

```bash
# Engage / disengage the sovereign-halt kill switch (engage fails closed)
curl -XPOST $BOUNDARY/v1/execution-control/admin/kill \
  -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"engaged":true,"reason":"incident-1234"}'

# Revoke a compromised trust root
curl -XPOST $BOUNDARY/v1/execution-control/admin/revoke \
  -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"kind":"envelope","id":"ae-drone-survey-001","reason":"compromised"}'
```

`admin/kill` requires `--kill-switch` to be configured; `admin/revoke` requires
`--revocations`. Both are recorded as `operator_action` events in the structured
log and forwarded to the audit sink, attributed to the calling identity.

## Attribution in the ledger

Every decision GEL record carries an `actor`:

```json
"actor": { "subject": "alice@corp", "role": "operator", "auth": "oidc",
           "issuer": "https://idp.corp/", "key_id": "2026-key-a" }
```

`actor` is part of the **signed, hash-chained** material, so altering who-did-what
breaks GEL verification (`audit/verify`) and any exported Evidence Bundle. Records
written without an authenticated operator (open mode) simply omit `actor` and hash
identically to pre-RBAC records — existing ledgers remain valid.

## Operational guidance

- Prefer OIDC so operator identity ties to your IdP and SSO lifecycle.
- Keep a single static **admin** "break-glass" token in a secrets manager for when
  the IdP is unavailable.
- With `jwksUri`, OIDC signing-key rollover is automatic — the boundary picks up
  rotated keys on the next refresh (or immediately on first sight of a new `kid`),
  no reload required. With statically materialized `keys`, rollover is a config
  update + reload. Rotate static **tokens** on your own schedule either way.
- Run `aristotle preflight` — it reports the configured auth methods and warns when
  no admin credential exists (operator actions over HTTP would be refused).
