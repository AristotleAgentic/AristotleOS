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

`oidc.json`:

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

The boundary verifies the compact JWS, then maps the token to a role:

- The token `sub` becomes the operator identity (written to the GEL).
- The `rolesClaim` value(s) are mapped via `roleMap`; values that are already
  `viewer`/`operator`/`admin` map directly. The highest matched role wins.
- If nothing maps and `defaultRole` is unset, the verified identity is **forbidden**
  (`403`) — a valid SSO token alone does not grant access.

Each key may carry `publicKeyPem` inline or a `publicKeyFile` path (resolved
relative to the working directory). Env: `ARISTOTLE_OIDC_CONFIG=<path>`.

#### OIDC hardening

- **Asymmetric only.** Allowed algs: `RS256/384/512`, `ES256/384/512`, `EdDSA`.
  `alg:none` and all HMAC algs are rejected — there is no symmetric verification
  path, so there is no `alg:none` or alg-confusion vector.
- The configured key's type must match the token's `alg`.
- `kid` is required when more than one key is configured.
- `iss` must match; `aud` is enforced when configured; `exp`/`nbf` are checked with
  `clockSkewSec` tolerance.

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
- Rotate static tokens and OIDC signing keys on your own schedule; OIDC keys are
  configured statically, so key rollover is a config update + reload.
- Run `aristotle preflight` — it reports the configured auth methods and warns when
  no admin credential exists (operator actions over HTTP would be refused).
