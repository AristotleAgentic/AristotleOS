# Hardening increments and acceptance criteria

Baseline: `8380d27`, branch `harden/assurance-effects-20261006`. The original
dirty checkout is not the baseline; its generated-file edits and unrelated
untracked work remain untouched. No upstream publication is authorized.

## 1. Baseline and evidence quality

Capture test/build outputs and inventories before runtime changes. Distinguish
the constructed UAV demonstration from mesh runtime tests. Correct stale test,
nonce-store, auto-pull, and formal-model claims using source evidence. Retain
failures and missing prerequisites. Acceptance: reproducible manifest with logs
and hashes; no unsupported blanket pass or production-readiness statement.

## 2. HTTP effect boundary

Add explicit response/dispatch uncertainty without interpreting HTTP status as a
business-effect receipt. Add a durable SQLite operation/attempt store using the
existing GEL record/signature format, with consumption and event insertion in
one local transaction. Use `BEGIN IMMEDIATE`, unique Warrant/nonce identities,
and operation ownership in the same database. A stored in-flight attempt remains
non-redispatchable on restart. Reconciliation requires an independently pinned
observer signature and exact attempt/action/target/state bindings.

Limit the guarantee to participants sharing that SQLite database on one host.
This is not a distributed lock, active-active Postgres solution, or atomic commit
with an arbitrary downstream system. An operator must keep an attempt's database
with its authority boundary; restoring stale snapshots is outside this guarantee.
Do not add a remote reconciliation endpoint until operator authentication and
observer trust configuration are explicitly wired.

Acceptance: no emission on refusal or store failure; duplicate attempts blocked
across connections and restart, including fresh Warrants for an unresolved
operation; loss of response and body-read failures stay unknown; original Warrant
never reusable; valid/no-effect reconciliation enables only newly authorized
attempts; forged, stale, mismatched and competing observations rejected; signed
GEL verifies and detects tampering; baseline proxy behavior retained where safe.

## 3. Destination and admission controls

Refuse automatic redirects to destinations not present in the canonical action.
Match credential prefixes by URL origin and path boundary rather than raw string
prefix. Carry the server's budget, approval, runtime-state and degradation
controls into the proxy evaluation path instead of bypassing them.
Acceptance: attacker-controlled prefix lookalikes/redirect targets get no request
or credential; required approvals/budgets apply to proxy as to evaluation.
DNS rebinding and secure production egress remain separate deployment concerns.

## 4. Formal model and CI

Make the mesh model's quota property conditional on disconnected operation,
replace tautologies with trace properties, represent reconciliation explicitly,
and bound issuance to make model checking finite. Check exact configurations
with TLC where a Java runtime is available. Add an executable CI check and logs;
do not report local model-check success unless it ran. Scope claims to the model.

## Remaining program increments

Portable envelope conformance and decidable attenuation; complete mediation
inventory; crash/race hardening for other stores and budgets; global/disconnected
operation ownership semantics; protocol adapter integration; independently
anchored evidence; expanded adversarial benchmark; hardware validation; CLI and
release integration. These require their own regression evidence. Completing
the HTTP slice does not complete the full preservation and assurance program.
