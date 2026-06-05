# Roadmap to 100%

Five categories. Each lists the current gap, the concrete actions to close it, and the highest-leverage next step. No financial assumptions.

---

## Category 1 — Technical seriousness

### Current gaps
- No formal verification of the Commit Gate's decision function. The mesh reconciliation protocol has a TLA+ model at `docs/specs/mesh-reconciliation.tla` (manual `tlc` run; not yet in CI).
- No external security audit.
- No KMS / HSM integration as a first-party package.
- ~~No production-grade mesh transport (mTLS + per-node Ed25519 keypairs); shared HMAC ships as the default~~ — **partially closed.** `shared/mesh-runtime` now ships `MeshSigner` + `MeshVerifier` interfaces with first-party `createEd25519MeshSigner` / `createEd25519MeshVerifier` factories. Per-node Ed25519 with a MAE-style trust-anchor allowlist is opt-in via the `signer` + `verifier` MeshNode options; shared HMAC remains the default for backwards compat. 8 new tests in `ed25519-mesh.test.ts` cover happy path, allowlist enforcement, impersonation defense, and constructor misconfiguration. mTLS at the HTTP layer remains caller-supplied (the `httpClient` and `urlFor` hooks are already in place).
- No production hardware validation for any of the seven adapters.
- No fuzzing or property-based testing beyond the existing 2 property tests in `gate.property.test.ts`.
- No cross-adapter test asserting the refusal-before-emission invariant simultaneously.
- ~~No durable nonce store as a first-party implementation~~ — **closed** (`@aristotle/nonce-store` ships `InMemoryNonceStore` + `FilesystemNonceStore` with append-only JSONL persistence, TTL eviction, and an integration test that proves `WARRANT_REPLAYED` survives a process restart). Redis / Postgres adapters can implement the same `NonceStore` interface in separate packages.
- ~~No auto-pull of missed revocations on the edge~~ — **closed** (`EdgeNode.pullRevocations()` plus auto-trigger on `pingRoot()` reconnect; covered by `auto-pull: *` tests in `shared/mesh-runtime/src/index.test.ts`).
- ~~No cross-adapter test asserting the refusal-before-emission invariant simultaneously~~ — **closed** (`@aristotle/tests-cross-adapter`; spy transports across all 7 protocol adapters; runs in <500ms; wired into CI `protocol-adapters` job).
- No external timestamp authority anchor on GEL records.
- No latency benchmarks under realistic concurrent load.

