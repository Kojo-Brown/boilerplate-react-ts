import { cn } from "@/shared/lib/cn";
import { paginationRange } from "@/shared/lib/paginationRange";
import { Button } from "@/shared/ui/Button";

/**
 * A page picker over a known number of pages.
 *
 * It holds no page state of its own: `page` comes in, `onPageChange` goes out,
 * and what the control shows is a pure function of the two. The window of page
 * numbers is `paginationRange`'s decision — see `docs/tdd.md`.
 */
export interface PaginationProps {
  /** The page currently being displayed, 1-based. */
  readonly page: number;
  /** How many pages there are in total. */
  readonly pageCount: number;
  /** Called with the page the reader asked for. */
  readonly onPageChange: (page: number) => void;
  /**
   * The landmark's accessible name.
   *
   * A prop with an English default rather than a string in this file: the
   * component is in `shared/`, nothing here can reach an `IntlShape`, and the
   * page that mounts it can.
   */
  readonly label?: string;
  readonly previousLabel?: string;
  readonly nextLabel?: string;
  /** How a page number's button names itself. "3" on its own is not a name. */
  readonly pageLabel?: (page: number) => string;
  readonly className?: string | undefined;
}

const defaultPageLabel = (page: number) => `Page ${page}`;

export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = "Pagination",
  previousLabel = "Previous page",
  nextLabel = "Next page",
  pageLabel = defaultPageLabel,
  className,
}: PaginationProps) {
  /*
   * A range of one page offers one choice, which is not a choice. Rendering
   * nothing is also what makes the control safe to mount unconditionally over
   * a list whose length is still loading — the way every caller writes it the
   * first time.
   */
  if (pageCount <= 1) return null;

  /*
   * Two readings of "the current page", and they are not the same number.
   *
   * `current` is what the control *shows*: clamped, so there is always a page
   * marked and the ends always agree with it. `page` is what the parent
   * *holds*, and the click guard below compares against that one — a parent
   * sitting on page 12 of a list that is now 3 pages long is corrected by
   * pressing page 3, and comparing against `current` would suppress exactly
   * that event and leave it stuck.
   */
  const current = Math.min(Math.max(page, 1), pageCount);
  const items = paginationRange({ page: current, pageCount });
  const goTo = (target: number) => {
    if (target !== page) onPageChange(target);
  };

  return (
    <nav aria-label={label} className={cn("flex", className)}>
      <ul className="flex items-center gap-1">
        <li>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={previousLabel}
            disabled={current <= 1}
            onClick={() => {
              goTo(current - 1);
            }}
          >
            Previous
          </Button>
        </li>

        {items.map((item) =>
          item.type === "gap" ? (
            <li
              key={`gap-${item.side}`}
              aria-hidden="true"
              className="px-2 text-sm text-[var(--color-muted-fg)]"
            >
              …
            </li>
          ) : (
            <li key={item.page}>
              <Button
                type="button"
                size="sm"
                className="min-w-9"
                variant={item.page === current ? "primary" : "ghost"}
                aria-label={pageLabel(item.page)}
                aria-current={item.page === current ? "page" : undefined}
                onClick={() => {
                  goTo(item.page);
                }}
              >
                {item.page}
              </Button>
            </li>
          ),
        )}

        <li>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={nextLabel}
            disabled={current >= pageCount}
            onClick={() => {
              goTo(current + 1);
            }}
          >
            Next
          </Button>
        </li>
      </ul>
    </nav>
  );
}
