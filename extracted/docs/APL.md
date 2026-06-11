# APL — Aristotle Policy Language

APL is a small, typed, declarative DSL that compiles to `GovernanceDraft` (Ward + AuthorityEnvelope manifests). It is intentionally narrow today; this document explains what compiles, what doesn't, and what the production roadmap looks like.

## What APL is

```
ward "Montana Drone Range" {
  id montana-drone-range
  domain drone-swarm-ops
  sovereignty "private-ranch-field-test"
  version 0.1.0
  subject agent:survey-planner
  criticality safety_critical
  classification CUI caveats "NOFORN"
  allow drone.takeoff, drone.scan_area when telemetry.gps_lock
  deny  drone.disable_geofence, drone.leave_boundary
  bound altitude_m <= 120
  bound battery_pct >= 20
  within ranch-test-grid-a
}
```

The compiler is at `shared/execution-control-runtime/src/policy-dsl.ts`. The wrapped build pipeline (signing + provenance + reproducibility) is at `shared/policy-pipeline`.

## What APL can express today

| Construct | Syntax | Compiles to |
|---|---|---|
| Ward declaration | `ward "<name>" { ... }` | `WardManifest` (one per block) |
| Ward id | `id <kebab-case-id>` | `ward.ward_id` |
| Authority domain | `domain <domain>` | `ward.authority_domain` |
| Sovereignty context | `sovereignty "<string>"` | `ward.sovereignty_context` |
| Policy version | `version <string>` | `ward.policy_version` |
| Subject | `subject <subject-id>` | `envelope.subject` (also added to `ward.permitted_subjects`) |
| Criticality | `criticality safety_critical \| mission_critical \| routine \| best_effort` | `ward.criticality` |
| Classification | `classification <LEVEL> [caveats "<...>"]` | `ward.classification`, `envelope.classification` |
| Allowed actions | `allow A, B, C [when <predicate>]` | `envelope.allowed_actions` + `envelope.telemetry_requirements` if `when` clause present |
| Denied actions | `deny A, B` | `envelope.denied_actions` |
| Bounds | `bound <register> <op> <value>` (e.g., `bound altitude_m <= 120`) | `ward.physical_bounds.*` |
| Boundary | `within <boundary-id>` | `ward.physical_bounds.permitted_boundary_id` |

Each `ward { ... }` block produces one `GovernanceDraft` containing one Ward and one Authority Envelope. A source file can contain multiple blocks.

## What APL does NOT express (yet)

| Missing construct | Why missing | Workaround today |
|---|---|---|
| Cross-ward references / inheritance | Each block is self-contained | Author multiple blocks, share by convention |
| Macros / reusable rule fragments | No template system | Copy-paste; consolidate in code |
| Custom predicate functions | `when` clauses only support `telemetry.<key>` boolean predicates | Express in code via `compileGovernanceManifest` + custom `constraints` |
| Importable type libraries | No `import` statement | Single-file authoring |
| Conditional escalation (`escalate if ...`) | No escalation grammar | Set `envelope.escalation_requirements` directly in code |
| Compound predicates (`A AND B OR C`) | `when` clauses are single-predicate | Author multiple `allow` lines with different `when` clauses |
| Numeric expression evaluation (`bound a * 2 <= b`) | Bounds are field-vs-literal only | Pre-compute in code |
| Subject groups / role hierarchies | One subject per envelope | Use multiple envelopes |
| Time-of-day or day-of-week constraints | No temporal grammar | Set `temporal_scope` directly in code |
| Quota / rate-limit grammar | No quota grammar | Set `budget` constraints in code |
| Federation rules in APL | Federation grammar absent | Use `@aristotle/tenant-onboarding::federateTenants` |

For non-trivial policies, callers construct `WardManifest` / `AuthorityEnvelope` objects directly in TypeScript and skip APL. This is supported and documented.

## Compilation pipeline

