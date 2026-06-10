# Aristotle Agentic Website Backend

The website is now a zero-dependency Node web app. It still serves static HTML
for `/`, `/training-hub/`, `/montana-ai-x/`, and `/aristotleos/`, but it also
has a small backend for production basics.

The server is hardened for a portable launch: public routes are allowlisted,
source files and private implementation artifacts are blocked, POST requests
require same-origin evidence, and admin exports remain hidden unless a token or
valid admin session is present.

## Runtime

```sh
cd extracted/apps/website
npm run preview
```

Environment:

```sh
HOST=0.0.0.0
PORT=8080
PUBLIC_ORIGIN=https://www.aristotleagentic.com
ARISTOTLE_WEBSITE_DATA_DIR=/var/lib/aristotle-website
ARISTOTLE_ADMIN_TOKEN=replace-with-long-random-secret
UI_PROTOTYPE_URL=https://github.com/AristotleAgentic/AristotleOS/tree/main/extracted/apps/console-ui
TRUST_PROXY=1
STORE_RAW_IP=0
REQUIRE_PRODUCTION_CONFIG=1
```

Optional GoDaddy / Microsoft 365-hosted email notifications:

```sh
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=0
SMTP_STARTTLS=1
SMTP_USER=jdpepper@aristotleagentic.com
SMTP_PASS=<mailbox-password-or-app-password>
CONTACT_FROM=jdpepper@aristotleagentic.com
CONTACT_TO=jdpepper@aristotleagentic.com
```

Use `TRUST_PROXY=1` only when the app is behind a trusted reverse proxy that
sets `X-Forwarded-For`. Otherwise the server uses the direct socket address for
rate limiting. By default, accepted inquiries store an IP hash instead of the
raw IP address. Set `STORE_RAW_IP=1` only if operational policy requires it.

## Routes

- `GET /` - Aristotle Agentic homepage
- `GET /about/` - institutional posture, leadership, and status
- `GET /research/` - research area with PDF papers, book manuscript, working-paper map, and applied research tracks
- `GET /papers/gplane/` - G-Plane publication page with download/open fallbacks
- `GET /governance-thesis/` - authority-before-consequence thesis
- `GET /support/` - partner and support page
- `GET /training-hub/` - Training Hub workforce readiness subsite
- `GET /montana-ai-x/` - Montana AI-X Initiative subsite
- `GET /aristotleos/` - AristotleOS subsite
- `GET /privacy/` - privacy, data handling, and sponsor independence
- `GET /papers/files/*.pdf` - public PDF research downloads linked from `/research/`
- `GET /github` - redirect to the AristotleOS GitHub repository
- `GET /ui-prototype/` - redirect to the configured AristotleOS UI prototype
- `GET /healthz` - health check
- `GET /readyz` - readiness check including writable inquiry storage
- `POST /api/inquiries` - inquiry intake
- `GET /api/inquiries?limit=100` - token-protected inquiry export
- `GET /api/inquiries/summary` - token-protected inquiry summary
- `GET /api/inquiries.csv` - token-protected CSV export
- `GET /admin/` - token-protected admin console
- `POST /admin/login` - admin session login
- `POST /admin/logout` - admin session logout
- `GET /thank-you/?type=...` - form success page
- `GET /robots.txt` - crawl policy
- `GET /sitemap.xml` - sitemap
- `GET /.well-known/security.txt` and `/security.txt` - security contact and policy pointer

## Inquiry Intake

Forms post to `/api/inquiries` with ordinary HTML form encoding. The backend:

- validates name, email, and message
- restricts inquiry types to known site areas
- rejects a hidden honeypot field
- rejects unsupported content types
- rejects posts without same-origin `Origin` or `Referer` evidence
- rate-limits by client IP
- caps request bodies at 64 KB
- writes accepted submissions to JSONL

Default storage:

```text
extracted/apps/website/.data/inquiries.jsonl
```

