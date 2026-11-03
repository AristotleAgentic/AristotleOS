# Preservation report: HTTP effect and assurance increment

This is a bounded increment, not completion of the full hardening program and
not a certification of zero degradation. Final command results are recorded in
`hardened/RESULTS.json`; the original baseline and its failures remain preserved
in `baseline/BASELINE_ASSURANCE_MANIFEST.json`.

## Source and isolation

The upstream feature branch `ward-warrant-execution-control` was checked at
`8380d27`. Implementation is on the separate local branch
`harden/effect-boundary` in `AristotleOS-hardened`. The original checkout and its
uncommitted work were preserved. Nothing was pushed, merged or deployed.

Source changes are committed separately from generated build output. The isolated
checkout retains 29 generated service/declaration/website-preview files outside
the source commits; `GENERATED_OUTPUTS.json` records their hashes and confirms
that the corresponding TypeScript sources are unchanged from the baseline.
They are reproducible build output, not additional manually edited fixes.

The revised execution prompt is `docs/HARDENING_PROGRAM.md`. It preserves the
native authority chain and bounded offline operation, protects legitimate
capabilities, distinguishes unsafe legacy behavior from supported behavior,
and requires evidence appropriate to each claim.

## Implemented changes

- The HTTP proxy persists dispatch ownership, Warrant/nonce consumption and
  signed effect events in one SQLite transaction before dispatch. Participants
  sharing that database cannot blindly redispatch an unresolved business
  operation with a new Warrant. Crash, lost reply, body-read and finalization
  failures preserve uncertainty.
- Effect observation is separate from dispatch and authority reconciliation.
  Reconciliation checks pinned observer signatures, exact operation/attempt/
  Warrant/envelope/action/target/state bindings, freshness, method and finality.
  No-effect resolution never restores a consumed Warrant.
- The offline verifier returns PASS/FAIL/INDETERMINATE with explicit trust and
  completeness requirements. The existing CLI gains `execution-control effects
  verify`; the original commands remain available.
- Redirects require fresh governed actions. Credential prefixes use URL origin
  and path boundaries. The proxy carries evaluation controls and rejects method
  and transport-header substitution. Execution APIs use the boundary clock.
- Malformed Warrant timestamps, corrupt budget/approval files, invalid policy
  bounds and invalid enforced costs fail closed. Existing budget/approval file
  storage is not thereby made race-safe across processes.
- The mesh model now represents reconciliation and checks meaningful bounded
  safety/liveness properties. CI requires two positive configurations and two
  negative controls. Runtime mesh behavior was not weakened to satisfy a model.
- The dependency audit rejects malformed/unavailable reports and invalid
  exception expiries instead of treating them as clean evidence. Compatible
  transitive security updates remove the detected high/critical advisories.
- Workspace resolution uses package entry points instead of routing runtime
  imports into declarations or consumer builds into foreign source roots. A
  missing Rekor runtime dependency and the timestamp client's BodyInit typing
  were corrected. The complete workspace build passed locally.

## Compatibility and preserved capabilities

`REGRESSION_CONTRACT.json` maps the tested capability families to commands.
`COMPATIBILITY_COMPARISON_FINAL.json` records normalized hashes for nine files in the
schema/OpenAPI inventory, exported runtime names, generated execution-control
OpenAPI and CLI help.
No compared schema, export or CLI command was removed. Three runtime exports and
one CLI command were added. These static checks do not establish every TypeScript
signature's compatibility or semantic substitutability.

| Capability | Implementation disposition | Evidence and limits |
|---|---|---|
| Native authority chain and physical/domain constraints | UNCHANGED | Existing gate, chain and domain regression commands; no physical certification |
| Single-use HTTP dispatch ownership | STRENGTHENED | New shared-local SQLite transaction and adversarial tests; not global partition uniqueness |
| Bounded offline mesh operation and authority reconciliation | UNCHANGED | Existing runtime partition/replay tests; corrected bounded model is separate evidence |
| HTTP destination/credential and execution-time controls | STRENGTHENED | New redirect, prefix, method, header, control-parity and backdating tests |
| Budget and approval state handling | STRENGTHENED | Corrupt-state/invalid-input refusal tests; multi-process atomicity remains open |
| GEL and reviewer workflows | STRENGTHENED | Existing format retained; optional signed effect extension and separate effect chain |
| Operator APIs, task lifecycle, framework and industrial adapters | UNCHANGED | Existing regression suites; HTTP effect accounting does not cover these other boundaries automatically |
| CLI and deployment tooling | STRENGTHENED | Additive verifier command, build corrections, original command inventory and package checks |
| Production dependency audit | STRENGTHENED | Fail-closed report parsing, finite reasoned exceptions and compatible security patches; unchanged high/critical gate |

These dispositions describe the code changes, not unconditional claims that every
deployment or untested behavior is preserved. Security compatibility changes and
operator migration requirements are listed in `extracted/docs/effect-accounting.md`.

## Test evidence and failure triage

The untouched baseline recorded 83 passing command invocations, eight failures,
one skipped live-stack category and one unavailable hardware category. Failures
included missing build prerequisites, sandbox restrictions and actual workspace
resolution errors. They were preserved rather than relabeled as passes.

The post-change full run recorded **89 PASS, 3 FAIL, 1 SKIPPED and 1 UNAVAILABLE**
at command/category level. All three failures have retained corrective/recheck
evidence below. The final dependency follow-up recorded **10 PASS**, with the same
two explicit hardware/live-stack limitations. These are invocation counts, not
unique tests. `FINAL_ASSURANCE_SUMMARY.json` links final dispositions and hashes.

