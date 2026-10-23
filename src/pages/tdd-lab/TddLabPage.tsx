import { useState } from "react";
import { paginationRange } from "@/shared/lib/paginationRange";
import { Pagination } from "@/shared/ui/Pagination";
import { Text } from "@/shared/ui/Text";

/**
 * The kata's output, driven rather than described.
 *
 * `docs/tdd.md` is the write-up and the pull request's commit history is the
 * artefact; this page exists because two of the four properties the tests
 * drove out are properties of the control *in motion* — the width that does
 * not change and the gap that never stands for a single page — and a reader
 * can confirm both here in about four clicks, which no amount of prose does.
 */

/** Enough rows that the window has to elide something. */
const ROWS: readonly string[] = Array.from({ length: 83 }, (_, index) => `Row ${index + 1}`);
const PER_PAGE = 8;
const PAGE_COUNT = Math.ceil(ROWS.length / PER_PAGE);

/**
 * A second, smaller range, laid out one line per page.
 *
 * Twelve rather than eighty-three because the whole point is to read every
 * page's shape at once: the entries move, the count does not, and the two
 * bands where a gap would have stood for one page (page 4 and page 9 here)
 * show real numbers instead.
 */
const SHAPE_PAGE_COUNT = 12;

function shapeOf(page: number): string {
  return paginationRange({ page, pageCount: SHAPE_PAGE_COUNT })
    .map((item) => (item.type === "gap" ? "…" : String(item.page)))
    .join(" ");
}

export function TddLabPage() {
  const [page, setPage] = useState(1);
  const firstIndex = (page - 1) * PER_PAGE;
  const rows = ROWS.slice(firstIndex, firstIndex + PER_PAGE);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-2">
        <Text as="h1" size="2xl" weight="bold">
          TDD Kata
        </Text>
        <Text tone="muted">
          One component — <code>Pagination</code> and the <code>paginationRange</code> function
          under it — built red, green, refactor, one commit per step. Two of the four properties its
          tests drove out are only visible while paging, so they are below rather than in{" "}
          <code>docs/tdd.md</code>.
        </Text>
      </header>

      <section className="flex flex-col gap-4">
        <Text as="h2" size="xl" weight="semibold">
          The control
        </Text>
        <ul
          data-testid="paged-rows"
          className="divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)]"
        >
          {rows.map((row) => (
            <li key={row} className="px-4 py-2 text-sm">
              {row}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text tone="muted" size="sm">
            Showing{" "}
            <strong data-testid="row-window">
              {firstIndex + 1}–{firstIndex + rows.length}
            </strong>{" "}
            of {ROWS.length}, page{" "}
            <strong data-testid="current-page">
              {page} of {PAGE_COUNT}
            </strong>
            .
          </Text>
          <Pagination page={page} pageCount={PAGE_COUNT} onPageChange={setPage} />
        </div>
        <Text tone="muted" size="sm">
          Page through it and watch the row of buttons rather than the list: the entries change, the
          number of them does not, and no gap ever hides a single page. Both were tests before they
          were code — the second one failed on a range nobody would have thought to try.
        </Text>
      </section>

      <section className="flex flex-col gap-4">
        <Text as="h2" size="xl" weight="semibold">
          Seven entries, whichever page is current
        </Text>
        <Text tone="muted" size="sm">
          Every page of a twelve-page range, in order. The shape moves, the count is the same seven
          every time, and pages 4 and 9 are where a leading or trailing gap would have stood for
          exactly one page and shows the page instead.
        </Text>
        <ul data-testid="range-shapes" className="flex flex-col gap-1">
          {Array.from({ length: SHAPE_PAGE_COUNT }, (_, index) => index + 1).map((current) => (
            <li key={current} className="flex items-baseline gap-3 font-mono text-sm">
              <span className="w-16 shrink-0 text-[var(--color-muted-fg)]">page {current}</span>
              <span className="grow">{shapeOf(current)}</span>
              <span className="text-[var(--color-muted-fg)]">
                {paginationRange({ page: current, pageCount: SHAPE_PAGE_COUNT }).length} entries
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