Set `ARISTOTLE_WEBSITE_DATA_DIR` in production so submissions survive deploys.
The durable inquiry log remains the system of record. SMTP email is a
notification layer; if the mail server is unavailable, the inquiry is still
stored for admin review and CSV export.

Export requires `ARISTOTLE_ADMIN_TOKEN` and returns JSON:

```sh
curl -H "Authorization: Bearer $ARISTOTLE_ADMIN_TOKEN" \
  "https://aristotleagentic.com/api/inquiries?limit=100"
```

The admin console is available at `/admin/` when `ARISTOTLE_ADMIN_TOKEN` is
configured. It uses an HTTP-only same-site session cookie after token login and
provides:

- recent inquiry table
- counts by site and topic
- summary JSON link
- CSV export link

## Security Headers

The server sets:

- Content Security Policy
- Strict Transport Security when `PUBLIC_ORIGIN` is HTTPS
- frame denial
- content-type sniffing protection
- referrer policy
- permissions policy
- cross-origin isolation-adjacent headers
- cross-domain policy denial

Static serving is allowlisted to public page and asset types. Server source,
package metadata, scripts, markdown docs, logs, sourcemaps, backup/config
extensions, dotfiles, and runtime storage are not public web assets.

The site renders without client-side JavaScript. Forms work through normal HTTP
POSTs.

## Verification

Syntax check:

```sh
npm run build
```

`npm run build` also runs `scripts/site-audit.mjs`, which checks public HTML for
broken internal links, missing local assets, missing required metadata, unsafe
public file references, local machine paths, placeholder text, and unreferenced
PDF publications.

Production preflight:

```sh
PUBLIC_ORIGIN=https://www.aristotleagentic.com \
ARISTOTLE_ADMIN_TOKEN=<long-random-secret> \
ARISTOTLE_WEBSITE_DATA_DIR=/var/lib/aristotle-website \
UI_PROTOTYPE_URL=<deployed-ui-prototype-url> \
TRUST_PROXY=1 \
npm run preflight
```

Smoke test against a running server:

```sh
npm run preview
WEBSITE_BASE_URL=http://127.0.0.1:4187 npm run smoke
```

The smoke test checks homepage, Training Hub, Montana AI-X, AristotleOS,
security headers, health/readiness, robots/sitemap/security.txt, dotfile blocking,
private source-file blocking, HEAD behavior, invalid content-type rejection,
missing-origin rejection, and cross-origin inquiry rejection. It also submits a
valid test inquiry to an isolated temporary data directory and verifies
token-protected JSON export, admin login, dashboard rendering, summary JSON,
CSV export, and logout.

## Production Hardening Still Needed

Before public launch, choose and configure:

- durable database or object storage for inquiries
- email notification provider
- privacy policy and retention schedule
- admin/export workflow owner and access rotation
- audit logging for admin access
- CAPTCHA or managed bot protection if spam appears
- platform deployment target such as Fly.io, Render, Railway, a VPS, or
  Cloudflare Workers/Pages Functions
- DNS, TLS, reverse proxy, backups, and log retention
- legal review for privacy, donor/sponsor disclosure, and nonprofit language

The current backend is intentionally small and auditable. It is enough to make
the site functional and collect real inquiries, but it is not yet a CRM.

## Container Deployment

The included `Dockerfile` runs the site as a non-root user, stores inquiries in
`/data`, exposes port 8080, and uses `/readyz` as the container healthcheck.

Example:

```sh
docker build -t aristotle-website .
docker run --rm -p 8080:8080 \
  -e PUBLIC_ORIGIN=https://www.aristotleagentic.com \
  -e ARISTOTLE_ADMIN_TOKEN=<long-random-secret> \
  -e UI_PROTOTYPE_URL=<deployed-ui-prototype-url> \
  -e REQUIRE_PRODUCTION_CONFIG=1 \
  -v aristotle-website-data:/data \
  aristotle-website
```
