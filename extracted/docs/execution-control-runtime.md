# Ward/Warrant Execution-Control Path

This AristotleOS component is independently developed. It may discuss Faramesh as a public example of the broader runtime authorization and execution-control category, but it does not copy Faramesh source code, documentation, examples, schemas, tests, comments, file names, repository structure, policy syntax, branding, or expressive material. AristotleOS is not affiliated with, certified by, sponsored by, or endorsed by Faramesh.

The AristotleOS doctrine remains unchanged:

> Governance must bind at the execution boundary before irreversible state mutation or external action occurs.

## Quickstart

```bash
npx @aristotle/os-cli pilot          # self-check the whole boundary
aristotle init                       # scaffold a governed project
aristotle keys generate              # durable Ed25519 signing key
aristotle run -- node aristotle/agent.mjs   # run an agent behind the boundary
aristotle playground                 # no-install browser playground
```

See [getting-started.md](getting-started.md) for the full path.

## What It Does

This runtime path takes a proposed governed action, canonicalizes it into deterministic JSON, evaluates it through the Commit Gate, issues a single-use Warrant only on `ALLOW`, and appends a hash-linked Governance Evidence Ledger record for every decision.

The module uses AristotleOS-native names, schemas, examples, and tests:

- Ward Manifest establishes the protected domain and sovereignty context.
- Authority Envelope establishes scoped delegated authority inside the Ward.
- Canonical Governed Action gives the Commit Gate stable decision material.
- Commit Gate returns `ALLOW`, `ESCALATE`, or `REFUSE` with reason codes.
- Warrant proves admissibility at the moment of consequence. Warrants are signed with a real **Ed25519** key (not a recomputable hash), carry their `key_id` and public key, and can be verified offline and pinned to a trusted key.
- GEL preserves the decision context as a tamper-evident execution lineage. Each record is hash-chained and Ed25519-signed.
- PIG blocks physical invariant violations before execution.

## Runtime Package

Implementation:

```text
shared/execution-control-runtime
```

Core exports:

- `canonicalizeAction`
- `evaluateCommitGate`
- `issueWarrant`
- `verifyWarrant`
- `consumeWarrant`
- `appendGelRecord`
- `verifyGelChain`
- `evaluatePhysicalInvariants`
- `evaluateExecutionControl`
- `createExecutionControlRuntimeServer`
- `submitGovernedAction`
- `exportEvidenceBundle`
- `verifyEvidenceBundle`
- `createEd25519Signer` / `loadWarrantSignerFromEnv` / `verifyEd25519`
- `CredentialBroker` / `proxyGovernedAction`
- `createExecutionControlMcpServer`
- `loadRevocationList` / `addRevocation` / `revocationReason`
- `LedgerStore` / `LedgerBackend` / `FileLedgerBackend` / `InMemoryLedgerBackend` / `SqliteLedgerBackend`
- `AsyncLedgerStore` / `AsyncLedgerBackend` / `PostgresLedgerBackend` / `evaluateExecutionControlAsync`
- `SubjectRateLimiter`

## Demo

Run the vertical slice:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/execution_control/ward.montana_drone_test_range.yaml \
  --envelope examples/execution_control/authority_envelope.survey_planner.yaml \
  --action examples/execution_control/actions/allow_takeoff.json \
  --ledger ./.tmp/gel.jsonl \
  --evidence-out ./.tmp/evidence-bundle.json \
  --now 2026-05-21T14:00:00.000Z
```

Expected shape:

```text
decision=ALLOW
reason_codes=ALLOWED
canonical_action_hash=<sha256>
warrant_id=wrn-...
gel_record_hash=<sha256>
ledger_verification=ok
evidence_bundle=./.tmp/evidence-bundle.json
```

## Evidence Bundle

The runtime can export an offline Evidence Bundle for an admitted action. The bundle contains the Ward Manifest, Authority Envelope, selected GEL record, full GEL chain, Warrant material when available, stable hashes, and a verification result. This gives operators a portable proof that can be inspected without trusting the live runtime process.

Create and verify a bundle:

```bash
npm run execution-control:evidence:demo
npm run execution-control:evidence:verify
```

Direct CLI:

```bash
npm run aristotle -- execution-control evidence verify \
  --bundle ./.tmp/evidence-bundle.json
