# ADR-0020 — Reviewer ships as a separate package

**Status:** Accepted

## Context

The substrate's reviewer flow proves three things to a third party
who doesn't trust the operator's word:

1. A signed evidence bundle verifies (re-run the gate, check the
   Warrant, check the chain).
2. A signed Warrant verifies against a trusted key.
3. A published replay artifact reproduces the original scenario.

The reference implementation is `examples/reviewer/verify.ts` +
`pnpm reviewer:verify`. That works for anyone who clones the repo.
For anyone who doesn't, the friction is real.

## Decision

Ship a separate package: `@aristotle/reviewer`.

- Installable via `npx @aristotle/reviewer verify <bundle.json>`.
  Zero install, zero clone. Reviewers verify a decision from a
  bundle their counterparty hands them.
- Bundled with esbuild into a single executable file (mirroring
  `apps/aristotle-cli/build.mjs`). Single `dist/index.js` with
  shebang + npm `bin` entry.
- Three subcommands matching the three reviewer flows:
  `verify`, `verify-warrant`, `verify-replay`. Plus `help` and
  `--version`.
- Depends on `@aristotle/execution-control-runtime` (for
  `verifyEvidenceBundle`), `@aristotle/warrant-verifier` (for
  `verifyWarrantPublic`), `@aristotle/replay-artifact` (for replay
  hash + signature verification).

The in-repo `pnpm reviewer:verify` flow still works (it's the
fuller 18-check headline that runs as the substrate's gate of
trust). The CLI package is a slim subset focused on what an
external reviewer does — verify ONE artifact someone handed them.

## Alternatives considered

- **Bundle reviewer into `@aristotle/os-cli`.** Rejected. The
  os-cli is a maintainer / operator tool with broad subcommand
  surface (execution-control, ward-marshal, etc.) and a 700 KB
  bundle. A reviewer doesn't need any of that; the smaller package
  is npx-friendly without forcing the reviewer to pull down the
  full toolchain.
- **Ship reviewer as a webpage / hosted endpoint.** Rejected. A
  hosted endpoint introduces the substrate maintainer as a trust
  party in the verification chain — exactly what the reviewer
  flow is supposed to NOT need. The CLI runs locally on the
  reviewer's machine with the substrate's published code; the
  trust chain is them, the npm registry's signature on the
  published artifact, and the reviewer's own Node runtime.
- **Don't ship a separate package — point reviewers at
  `examples/reviewer/verify.ts`.** Rejected. The reference path
  requires cloning the repo + installing the workspace + running
  pnpm. The CLI removes every step except `npx`.
- **Reviewer-only Docker image.** Considered. A Docker image is
  another deployment shape and adds Docker as a reviewer
  dependency. npx is the lowest common reviewer-side dependency
  (anyone with Node 18+).

## Consequences

- Reviewers verify in seconds: `npx @aristotle/reviewer verify
  bundle.json`. Exit 0 / non-zero is machine-checkable; the printed
  output is human-readable.
- The CLI's behavior is locked by its tests (verify-on-good +
  verify-on-tampered + version + help). A breaking change to the
  underlying primitives surfaces as a CLI test failure.
- Publishing discipline: the package's `bin` entry is the bundled
  output; consumers don't run TypeScript source. The build runs at
  `prepublishOnly` time so the published tarball always has fresh
  bundled output.
- Sigstore-signed releases (CI workflow `.github/workflows/
  release.yml`) include the reviewer CLI tarball — reviewers can
  verify provenance of the CLI binary itself against the
  substrate's release signing key before trusting its output.
- Future extension: the CLI is the natural home for additional
  reviewer-side primitives (verify a Sigstore-anchored bundle,
  verify a TSA-anchored bundle, etc.) — each adds a subcommand,
  not a new package.

## See also

- `packages/reviewer/` — the package
- `packages/reviewer/README.md` — usage guide
- `examples/reviewer/verify.ts` + `REVIEWER.md` — the fuller
  in-repo headline check
- ADR-0009 (evidence bundle format) — the artifact the CLI verifies
- ADR-0012 (replay artifact format) — the third subcommand
- ADR-0015 (one-package-per-concept) — reviewer's separation
  follows the same principle
