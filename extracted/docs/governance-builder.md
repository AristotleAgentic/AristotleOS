# Visual Governance Builder

Define AristotleOS governance visually and get a **real** artifact out — a Ward
Manifest + Authority Envelope, validated, hashed, and explained. There is no
invented "policy bytecode": the compiled output is the manifest itself plus content
hashes, and what it permits/refuses/escalates is computed by running sample actions
through the real Commit Gate.

## Backend (the seam the UI builds on)

The builder logic lives in `@aristotle/execution-control-runtime` so the UI is a
thin form over deterministic, tested functions:

| Function | Purpose |
|----------|---------|
| `compileGovernanceManifest({ ward, authorityEnvelope })` | validate (real validators + cross-artifact coherence), hash (ward / envelope / manifest), return a `GovernanceManifest` |
| `diffGovernanceManifests(before, after)` | governance-aware diff; each entry carries a **`weakening`** flag |
| `explainPolicy({ ward, authorityEnvelope, sampleActions })` | the allow/deny surface, constraints, and the gate decision for each sample |

`GovernanceManifest` (`aristotle.governance-manifest.v1`) is the exportable
artifact: `{ ward, authority_envelope, hashes, validation }`.

## No silent weakening

`diffGovernanceManifests` marks every change that **broadens authority** —
adding an allowed action, removing a denied action, raising a numeric constraint
(e.g. `max_amount`), removing a required Runtime Register, extending expiry, adding
a permitted subject, raising the altitude ceiling, lowering the battery floor. A
builder UI must present these as reviewed governance diffs, never apply them
silently. The CLI `governance diff` exits non-zero when any change weakens
authority, so a review gate can require sign-off.

## CLI

```bash
# Compile + validate + hash a draft into a manifest
aristotle governance compile --ward ward.yaml --envelope envelope.yaml --out manifest.json

# Diff two drafts; ⚠ flags changes that weaken authority (exit 1 if any)
aristotle governance diff --ward base-ward.yaml --envelope base-env.yaml \
  --against-ward new-ward.yaml --against-envelope new-env.yaml

# Explain what the policy does for sample actions
aristotle governance explain --ward ward.yaml --envelope envelope.yaml --actions samples.json
```

## UI integration boundary (next layer)

The operator UI (a Command Center surface) is form-based + visual editing over the
three functions above: edit Ward/Authority fields → `compileGovernanceManifest`
for live validation + the manifest hash → `diffGovernanceManifests` for the diff
preview (weakening highlighted) → `explainPolicy` for the permits/refuses/escalates
panel → export the `GovernanceManifest`. The UI holds no governance logic of its
own; it renders these results. (UI wiring is pending the in-flight console-ui work
to avoid collision.)
