import { useState, type ComponentType } from "react";
import { cn } from "@/lib/cn";
import { Text } from "@/components/ui/Text";
import { Button } from "@/components/ui/Button";
import { MediaQuery } from "@/components/patterns/MediaQuery";
import { withMediaQuery, type MediaQueryInjectedProps } from "@/components/patterns/withMediaQuery";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const MEDIA_QUERIES = [
  { label: "≥ 48rem", query: "(min-width: 48rem)" },
  { label: "≥ 64rem", query: "(min-width: 64rem)" },
  { label: "landscape", query: "(orientation: landscape)" },
  { label: "reduced motion", query: "(prefers-reduced-motion: reduce)" },
] as const;

type LabQuery = (typeof MEDIA_QUERIES)[number]["query"];

interface MatchCardProps extends MediaQueryInjectedProps {
  /** Which delivery mechanism produced the value. */
  source: string;
}

function MatchCard({ matches, source }: MatchCardProps) {
  return (
    <div
      data-testid={`card-${source}`}
      data-matches={String(matches)}
      className={cn(
        "flex flex-1 flex-col gap-1 rounded-[var(--radius-lg)] border p-4",
        matches
          ? "border-[var(--color-primary)]"
          : "border-[var(--color-border)] text-[var(--color-muted-fg)]",
      )}
    >
      <Text as="h3" size="sm" weight="semibold">
        {source}
      </Text>
      <Text size="lg" weight="bold">
        {String(matches)}
      </Text>
    </div>
  );
}

/**
 * One wrapper per query, built at module scope.
 *
 * This is not defensive style, it is the HOC's shape showing through. A hook
 * takes its argument at *call* time, so `useMediaQuery(query)` follows a piece
 * of state for free. A HOC takes its argument at *wrap* time, so a query that
 * varies means either a component type that varies with it — a remount on
 * every change, demonstrated further down this page — or every value it can
 * take being enumerated up front, as here.
 *
 * Spelling the keys out twice is the price of `Record<LabQuery, …>` checking
 * that the table covers the union. A `map` over `MEDIA_QUERIES` would build
 * the same object with a cast standing where the check used to be.
 */
const HOC_CARDS: Record<LabQuery, ComponentType<{ source: string }>> = {
  "(min-width: 48rem)": withMediaQuery(MatchCard, "(min-width: 48rem)"),
  "(min-width: 64rem)": withMediaQuery(MatchCard, "(min-width: 64rem)"),
  "(orientation: landscape)": withMediaQuery(MatchCard, "(orientation: landscape)"),
  "(prefers-reduced-motion: reduce)": withMediaQuery(MatchCard, "(prefers-reduced-motion: reduce)"),
};

interface CounterCardProps extends MediaQueryInjectedProps {
  source: string;
}

/** State is the whole point: a remount is invisible without something to lose. */
function CounterCard({ matches, source }: CounterCardProps) {
  const [clicks, setClicks] = useState(0);
  return (
    <div className="flex flex-1 flex-col items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      <Text as="h3" size="sm" weight="semibold">
        {source}
      </Text>
      <Button
        size="sm"
        variant="secondary"
        data-testid={`count-${source}`}
        onClick={() => {
          setClicks((n) => n + 1);
        }}
      >
        clicked {clicks}×
      </Button>
      <Text size="sm" tone="muted">
        matches: {String(matches)}
      </Text>
    </div>
  );
}

/** Created once, when this module was evaluated. */
const StableCounter = withMediaQuery(CounterCard, MEDIA_QUERIES[0].query);

