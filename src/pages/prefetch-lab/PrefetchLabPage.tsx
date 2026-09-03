import { Text } from "@/shared/ui/Text";
import { cn } from "@/shared/lib/cn";
import { ROUTES } from "@/shared/routes/paths";
import { usePrefetchSnapshot } from "@/features/route-prefetch/usePrefetchSnapshot";
import { PrefetchNavLink } from "@/widgets/layout/PrefetchNavLink";

/**
 * Links whose chunks this page can warm.
 *
 * Lab routes rather than the nav's own destinations, because the nav has
 * already prefetched those on the way here — a demonstration whose subject was
 * loaded before you arrived demonstrates nothing.
 */
const HOVER_TARGETS = [
  { label: "Headless lab", to: ROUTES.HEADLESS_LAB },
  { label: "Polymorphic lab", to: ROUTES.POLYMORPHIC_LAB },
  { label: "Checkout lab", to: ROUTES.CHECKOUT_LAB },
] as const;

const VIEWPORT_TARGET = { label: "Worker lab", to: ROUTES.WORKER_LAB } as const;

const LINK_CLASSES = cn(
  "inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2",
  "text-sm font-medium text-[var(--color-fg)] transition-colors",
  "hover:bg-[var(--color-muted)]",
);

function QueueColumn({ title, hrefs }: { title: string; hrefs: readonly string[] }) {
  return (
    <div
      data-testid={`queue-${title.toLowerCase()}`}
      data-count={hrefs.length}
      className="flex flex-1 flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
    >
      <Text as="h3" size="sm" weight="semibold">
        {title}
      </Text>
      {hrefs.length === 0 ? (
        <Text size="sm" className="text-[var(--color-muted-fg)]">
          —
        </Text>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {hrefs.map((href) => (
            <li key={href}>
              <Text size="sm" className="font-mono">
                {href}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Reference demo for idle-budgeted route prefetching.
 *
 * The queue below is the real one the app shell uses — this page reads it
 * through `usePrefetchSnapshot`, it does not build its own. Two things are
 * worth watching, and neither is visible from the network panel alone:
 *
 * - Sweeping the pointer across the three hover links queues *nothing*. The
 *   dwell timer is what makes a nav bar survivable; without it a pointer on
 *   its way past buys a chunk per link it crosses.
 * - Entries move from Queued to Loading only when the browser actually goes
 *   idle, at most two at a time. On a busy page they simply stay queued, which
 *   is the intended outcome rather than a stall — see `docs/route-prefetch.md`.
 */
export function PrefetchLabPage() {
  const { queued, loading, loaded } = usePrefetchSnapshot();

  return (
    <main className="flex flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <Text as="h1" size="2xl" weight="bold">
          Route prefetch
        </Text>
        <Text className="max-w-2xl text-[var(--color-muted-fg)]">
          Hovering a link for {""}
          <span className="font-mono">65ms</span> queues its route chunk; the queue drains only
          while the browser is idle, two requests at a time.
        </Text>
      </header>

      <section className="flex flex-col gap-3">
        <Text as="h2" size="lg" weight="semibold">
          Hover
        </Text>
        <div className="flex flex-wrap gap-3">
          {HOVER_TARGETS.map((target) => (
            <PrefetchNavLink
              key={target.to}
              to={target.to}
              prefetchOn="hover"
              className={LINK_CLASSES}
              data-testid={`hover-link-${target.to}`}
            >
              {target.label}
            </PrefetchNavLink>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Text as="h2" size="lg" weight="semibold">
          Queue
        </Text>
        <div className="flex flex-col gap-3 sm:flex-row">
          <QueueColumn title="Queued" hrefs={queued} />
          <QueueColumn title="Loading" hrefs={loading} />
          <QueueColumn title="Loaded" hrefs={loaded} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Text as="h2" size="lg" weight="semibold">
          Viewport
        </Text>
        <Text className="max-w-2xl text-[var(--color-muted-fg)]">
          The link below is far enough down the page that reaching it is itself a signal. Scroll
          until it is within 200px of the viewport and it queues without being touched.
        </Text>
        {/* A real gap rather than a `min-height` on the link's container: the
            observer answers a question about geometry, and geometry is the one
            thing a shorter page cannot fake. */}
        <div aria-hidden="true" className="h-[150vh]" />
        <PrefetchNavLink
          to={VIEWPORT_TARGET.to}
          prefetchOn="viewport"
          className={LINK_CLASSES}
          data-testid="viewport-link"
        >
          {VIEWPORT_TARGET.label}
        </PrefetchNavLink>
      </section>
    </main>
  );
}
