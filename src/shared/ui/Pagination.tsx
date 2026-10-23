import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { paginationRange } from "@/shared/lib/paginationRange";
import { Button } from "@/shared/ui/Button";

/**
 * A page picker over a known number of pages.
 *
 * It holds no page state of its own: `page` comes in, `onPageChange` goes out,
 * and what the control shows is a pure function of the two. Which page numbers
 * those are is `paginationRange`'s decision, and the kata that drove both out
 * of a failing test at a time is written up in `docs/tdd.md`.
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

interface ControlProps {
  /**
   * The button's accessible name, always set.
   *
   * Every control in here needs one the visible text does not supply: a page
   * button's text is a bare numeral, and "Previous" on its own does not say
   * previous *what*. Both names contain their visible text, which is what
   * WCAG 2.5.3 asks of a label that extends one.
   */
  readonly label: string;
  /** Carries both the fill and `aria-current`, because they are one claim. */
  readonly current?: boolean;
  readonly disabled?: boolean;
  readonly className?: string | undefined;
  readonly onPress: () => void;
  readonly children: ReactNode;
}

/**
 * One list item holding one button, which is every entry in this control that
 * is not a gap.
 *
 * Extracted in the kata's second refactor: Previous, Next and nine page
 * numbers were the same eight props three times over, and the duplication was
 * the kind that rots unevenly — `type="button"` or `size="sm"` dropped from
 * one of the three is invisible until a form submits or a row reflows.
 */
function Control({
  label,
  current = false,
  disabled = false,
  className,
  onPress,
  children,
}: ControlProps) {
  return (
    <li>
      <Button
        type="button"
        size="sm"
        variant={current ? "primary" : "ghost"}
        className={className}
        aria-label={label}
        aria-current={current ? "page" : undefined}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </Button>
    </li>
  );
}

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
        <Control
          label={previousLabel}
          disabled={current <= 1}
          onPress={() => {
            goTo(current - 1);
          }}
        >
          Previous
        </Control>

        {items.map((item) =>
          item.type === "gap" ? (
            /*
             * Text for the eye and nothing for the accessibility tree. "5,
             * ellipsis, 100" tells a listening reader nothing that "5, 100"
             * does not, and it is one more stop between them and the far end
             * of the control.
             *
             * Keyed by side rather than by index: the run of pages a gap
             * stands for changes on every navigation, which side it is on
             * does not.
             */
            <li
              key={`gap-${item.side}`}
              aria-hidden="true"
              className="px-2 text-sm text-[var(--color-muted-fg)]"
            >
              …
            </li>
          ) : (
            <Control
              key={item.page}
              label={pageLabel(item.page)}
              current={item.page === current}
              // So a one-digit page and a three-digit page are the same width
              // and the row does not reflow as the window moves.
              className="min-w-9"
              onPress={() => {
                goTo(item.page);
              }}
            >
              {item.page}
            </Control>
          ),
        )}

        <Control
          label={nextLabel}
          disabled={current >= pageCount}
          onPress={() => {
            goTo(current + 1);
          }}
        >
          Next
        </Control>
      </ul>
    </nav>
  );
}