function RemountDemo() {
  const [tick, setTick] = useState(0);

  /*
   * The mistake, written on purpose.
   *
   * `withMediaQuery(...)` returns a new function every call, and React
   * compares element types by identity to decide between updating a fiber and
   * replacing it. A wrapper built here is a different component type on every
   * render of this one, so the subtree below is unmounted and rebuilt: state
   * gone, effects re-run, DOM nodes replaced — and with them focus, scroll
   * position and any selection.
   *
   * Nothing reports it. The counter on the right keeps working perfectly and
   * simply forgets, which is why the button beside it is the only way to see
   * the difference.
   */
  // The rule firing on this is itself part of the exhibit — it is what stops
  // the mistake being written by accident in real code. The `eslint-disable`
  // sits on the usage below rather than here, because that is where
  // `react-hooks/static-components` reports it: the defect is not creating a
  // component type, it is *rendering* one that will not be there next time.
  const UnstableCounter = withMediaQuery(CounterCard, MEDIA_QUERIES[0].query);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          data-testid="rerender-parent"
          onClick={() => {
            setTick((n) => n + 1);
          }}
        >
          Re-render the parent
        </Button>
        <Text size="sm" tone="muted">
          rendered {tick + 1}×
        </Text>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <StableCounter source="module-scope" />
        {/* eslint-disable-next-line react-hooks/static-components -- see above */}
        <UnstableCounter source="created-in-render" />
      </div>
    </div>
  );
}

/**
 * Harness for render props and higher-order components against the hook that
 * replaced both.
 *
 * Two things here are worth driving by hand rather than reading about.
 *
 * The top row is one capability delivered three ways, all subscribed to the
 * query you picked. Resize the window across the breakpoint and all three
 * flip together, because there is one implementation underneath and two
 * twelve-line adapters. That is the doc's argument, and it is more convincing
 * as three numbers changing at the same instant than as a paragraph.
 *
 * The bottom row is the HOC defect that has no error message. Click each
 * counter a few times, then re-render the parent: the left one keeps its
 * count and the right one is back to zero, because its wrapper was built
 * during render and is therefore a different component type every time.
 * A screenshot cannot tell the two apart, which is exactly the problem.
 */
export function RenderPropsLabPage() {
  const [query, setQuery] = useState<LabQuery>(MEDIA_QUERIES[0].query);
  const hookMatches = useMediaQuery(query);
  const HocCard = HOC_CARDS[query];

  return (
    <main className="flex flex-col gap-10 p-8">
      <header className="flex flex-col gap-2">
        <Text as="h1" size="2xl" weight="bold">
          Render Props &amp; HOCs Lab
        </Text>
        <Text tone="muted" className="max-w-2xl">
          One media-query subscription, delivered as a hook, as a render prop and as a higher-order
          component. Resize the window and watch all three agree — then look at what the two older
          mechanisms cost.
        </Text>
      </header>

      <section className="flex flex-col gap-4">
        <Text as="h2" size="xl" weight="semibold">
          Three deliveries, one implementation
        </Text>

        <div className="flex flex-wrap gap-2">
          {MEDIA_QUERIES.map(({ label, query: value }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setQuery(value);
              }}
              aria-pressed={query === value}
              className={cn(
                "rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 font-mono text-xs",
                query === value
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                  : "hover:bg-[var(--color-muted)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Text size="sm" tone="muted">
          Watching <code data-testid="chosen-query">{query}</code>
        </Text>

        <div className="flex flex-col gap-4 sm:flex-row">
          <MatchCard source="hook" matches={hookMatches} />

          {/*
            The render prop. Note that the value has to come back out through a
            function: it does not exist until `<MediaQuery>` has rendered, so
            there is nothing to hand the caller any earlier.
          */}
          <MediaQuery query={query}>
            {(matches) => <MatchCard source="render-prop" matches={matches} />}
          </MediaQuery>

          {/*
            The HOC. `HOC_CARDS` is a lookup rather than a call because calling
            it here would rebuild the component type on every render — the
            defect the next section is about.
          */}
          <HocCard source="hoc" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <Text as="h2" size="xl" weight="semibold">
          Where a HOC is built decides whether it keeps its state
        </Text>
        <Text tone="muted" className="max-w-2xl">
          Both counters below are the same component behind the same HOC. The only difference is
          that one wrapper was created when this module loaded and the other is created during every
          render of its parent.
        </Text>
        <RemountDemo />
      </section>
    </main>
  );
}
