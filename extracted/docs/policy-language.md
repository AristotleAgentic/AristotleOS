# Aristotle Policy Language (APL)

APL is a small, typed governance language that compiles to the **existing** Ward +
Authority Envelope manifests. It is a front-end, not a parallel system: the
compiler's only output is the same `GovernanceDraft` the rest of the stack already
consumes (validate → content-addressed manifest → Commit Gate → GEL). Authoring a
policy as code gets you review, diff, versioning, and a single artifact to hash and
anchor — without a second runtime to trust.

## Why

Hand-writing two YAML/JSON files (a Ward and an Authority Envelope) and keeping them
consistent is error-prone. APL expresses the *intent* once, in one block, and the
compiler derives both — deterministically, with fail-fast `file:line:column`
diagnostics and enum validation (criticality, classification level).

## Example

```apl
ward "Montana Drone Range" {
  id          montana-drone-range
  domain      drone-swarm-ops
  sovereignty "private-ranch-field-test"
  version     0.1.0
  subject     agent:survey-planner
  criticality safety_critical
  classification CUI caveats "NOFORN"

  allow drone.takeoff, drone.scan_area when telemetry.gps_lock
  deny  drone.disable_geofence, drone.leave_boundary

  bound altitude_m <= 120
  bound battery_pct >= 20
  within ranch-test-grid-a
}
```

```bash
aristotle policy check   examples/policy/montana_drone_range.apl   # validate only (CI gate)
aristotle policy compile examples/policy/montana_drone_range.apl --out manifest.json
```

`compile` prints, per ward, the content-addressed `manifest_hash` and an allow/deny
count, and exits non-zero if any manifest fails validation. `check` validates and
exits non-zero on the first diagnostic — drop it into CI to keep policy honest.

## Grammar (v1)

One file holds one or more `ward "<name>" { ... }` blocks. Statements inside a block:

| Statement | Maps to | Notes |
|---|---|---|
| `id <ward-id>` | `ward.ward_id` | defaults to a slug of the name |
| `name` (the `"<name>"`) | `ward.name` | required (the block header) |
| `domain <ident>` | `ward.authority_domain` | default `default-domain` |
| `sovereignty "<text>"` | `ward.sovereignty_context` | default `unspecified` |
| `version <semver>` | `ward.policy_version` | default `0.1.0` |
| `subject <subject>` | `permitted_subjects` + envelope `subject` | **required** |
| `envelope <id>` | `authority_envelope.envelope_id` | default `ae-<ward-id>` |
| `issuer "<text>"` | `authority_envelope.issuer` | default `aristotle-root` |
| `expires "<iso8601>"` | `authority_envelope.expires_at` | default far-future |
| `criticality <level>` | `ward.criticality` | `safety_critical \| mission_critical \| routine \| best_effort` |
| `classification <LEVEL> [caveats "A", "B"]` | `ward`/envelope `classification` | `UNCLASSIFIED \| CUI \| CONFIDENTIAL \| SECRET \| TOP_SECRET` |
| `allow a, b [when r1, r2]` | `allowed_actions` (+ required registers) | repeatable; `when` adds runtime-register requirements |
| `deny a, b` | `denied_actions` | repeatable |
| `require r1, r2` | `constraints.required_runtime_registers` | repeatable |
| `bound altitude_m <= N` | `physical_bounds.max_altitude_m` + constraint | |
| `bound battery_pct >= N` | `physical_bounds.battery_minimum_pct` | |
| `within <boundary-id>` | `physical_bounds.permitted_boundary_id` + constraint | |

Comments start with `#`. Strings are double-quoted; identifiers may contain
`. : / _ -` (so `drone.takeoff`, `agent:survey-planner`, `telemetry.gps_lock`, and
semver are bare idents). Numbers are used only in `bound`.

## Guarantees

- **Deterministic** — same source ⇒ same manifest ⇒ same `manifest_hash`.
- **Validated** — enum values and required fields are checked at compile time; the
  resulting draft is then run through the standard governance validator/hasher.
- **No new trust** — APL adds zero runtime surface; it only produces the manifests
  the gate already enforces. Library: `compilePolicy(source)` in
  `shared/execution-control-runtime/src/policy-dsl.ts`.

## Not in v1 (honest scope)

Imports/includes, variables/macros, multiple subjects per envelope, and richer
bound expressions are deliberately out of scope for v1 — the grammar is kept small
and total so the compiler stays deterministic and auditable. Author multiple
envelopes as multiple `ward` blocks for now.
