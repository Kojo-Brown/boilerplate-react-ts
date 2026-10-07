import { z } from "zod";

/**
 * The application's Zod, configured once.
 *
 * `jitless: true` turns off Zod 4's JIT object parser, and the reason is the
 * Content-Security-Policy. `$ZodObjectJIT` compiles a specialised parse
 * function for every `z.object()` with `new Function`, which `script-src`
 * refuses without `'unsafe-eval'` — and `'unsafe-eval'` would undo most of
 * what the nonce buys, since the first thing an injected string gets handed to
 * in a real exploit is an evaluator.
 *
 * Zod already handles the refusal: it probes `new Function` once inside a
 * `try`, caches the answer on `util.allowsEval`, and falls back to the
 * interpreted path. So this is not a bug fix — nothing was broken — it is the
 * removal of a probe whose cost is one `securitypolicyviolation` report **per
 * page load**, on a reporting channel whose whole value is that something
 * appearing in it means something is wrong. A policy whose reports are mostly
 * one known false alarm is a policy nobody reads.
 *
 * It has to be set before the first schema is constructed, because each
 * `z.object()` reads `globalConfig.jitless` once, at construction, and keeps
 * the answer. Importing `z` from here rather than from `"zod"` is what
 * guarantees the ordering for every schema in the application, whatever the
 * module graph happens to look like — and `zod.test.ts` is what keeps that
 * true, by failing when a module imports `"zod"` directly.
 *
 * See `docs/csp.md`.
 */
z.config({ jitless: true });

export { z };
