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
  const items = paginationRange({ page, pageCount });

  return (
    <nav aria-label={label} className={cn("flex", className)}>
      <ul className="flex items-center gap-1">
        <li>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={previousLabel}
            onClick={() => {
              onPageChange(page - 1);
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
                variant={item.page === page ? "primary" : "ghost"}
                aria-label={pageLabel(item.page)}
                aria-current={item.page === page ? "page" : undefined}
                onClick={() => {
                  onPageChange(item.page);
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
            onClick={() => {
              onPageChange(page + 1);
            }}
          >
            Next
          </Button>
        </li>
      </ul>
    </nav>
  );
}