### Concrete actions
| Action | Output | Affects |
|---|---|---|
| Write a `fast-check` property-based test suite for `evaluateCommitGate` covering decision determinism + invariants — partial: `gate.replay-property.test.ts` ships 4 replay-protection invariants (I1 replay detection, I2 precedence, I3 fresh-passes, I4 nonce uniqueness) over ~5500 deterministic trials using the existing hand-rolled mulberry32 PRNG (no new dev-dep). A future iteration could swap in `fast-check` for richer shrinking. | `shared/execution-control-runtime/src/gate.{property,replay-property}.test.ts` | Partial |
| ~~Write a TLA+ or Alloy spec for the mesh reconciliation protocol~~ — shipped at `docs/specs/mesh-reconciliation.tla` with `docs/specs/README.md` walkthrough. Models the partition→heal→auto-pull→reconcile flow; asserts `Inv_NoWarrantAfterKnownRevocation`, `Inv_QuotaCap`, `Inv_ReconcileDetectsConflict`, and the liveness property `Live_EventualConsistencyOnHeal`. Manual `tlc` run only; not yet in CI. | `docs/specs/mesh-reconciliation.tla` | ✅ done (doc); CI step still TBD |
| Ship a first-party KMS keyring adapter (AWS KMS + Vault) implementing the `Keyring` interface | new package `@aristotle/kms-keyring` | High |
| ~~Ship a durable `NonceSeenSet` implementation~~ — shipped (`InMemoryNonceStore` + `FilesystemNonceStore`; Redis + Postgres backends still TBD as separate packages) | `@aristotle/nonce-store` | ✅ done |
| ~~Add cross-adapter refusal-before-emission test~~ — shipped at `tests/cross-adapter/src/refusal-before-emission.test.ts` | `@aristotle/tests-cross-adapter` | ✅ done |
| ~~Replace shared-HMAC mesh trust with per-node Ed25519 keypairs gated by MAE signing-key allowlist~~ — partially closed: `MeshSigner` + `MeshVerifier` interfaces + `createEd25519MeshSigner` / `createEd25519MeshVerifier` factories ship; per-node Ed25519 is opt-in via MeshNode options. Shared HMAC stays as default for backwards compat. Covered by 8 tests in `ed25519-mesh.test.ts`. | `shared/mesh-runtime` | ✅ done (opt-in) |
| GEL chain mutation-resistance property tests (M1 record-hash, M2 previous-hash, M3 reorder, M4 insertion, M5 signature strip, M6 signature forgery) | `shared/execution-control-runtime/src/gel.mutation.test.ts` | ✅ done |
| Default-secret detection + `productionMode` lockdown on MeshNode (refuses HMAC entirely when productionMode=true; one-time WARN on known demo secrets in non-production mode) | `shared/mesh-runtime/src/index.ts` + `ingress-hardening.test.ts` | ✅ done |
| Mesh HTTP ingress hardening (1 MiB body cap configurable, content-type enforcement, structured JSON errors) | `shared/mesh-runtime/src/index.ts` + `ingress-hardening.test.ts` | ✅ done |
| Mesh anti-replay cache (opt-in `createMeshReplayCache({ ttlMs, maxSize })`; rejects exact-body replays within window with HTTP 409) | `shared/mesh-runtime/src/index.ts` + `ingress-hardening.test.ts` | ✅ done |
| Integrate Sigstore (or RFC 3161 TSA) for GEL root anchoring | extension to `appendGelRecord` | Medium |
| Add OpenTelemetry tracing through the gate + adapter layers | shared instrumentation | Medium |
| Add benchmarks under sustained concurrent load (1000 req/s, 10K req/s) with regression tracking | `bench/` directory | Medium |
| Add a mutation-test pass (Stryker) to identify shallow assertions | CI gate | Low (but high signal) |
| External security audit (engagement, not internal) | audit report | **Critical** |
| Production hardware integration test for ≥ 1 adapter (PX4 SITL is the most achievable) | CI workflow against SITL Docker | **Critical for #7** |

### Highest-leverage next step
**External security audit (Trail of Bits / NCC Group / Doyensec / Cure53) of the Commit Gate, warrant lifecycle, GEL chain, and mesh reconciliation.** Without this, every "is it secure?" question gets the same self-asserted answer. With it, every such question becomes an audit citation.

---

## Category 2 — Commercial readiness

### Current gaps
- No public pilot deployments.
- No hosted demo a reviewer can interact with without cloning the repo.
- No production deployment guide.
- No enterprise packaging (Helm chart exists in `charts/` but is not validated against a real cluster).
- No security questionnaire response (CAIQ, SIG-Lite).
- No support model documented.
- The CLI's typecheck is broken (pre-existing dep declaration).
- No SBOM publication discipline (script exists at `scripts/generate-sbom.mjs`; not run on every release).
- No procurement FAQ.

