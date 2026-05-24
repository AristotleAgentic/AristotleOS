# AristotleOS — Security Audit Scope & Onboarding

This document onboards a third-party security auditor in minutes. Pair it with
[THREAT_MODEL.md](THREAT_MODEL.md), [../SECURITY.md](../SECURITY.md), and the
component inventory in [`../sbom.json`](../sbom.json).

## Target of evaluation
- **Artifact:** git tag `v0.1.0` on branch `ward-warrant-execution-control`.
- **Primary in scope:**
  - `shared/execution-control-runtime/` — the Ward/Warrant boundary, signing,
    ledger backends (file / SQLite / Postgres), proxy + credential broker, MCP,
    revocation, validation.
  - `apps/aristotle-cli/` — the `@aristotle/os-cli` CLI and its bundle.
- **Secondary:** `adapters/http-gateway/`, `services/*`, `apps/console-ui/`.
- **Out of scope:** third-party dependencies' internals (covered by SBOM/`pnpm audit`),
  the marketing site copy, and any non-AristotleOS infrastructure.

## Engagement priorities (highest first)
1. Cryptographic / protocol review — Ed25519 warrant signing & verification,
   canonical-action hashing, GEL hash-chain, evidence-bundle verification, key
   pinning, revocation.
2. Authorization-bypass review of the Commit Gate and the credential-brokering proxy.
3. Replay / idempotency (incl. multi-node via shared Postgres) and fail-closed behavior.
4. Supply-chain & deployment (deps, bundle, Docker, Kubernetes).

## Where the crypto lives
| Concern | File / symbol |
|---------|---------------|
| Sign / verify (Ed25519) | `shared/execution-control-runtime/src/signing.ts` |
| Canonicalization & hashing | `index.ts` → `stableStringify`, `sha256`, `canonicalizeAction` |
| Warrant issue / verify | `index.ts` → `issueWarrant`, `verifyWarrant` |
| Commit Gate decision | `index.ts` → `evaluateCommitGate`, `evaluateExecutionControl` |
| GEL append / verify | `index.ts` → `LedgerStore`, `verifyGelRecords` |
| Evidence bundles | `index.ts` → `exportEvidenceBundle`, `verifyEvidenceBundle` |
| Revocation | `revocation.ts` |
| Proxy / broker (SSRF, secrets) | `proxy.ts` |
| Postgres serialized append | `postgres-ledger.ts` |

## Build, run, test (Windows/macOS/Linux, Node ≥ 20; Node ≥ 22.5 for SQLite)
```bash
corepack pnpm install            # pnpm workspace; npm install will NOT work
corepack pnpm test               # full suite (governance, execution-control, cli, api, chain)
corepack pnpm audit --prod       # dependency CVEs (currently: none)
node apps/aristotle-cli/dist/index.js pilot   # self-check of the boundary
npm run bench:execution-control  # throughput numbers
npm run sbom                     # regenerate sbom.json
```
Reproduce a governed decision end-to-end:
```bash
node apps/aristotle-cli/dist/index.js init
node apps/aristotle-cli/dist/index.js keys generate
node apps/aristotle-cli/dist/index.js run -- node aristotle/agent.mjs
node apps/aristotle-cli/dist/index.js execution-control audit verify --ledger .aristotle/gel.jsonl
```

## Test coverage to build on
129 tests live in `shared/execution-control-runtime/src/index.test.ts` and
`apps/aristotle-cli/src/index.test.ts`, including forged/tampered signatures,
key pinning, replay, revocation, the SSRF guard, credential non-leakage, durable
SQLite, and serialized Postgres append (via PGlite).

## Deliverables requested
Findings with CVSS-style severity, remediation guidance, and a **retest pass**
after fixes. A publishable summary/attestation is welcome.

## Reporting
See the responsible-disclosure policy in [../SECURITY.md](../SECURITY.md) and
`/.well-known/security.txt`.
