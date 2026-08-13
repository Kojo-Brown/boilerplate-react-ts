import { Suspense, use } from "react";
import { useSearchParams } from "react-router";
import { TransitionLink } from "@/components/navigation/TransitionLink";
import { PageLoader } from "@/components/ui/PageLoader";
import { ROUTES } from "@/router/paths";
import { createSlowRouteCache, slowRouteKey, type SlowRouteCache } from "@/lib/slowRoute";
import {
  parseBoundaryPlacement,
  parseRouteLatency,
  parseRouteRun,
} from "@/pages/navigationLabParams";

/**
 * The cache the lab suspends on when nothing is injected.
 *
 * Module scope rather than per-render, for the reason `createPromiseCache`
 * exists: a cache built during render hands `use()` a different promise every
 * pass and the fallback never leaves.
 */
const defaultCache = createSlowRouteCache();

export interface SlowRouteLabPageProps {
  /** Injected by tests so a run settles on command instead of on a timer. */
  cache?: SlowRouteCache;
}

/** The destination. Suspends for the configured latency, then renders. */
export function SlowRouteLabPage({ cache = defaultCache }: SlowRouteLabPageProps) {
  const [searchParams] = useSearchParams();
  const latencyMs = parseRouteLatency(searchParams.get("latency"));
  const run = parseRouteRun(searchParams.get("run"));

  use(cache.read(slowRouteKey(latencyMs, run)));

  return (
    <main className="flex flex-col gap-4 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Slow route</h1>
      <p className="max-w-2xl text-[var(--color-muted-fg)]">
        This took {latencyMs}ms to arrive. Whether the lab page stayed on screen and stayed
        clickable for that whole time was decided by where its Suspense boundary was, not by how the
        navigation was started.
      </p>
      <TransitionLink
        to={ROUTES.NAVIGATION_LAB}
        className="text-[var(--color-primary)] underline underline-offset-4"
      >
        Back to the lab
      </TransitionLink>
    </main>
  );
}

/**
 * The route element, which is where the arm is actually chosen.
 *
 * Reading the parameter here rather than in the route config is what makes the
 * comparison possible at all: a route's element is fixed when the router is
 * built, so the only way to have both shapes in one app is for the element to
 * decide. Wrapping in a `<Suspense>` at this depth reproduces exactly what
 * every route in this app used to do.
 */
export function SlowRouteLabRoute() {
  const [searchParams] = useSearchParams();
  const placement = parseBoundaryPlacement(searchParams.get("boundary"));

  if (placement === "per-route") {
    return (
      <Suspense fallback={<PageLoader />}>
        <SlowRouteLabPage />
      </Suspense>
    );
  }

  return <SlowRouteLabPage />;
}
