# Stryker mutation-test baseline status

**Status:** Config shipped, baseline run deferred to operator / nightly CI.

## What's shipped

- `stryker.conf.mjs` at the repo root — Stryker config pinned to the
  gate decision function + signing.ts + the property-test suites
  (`gate.property.test.ts`, `gate.replay-property.test.ts`,
  `gel.mutation.test.ts`, `index.test.ts`).
- `pnpm run mutation:gate` script that invokes Stryker via
  `pnpm dlx @stryker-mutator/core` (no permanent dep added).
- Thresholds: high 90, low 70, break 0. Goal is to drive the
  survived count to zero or to a documented "intentionally not
  covered" list.

## Why this directory is empty

The Stryker run for the gate decision function:

1. **Takes 30–90 minutes** on a developer machine. Each mutant
   triggers a fresh test run; the 4000-case property test + 26 other
   tests × hundreds of mutants is a real multi-hour operation.
2. **Downloads ~100 MB** for the Stryker core + plugins via `pnpm dlx`.
3. **Flake-sensitive in the gate.property.test.ts path** because the
   property test's randomized cases can produce different oracle
   matches per mutant — Stryker handles this with retries, but the
   retries inflate runtime further.

Running it once locally and committing the JSON + HTML report would
produce a snapshot whose mutation score is a function of:
- the random seed (`AOS_PROP_SEED`)
- the Stryker version (`@stryker-mutator/core` released since the
  config landed)
- the Node version Stryker spawned (Node 22 vs 24 vs LTS)
- the operator's CPU + concurrency setting

A snapshot from one machine isn't an authoritative baseline for the
project. Two operationally-cleaner ways to use this config:

## How to run it yourself

### Locally (developer machine)

```sh
# From the repo root:
pnpm run mutation:gate
# (Stryker downloads on first run; ~30-90 min.)
# Reports land at:
#   reports/mutation/mutation.json
#   reports/mutation/mutation.html
```

Open `reports/mutation/mutation.html` for the survived-mutant browser
view. Each survived mutant is a candidate test-quality gap.

### Nightly CI

Wire a scheduled GitHub Action that runs `pnpm run mutation:gate` and
publishes the report as a release artifact OR commits the JSON to a
separate `mutation-baseline` branch for diffing. Example skeleton:

```yaml
on:
  schedule:
    - cron: '0 4 * * *'   # 04:00 UTC daily
permissions:
  contents: write
jobs:
  mutation:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22.x' }
      - run: corepack enable && corepack prepare pnpm@10.32.1 --activate
      - run: corepack pnpm@10.32.1 install --frozen-lockfile
      - run: corepack pnpm@10.32.1 run mutation:gate
      - name: Upload mutation report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mutation-baseline-${{ github.run_id }}
          path: reports/mutation/
          retention-days: 30
```

## Interpreting results

- **Survived** — a mutation no test caught. Investigate each one;
  either add a test or document why the mutation is benign (rare).
- **Killed** — a mutation caught by at least one test. Aim for this
  count to be the bulk of mutants.
- **Mutation score** = killed / (killed + survived). Aim for >80%
  on the targeted files; >95% is exceptional.

The first run will almost certainly surface survivors. Each survivor
is real signal about a test-quality gap; relaxing the threshold is
the wrong response.

## See also

- `stryker.conf.mjs` — the config + mutator selection + thresholds
- `docs/adr/0002-deterministic-gate.md` — why the gate's purity is
  what makes mutation testing useful here at all
- ROADMAP_TO_100.md Category 1 — mutation testing as a quality bar
