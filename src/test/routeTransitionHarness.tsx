import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { RouteTransitionProvider } from "@/features/route-transition/routeTransition";
import { RoutePrefetchProvider } from "@/features/route-prefetch/routePrefetch";
import type { ChunkRegistry, IdleScheduler } from "@/shared/lib/idlePrefetchQueue";
import { createManualIdleScheduler } from "@/test/prefetch";
import { TestI18nProvider } from "@/test/intl";
import { DEFAULT_LOCALE, type LocaleTag } from "@/shared/i18n/locales";

const NO_CHUNKS: ChunkRegistry = {};

export interface RouteTransitionHarnessProps {
  children: ReactNode;
  initialEntries?: string[];
  /**
   * Routes the prefetcher knows how to load. Empty by default: a test that
   * only renders links has nothing it wants fetched, and the queue refuses
   * hrefs it has no loader for, so requests from those links go nowhere.
   */
  prefetchRegistry?: ChunkRegistry;
  /**
   * Defaults to a manual scheduler that is never flushed, so nothing dispatches
   * unless the test asks. The real one would fall back to a `setTimeout` under
   * jsdom and fire mid-assertion.
   */
  prefetchScheduler?: IdleScheduler;
  /**
   * The locale the subtree renders in. Defaults to `en-GB`.
   *
   * The i18n provider is one of the contexts a navigation-aware component needs
   * now that the nav labels, the sidebar landmark and the skip link come from a
   * catalogue: `useIntl()` throws without it, exactly as the two providers below
   * do. Passing `"ar-EG"` is how a layout test asserts that the shell mirrors.
   */
  locale?: LocaleTag;
}

/**
 * The contexts every navigation-aware link needs.
 *
 * `<RouteTransitionProvider>` and `<RoutePrefetchProvider>` both throw rather
 * than defaulting when absent, so a component that navigates or prefetches
 * cannot be rendered bare in a test and still behave the way it does in the
 * app. Supplying them here keeps that strictness from turning into boilerplate
 * at every call site.
 */
export function RouteTransitionHarness({
  children,
  initialEntries = ["/"],
  prefetchRegistry = NO_CHUNKS,
  prefetchScheduler,
  locale = DEFAULT_LOCALE,
}: RouteTransitionHarnessProps) {
  // Held in state rather than created inline: a fresh scheduler identity on
  // every render would rebuild the queue and throw away its state each time.
  const [fallbackScheduler] = useState(createManualIdleScheduler);
  const scheduler = prefetchScheduler ?? fallbackScheduler;

  return (
    <TestI18nProvider locale={locale}>
      <MemoryRouter initialEntries={initialEntries}>
        <RouteTransitionProvider>
          <RoutePrefetchProvider registry={prefetchRegistry} scheduler={scheduler}>
            {children}
          </RoutePrefetchProvider>
        </RouteTransitionProvider>
      </MemoryRouter>
    </TestI18nProvider>
  );
}
