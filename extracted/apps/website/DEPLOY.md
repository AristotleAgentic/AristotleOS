# Deploying aristotleagentic.com

This website is a portable, zero-dependency Node web app. Copy the entire
`extracted/apps/website/` folder and you have the site: pages, images, backend,
admin console, and smoke tests.

## What Must Travel

Keep this folder structure together:

```text
extracted/apps/website/
  index.html
  about/index.html
  research/index.html
  governance-thesis/index.html
  papers/gplane/index.html
  papers/files/*.pdf
  support/index.html
  training-hub/index.html
  montana-ai-x/index.html
  aristotleos/index.html
  assets/
  serve.mjs
  package.json
  Dockerfile
  .env.production.example
  BACKEND.md
  ASSETS.md
  scripts/site-audit.mjs
  scripts/smoke-test.mjs
  scripts/production-check.mjs
```

The visual system uses only local files in `assets/`. There are no external
image URLs, no build-only image cache dependencies, and no required frontend
framework.

Do not copy `.data/` to production unless you intentionally want to migrate
local inquiry data. `.data/` is runtime storage and is gitignored.

## Local Preview

```sh
cd extracted/apps/website
npm run preview -- 4187
```

Open:

- `http://127.0.0.1:4187/`
- `http://127.0.0.1:4187/research/`
- `http://127.0.0.1:4187/papers/gplane/`
- `http://127.0.0.1:4187/support/`
- `http://127.0.0.1:4187/training-hub/`
- `http://127.0.0.1:4187/montana-ai-x/`
- `http://127.0.0.1:4187/aristotleos/`
- `http://127.0.0.1:4187/healthz`

## Production Runtime

Use any host that can run Node:

- Fly.io
- Render
- Railway
- DigitalOcean App Platform
- a small VPS with systemd
- Docker on any ordinary server

Static-only hosting will render the pages, but the inquiry forms and admin
console require `serve.mjs` or an equivalent backend.

## Environment

Set these in production:

```sh
HOST=0.0.0.0
PORT=8080
PUBLIC_ORIGIN=https://aristotleagentic.com
ARISTOTLE_WEBSITE_DATA_DIR=/var/lib/aristotle-website
ARISTOTLE_ADMIN_TOKEN=<long-random-secret>
UI_PROTOTYPE_URL=<deployed-ui-prototype-url-or-github-folder>
TRUST_PROXY=1
STORE_RAW_IP=0
ADMIN_SESSION_HOURS=12
```

Use `TRUST_PROXY=1` only behind a trusted reverse proxy that sets
`X-Forwarded-For`. Keep `STORE_RAW_IP=0` unless a written operating policy
requires raw IP retention.

## Commands

```sh
npm run build
npm run preflight
npm run smoke
npm run start
```

Smoke test an already-running production or staging URL:

```sh
WEBSITE_BASE_URL=https://aristotleagentic.com \
ARISTOTLE_ADMIN_TOKEN=<admin-token> \
npm run smoke
```

## Routes

- `/` - Aristotle Agentic homepage
- `/about/` - institutional posture, leadership, and status
- `/research/` - research area with PDF papers, book manuscript, working-paper map, and applied research tracks
- `/papers/gplane/` - G-Plane publication page with download/open fallbacks
- `/governance-thesis/` - authority-before-consequence thesis
- `/support/` - partner and support page
- `/training-hub/` - workforce readiness and AI training
- `/montana-ai-x/` - Montana AI-X Initiative
- `/aristotleos/` - AristotleOS product subsite
- `/privacy/` - privacy, data handling, and sponsor independence
- `/github` - redirect to the AristotleOS GitHub repository
- `/ui-prototype/` - redirect to the configured AristotleOS UI prototype
- `/api/inquiries` - inquiry intake
- `/api/inquiries/summary` - token/session protected summary
- `/api/inquiries.csv` - token/session protected CSV export
- `/admin/` - admin console
- `/healthz` - health check
- `/readyz` - readiness check with writable storage verification
- `/robots.txt`
- `/sitemap.xml`
- `/.well-known/security.txt`

## DNS And TLS

Point `aristotleagentic.com` and `www.aristotleagentic.com` at the production
host. Put TLS in front of the Node app. If using Cloudflare, keep proxying on
and set `PUBLIC_ORIGIN=https://aristotleagentic.com`.

## Inquiry Storage

By default the backend writes JSONL inquiries to:

```text
extracted/apps/website/.data/inquiries.jsonl
```

In production, set `ARISTOTLE_WEBSITE_DATA_DIR` to durable disk or mounted
storage. Back this directory up. The admin CSV export reads from the same log.

## Pre-Launch Checklist

- `npm run build` passes.
- `npm run build` reports `site audit passed`.
- `npm run smoke` passes against production.
- `PUBLIC_ORIGIN` matches the final HTTPS origin.
- `ARISTOTLE_ADMIN_TOKEN` is long, random, and stored as a secret.
- `ARISTOTLE_WEBSITE_DATA_DIR` points to durable storage.
- `npm run preflight` passes with production environment variables.
- `/assets/*` files are present on the deployed host.
- `/papers/files/*.pdf` files are present on the deployed host.
- `/about/`, `/research/`, `/papers/gplane/`, `/support/`, `/governance-thesis/`, `/training-hub/`, `/montana-ai-x/`, and `/aristotleos/` render.
- `/privacy/` renders and `/github` redirects to the AristotleOS GitHub repo.
- `/ui-prototype/` redirects to the deployed UI prototype or repo folder.
- Contact forms submit and redirect to `/thank-you/`.
- `/admin/` requires login and CSV export works.
- `/serve.mjs`, `/package.json`, `/scripts/smoke-test.mjs`, markdown docs,
  logs, sourcemaps, dotfiles, and backup/config extensions are not publicly
  served.
- Form and admin POSTs reject missing or cross-origin origin evidence.
- `/.well-known/security.txt` resolves with a security contact and privacy
  policy pointer.
- `/readyz` returns `200` and reports writable storage.
- Privacy, sponsor, donor, and retention language have been reviewed before
  public launch.

## Updating After Launch

Edit files, run checks, commit, and deploy:

```sh
npm run build
npm run smoke
git add .
git commit -m "update website"
git push
```

Your host should redeploy from git, or you can copy the full
`extracted/apps/website/` folder to the server again.
