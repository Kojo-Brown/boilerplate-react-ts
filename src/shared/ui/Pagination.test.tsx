import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "@/shared/ui/Pagination";

/**
 * Part two of the kata. `paginationRange` already knows which pages to show,
 * so nothing here re-asserts the arithmetic — these tests are about the three
 * things only a rendered control has: what the accessibility tree says it is,
 * which entries are targets, and what it asks its parent for.
 */
const noop = () => {};

/**
 * The accessible names of every button in the control, in document order.
 *
 * Read off `aria-label` rather than computed, because every button here is
 * expected to carry one: a page button's visible text is a bare numeral, which
 * is a label for the eye and not a name for anything else.
 */
function buttonNames(): (string | null)[] {
  const nav = screen.getByRole("navigation", { name: "Pagination" });
  return within(nav)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
}

describe("Pagination", () => {
  /*
   * A navigation landmark rather than a bare row of buttons, and a named one.
   * Unnamed, it is "navigation" in a landmark list that already holds the
   * sidebar and the header; named, it is the thing a reader can jump to. The
   * name is a prop with an English default rather than a hard-coded string,
   * because this component is in `shared/` and the only honest place to
   * translate it is the page that mounts it.
   */
  it("is a labelled navigation landmark around the window of pages", () => {
    render(<Pagination page={3} pageCount={10} onPageChange={noop} />);

    expect(buttonNames()).toEqual([
      "Previous page",
      "Page 1",
      "Page 2",
      "Page 3",
      "Page 4",
      "Page 5",
      "Page 10",
      "Next page",
    ]);
  });

  /*
   * The gap is not a button, not a target, and not read out. "Ellipsis" or
   * "dot dot dot" in the middle of a list of page numbers tells a listening
   * reader nothing they cannot infer from 5 being followed by 10, and it is
   * one more stop between them and the control's other end.
   */
  it("renders the gap as something the accessibility tree does not contain", () => {
    render(<Pagination page={3} pageCount={10} onPageChange={noop} />);

    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(nav).toHaveTextContent("…");
    // Seven page entries plus Previous and Next; the gap's item is hidden.
    expect(within(nav).getAllByRole("listitem")).toHaveLength(8);
  });

  /*
   * `aria-current="page"` on exactly one entry. It is how the control says
   * which page you are on to a reader who cannot see that one button is
   * filled, and "exactly one" is the half that a styling-only implementation
   * gets wrong by saying it nowhere.
   */
  it("marks the current page and only the current page", () => {
    render(<Pagination page={3} pageCount={10} onPageChange={noop} />);

    expect(screen.getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("button", { current: "page" })).toHaveLength(1);
  });

  it("asks its parent for the page that was pressed", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={3} pageCount={10} onPageChange={onPageChange} />);

    await user.click(screen.getByRole("button", { name: "Page 5" }));

    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(5);
  });
});