```
APL source (string)
  ↓ compilePolicy(source, { now? })           [policy-dsl.ts]
GovernanceDraft (Ward + Envelope objects, validated)
  ↓ compileGovernanceManifest(draft)          [builder.ts]
GovernanceManifest (with hashes: ward_hash, envelope_hash, manifest_hash)
  ↓ buildPolicyBundle(source, opts)           [policy-pipeline]
PolicyBundle (canonical, content-addressed, provenance-stamped)
  ↓ (signer? )
SignedPolicyBundle (Ed25519 or HMAC signature over bundle_hash)
  ↓ verifyPolicyBundle(signed, keyring)
{ ok, signature_ok, hash_ok, manifests_reproducible }
```

`buildPolicyBundle` enforces three reproducibility properties:
1. Same source + same `built_at` → byte-identical `bundle_hash`.
2. Tampering source breaks the source-reproducibility check.
3. Tampering manifests breaks `bundle_hash`.

## Reason-code mapping

When a Commit Gate evaluation refuses an action that violates an APL-compiled rule, the reason code is one of:

| APL construct | Reason code |
|---|---|
| `subject` mismatch | `SUBJECT_NOT_IN_WARD` |
| Action not in `allow` list | `ACTION_NOT_ALLOWED` |
| Action in `deny` list | `ACTION_DENIED` |
| `when` predicate fails | `RUNTIME_STATE_MISSING` |
| `bound` violated | `PHYSICAL_INVARIANT_FAILED` (with `physical_invariant_result.failed_predicates`) |
| `criticality: safety_critical` + degraded mode | `DEGRADED_MODE` (with REFUSE) |
| `policy_version` mismatch on runtime register | `POLICY_VERSION_MISMATCH` (with ESCALATE) |

The mapping is stable; reason codes are part of the public contract.

## Example policies that compile today

### A UAV survey range
```
ward "Montana Drone Range" {
  id montana-drone-range
  domain drone-survey
  sovereignty "private-ranch-field-test"
  version 1.0.0
  subject agent:survey-planner
  criticality safety_critical
  allow drone.takeoff, drone.scan_area when telemetry.gps_lock
  deny  drone.disable_geofence, drone.leave_boundary
  bound altitude_m <= 120
  bound battery_pct >= 20
  within ranch-test-grid-a
}
```

### A treasury refund operator (illustrative — needs in-code monetary limits today)
```
ward "Treasury Refunds" {
  id treasury-refunds
  domain payments
  sovereignty "demonstration"
  version 1.0.0
  subject agent:refund-bot
  criticality mission_critical
  allow payment.refund, payment.read when telemetry.fraud_score_below_threshold
  deny  payment.wire.external
}
# Monetary cap must be set in code today:
#   envelope.constraints = { max_monetary_limit: { currency: "USD", max_amount: 500 } }
```

## Production roadmap for APL

| Item | Status | Tracking |
|---|---|---|
| Versioned grammar specification (independent of this compiler) | NOT_YET | `ROADMAP_TO_100.md` Category 3 |
| Reusable rule fragments / macros | NOT_YET | Future work |
| Compound predicates with `AND` / `OR` | NOT_YET | Future work |
| Custom predicate functions | NOT_YET | Future work |
| Temporal grammar (`active from ... until ...`, `during business_hours`) | NOT_YET | Future work |
| Monetary / budget grammar in APL | NOT_YET | In-code workaround |
| Cross-ward references and inheritance | NOT_YET | Architectural decision needed |
| External policy-bundle registry integration | OCI bundling ships (`policy-pipeline/oci.test.ts`) | — |
| Policy linting (e.g., flag overly permissive envelopes) | NOT_YET | Future work |
| External Policy Studio UI | Out of scope for substrate | Operator tooling |

## Tests

- `policy-dsl.test.ts` (11 tests): tokenizer + compiler correctness.
- `policy-pipeline/src/index.test.ts` (13 tests): bundle + signature + reproducibility.
- `policy-pipeline/src/oci.test.ts` (5 tests): OCI-style distribution.

```sh
pnpm --filter @aristotle/execution-control-runtime test    # includes policy-dsl
pnpm --filter @aristotle/policy-pipeline test
```
