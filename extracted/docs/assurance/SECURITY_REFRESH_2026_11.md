# November 2026 security refresh

This release closes the November 2 review's dependency and console HTTP gaps.
It preserves the existing governance and physical-adapter behavior.

## Dependencies and monitoring

- Hono 4.13.16 fixes the November 1 middleware, form, CSRF and CSS advisories.
  A local regression exercises the formerly bypassed `/admin/*` middleware.
- Vite moves from 5.4.21 to 6.4.5 with the compatible React plugin 4.7.0.
  Developer and preview servers now default to IPv4 loopback.
- Shell-quote, PostCSS, browserslist, Babel, source-map-js and vulnerable
  esbuild versions are updated in the integrity-locked pnpm graph.
- CI and release auditing now include build/development dependencies. A daily
  GitHub Actions scan catches new advisories without waiting for a code push.
  Dependabot proposes weekly dependency and Actions updates; it does not merge them.
- The remaining low provider-utils 2.2.8 version flag is covered by the existing
  integrity-checked backport and bounded-response regression tests. No advisory
  exception or weaker failure threshold was added.

## Console HTTP contract

- Production refuses startup without `CONSOLE_ACCESS_TOKEN`.
- Login bodies are capped at 8 KiB; proxy requests at 1 MiB; session responses
  at 64 KiB; proxy responses at 8 MiB, including chunked/decompressed responses.
- Inbound body reads have a 10-second deadline. Session fetches have a 10-second
  deadline and proxy fetches a 30-second deadline. Upstream redirects are rejected.
- Login attempts share a per-process token bucket: burst 60, refill one/second.
  This does not trust forwarded IP headers or allocate attacker-controlled maps.
  A flood can temporarily rate-limit legitimate logins; this is not distributed
  identity-based throttling or a substitute for edge-level abuse controls.
- Limit errors return 413/408 and close the inbound connection. Oversized upstream
  responses return 502. Workflows exceeding these limits need a deliberately
  designed streaming/export route, not an unbounded buffer.
- Production cookies always carry Secure, HttpOnly and SameSite=Lax, including
  behind Render TLS termination. No broad proxy trust setting is introduced.
- CSP, HSTS (production), nosniff, frame denial and referrer protection are set.
  Client cookies/operator credentials and hop-by-hop headers are not forwarded;
  upstream responses cannot weaken these headers or set browser cookies.

## Validation

The regression suite covers the Hono bypass, existing dependency backports,
declared/chunked/stalled input, upstream overflow, limiter recovery, malformed
cookies, login success, Secure cookies, unauthenticated denial, credential
stripping, preserved response headers, and ordinary gateway proxying.
Desktop/mobile layout and clean-install CI must pass before promotion.

Node security baselines for October's fixes are 22.23.4 and 24.22.1. Update the
local runtime separately using the official signed installer. Package scans do
not inventory host OS or Node executables, and deployment success does not
establish flight clearance or universal exactly-once physical effects.
