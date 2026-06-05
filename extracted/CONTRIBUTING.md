# Contributing to AristotleOS

This is a substrate project. The bar for contributions is correctness, evidence, and clarity. Marketing language is rejected; rigor is welcomed.

## What we accept

- **Bug fixes** with a failing test that the fix makes pass.
- **Hardening** of existing primitives where tests are shallow.
- **New protocol adapters** that follow the existing pattern (Operation → Authorization → ControlTransport → Receipt → governXxx).
- **New chaos scenarios** that exercise a new failure mode deterministically.
- **Documentation** that improves diligence-grade clarity (and reduces ambiguity).
- **Test additions** to packages currently lacking coverage (see `PROOF_STATUS.md`).

## What we reject

- Marketing-style language ("revolutionary", "world-changing", "military-grade", "certified", "audited" — none of these are true and none are useful).
- Claims of production validation, hardware integration, customer deployments, or external endorsements that don't exist.
- Tests that assert only superficial behavior (`assert.ok(true)`).
- Code that introduces a new abstraction without an evidence path explaining what it proves.

## How to contribute

1. **Open an issue first** for anything larger than a typo. Describe the problem and the proposed direction.
2. **Branch from `ward-warrant-execution-control`** (the active development branch).
3. **Write the test first** when adding or changing behavior. The test failure should make the case for the change.
4. **Run the full sweep before pushing:**
   ```sh
   pnpm reviewer:verify       # the 4-stage reviewer flow
   pnpm test:core             # governance-core + execution-control-runtime + mesh-runtime + verifier + replay-artifact
   pnpm test:protocol-adapters
   pnpm test:framework-adapters
   pnpm test:mesh
   pnpm test:tenancy
   ```
5. **Update `PROOF_STATUS.md`** if your change adds, removes, or modifies a claim.
6. **Update `CHANGELOG.md`** with a release-batch entry.
7. **Open a PR against `ward-warrant-execution-control`.** Describe the change, the test that proves it, and any PROOF_STATUS rows it touches.

## Commit message conventions

- Prefix with the scope: `feat(<package>):`, `fix(<package>):`, `docs(<topic>):`, `test(<package>):`, `chore(<topic>):`.
- One line summary, then a blank line, then the body.
- Body should explain *what's tested* and *what's NOT tested*.
- End with the co-author trailer used in the repo:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
  (Only if your contribution was generated with AI assistance. Otherwise omit.)

## Naming conventions

The repo's naming is load-bearing. Use these terms correctly:

- **Ward** — sovereign protected domain. NOT a tenant, NOT an RBAC role, NOT a namespace.
- **Authority Envelope** — scoped delegation. NOT a permission, NOT a policy bundle.
- **Warrant** — single-use, content-bound, signed conveyance. NOT a JWT, NOT a bearer token.
- **Commit Gate** — admissibility evaluator. NOT middleware, NOT a webhook handler.
- **GEL Record** — hash-chained evidence. NOT a log entry, NOT observability data.
- **Governor** — delegates authority within a Ward. NOT a Ward. Delegation extends reach; consequence stays with the accountable party.

Don't rename without discussion. Don't add synonyms.

## Code quality

- TypeScript strict mode is on.
- `noUnusedLocals` and `noUnusedParameters` are enforced where present.
- Public exports must be explicit; no default exports of complex types.
- Cryptographic operations: use `node:crypto`. No third-party crypto libraries unless approved.
- Canonical serialization: use the centralized `stableStringify` (currently re-implemented in policy-pipeline and replay-artifact; planned consolidation tracked in `ROADMAP_TO_100.md`).

## Test discipline

- Every test file lives next to the source it tests (`src/index.test.ts`, not `tests/index.test.ts`).
- Tests run under `node --import tsx --test` for the workspace packages. Some legacy packages still use `tsx src/foo.test.ts` directly; both are acceptable for now.
- No `test.skip`, `test.only`, `test.todo` in committed code. The forensics agent will catch these.
- Tests must be deterministic. Network calls must be to `127.0.0.1`. Real-socket tests must clean up on `finally`.
- A test that asserts a specific reason code must use the exact string (not `match /SUBJECT/`); the reason-code taxonomy is part of the public contract.

## Security disclosures

See `SECURITY.md`. Do not file public GitHub issues for security bugs.

## Licensing

Contributions to AristotleOS-original material are submitted for inclusion under the repository's proprietary license unless a separate written agreement says otherwise. By submitting a PR, you certify that you have the right to contribute the material on those terms.

## Code of conduct

Be direct, technical, and respectful. Disagreements about the substrate are welcome; disagreements about each other are not. If a reviewer challenges a claim, treat that as an invitation to either prove it or remove it.

## What "100%" means in this repo

The substrate audit (CHANGELOG v0.1.60 → v0.1.65) tracks 12 items. Each item moves to 100% only when there is testable evidence — not when the documentation sounds confident. Use the same standard.

The reviewer flow (`pnpm reviewer:verify`) is the single command that proves the core claim end-to-end. Any new top-level claim should be reflected there or in `PROOF_STATUS.md`.
