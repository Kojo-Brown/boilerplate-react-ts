/**
 * Mutation testing: does the suite in `vitest.config.ts` actually *assert*?
 *
 * Coverage says a line ran. It cannot say the line mattered. Stryker answers
 * the other question — it changes the source one edit at a time (`<=` becomes
 * `<`, a branch becomes `false`, a string becomes `""`) and re-runs the tests
 * that cover that line. A mutant the suite still passes is a line whose
 * behaviour no assertion pins down.
 *
 * `pnpm test:mutation` is the gate; `thresholds.break` below is what makes it
 * one. The coverage thresholds in `vitest.config.ts` are the other half of the
 * pair and measure a different thing: they say how much of the code the tests
 * reach, this says how much of it they hold still.
 *
 * See docs/mutation-testing.md — in particular before changing `mutate` or
 * `thresholds.break`, both of which are easy to "fix" by making the gate
 * measure less.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: "pnpm",

  testRunner: "vitest",

  // Explicit, rather than relying on the default `['@stryker-mutator/*']`
  // glob. That glob is resolved against `node_modules/@stryker-mutator/*`,
  // which under pnpm holds only this project's direct dependencies as
  // symlinks — the runner is there, but the glob walks the real paths under
  // `.pnpm` and comes back empty. The failure is `Cannot find TestRunner
  // plugin "vitest". In fact, no TestRunner plugins were loaded`, which reads
  // like a missing dependency and is not one.
  plugins: ["@stryker-mutator/vitest-runner"],

  vitest: { configFile: "vitest.config.ts" },

  // Stryker records which tests touch which line during the initial run and
  // then runs only those per mutant — about 4 of 3,400 tests per mutant
  // instead of all of them. Without it this config would not finish inside a
  // CI job: the suite is jsdom and takes two and a half minutes, which is a
  // price worth paying once and not 363 times.
  coverageAnalysis: "perTest",

  /**
   * The scope: modules that decide something, where a weak assertion is a bug
   * waiting to happen rather than a cosmetic gap.
   *
   * Deliberately not `src/shared/**`. That is ~12,000 lines and most of it is
   * React — a component's mutants are overwhelmingly about which class name
   * or ARIA attribute came out, which the a11y gate and the component tests
   * already hold, and each one costs a jsdom mount to evaluate. These eight
   * are the ones where the mutants Stryker generates map onto real failures: a
   * boundary off by one, a security carve-out that stops carving, a comparator
   * that disagrees with itself, a redaction that stops redacting.
   *
   * Adding a module here is welcome. Removing one to recover a threshold is
   * the thing docs/mutation-testing.md asks you not to do.
   */
  mutate: [
    "src/shared/lib/paginationRange.ts",
    "src/shared/lib/sanitizeHtml.ts",
    "src/shared/lib/retrySchedule.ts",
    "src/shared/lib/filterableItems.ts",
    "src/shared/lib/optimisticList.ts",
    "src/shared/observability/redact.ts",
    "src/shared/i18n/negotiateLocale.ts",
    "src/shared/offline/routing.ts",
  ],

  reporters: ["html", "clear-text", "progress"],

  // Survivors are the output worth reading; the tests that killed a mutant are
  // not, and at ~363 mutants listing them buries the report in a CI log.
  clearTextReporter: { reportTests: false },

  htmlReporter: { fileName: "reports/mutation/index.html" },

  /**
   * `break` is the gate: Stryker exits non-zero below it.
   *
   * 96 against a measured 97.80 — about seven mutants of room. The gap is not
   * slack to spend. It is there because what survives in this scope is now
   * *equivalent*: a mutant describing a program indistinguishable from the
   * original, which no test can kill, and which ones Stryker generates shifts
   * with refactors that change no behaviour at all.
   * docs/mutation-testing.md lists every survivor as of this writing with the
   * argument for each, so the first question about a red run is which column
   * moved — a drop in `# killed` is a weakened test, a jump in `# survived` on
   * an untouched file is usually a new equivalent mutant. Raise this when the
   * real score rises; do not lower it to make a red build green.
   *
   * `high`/`low` only colour the HTML report.
   */
  thresholds: { high: 99, low: 96, break: 96 },

  tempDirName: ".stryker-tmp",
};
