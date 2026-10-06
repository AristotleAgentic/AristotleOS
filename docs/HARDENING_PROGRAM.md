# AristotleOS preservation and assurance program

## Objective and protected architecture

Make AristotleOS harder to bypass, easier to verify and deploy, and more honestly
proven. Preserve MAE -> Ward -> Authority Envelope -> canonical action -> Commit
Gate -> single-use Warrant -> execution boundary -> GEL -> reconciliation.
Preserve legitimate bounded disconnected operation, physical invariants,
domain-specific adapters, historical-policy reconstruction, and multi-asset use.
Do not require central contact for actions explicitly permitted offline.

This is an incremental hardening program, not a rewrite. Preserve supported,
legitimate capabilities and their safety invariants. Unsafe behavior is not a
protected capability. Document security-driven compatibility changes, provide
migration guidance, and obtain explicit review for material behavior changes.
Do not keep an unsafe legacy execution path merely because a replacement exists.
Avoid unrelated refactors, renamed concepts, and unnecessary dependencies.

## Baseline and isolation

Use a new branch and isolated checkout at an explicitly recorded upstream commit.
Record and preserve existing user changes separately; never reset, stash, or
incorporate them without understanding their provenance. Do not push or deploy
without authorization. Use small, independently reviewable local commits.

Before runtime edits, create BASELINE_ASSURANCE_MANIFEST.json: source SHA and
branch, environment/tool versions, lock and artifact hashes, package versions,
schema/API/CLI inventory, test and proof inventory, exact commands and results.
Record PASS, FAIL, SKIPPED, UNAVAILABLE, and ENVIRONMENT_BLOCKED separately;
never invent pass counts. Existing failures do not become new regressions, but
must remain visible and prevent an unqualified release-readiness claim.
Run existing suites, builds, reviewer paths, adapter checks, benchmarks, and
CI-equivalent checks where prerequisites are available. Do not operate live
industrial hardware, invoke production effects, or reuse production credentials
as a test fixture. Record missing prerequisites and continue independent work.

Reconcile PROOF_STATUS.md, LIMITATIONS.md, VALIDATION_MATRIX.md, existing formal
specifications, and release tooling against code and fresh results. Extend these
sources of truth rather than create competing assurance systems. Documentation
claims are evidence to examine, not guaranteed existing behavior.

## Dependency-ordered implementation

1. Baseline, regression contract, claim reconciliation, and a code-backed inventory
   of consequential surfaces, trust anchors, credentials, and bypass assumptions.
2. Persistence and concurrency: durable single-use consumption, budgets, replay
   indexes, revocation, restart recovery, and GEL append coordination. Define
   deployment profiles; never imply an in-memory store is production durable.
3. One complete HTTP effect lifecycle before broad adapter rollout: AUTHORIZED,
   IN_FLIGHT, CONFIRMED_EFFECT, CONFIRMED_NO_EFFECT, EFFECT_UNKNOWN. Preserve the
   existing admission and Warrant semantics. A timeout, missing acknowledgment,
   response-read failure, or crash after dispatch may mean an unknown effect.
   An HTTP status alone is not proof of a business effect or its absence.
4. Effect reconciliation, independently audited from authority reconciliation.
   Observations must bind Warrant, envelope, action hash, operation and attempt
   IDs, target, state fingerprint, time, method, and evidence provenance. Observing
   an effect must not trigger it. New physical probes or compensating actions
   require their own authority. Contradictory/insufficient evidence stays uncertain.
5. Offline verification and conformance vectors, versioned Authority Envelope
   specification, monotonic attenuation, and implementation/model correspondence.
6. Extend protocol/framework adapters and domain demonstrations incrementally;
   retain domain safety checks. Add adversarial partition, race, rollback, crash,
   key substitution, SSRF, forged evidence, and bypass tests.
7. Extend developer workflows, reproducible release evidence, and CI gates.
   Separate simulation, hardware-in-loop, real hardware, independent review,
   and production validation. Never claim unavailable physical evidence.

All original requested workstreams remain in scope: authority-chain enforcement,
attenuation, physical gating, credential isolation, revocation and trusted time,
partition/mesh behavior, operator attribution and dual control, domain adapters,
effect accounting, formal assurance, conformance, developer experience, reviewer
experience, release evidence, and non-degradation CI. Deliver bounded increments
with acceptance criteria, not an unverified all-at-once change.

## Effect identity and atomicity

Distinguish business-operation ID, execution-attempt ID, canonical action hash,
and Warrant ID. Define legitimate repeated actions separately from retries.
An unknown operation cannot be blindly dispatched with either its old Warrant
or a newly minted one. A consumed Warrant never becomes reusable, even when
no effect is later confirmed. A legitimate retry requires new authorization and
the applicable operation policy. Define ownership, fencing, or preallocated
authority for duplicate prevention across disconnected nodes; do not silently
introduce a global coordinator or promise global uniqueness without assumptions.

Persist the dispatch intent before emission and recover uncertain attempts
conservatively. Use race-safe transitions and idempotent evidence delivery.
Do not claim atomicity across a database and an arbitrary external device.
Distinguish at-most-once authorized dispatch from exactly-once external effect.
Test failure at every boundary: consumption, intent persistence, emission,
response reception, finalization, evidence append, and recovery.

## Formal and independent assurance

Audit the existing mesh TLA+ model before extending it. Require non-vacuous
properties, checked bounds/configuration, tool identity, checker logs, and code
mapping. Distinguish a specification, bounded model checking, theorem proof,
and implementation refinement. Model applicable partition revocation semantics;
do not weaken offline authority to simplify proof. Safety does not imply liveness.
Document fairness, eventual connectivity, trusted clocks, persistence, keys,
telemetry, and external-observer assumptions explicitly.

Preserve both 40-asset paths but identify them separately: the mesh-runtime
partition/replay scenario and the constructed UAV demonstration. Only runtime
tests can substantiate runtime enforcement; neither establishes real-hardware
safety. Add adversarial cases, not counters designed to produce easy wins.

Offline verification returns deterministic PASS/FAIL/INDETERMINATE with reason
codes and explicit trust anchors. Valid signatures cannot prove revocation
completeness, absence of hidden execution, trustworthy sensor measurements, or
physical effects without appropriate independent evidence. Unknown extensions
must not silently broaden authority; version and canonicalization rules must
be explicit. Arbitrary predicates may make attenuation undecidable: use a
defined decidable subset or return INDETERMINATE/refuse delegation.

## Execution and completion

For each increment: state scope and acceptance criteria -> implement -> test ->
run affected baseline regressions -> update evidence/compatibility/risk report ->
commit. Do not accumulate new regressions. Preserve baseline artifacts; attach
later runs separately. Improve checks that are insufficient rather than preserving
false assurance. Continue non-conflicting work when an architectural conflict is
documented; do not weaken core invariants to close a checklist.

Maintain a machine-readable regression contract mapping each supported capability
to code, test commands, deployment assumptions, and evidence. CI must enforce
the actual checks, not only inventory labels. Extend existing CI and release
manifest tooling. A textual scan is a review aid, not a proof of complete mediation.

Final reporting must identify unchanged/strengthened legitimate capabilities,
security-driven compatibility changes, actual passes/failures/skips, unverified
claims, and remaining work. Do not report zero degradation, formal verification,
exactly-once effects, or production readiness without supporting evidence.
Completion requires the original applicable checks plus new adversarial,
conformance, model, replay, and evidence checks, with no introduced regressions.
Do not stop at a roadmap: execute the safely achievable increments and report
external blockers precisely without manufacturing completion.
