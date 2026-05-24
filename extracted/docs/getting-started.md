# Getting started with AristotleOS

AristotleOS puts a **governed execution-control boundary** in front of your AI
agents. Before an agent does anything consequential, it asks the boundary. The
boundary returns one of three answers — `ALLOW`, `REFUSE`, `ESCALATE` — and on
`ALLOW` it issues a single-use, **Ed25519-signed Warrant** and records the
decision in a tamper-evident **Governance Evidence Ledger** (GEL).

This page gets you from zero to a governed agent in about five minutes.

---

## 1. Install

```bash
npm install -g @aristotle/os-cli
# or run without installing:
npx @aristotle/os-cli pilot
```

`aristotle pilot` runs a complete self-check (ALLOW, REFUSE, ESCALATE, signed
Warrant, evidence bundle, ledger chain) and prints a PASS/FAIL report. If it says
`PILOT READY`, your install works.

## 2. Scaffold a project

```bash
aristotle init
```

This writes:

| File | Purpose |
|------|---------|
| `aristotle/ward.yaml` | the protected domain (**Ward Manifest**) |
| `aristotle/authority-envelope.yaml` | scoped delegated authority (**Authority Envelope**) |
| `aristotle/agent.mjs` | a sample governed agent |
| `aristotle.json` | run configuration |

## 3. Generate a durable signing key (recommended)

```bash
aristotle keys generate
export ARISTOTLE_WARRANT_SIGNING_PRIVATE_KEY_PATH=secrets/warrant-ed25519-private.pem
export ARISTOTLE_WARRANT_SIGNING_PUBLIC_KEY_PATH=secrets/warrant-ed25519-public.pem
```

Without this, a process-stable **ephemeral dev key** signs Warrants (fine for
local development; refused under `NODE_ENV=production`).

## 4. Run an agent behind the boundary

```bash
aristotle run -- node aristotle/agent.mjs
```

`aristotle run` boots the boundary on a local port, injects `ARISTOTLE_ENDPOINT`
into your agent's environment, and runs your agent as a governed child process.
The sample agent asks the boundary before acting and only proceeds with a
verified Warrant.

## 5. Audit

```bash
aristotle execution-control audit verify --ledger .aristotle/gel.jsonl
```

---

## Beyond the basics

### Brokered credentials (the agent never holds secrets)

Define a broker rule so the boundary injects a downstream credential **only** for
approved actions. Add an `aristotle.broker.json`:

```json
{
  "rules": [
    { "action_type": "http.post", "target_prefix": "https://api.stripe.com",
      "header": "Authorization", "value_env": "STRIPE_API_KEY", "scheme": "Bearer" }
  ]
}
```

Then point your agent at the proxy route instead of calling the API directly:

```
POST http://127.0.0.1:<port>/v1/execution-control/proxy
```

The boundary evaluates the action, injects the credential at the moment of
forwarding, and returns the downstream response. The raw secret is never
returned to the agent and never written to the ledger.

### Model Context Protocol (MCP)

Expose the boundary to any MCP-capable agent runtime over stdio:

```bash
aristotle mcp
```

Tools: `aristotle_evaluate_action`, `aristotle_proxy_action`,
`aristotle_audit_verify`.

### No-install playground

```bash
aristotle playground
# open http://127.0.0.1:4178
```

Edit a Canonical Governed Action in the browser and watch the live Commit Gate
decision, signed Warrant, and GEL record. The page is served by the real
boundary — every decision is produced by the same code path as production.

### Production hardening

The boundary ships with enterprise safety controls:

```bash
# Check production readiness before deploying (signing key, auth, valid config)
aristotle preflight

# Sovereign halt — refuse every action until released
aristotle kill engage
aristotle kill release

# Revoke a compromised trust root (signing key, envelope, or a single warrant)
aristotle revoke key ed25519:abc123…
aristotle revoke envelope ae-prod-001
aristotle revoke warrant wrn-…
aristotle revoke list

# Require an API key on /v1 routes
ARISTOTLE_OPERATOR_API_KEY=... aristotle run -- <your agent command>
```

