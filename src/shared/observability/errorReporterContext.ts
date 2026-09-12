import { createContext, use } from "react";
import {
  createReporter,
  noopTransport,
  type ErrorReporter,
} from "@/shared/observability/errorReporter";

/**
 * A reporter that shapes events and sends them nowhere.
 *
 * This is the default context value, and the choice is the opposite of the one
 * `apiClientContext.ts` makes — that one defaults to `null` so a component
 * rendered outside its provider fails loudly. Here a throw would fire inside
 * `componentDidCatch`, i.e. while React is already unwinding from one error,
 * and would replace the fallback the user was about to see with a blank page.
 * "Reporting was not configured" is a deployment mistake; "the error screen
 * itself crashed" is an outage.
 *
 * It is a real reporter over {@link noopTransport} rather than a stub of hand-
 * written no-ops, so the shaping code runs in every configuration. A
 * `captureException` that only throws in production because that is the only
 * build where the real reporter is reached is exactly the bug this removes.
 */
export const fallbackReporter: ErrorReporter = createReporter({ transport: noopTransport });

export const ErrorReporterContext = createContext<ErrorReporter>(fallbackReporter);

/**
 * The {@link ErrorReporter} for this subtree.
 *
 * Never throws and never returns `null`: see {@link fallbackReporter}. A test
 * that wants to assert on reported events supplies its own via
 * `<ErrorReporterProvider>`, rather than this hook signalling absence.
 */
export function useErrorReporter(): ErrorReporter {
  return use(ErrorReporterContext);
}