```

Verification checks:

- GEL chain linkage and record hashes
- selected record inclusion in the bundled chain
- Ward Manifest hash and Ward-to-record match
- Authority Envelope hash and envelope-to-record match
- Warrant signature, action hash binding, and Warrant id match
- Evidence Bundle hash

## Runtime Daemon

Run the local AristotleOS execution boundary:

```bash
npm run execution-control:dev
```

The daemon listens on `http://127.0.0.1:8181` and exposes:

- `GET /health`
- `POST /v1/execution-control/evaluate`
- `GET /v1/execution-control/audit/tail`
- `GET /v1/execution-control/audit/verify`
- `POST /v1/execution-control/governance/compile` — validate + hash a Ward+Authority draft into a content-addressed governance manifest
- `POST /v1/execution-control/governance/diff` — diff two drafts, flagging authority-**weakening** changes (`summary.requires_review`)
- `POST /v1/execution-control/governance/explain` — run `sample_actions` through the real Commit Gate and return allow/refuse/escalate per action
- `GET /openapi.json`

The three `governance/*` routes are the Visual Governance Builder backend (`builder.ts`).
They are pure analysis — **no ledger mutation** — and are role-gated to `operator`.
Body: `{ ward?, authority_envelope? }` (defaults to the server's configured artifacts),
plus `{ before, after }` for diff and `{ sample_actions }` for explain.

Submit an action from another terminal:

```bash
npm run execution-control:submit:allow
```

`execution-control:submit:allow` requires a verified Warrant before treating the action as executable.

Or call it directly:

```bash
curl -s http://127.0.0.1:8181/v1/execution-control/evaluate \
  -H "content-type: application/json" \
  --data-binary @examples/execution_control/actions/allow_takeoff.json
```

Verify the GEL chain:

```bash
npm run execution-control:audit:verify
```

This is the "runs alongside your agent" path: agent runtimes call the local AristotleOS boundary before invoking a consequential tool, then require the Warrant id when `decision=ALLOW`.

Programmatic client helpers are exported from `@aristotle/execution-control-runtime`:

- `submitGovernedAction`
- `requireAllowedWarrant`
- `executionControlOpenApiSpec`

See:

```text
examples/execution_control/agent_runtime_wrapper.ts
```

Refusal example:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/execution_control/ward.montana_drone_test_range.yaml \
  --envelope examples/execution_control/authority_envelope.survey_planner.yaml \
  --action examples/execution_control/actions/refuse_leave_boundary.json \
  --ledger ./.tmp/gel.jsonl
```

Escalation example:

```bash
npm run aristotle -- execution-control evaluate \
  --ward examples/execution_control/ward.montana_drone_test_range.yaml \
  --envelope examples/execution_control/authority_envelope.survey_planner.yaml \
  --action examples/execution_control/actions/escalate_missing_runtime_state.json \
  --ledger ./.tmp/gel.jsonl
```

## Tests

```bash
npm run test:execution-control
npm test
```

The execution-control tests prove:

- canonical action hash stability across equivalent key orderings
- allowed action produces `ALLOW`
- denied action produces `REFUSE`
- expired Authority Envelope produces `REFUSE`
- missing runtime state produces `ESCALATE`
- physical invariant violation produces `REFUSE`
- `ALLOW` issues a Warrant
- `REFUSE` does not issue a Warrant
- Warrant cannot be consumed twice
- Warrant verification fails for mismatched action hash
- GEL verifies after normal append
- GEL verification fails after tampering
- Evidence Bundle exports Ward, Authority Envelope, Warrant, and GEL
- Evidence Bundle verification fails after selected record tampering
- Warrant carries a real Ed25519 signature (not a recomputable hash)
- forged or tampered Warrant signatures fail verification
- Warrant verification can pin a trusted signing key id
- GEL records are Ed25519-signed and verification fails on signature tampering
- Evidence Bundle carries a verifiable bundle-level signature
- credential broker injects only matched secrets and never leaks values
- proxy forwards an approved action with brokered credentials and refuses denied actions
- kill switch refuses every action while engaged (and audits the attempt)
- replay protection refuses an identical previously-admitted action
- server enforces an API key on `/v1` routes, leaves `/health` open, and serves metrics
- the gate refuses a revoked Authority Envelope (`AUTHORITY_REVOKED`)
- `verifyWarrant` rejects a Warrant signed by a revoked key (`REVOKED`)
- Evidence Bundle verification fails against a revocation list

## Real signing and keys

Warrants, GEL records, and Evidence Bundles are signed with Ed25519. Generate a
durable keypair and point the runtime at it:

```bash
aristotle keys generate
export ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH=secrets/warrant-ed25519-private.pem
export ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH=secrets/warrant-ed25519-public.pem
```

Without a configured key, a process-stable **ephemeral dev key** signs Warrants.
It is genuinely Ed25519-signed (unforgeable without the in-process key) but is
discarded on exit and **refused under `NODE_ENV=production`**. Verifiers can pin a
trusted `key_id` via `trustedKeyIds`.

## Run an agent behind the boundary

```bash
aristotle run -- <your agent command>
```

`run` auto-discovers the Ward/Envelope (flags, `aristotle.json`, or conventional
paths), boots the boundary on a local port, injects `ARISTOTLE_ENDPOINT`, and
runs your agent as a governed child process, tearing the boundary down when the
agent exits.

## Credential brokering and the action proxy

The boundary can hold downstream secrets so the agent never sees them. Define
broker rules (`aristotle.broker.json`, or the `broker` field of `aristotle.json`):

```json
{ "rules": [
  { "action_type": "http.post", "target_prefix": "https://api.stripe.com",
    "header": "Authorization", "value_env": "STRIPE_API_KEY", "scheme": "Bearer" }
] }
```

Agents POST actions to `/v1/execution-control/proxy`. On `ALLOW` (with a verified
Warrant) the broker injects the credential and the proxy forwards the call,
returning the downstream response. The raw secret is never returned and never
written to the ledger.

### Short-lived credential minting

Beyond brokering static secrets, AristotleOS can **mint** a short-lived, scoped,
Warrant-bound credential at the call site, so an agent never holds a long-lived
secret and a leaked token expires on its own:

```ts
const minter = createHmacCredentialMinter({ secret: process.env.MINT_SECRET! });
// only after the gate returns ALLOW and the Warrant verifies:
const cred = minter.mint({ subject, scope: ["warehouse:read"], audience: "warehouse", ttlSeconds: 300, warrantId });
// the audience verifies it offline — signature, expiry, audience, and revocation:
const check = verifyMintedCredential(cred.token, { secret, audience: "warehouse", revocations });
```

Verification checks the signature, expiry, audience, **and the Ward Marshal
credential-revocation list** — so a credential revoked during interdiction stops
verifying immediately. Two built-in minters:

- **`createEd25519CredentialMinter(signer)`** — **non-repudiable**, offline-verifiable
  with only the public key (`verifyEd25519MintedCredential`); preferred across trust
  domains. Reuses any `AristotleSigner` (file/env/managed store/HSM-backed).
- **`createHmacCredentialMinter({ secret })`** — symmetric, verifier must hold the
  same secret (`verifyMintedCredential`); fine within a single trust domain / dev.

Implement `CredentialMinter` with an injected client for cloud STS / Vault dynamic
secrets (no SDK dependency).

## MCP server

```bash
aristotle mcp
```

Serves the boundary to MCP-capable agent runtimes over stdio (newline-delimited
JSON-RPC, no external SDK). Tools: `aristotle_evaluate_action`,
`aristotle_proxy_action`, `aristotle_audit_verify`.

## Playground

```bash
aristotle playground   # http://127.0.0.1:4178
```

A no-install browser page, served by the live boundary, for editing a Canonical
Governed Action and watching the decision, Warrant, and GEL record in real time.

## One-command pilot

```bash
aristotle pilot
```

A dependency-free self-check of the full boundary (ALLOW / REFUSE / ESCALATE,
signed Warrant, key pinning, Evidence Bundle, GEL chain). Prints a PASS/FAIL
report and exits non-zero on any failure.

## Production hardening

- **Kill switch (sovereign halt)** — `aristotle kill engage` / `release`. While
  engaged, the gate refuses every action with `KILL_SWITCH_ENGAGED`; the attempt
  is still recorded in the ledger. The runtime checks a sentinel file
  (`killSwitchPath`, default `.aristotle/KILL_SWITCH`) on every request, so an
  operator can halt a running boundary without restarting it.
- **Replay protection** — an identical, previously-admitted Canonical Governed
  Action is refused with `REPLAY_DETECTED`, enforcing the single-use guarantee at
  the boundary. On by default; disable with `--no-replay-protection`.
- **Revocation** — `aristotle revoke key|envelope|warrant <id>` writes a
  file-backed revocation list the boundary re-reads per request. A revoked signing
  key or Authority Envelope is refused at the gate (`AUTHORITY_REVOKED`); a Warrant
  or Evidence Bundle bound to a revoked key/envelope/warrant fails verification
  (`REVOKED`). Verify offline against a list with
  `aristotle execution-control evidence verify --bundle b.json --revocations r.json`.
- **Operator access control (RBAC)** — authenticate `/v1` with a single
  `--api-key` (admin), role-scoped `--operator role:token[:subject]` tokens, or
  `--oidc-config` (OIDC bearer/JWT). Roles `viewer < operator < admin` are enforced
  per route (`401` unauthenticated, `403` under-privileged). The authenticated
  identity (incl. OIDC `sub`) is written into the signed GEL as the record `actor`.
  `/health`, `/openapi.json`, and Prometheus `/metrics` stay open for probes.
  Admin-only operator actions: `POST /v1/execution-control/admin/{kill,revoke}`.
  See [ACCESS_CONTROL.md](ACCESS_CONTROL.md).
- **Request limits** — request bodies over 1 MB are rejected with `413`.
- **Metrics** — `GET /v1/execution-control/metrics` returns decision counts, a
  reason-code histogram, ledger size, signing key id, kill-switch state, and
  ledger integrity.

## Ledger performance

The boundary keeps an in-memory ledger index (`LedgerStore`) for the lifetime of
the running server: it holds the chain tip, the record count, and the set of
admitted canonical-action hashes. This makes both **append** and **replay
detection O(1)** on the hot path instead of rescanning the JSONL on every
request. The JSONL file remains the source of truth; the index is rebuilt from it
at startup (and full `verifyGelChain` is still available on demand via
`/v1/execution-control/audit/verify`). One-shot CLI evaluations use the stateless
file functions, so behavior is identical with or without the index.

The index sits behind a `LedgerBackend` interface. Three backends ship in-box:
`FileLedgerBackend` (JSONL, default), `InMemoryLedgerBackend` (ephemeral), and
`SqliteLedgerBackend` — an ACID, indexed, restart-durable store built on Node's
built-in `node:sqlite` (no extra dependency, no native build). Replay lookups use
a SQL index (bounded memory) and records survive restarts. Enable it with
`aristotle run --ledger-backend sqlite`.

For **multi-node high availability**, `PostgresLedgerBackend` (async) keeps replay
state in a shared database, so multiple boundary instances refuse replays
consistently. Enable with `--ledger-backend postgres --postgres-url <conn>` (the
`pg` driver is lazy-loaded; `npm install pg`). It implements an `AsyncLedgerBackend`
and runs through `evaluateExecutionControlAsync` — purely additive to the sync
path. Appends are **serialized via an advisory-locked transaction**
(`appendChained`), so the hash chain stays correct under active-active
multi-writer deployment. (Tested against real PostgreSQL via PGlite, including the
serialized append path.)

Two more operational controls for production:

- **Rate limiting** — `--rate-limit <perMinute>` enforces a per-subject token
  bucket; requests over budget receive `429`.
- **Structured logging** — `--log-format json` emits one JSON decision line per
  request (request id, decision, reason codes, signing key id, latency) to stderr.
- **Audit sink** — `--audit-sink <url>` forwards each decision's signed GEL record
  to a SIEM / log pipeline, best-effort and off the hot path (`deliverAuditEvent`).
- **Prometheus** — `GET /metrics` returns decision counters, ledger size, and
  integrity in Prometheus exposition format.
- **Graceful shutdown** — `serve` closes the server and ledger on SIGTERM/SIGINT.
- **Kubernetes** — `manifests/k8s/execution-control.yaml` deploys the boundary
  (Deployment + Service + ConfigMap + PVC, non-root restricted securityContext,
  durable SQLite ledger, probes on `/health`).