- **Kill switch** — while engaged, the Commit Gate refuses every action with
  `KILL_SWITCH_ENGAGED` (the attempt is still recorded in the ledger).
- **Replay protection** — an identical, previously-admitted action is refused with
  `REPLAY_DETECTED`, making the single-use guarantee real. On by default; disable
  with `--no-replay-protection`.
- **Revocation** — revoke a compromised signing key, a withdrawn Authority
  Envelope, or a single Warrant. The gate refuses to issue against a revoked
  key/envelope (`AUTHORITY_REVOKED`), and verifiers reject any Warrant or Evidence
  Bundle bound to a revoked id (`REVOKED`). File-backed, honored live.
- **API key** — when `ARISTOTLE_OPERATOR_API_KEY` (or `--api-key`) is set, `/v1`
  routes require `Authorization: Bearer <key>` or `x-api-key`. `/health` stays open.
- **Request limits** — request bodies over 1 MB are rejected (`413`).
- **Metrics** — `GET /v1/execution-control/metrics` reports decision counts, a
  reason-code histogram, ledger size, and integrity.
- **Config validation** — Ward Manifests and Authority Envelopes are validated on
  load; malformed config fails fast with a readable error.
- **Configurable warrant TTL** — `--warrant-ttl <seconds>` or
  `ARISTOTLE_WARRANT_TTL_SECONDS` (default 60).
- **Preflight** — `aristotle preflight` blocks deploys missing a durable signing
  key or other production essentials.
- **Rate limiting** — `--rate-limit <perMinute>` (or `ARISTOTLE_RATE_LIMIT_PER_MINUTE`)
  enforces a per-subject token bucket; over-budget requests get `429`.
- **Structured logging** — `--log-format json` emits a JSON decision line per
  request (request id, decision, reason codes, key id, latency) to stderr for SIEM/ops.
- **Durable ledger** — `--ledger-backend sqlite` gives an ACID, indexed,
  restart-durable ledger (Node's `node:sqlite`, no extra dependency). For
  **multi-node high availability**, `--ledger-backend postgres --postgres-url <conn>`
  (needs `npm install pg`) keeps **replay state shared across instances** via the
  database. The default file (JSONL) and in-memory backends also ship.
- **Audit sink (SIEM)** — `--audit-sink <url>` forwards each decision's signed GEL
  record to your SIEM / log pipeline (best-effort, off the hot path).
- **Prometheus** — `GET /metrics` exposes decision counters and ledger size in
  Prometheus exposition format for Grafana.
- **Graceful shutdown** — `serve` handles SIGTERM/SIGINT (clean container lifecycle).
- **Container & Kubernetes** — `manifests/docker/execution-control.Dockerfile`
  (non-root) and `manifests/k8s/execution-control.yaml` (Deployment, Service,
  ConfigMap, PVC, probes, restricted securityContext). See [SECURITY.md](../SECURITY.md)
  for the threat model and known limitations.

### Portable evidence

```bash
aristotle execution-control evidence export --ward ... --envelope ... \
  --ledger .aristotle/gel.jsonl --out evidence.json
aristotle execution-control evidence verify --bundle evidence.json
```

An Evidence Bundle contains the Ward, Authority Envelope, Warrant, full GEL
chain, and signatures. Anyone can verify it offline against the pinned public
key — no trust in the live runtime required.

---

## Mental model

| Primitive | What it is |
|-----------|------------|
| **Ward Manifest** | the protected domain and its sovereignty context |
| **Authority Envelope** | scoped, time-bounded delegated authority inside a Ward |
| **Canonical Governed Action** | a proposed action, canonicalized to a stable hash |
| **Commit Gate** | the decision point: `ALLOW` / `REFUSE` / `ESCALATE` |
| **Warrant** | single-use, signed proof of admissibility at the moment of consequence |
| **Governance Evidence Ledger** | hash-chained, signed record of every decision |
| **Physical Invariant Check** | hard interlocks (geofence, altitude, battery, …) |
