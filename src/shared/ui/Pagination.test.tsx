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
  /*
   * The ends. Without this the control asks for page 0 and for one past the
   * last page, and what happens then is entirely the parent's problem —
   * which is the kind of defect that ships, because every parent written on
   * the same afternoon as the control clamps by accident.
   *
   * `disabled` rather than `aria-disabled`: there is nothing at the other end
   * of the range to explain, so taking it out of the tab order is the honest
   * description, and it is what stops Enter as well as a click.
   */
  it("closes both ends of the range", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageCount={10} onPageChange={onPageChange} />);

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

    rerender(<Pagination page={10} pageCount={10} onPageChange={onPageChange} />);

    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous page" }));

    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(9);
  });

  it("steps one page at a time from the middle", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={5} pageCount={10} onPageChange={onPageChange} />);

    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(6);
  });

  /*
   * Pressing the page you are already on is not a request for anything. The
   * button stays focusable — it is the one entry a reader navigating by
   * keyboard uses to find their place — and `aria-current` already says why
   * nothing happened.
   */
  it("does not ask for the page it is already showing", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={3} pageCount={10} onPageChange={onPageChange} />);

    await user.click(screen.getByRole("button", { name: "Page 3" }));

    expect(onPageChange).not.toHaveBeenCalled();
  });

  /*
   * A control offering one choice is not a control. Rendering nothing is also
   * what makes it safe to mount unconditionally above a list whose length is
   * still loading, which is the only way a caller writes it without thinking.
   */
  it.each([
    ["one page", 1],
    ["no pages at all", 0],
  ])("renders nothing for %s", (_label, pageCount) => {
    const { container } = render(<Pagination page={1} pageCount={pageCount} onPageChange={noop} />);

    expect(container).toBeEmptyDOMElement();
  });

  /*
   * A `page` outside the range, which a parent produces by filtering a list
   * while the reader is on page 12 of it. The display clamps — there is a
   * current page and it is the nearest end — but the *click* is compared
   * against the page the parent actually holds, so pressing it is what
   * corrects the parent. Comparing against the clamped value instead would
   * suppress the one event that could unstick it.
   */
  it("clamps an out-of-range page for display and still corrects its parent", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={0} pageCount={10} onPageChange={onPageChange} />);

    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Page 1" }));

    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(1);
  });
});
