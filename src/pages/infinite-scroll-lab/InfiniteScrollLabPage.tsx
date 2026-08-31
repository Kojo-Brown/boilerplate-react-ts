import { useSearchParams } from "react-router";
import { Button } from "@/shared/ui/Button";
import { InfiniteFeed } from "@/entities/post/InfiniteFeed";
import { useInfiniteFeed } from "@/entities/post/useInfiniteFeed";
import {
  PREFETCH_MARGIN_PX,
  PREFETCH_MODES,
  parsePrefetchMode,
  type PrefetchMode,
} from "@/pages/infinite-scroll-lab/infiniteScrollLabParams";

const MODE_LABEL: Record<PrefetchMode, string> = {
  eager: "Prefetch 600px early",
  end: "Load at the bottom",
};

/**
 * Windowed infinite scroll, with the prefetch distance as the only variable.
 *
 * Both arms are the same `InfiniteFeed` over the same 5,000-row mock feed. The
 * `end` arm is what an infinite list usually does — the request begins when
 * the user reaches the bottom, so the spinner is unavoidable. The `eager` arm
 * moves the tripwire 600px earlier, which is roughly one flick, and the page
 * is generally already in the cache by the time its rows are needed.
 *
 * The claim this page cannot make on its own is the windowing one: the number
 * of rows actually in the DOM stays flat while `items` climbs into the
 * thousands. Counting them needs a browser with a layout, so
 * `e2e/windowed-infinite-scroll.spec.ts` asserts it there — in jsdom the
 * virtualizer cannot run at all.
 */
export function InfiniteScrollLabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = parsePrefetchMode(searchParams.get("prefetch"));

  // The same query the feed below is rendering: one cache entry, one request
  // per page, read twice. No lifting, no duplicated fetch.
  const { items, total, pagesLoaded, hasNextPage, isFetchingNextPage } = useInfiniteFeed();

  return (
    <section className="flex flex-col gap-6 p-6" aria-labelledby="infinite-scroll-lab-heading">
      <header className="flex flex-col gap-2">
        <h1 id="infinite-scroll-lab-heading" className="text-2xl font-bold text-[var(--color-fg)]">
          Windowed infinite scroll
        </h1>
        <p className="max-w-2xl text-sm text-[var(--color-muted-fg)]">
          A 5,000-row feed loaded 50 rows at a time, rendered through TanStack Virtual. The sentinel
          that asks for the next page sits after the virtualiser&rsquo;s spacer, so it is in the DOM
          from the first render rather than only once you have scrolled to the last row — which is
          the part virtualisation breaks about the usual pattern.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Prefetch distance">
        {PREFETCH_MODES.map((candidate) => (
          <Button
            key={candidate}
            variant={candidate === mode ? "primary" : "secondary"}
            size="sm"
            aria-pressed={candidate === mode}
            data-testid={`prefetch-mode-${candidate}`}
            onClick={() => {
              setSearchParams({ prefetch: candidate });
            }}
          >
            {MODE_LABEL[candidate]}
          </Button>
        ))}
      </div>

      <dl
        className="grid max-w-2xl grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4"
        data-testid="feed-stats"
      >
        <Stat label="Rows loaded" value={String(items.length)} testId="stat-items" />
        <Stat label="Total rows" value={String(total)} testId="stat-total" />
        <Stat label="Pages fetched" value={String(pagesLoaded)} testId="stat-pages" />
        <Stat
          label="State"
          value={isFetchingNextPage ? "fetching" : hasNextPage ? "idle" : "complete"}
          testId="stat-state"
        />
      </dl>

      <InfiniteFeed height={480} prefetchMargin={PREFETCH_MARGIN_PX[mode]} />
    </section>
  );
}

interface StatProps {
  label: string;
  value: string;
  testId: string;
}

function Stat({ label, value, testId }: StatProps) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-[var(--color-muted-fg)]">{label}</dt>
      <dd className="font-semibold text-[var(--color-fg)] tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