The post-change run passed typechecking, the 75-test runtime suite, all 20 new
effect tests, all 25 CLI tests, workspace package tests, the 10-test runtime mesh/
published replay suite, and all 18 reviewer checks. Command-level totals and
remaining build/package/audit results are in the machine-readable summary.
The packaged CLI also passed its clean-consumer installation and boundary pilot
in `packed-cli-check.txt`; no package was published. Local CI-equivalent checks
were exercised, but a remote GitHub Actions run was not triggered.

Three first-run failures require explicit accounting:

1. Legacy APIs: 98/99 passed, with one gateway readiness timeout. The affected
   file then passed 6/6, and the unchanged full command passed 99/99. No runtime
   change was made for this failure. Logs: `legacy-timeout-recheck.txt` and
   `legacy-full-recheck.txt`. One successful rerun does not prove the test cannot
   flake again.
2. MAVLink UDP delivery: an existing test assumed delivery within 30 ms. It now
   awaits the actual message with a five-second deadline, registered before
   sending, and retains the original duplicate-observation window and assertions.
   The full protocol-adapter command passed after this test-only change; see
   `protocol-delivery-recheck.txt`. No adapter runtime code changed.
3. Dependency audit: the real registry scan found 48 advisory records, including
   16 blocking high/critical records, despite the baseline command reporting zero.
   The old parser accepted error/unknown JSON as an empty scan. The baseline did
   not retain its underlying registry JSON, so the precise cause of its zero
   count cannot be reconstructed. Its exit-zero result is not trustworthy proof
   of a clean dependency graph. The gate now rejects these cases; 11 audit tests
   pass and both the vulnerable-report and unavailable-registry negative controls
   fail as required. No allowlist exceptions were added or severity threshold
   lowered.

The long post-change run began before that UDP test correction. Its initial
source inventory therefore describes the initial run, not every later command.
The correction is separately committed and the explicit protocol rerun binds
its result to that final test. Final source hashes accompany the summary. The
original failed logs remain present; no result was edited to conceal a failure.

The 1,000-iteration runtime benchmark retained valid 3,000-record evidence and
completed successfully. Its measured means were lower than the baseline run,
but these single runs on a shared host are not a controlled performance study.
That benchmark does not measure the new durable HTTP path's SQLite/network cost;
no global performance non-degradation claim is made.

The PX4 SITL script exits successfully with **one skipped test and zero passes**
unless a simulator is provisioned. This is not live-SITL or hardware evidence.
Workspace results repeat some root suites, so their test totals must not be
added together and presented as a count of unique tests.

## Dependency security follow-up

The final saved production audit is
`dependency-audit-final-aliases-raw.json`. It reports three remaining advisory
records, down from 48: **zero high/critical, two moderate and one low**. Compatible
patches cover js-yaml, Hono, fast-uri, ip-address, nanoid, proxy-addr, qs,
@hono/node-server, body-parser, and compatible provider-utils versions (including
Mastra aliases). The root package and frozen lockfile record exact overrides.

| Remaining dependency | Severity | Required next work |
|---|---|---|
| uuid 10.0.0 through LangChain | Moderate | Advisory's patched range begins at 11.1.1; validate an upstream framework/major dependency upgrade |
| @ai-sdk/provider-utils 2.2.8 through Mastra's older UI utilities | Low | Patched range begins at 3.0.28; validate upstream integration instead of forcing a major transitive override |
| sprintf-js 1.0.3 through gray-matter/js-yaml/argparse | Moderate | Audit lists no published patched version; evaluate upstream replacement or a reviewed patch |

These findings were not waived or characterized as unreachable. The existing
high/critical production gate passes; that does not mean zero vulnerabilities.
Existing Mastra/Zod peer warnings also remain. Adapter unit tests do not establish
end-to-end compatibility with every external cloud provider.

The full workspace build passed after the compatible dependency updates; the
last Mastra alias correction is checked again in `dependency-final/RESULTS.json`
alongside the affected builds, service/framework tests, typecheck, effect/CLI
tests, audit, frozen install, SBOM and boundary pilot. The earlier complete
regression manifest remains attached to its original lock hash.

## Formal evidence

`formal/manifest.json` preserves TLC identity, hashes and logs. Two-edge bounds
explored 201,368 distinct states; the separate quota configuration explored
38,990. Both passed. Removing the quota guard or known-revocation guard produced
the required counterexamples. The original model produced a counterexample and
its log is retained. An exploratory larger run was stopped and is not a pass.

This is bounded model checking. There is no unbounded theorem proof, verified
implementation refinement, model of the complete authority/effect kernel, or
real-hardware safety claim. Fairness, eventual connectivity and other assumptions
are stated beside the model.

## Remaining work and deployment limits

The effect guarantee covers processes on one host sharing the same SQLite file.
It does not cover independent files, stale snapshot restoration, active-active
Postgres deployments or arbitrary disconnected ownership. It cannot make a
database transaction atomic with a downstream device, or promise exactly-once
external effects. An HTTP response is intentionally not terminal effect evidence.

The admission GEL and effect GEL remain distinct, linked by admission hash.
Independent anchors, authenticated observer provisioning, operational recovery
with dispatcher fencing, and an authenticated server reconciliation workflow
remain to be integrated. Host, storage, issuer keys, observer truth and trusted
time remain assumptions. DNS rebinding/egress isolation needs deployment controls.

Other remaining increments include complete mediation auditing, durable
multi-process budgets/approvals, protocol/framework effect integration, portable
envelope conformance and decidable attenuation, broader adversarial benchmarks,
release attestation and independent review. Hardware/production validation and
live-stack checks were not performed. The full program remains incomplete.
