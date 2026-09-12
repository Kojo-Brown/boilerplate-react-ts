/**
 * The application's one reporter, built from configuration.
 *
 * This is the composition root's half of the seam: the only module that knows
 * which transport is real, so every consumer below reads an `ErrorReporter`
 * from context and none of them imports a backend. Swapping in Sentry proper
 * is a change to `pickTransport` and nothing else.
 *
 * A module-scope singleton rather than something built in a component: the
 * reporter holds the breadcrumb ring and the dedupe window, and rebuilding it
 * would drop every crumb collected so far and forget what it last sent. It is
 * also needed before React exists — `main.tsx` passes `onUncaughtError` to
 * `createRoot`, and an error thrown during the first render has to be
 * reportable by something that already exists.
 */

import { env } from "@/shared/config/env";
import {
  createBeaconTransport,
  createConsoleTransport,
  createReporter,
  noopTransport,
  type ErrorReporter,
  type ErrorTransport,
} from "@/shared/observability/errorReporter";
import { createBreadcrumbBuffer } from "@/shared/observability/breadcrumbs";

function pickTransport(): ErrorTransport {
  if (env.VITE_ERROR_REPORT_URL !== "") {
    return createBeaconTransport(env.VITE_ERROR_REPORT_URL);
  }
  // A development build with no collector still wants to see what *would*
  // have been sent — including the breadcrumb trail, which is the part that is
  // hard to reconstruct after the fact.
  return import.meta.env.DEV ? createConsoleTransport() : noopTransport;
}

/**
 * Unlike `createSinkFromEnv` for vitals, this never returns `null`.
 *
 * Vitals can decline to subscribe when unconfigured, because the cost it
 * avoids is three `PerformanceObserver`s running for nothing. Here there is no
 * equivalent standing cost — the work happens only when something throws — and
 * a `null` reporter would mean every call site handles absence, on the error
 * path, where a missed branch is a crash inside a crash.
 */
export const reporter: ErrorReporter = createReporter({
  transport: pickTransport(),
  breadcrumbs: createBreadcrumbBuffer(),
  tags: {
    environment: import.meta.env.DEV ? "development" : "production",
    ...(env.VITE_RELEASE !== "" ? { release: env.VITE_RELEASE } : {}),
  },
});
