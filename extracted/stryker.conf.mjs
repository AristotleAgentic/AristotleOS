/**
 * Stryker mutation-test configuration for AristotleOS.
 *
 * Closes the shippable portion of ROADMAP_TO_100.md Category 1
 * "mutation-test pass (Stryker) to identify shallow assertions" by
 * scaffolding the config + npm script. The actual run is multi-hour
 * and intentionally NOT in CI (would slow every PR by 30+ minutes);
 * run it locally as a quality baseline or wire it as a nightly job.
 *
 * USAGE
 *   pnpm dlx @stryker-mutator/core --config stryker.conf.mjs
 *   # or, with the npm script:
 *   pnpm run mutation:gate
 *
 * SCOPE
 *   First pass targets the highest-leverage substrate code: the
 *   evaluateCommitGate decision function and its supporting validators
 *   in shared/execution-control-runtime/src. These are the files whose
 *   mutation survivors would indicate the most dangerous test-quality
 *   gaps. Extending to more files is a one-line config change.
 *
 * INTERPRETING RESULTS
 *   - "Survived" mutants are mutations that NO test caught. Each
 *     survived mutant points at either a missing test case or a too-
 *     loose assertion. Goal: drive the survived count to zero (or to
 *     a documented "intentionally not covered" list).
 *   - "Killed" mutants are caught by at least one test. The killed
 *     count should be close to the total mutant count.
 *   - "Mutation score" = killed / (killed + survived). Aim for >80%
 *     on the targeted files; >95% is exceptional.
 *
 * THRESHOLDS
 *   The thresholds below are deliberately ambitious. A first run will
 *   likely surface survivors; treat each as a real test-quality issue
 *   rather than relaxing the threshold.
 */

export default {
  packageManager: "pnpm",
  reporters: ["progress", "clear-text", "json", "html"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  htmlReporter: { fileName: "reports/mutation/mutation.html" },

  // Test runner — the existing gate.property.test.ts is the single
  // strongest test for the gate decision function (4000 randomized
  // cases against an oracle); the replay-property and gel-mutation
  // tests cover the surrounding invariants.
  testRunner: "command",
  commandRunner: {
    command:
      "node --import tsx --test " +
      "shared/execution-control-runtime/src/gate.property.test.ts " +
      "shared/execution-control-runtime/src/gate.replay-property.test.ts " +
      "shared/execution-control-runtime/src/gel.mutation.test.ts " +
      "shared/execution-control-runtime/src/index.test.ts"
  },

  // Files to mutate. Start with the core gate decision function; the
  // supporting validators are intentionally included because they're
  // part of the decision pipeline.
  mutate: [
    "shared/execution-control-runtime/src/index.ts",
    "shared/execution-control-runtime/src/signing.ts",
    "!shared/execution-control-runtime/src/**/*.test.ts"
  ],

  // Concurrency: leave 1 core free so the box stays responsive.
  concurrency: Math.max(1, (require("node:os").cpus().length) - 1),

  // Don't bail early on a few survivors; we want the full picture.
  thresholds: { high: 90, low: 70, break: 0 },

  // Timeouts — the gate.property.test.ts does 4000 cases per run; under
  // mutation, every run is independent and adds setup overhead.
  timeoutMS: 300_000,
  timeoutFactor: 2.0,

  // Disable typechecking during mutation — Stryker's TS plugin runs the
  // test runner directly through tsx, which already does on-the-fly
  // TS handling.
  disableTypeChecks: "shared/execution-control-runtime/src/**/*.ts"
};
