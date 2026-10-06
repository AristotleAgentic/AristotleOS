# HTTP effect accounting v1

The HTTP proxy keeps admission separate from external outcome. Its existing
`decision`, `forwarded`, `response`, and admission `gel_record` fields remain.
New fields are `dispatch_status`, `effect_state`, and `effect_attempt`.
`forwarded` means a response was fully received; it never proves a business effect.

- `NOT_ATTEMPTED`: this invocation did not dispatch. A duplicate operation may
  still have an unknown effect from its earlier attempt.
- `ATTEMPTED_UNKNOWN`: transport/response processing failed after dispatch began.
- `RESPONSE_RECEIVED`: an HTTP response was received, including error/redirect
  responses. The business outcome still needs authoritative observation.

By default the proxy opens `ledgerPath + '.effects.sqlite'`. An explicitly
configured `SqliteEffectStore` can instead be shared by callers. The store uses
SQLite WAL, FULL synchronous durability and an immediate transaction to persist
Warrant/nonce consumption, operation ownership, and signed AUTHORIZED/IN_FLIGHT
events before dispatch. It never releases consumed Warrant/nonce identities.
Do not delete the sidecar when restarting or restoring the admission ledger.

The operation ID is `action.params.operation_id`, falling back to `action_id`.
It is scoped by Ward and subject and included in the admitted canonical action.
Clients must keep the same operation ID across retries. A new action ID, request
timestamp, or Warrant does not free an existing operation ID. Arbitrary different
IDs cannot be recognized as the same real-world business effect without a
domain-specific business identity policy.

Both a lost reply and a successful HTTP exchange move the attempt to
EFFECT_UNKNOWN. HTTP status alone cannot establish either effect or no effect.
If finalization fails or the process exits, the durable IN_FLIGHT attempt still
blocks dispatch. Opening another connection never resets it. Recovery must fence
the old dispatcher before treating it as no longer live; use `markUnknown` only
after that operational precondition is established. A delayed external commit
must still be excluded by settled observer evidence before confirming no effect.

## Reconciliation and verification

`SqliteEffectStore.reconcile` accepts an Ed25519-signed
`aristotle.effect-observation.v1` object. The operator supplies trusted observer
keys and allowed observation methods. The observation binds operation, attempt,
Warrant, envelope, canonical action hash, Ward, subject, exact target, state
fingerprint, observation time and external evidence hash. Confirmed outcomes
require `finality: settled`. A no-effect observation must exclude future delayed
commit, not merely say that a read currently finds nothing.

The method has no transport callback. It rejects mismatched, stale, untrusted,
non-final and conflicting observations. Identical observations are idempotent;
competing writes serialize. Confirmed no effect permits a *newly authorized*
attempt for that operation, never reuse of the original Warrant. Existing
action-hash replay policy still applies; an identical admitted action may need a
fresh attempt identity even after settled no-effect evidence.

Effect transitions are committed atomically with an extension to the existing
signed GEL record format in the SQLite store's **separate effect chain**. Each
attempt links to the original admission GEL record hash. The default admission
audit endpoint still serves the admission chain; it does not implicitly export
this second chain. Export effect records with `store.records()` and retain both.

`verifyEffectEvidence` checks supplied event integrity, signatures against pinned
keys, bindings, transitions, duplicate operation use, observation methods, and
the expected independently anchored chain tip. Results are PASS, FAIL or
INDETERMINATE with reason codes. Missing trust configuration, no independent
checkpoint, or unresolved effects cannot produce PASS. PASS concerns the supplied
evidence contract; it does not establish physical truth or independently verify
the linked admission chain. Verify that chain and its authority artifacts too.

The existing CLI verifies exported effect records with a separately provisioned
trust profile (never take trusted keys or checkpoints from the evidence itself):

```sh
aristotle execution-control effects verify --records effects.json --trust trust.json --json
```

The trust JSON supplies `trustedLedgerKeys`, `trustedObservers`, `allowedMethods`
and `expectedTipHash`. Exit codes are 0 PASS, 1 FAIL, and 2 INDETERMINATE.
No remote reconciliation endpoint is exposed in this increment. The library
requires explicit operator observer configuration; a server trust-profile and
operational recovery integration remains necessary for a deployed workflow.

## Security compatibility changes

- HTTP dispatch now requires a writable durable SQLite sidecar (or an injected
  shared store) and Node's `node:sqlite` module. Node 22.5–22.12 requires
  `--experimental-sqlite`; Node 22.13+ on the 22.x line does not require that flag.
  See [Node's SQLite version history](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html).
  The local checks used Node 24.15.0; older supported versions were not separately
  exercised. An unavailable store refuses emission; it does not fall back to
  non-durable dispatch.
- Automatic HTTP redirects are disabled: a new destination needs its own governed
  action. The original redirect response is returned to the caller.
- Credential prefixes now match URL origin and a path-segment boundary. Hostname
  lookalikes, alternate ports and sibling path prefixes no longer match.
- Known `http.*` method classifications cannot be overridden with a different
  method. `http.request` retains its explicit-method contract.
- Caller headers cannot override Host/connection framing; broker headers replace
  caller values case-insensitively.
- The proxy route now passes configured budget, approval, runtime-register and
  degradation controls into evaluation.
- Execution endpoints use the boundary's clock (or trusted `options.now` fixture),
  not request-body `now`. Pure analysis routes remain separate.
- Invalid Warrant timestamps refuse with `WARRANT_INVALID_TIME`.
- Corrupt budget/approval files fail closed instead of silently resetting state.
  Restore trusted state before resuming; deleting spent-authority history is not
  a recovery procedure. Invalid policy bounds and negative/non-numeric costs
  cannot bypass an enforced budget. These file stores still need a separate
  multi-process atomicity increment.
- Returned Warrants are marked consumed after durable dispatch reservation.

## Limits

This is local-host coordination for processes sharing the same SQLite database.
It is not shared-database Postgres coordination, global partition-safe operation
identity, exactly-once delivery, or atomic commitment with a downstream device.
Independent files or restored stale snapshots can invalidate the guarantee.
The filesystem, host, configured issuer keys, and observer truth remain trusted.
DNS rebinding/egress isolation and credential access outside the proxy require
deployment controls. Existing industrial/framework paths are not automatically
covered by this HTTP increment. Keep the original domain/mesh tests and authority
reconciliation; extend other boundaries with their own verified increments.