### Concrete actions
| Action | Output | Affects |
|---|---|---|
| Docker Compose demo that brings up a root + 2 witnesses + 5 edges + reviewer dashboard | `docker/demo/docker-compose.yml` + walkthrough | High |
| Helm chart validation against a real `kind` cluster in CI | `charts/aristotle/ci/` + workflow | High |
| Cloud-hosted reviewer demo at a stable URL | external deployment | High (but external work) |
| Fix `apps/aristotle-cli` typecheck: declare `@aristotle/execution-control-runtime` and `@aristotle/trial-engine` as explicit deps | `apps/aristotle-cli/package.json` | Quick fix |
| Write `docs/DEPLOYMENT.md` covering: gate sizing, KMS wiring, ledger backend choice (SQLite vs Postgres), mesh topology recommendations | `docs/DEPLOYMENT.md` | Medium |
| Write `docs/SECURITY_QUESTIONNAIRE.md` answering CAIQ / SIG-Lite items honestly (no fabrication) | `docs/SECURITY_QUESTIONNAIRE.md` | Medium |
| Write `docs/PROCUREMENT.md` answering: licensing, support model, SLA expectations, escalation path | `docs/PROCUREMENT.md` | Medium |
| Wire SBOM generation into CI on every release | `.github/workflows/ci.yml` step | Quick |
| Write pilot playbooks for UAV, OT, K8s admission, insurance-evidence use cases | `docs/pilots/*.md` | High |
| Sign release artifacts with npm provenance (`npm publish --provenance`) | release pipeline | Medium |

### Highest-leverage next step
**Land one named, public pilot deployment** running real (not test) traffic for at least 90 days. Without a pilot, every commercial conversation starts at zero. With even one, it starts with "show me what their adoption looked like".

---

## Category 3 — Strategic novelty

### Current gaps
- The category (governance execution substrate) is not yet externally validated.
- Comparables are mapped in `docs/MARKET_POSITIONING.md` but not externally challenged.
- The Warrant + GEL wire formats are defined in this codebase but not published as an open spec independent of this codebase.
- No ADRs (Architecture Decision Records) explaining why specific design choices were made.
- No technical whitepaper articulating the substrate's design rationale.
- No standards-body engagement.

### Concrete actions
| Action | Output | Affects |
|---|---|---|
| Write a technical whitepaper covering: the chain, the seams, the threat model, the partition story, the replay-verification model, the comparable-systems landscape | `whitepaper.pdf` or `docs/WHITEPAPER.md` | High |
| Author ADRs for the top 15 design decisions: why single-use Warrants vs. JWT; why deterministic gate; why GEL hash chain; why Fluidity Tokens; why APL is small; etc. | `docs/adr/0001-*.md` ... `0015-*.md` | High |
| Publish Warrant + GEL formats as an open spec, versioned independently, with at least one reference implementation outside this codebase | `spec/aristotle-warrant.md` + `spec/aristotle-gel.md` | High |
| Build an adapter SDK with documented contracts, so third parties can ship adapters without modifying this repo | `packages/adapter-sdk/` | Medium |
| Submit a draft to IETF / NIST / OCI working group as appropriate (which depends on which way the substrate evolves) | draft RFC or working note | External / long-horizon |
| ~~Document the differences from OPA / Cedar / JWT / OAuth / Guardrails / Sigstore line by line~~ — shipped at `docs/COMPARISON.md` | `docs/COMPARISON.md` | ✅ done |
| Attend / present at appropriate venues: ICRA (robotics), S4 (industrial control), KubeCon (admission), NeurIPS / AAAI (AI safety) | external | Long-horizon |

### Highest-leverage next step
**Author and publish the Warrant + GEL wire-format spec** independent of the codebase. The substrate's value compounds when other implementations can speak the same authority chain. Until then, AristotleOS is the implementation AND the spec — which makes external adoption brittle.

---

## Category 4 — Diligence readiness

### Current gaps
- The reviewer flow exists; CI does not run it on every PR.
- Root `package.json` version (`0.1.33`) is older than the most recently touched package versions — visible version drift.
- `PROOF_STATUS.md` is now the source of truth, but not yet integrated into CI.
- No release artifact (zip / tarball / OCI image) signed and published per release.
- No CI badge on README.
- No SBOM on release artifacts.

