import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TddLabPage } from "@/pages/tdd-lab/TddLabPage";

const rows = () => within(screen.getByTestId("paged-rows")).getAllByRole("listitem");

describe("TddLabPage", () => {
  it("shows the first page of rows", () => {
    render(<TddLabPage />);

    expect(rows().map((row) => row.textContent)).toEqual([
      "Row 1",
      "Row 2",
      "Row 3",
      "Row 4",
      "Row 5",
      "Row 6",
      "Row 7",
      "Row 8",
    ]);
    expect(screen.getByTestId("row-window")).toHaveTextContent("1–8");
    expect(screen.getByTestId("current-page")).toHaveTextContent("1 of 11");
  });

  it("pages the list from the control", async () => {
    const user = userEvent.setup();
    render(<TddLabPage />);

    await user.click(screen.getByRole("button", { name: "Page 2" }));

    expect(rows()[0]).toHaveTextContent("Row 9");
    expect(screen.getByTestId("row-window")).toHaveTextContent("9–16");
  });

  /*
   * The last page is the short one — 83 rows at 8 a page — and it is the one a
   * caller gets wrong by slicing a fixed width.
   */
  it("shows the remainder on the last page", async () => {
    const user = userEvent.setup();
    render(<TddLabPage />);

    await user.click(screen.getByRole("button", { name: "Page 11" }));

    expect(rows()).toHaveLength(3);
    expect(screen.getByTestId("row-window")).toHaveTextContent("81–83");
  });

  /*
   * The page's second claim, asserted rather than illustrated: every one of
   * the twelve lines reports the same seven entries. If the width property
   * ever regresses, this fails here as well as in
   * `paginationRange.test.ts` — which is the point of rendering it.
   */
  it("reports a constant entry count for every page of the smaller range", () => {
    render(<TddLabPage />);

    const lines = within(screen.getByTestId("range-shapes")).getAllByRole("listitem");

    expect(lines).toHaveLength(12);
    for (const line of lines) {
      expect(line).toHaveTextContent("7 entries");
    }
  });

  it("shows the page a single-page gap would have hidden", () => {
    render(<TddLabPage />);

    const lines = within(screen.getByTestId("range-shapes")).getAllByRole("listitem");

    expect(lines[3]).toHaveTextContent("page 41 2 3 4 5 … 12");
    expect(lines[8]).toHaveTextContent("page 91 … 8 9 10 11 12");
  });
});
