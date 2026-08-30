import type { Endpoint } from "comlink";
import { exposeCsvParser } from "@/shared/lib/csvParserApi";

/**
 * The CSV parser worker's entry point.
 *
 * Everything it does is one call, and that is the design rather than an
 * accident of a small feature: jsdom implements no `Worker`, so a module that
 * only runs inside one cannot be covered by the unit suite at all. Keeping the
 * entry to a single line means the untested surface is a single line — the
 * behaviour lives in `csvParserApi.ts`, which the tests drive over a real
 * `MessageChannel`, and the fact that this file loads at all is covered by
 * `e2e/worker-parsing.spec.ts` in a real browser.
 *
 * The cast is unavoidable. Inside a dedicated worker `globalThis` is a
 * `DedicatedWorkerGlobalScope`, which does have `postMessage`,
 * `addEventListener` and `removeEventListener` — but this project compiles
 * against the `DOM` lib, where `globalThis` is typed as a `Window` whose
 * `postMessage` takes a target origin. There is no `lib` that describes both,
 * and adding `webworker` to the project's would retype `self` everywhere else.
 */
exposeCsvParser(globalThis as unknown as Endpoint);