### Concrete actions
| Action | Output | Affects |
|---|---|---|
| `.github/workflows/ci.yml` runs: install, lint, typecheck, `pnpm test:core`, `pnpm test:protocol-adapters`, `pnpm reviewer:verify`, `pnpm test:reviewer`, published-replay test, SBOM generation | CI workflow | **Critical** |
| Add CI badge to README pointing at the workflow | README | Quick |
| Bump root version on every release batch | `package.json` | Quick |
| Add a `RELEASE_CHECKLIST.md` items: tests pass, reviewer flow pass, replay artifact verified, package versions aligned, CHANGELOG updated, LIMITATIONS reviewed, PROOF_STATUS updated, no new unsupported claims, security docs updated | `RELEASE_CHECKLIST.md` | Medium |
| Generate and publish SBOM on every tag | release workflow | Medium |
| Generate signed release artifacts (zip + tarball, signed via Sigstore cosign or npm provenance) | release workflow | Medium |
| Add a `RELEASE_NOTES_TEMPLATE.md` | template | Quick |
| Lint discipline: add `eslint` config + check on PR; currently `pnpm lint` echoes "not configured" | `eslint.config.mjs` + CI | Medium |

### Highest-leverage next step
**Ship a working CI workflow that runs the reviewer flow on every PR and refuses merges where it fails.** Right now, the reviewer flow exists but doesn't have teeth in CI. With teeth, every PR is auditably governed by the same checks a reviewer would run.

---

## Category 5 — High-upside potential

### Current gaps
- No live deployment.
- No ecosystem of third-party adapters or integrations.
- No standardization.
- No academic citations or peer review.
- No defense / autonomy / OT partnerships.

### Concrete actions
| Action | Output | Affects |
|---|---|---|
| Build 1–3 production pilots (UAV operator, OT site, K8s mutation governance) | pilot reports | **Critical** |
| Publish the Warrant + GEL spec as an open specification | (see Category 3) | High |
| Build an adapter SDK so third parties can ship adapters | (see Category 3) | High |
| Attract external contributors — likely starting from a working pilot + a clear adapter SDK | contributor activity | Long-horizon |
| Commission an external security audit | audit report | (see Category 1) |
| Field-demo on real hardware (e.g., PX4 + a real drone in a controlled range) | video + replay artifact | High |
| Standards-body outreach (OCI for OCI bundle media types; NIST or NCSL for cyber-physical governance) | drafts | Long-horizon |
| Defense / autonomy / OT partnership exploration | partnership letters / MOUs | External |

### Highest-leverage next step
**Ship a real pilot, in public, with a real operator, on real traffic.** Every other high-upside path depends on this. Without it, the substrate is plausibly important; with it, it's measurably so.

---

## Scoring rubric

Each category has a current score (subjective, based on the test posture and documentation surface in this repo) and what would be needed to raise it.

| Category | Current | Needed for 100 | Achievable in repo? | Achievable externally? |
|---|---:|---|---|---|
| 1. Technical seriousness | ~75 / 100 | External audit + formal verification + KMS integration + production hardware test for ≥ 1 adapter | Partially (audit and hardware require external) | Audit is external; KMS adapter, formal spec, fuzzing all in-repo |
| 2. Commercial readiness | ~35 / 100 | Pilot, hosted demo, deployment guide, support model | Mostly external | Docs + Helm validation + SBOM are in-repo |
| 3. Strategic novelty | ~60 / 100 | Whitepaper + open spec + ADRs + comparable-system positioning | Yes | Yes |
| 4. Diligence readiness | ~85 / 100 | CI on every PR + version discipline + release signing + RELEASE_CHECKLIST | **Yes, all in-repo** | — |
| 5. High-upside potential | Unscored | Real pilot + ecosystem + standards adoption | No (external partnerships) | — |

The honest assessment: Categories 3 and 4 are nearly closable within the repo. Categories 1, 2, and 5 depend on work outside the repo (audit, pilots, partnerships, hardware validation). The substrate provides the credibility surface that makes those external conversations easier; it does not provide the conversations themselves.
