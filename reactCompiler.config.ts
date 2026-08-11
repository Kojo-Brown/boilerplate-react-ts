/**
 * Single source of truth for the React Compiler.
 *
 * Four consumers read this object and they must agree, or the guarantees stop
 * meaning anything:
 *
 * - `vite.config.ts` — compiles the production bundle.
 * - `vitest.config.ts` — compiles the code the unit suite executes, so tests
 *   run the same output the browser gets. Without this, removing a `useMemo`
 *   would be "verified" against source that was never compiled.
 * - `eslint.config.ts` — the `react-hooks` rules are the compiler's own
 *   diagnostics; pointing them at a different config would report on code that
 *   is not the code being built.
 * - `src/test/reactCompiler.audit.test.ts` — asserts every opted-in function
 *   actually compiles.
 */

/**
 * `annotation` is what makes adoption incremental: the compiler touches a
 * function only when it opts in with the `"use memo"` directive. Everything
 * else is emitted untouched, so this can land without re-memoizing 78 test
 * files' worth of behaviour in one commit.
 *
 * The alternative modes are deliberately not used yet:
 * - `infer` (the default) compiles everything it judges to be a component or
 *   hook. That is the end state, not the first step.
 * - `all` compiles every function, including plain helpers.
 *
 * See `docs/react-compiler.md` for the opt-in cohort and what has to be true
 * before a file joins it.
 */
export const reactCompilerConfig = {
  compilationMode: "annotation",
  /**
   * React 19 ships the compiler runtime (`react/compiler-runtime`) in the
   * `react` package itself, so no `react-compiler-runtime` polyfill is needed.
   * This must track the `react` major in package.json.
   */
  target: "19",
} as const;

/** The Babel plugin entry, in the shape both Vite and Vitest expect. */
export const reactCompilerBabelPlugin = [
  "babel-plugin-react-compiler",
  reactCompilerConfig,
] as const;
