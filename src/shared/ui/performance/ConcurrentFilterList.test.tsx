import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConcurrentFilterList } from "@/shared/ui/performance/ConcurrentFilterList";
import type { FilterableItem } from "@/shared/lib/filterableItems";

const items: FilterableItem[] = [
  { id: "1", name: "Deferred Queue", category: "Analytics", score: 10 },
  { id: "2", name: "Elastic Ledger", category: "Billing", score: 20 },
  { id: "3", name: "Deferred Snapshot", category: "Billing", score: 30 },
  { id: "4", name: "Keyed Bucket", category: "Storage", score: 40 },
];

const rows = () => screen.queryAllByTestId("filter-row");
const rowNames = () => rows().map((row) => row.textContent);

describe("ConcurrentFilterList", () => {
  it("renders every item before any filtering", () => {
    render(<ConcurrentFilterList items={items} />);
    expect(rows()).toHaveLength(4);
  });

  it("renders each row's name, category, and score", () => {
    render(<ConcurrentFilterList items={[items[0] as FilterableItem]} />);
    const row = screen.getByTestId("filter-row");
    expect(within(row).getByText("Deferred Queue")).toBeInTheDocument();
    expect(within(row).getByText("Analytics")).toBeInTheDocument();
    expect(within(row).getByText("10")).toBeInTheDocument();
  });

  it("reports how many items match", () => {
    render(<ConcurrentFilterList items={items} />);
    expect(screen.getByTestId("result-count")).toHaveTextContent("4 of 4 matches");
  });

  it("filters the list as the query is typed", async () => {
    const user = userEvent.setup();
    render(<ConcurrentFilterList items={items} />);

    await user.type(screen.getByTestId("filter-input"), "deferred");

    expect(await screen.findByText("2 of 4 matches")).toBeInTheDocument();
    expect(rowNames().every((name) => name.includes("Deferred"))).toBe(true);
  });

  it("settles to a non-stale list once the deferred render lands", async () => {
    const user = userEvent.setup();
    render(<ConcurrentFilterList items={items} />);

    await user.type(screen.getByTestId("filter-input"), "elastic");

    const list = await screen.findByTestId("filter-results");
    expect(list).toHaveAttribute("data-stale", "false");
    expect(list).toHaveAttribute("aria-busy", "false");
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(<ConcurrentFilterList items={items} />);

    await user.type(screen.getByTestId("filter-input"), "zzz-no-such-item");

    expect(await screen.findByText("No items match this filter.")).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
  });

  it("filters by category", async () => {
    const user = userEvent.setup();
    render(<ConcurrentFilterList items={items} />);

    await user.click(screen.getByRole("button", { name: "Billing" }));

    expect(await screen.findByText("2 of 4 matches")).toBeInTheDocument();
    expect(rowNames()).toEqual(expect.arrayContaining([expect.stringContaining("Elastic Ledger")]));
  });

  it("combines the query and the category filter", async () => {
    const user = userEvent.setup();
    render(<ConcurrentFilterList items={items} />);

    await user.click(screen.getByRole("button", { name: "Billing" }));
    await user.type(screen.getByTestId("filter-input"), "deferred");

    expect(await screen.findByText("1 of 4 matches")).toBeInTheDocument();
    expect(rowNames()[0]).toContain("Deferred Snapshot");
  });

  it("marks the active category as pressed", async () => {
    const user = userEvent.setup();
    render(<ConcurrentFilterList items={items} />);

    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Storage" }));

    expect(await screen.findByText("1 of 4 matches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Storage" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  });

  it("returns to the full list when the category filter is cleared", async () => {
    const user = userEvent.setup();
    render(<ConcurrentFilterList items={items} />);

    await user.click(screen.getByRole("button", { name: "Storage" }));
    expect(await screen.findByText("1 of 4 matches")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(await screen.findByText("4 of 4 matches")).toBeInTheDocument();
  });

  it("filters identically in blocking mode", async () => {
    const user = userEvent.setup();
    render(<ConcurrentFilterList items={items} mode="blocking" />);

    await user.type(screen.getByTestId("filter-input"), "deferred");

    expect(await screen.findByText("2 of 4 matches")).toBeInTheDocument();
  });

  it("never reports a stale list in blocking mode", async () => {
    const user = userEvent.setup();
    render(<ConcurrentFilterList items={items} mode="blocking" />);

    await user.type(screen.getByTestId("filter-input"), "deferred");

    // Blocking mode renders the urgent value, so the list and the input can
    // never disagree — that is exactly the property that costs a frame.
    expect(screen.getByTestId("filter-results")).toHaveAttribute("data-stale", "false");
  });

  it("exposes the active scheduling mode", () => {
    const { rerender } = render(<ConcurrentFilterList items={items} />);
    expect(screen.getByTestId("concurrent-filter-list")).toHaveAttribute("data-mode", "concurrent");

    rerender(<ConcurrentFilterList items={items} mode="blocking" />);
    expect(screen.getByTestId("concurrent-filter-list")).toHaveAttribute("data-mode", "blocking");
  });

  it("labels the filter input", () => {
    render(<ConcurrentFilterList items={items} />);
    expect(screen.getByLabelText("Filter items")).toBe(screen.getByTestId("filter-input"));
  });

  it("exposes the results as a labelled list", () => {
    render(<ConcurrentFilterList items={items} />);
    expect(screen.getByRole("list", { name: "Filtered items" })).toBeInTheDocument();
  });

  it("renders an empty dataset without crashing", () => {
    render(<ConcurrentFilterList items={[]} />);
    expect(screen.getByText("No items match this filter.")).toBeInTheDocument();
    expect(screen.getByTestId("result-count")).toHaveTextContent("0 of 0 matches");
  });

  it("applies a custom container height", () => {
    render(<ConcurrentFilterList items={items} height={200} />);
    expect(screen.getByTestId("filter-results")).toHaveStyle({ height: "200px" });
  });

  it("applies a custom class name to the section", () => {
    render(<ConcurrentFilterList items={items} className="custom-class" />);
    expect(screen.getByTestId("concurrent-filter-list")).toHaveClass("custom-class");
  });
});
