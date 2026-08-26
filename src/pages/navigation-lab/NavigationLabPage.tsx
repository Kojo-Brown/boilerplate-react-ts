import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/shared/ui/Button";
import { TransitionLink } from "@/features/route-transition/TransitionLink";
import { useRouteTransition } from "@/features/route-transition/routeTransition";
import {
  parseBoundaryPlacement,
  parseRouteLatency,
  parseRouteRun,
  slowRouteHref,
  type BoundaryPlacement,
} from "@/pages/navigation-lab/navigationLabParams";
import { cn } from "@/shared/lib/cn";

/**
 * Harness for held route transitions.
 *
 * The configuration lives in the URL so a run is shareable, and the two
 * boundary placements are one click apart — the comparison is the lesson and
 * it does not survive being described. `per-route` puts a `<Suspense>` inside
 * the destination's route element, which is what this app used to do for every
 * route; `hoisted` leaves the one boundary in `RootLayout` to catch it.
 *
 * The counter is the part that is otherwise unprovable. That the previous page
 * is still *painted* during a hold is visible; that it is still *live* is a
 * claim about whether React is willing to process events against it, and a
 * frozen screenshot would look identical.
 */
export function NavigationLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const placement = parseBoundaryPlacement(searchParams.get("boundary"));
  const latencyMs = parseRouteLatency(searchParams.get("latency"));
  const run = parseRouteRun(searchParams.get("run"));

  const { isPending, pendingHref } = useRouteTransition();
  const [clicks, setClicks] = useState(0);

  const setParam = (key: string, value: string): void => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Route Transition Lab</h1>
        <p className="max-w-3xl text-[var(--color-muted-fg)]">
          Both arms navigate identically — same link, same transition. The only difference is where
          the destination&apos;s Suspense boundary lives. With the boundary <strong>hoisted</strong>{" "}
          above <code>&lt;Outlet&gt;</code>, this page stays on screen and stays clickable while the
          next route loads. With a boundary <strong>inside the route element</strong>, React has a
          brand-new boundary with nothing revealed in it yet, so it commits that boundary&apos;s
          fallback immediately and this page is gone.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2" role="group" aria-label="Boundary placement">
          <ModeButton current={placement} value="hoisted" param="boundary" onSelect={setParam}>
            Hoisted boundary
          </ModeButton>
          <ModeButton current={placement} value="per-route" param="boundary" onSelect={setParam}>
            Boundary in the route
          </ModeButton>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
          Latency
          <select
            value={String(latencyMs)}
            data-testid="route-latency-select"
            onChange={(event) => {
              setParam("latency", event.target.value);
            }}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[var(--color-fg)]"
          >
            <option value="0">Instant</option>
            <option value="600">Fast</option>
            <option value="1500">Normal</option>
            <option value="5000">Slow</option>
          </select>
        </label>

        <TransitionLink
          to={slowRouteHref(placement, latencyMs, run + 1)}
          data-testid="open-slow-route"
          className={cn(
            "inline-flex h-9 items-center rounded-[var(--radius-md)] px-4 text-sm font-medium",
            "bg-[var(--color-primary)] text-[var(--color-primary-fg)]",
            "hover:bg-[var(--color-primary-hover)]",
          )}
        >
          Open the slow route
        </TransitionLink>
      </div>

      <section
        aria-labelledby="probe-title"
        className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
      >
        <h2 id="probe-title" className="text-base font-semibold">
          Interactivity probe
        </h2>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Click the slow route, then keep clicking this. Under a held transition the count keeps
          going up: the page is not a screenshot, it is still mounted and still processing events.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            data-testid="interactivity-probe"
            onClick={() => {
              setClicks((current) => current + 1);
            }}
          >
            Clicked {clicks} times
          </Button>
          <span data-testid="pending-readout" className="text-sm text-[var(--color-muted-fg)]">
            {isPending && pendingHref !== null
              ? `Navigating to ${pendingHref} — this page is being held`
              : "Idle"}
          </span>
        </div>
      </section>
    </main>
  );
}

interface ModeButtonProps {
  current: BoundaryPlacement;
  value: BoundaryPlacement;
  param: string;
  onSelect: (key: string, value: string) => void;
  children: React.ReactNode;
}

function ModeButton({ current, value, param, onSelect, children }: ModeButtonProps) {
  return (
    <Button
      variant={current === value ? "primary" : "ghost"}
      aria-pressed={current === value}
      onClick={() => {
        onSelect(param, value);
      }}
    >
      {children}
    </Button>
  );
}
