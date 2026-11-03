# Production contracts and single-drone hardening

This increment implements dependency remediation, durable adapter dispatch,
single-drone interlocks, and stricter production configuration checks. It does
**not** establish system-wide production readiness, exactly-once physical
effects, or flight clearance. No aircraft was contacted, armed, or flown.

Source commit: `2604ed08506c41166fc9be1550f70b883f0fd746` on
`harden/production-contracts`. The source and this evidence were pushed to GitHub
at `b949cfb`. That push did not deploy the runtime; deployment status must be
verified independently in Render. The verification below describes the recorded
source snapshot, not subsequent website or deployment-configuration edits.
The original checkout and its user changes remain separate.

## Changes

- The three outstanding dependency issues have code-level remediations: UUID
  uses upstream 11.1.1; provider-utils 2.2.8 has bounded streaming response reads;
  sprintf-js 1.0.3 has bounded numeric precision. Both patched packages retain
  their upstream versions, so the raw registry audit still lists **one low and
  one moderate finding**. No advisory exceptions or threshold reductions were
  introduced. Patch hashes are locked and byte-preserved; CI tests the installed
  implementations. See [patch provenance](../../extracted/patches/README.md).
- Production-marked protocol transports require an effect boundary. The supplied
  runtime boundary verifies pinned Warrant signatures, reserves stable operation
  identity and consumes the nonce in SQLite before emission. Transport receipts
  and exceptions remain EFFECT_UNKNOWN; accounting failure preserves IN_FLIGHT.
  Attempt IDs are returned for reconciliation. The six transport adapters expose
  the boundary option and stable operation IDs. Payloads and callback inputs are
  snapshotted before asynchronous evaluation.
- Single-drone dispatch requires a trusted telemetry interlock in production.
  It checks aircraft/target identity, telemetry and command age, operator enable,
  position/geofence/failsafe posture, battery/altitude, allowed commands and
  landed state. The altitude reference is explicit. Current-state checks do not
  replace target-coordinate geofence enforcement or onboard failsafes.
- Flight commands reject policy-field injection, broadcast/wrapped target IDs,
  malformed/non-finite parameters, contradictory arm/disarm parameters and forced
  arm/disarm. ARM defaults to the correct wire value. GOTO_NED is refused on the
  incorrectly mapped global-position transport. UDP opening is shared across
  concurrent sends, honors local binding, and retains an error listener.
- Production gateway startup requires enforced governance, signed durable chain
  and ledger configuration, roles, and signed sessions. The insecure override
  cannot turn failed checks into a passing readiness state. These are
  configuration checks, not validation of an actual deployed cluster.
- The opted-in simulator smoke test fails on a silent endpoint rather than
  reporting success, and only permits a local simulator. A negative control
  verifies that behavior. Actual simulator execution remains skipped.

## Verification

The broad [assurance run](production-contracts/RESULTS.json) recorded **95 passing
commands, zero failing commands**, one unavailable physical-validation category,
and one skipped live-stack category. It includes workspace tests, typechecking,
full builds, CLI checks, reviewer verification, the 40-asset replay proof,
dependency audit, SBOM generation and Helm validation. Some source changes were
completed during this run; its initial working-tree hash inventory is not the
final source snapshot.

The separate [final-source run](production-contracts-final/RESULTS.json) captures
the committed source and patch hashes and rechecks the changed boundaries with a
frozen install: **12 commands passed, zero failed**. All 107 recorded command-log
hashes and 719 final-source hashes were verified against the files on disk. See
the [machine-readable summary](PRODUCTION_CONTRACTS_SUMMARY.json).

Targeted coverage includes the dependency exploit paths (17 tests), adapter
boundary behavior (20), durable effects and restart/retry behavior (21), flight
command and interlock behavior (18), production preflight, and a signed
single-drone UDP loopback scenario. The simulator package's negative-control
pass is separate from its skipped real-simulator test.

The loopback scenario uses real signatures and a durable database, concurrent
same-operation requests, database reopening and synthetic telemetry. It observes
one datagram and blocks stale telemetry. It does not observe an autopilot ACK,
rotor movement, a flight trajectory or an authoritative aircraft effect.

## Remaining readiness work

The user selected a **single-drone flight test**. Autopilot/firmware, airframe,
telemetry source, endpoints and simulator/bench availability are not yet
specified. The [single-drone readiness contract](../../extracted/docs/single-drone-readiness.md)
lists the required simulator, bench and operator evidence.

Exactly-once physical execution is not provided by this COMMAND_LONG transport.
It has no receiver-side atomic effect/deduplication transaction. The delivered
guarantee is durable local dispatch ownership for cooperating processes sharing
one SQLite database and a stable operation identity. Fresh operation IDs,
independent databases, stale snapshot restore, network duplication and autopilot
restarts are outside that guarantee. Unknown effects must remain unresolved
until trustworthy, correctly bound observations support reconciliation.

System-wide promotion also remains blocked on complete mediation of every
deployed effect path (including framework-handler and response-shaped paths),
multi-process atomic budget/approval state, shared-host/partition behavior,
rollback-resistant storage and independent ledger anchoring, authenticated
telemetry/receiver evidence, real deployment isolation and key management,
recovery/load/soak validation, and aircraft-specific commissioning. Existing
Mastra transitive Zod peer-version warnings also remain. The broader hardening
program is not marked complete.

Generated build outputs documented in the previous increment are preserved;
the newly generated gateway preflight JavaScript is committed with its changed
TypeScript because the service can start from JavaScript. Remote CI has not run.
