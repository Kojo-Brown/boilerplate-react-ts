import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VirtualList } from "./VirtualList";
import type { VirtualListItem } from "./VirtualList";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 10) }, (_, i) => ({
        key: i,
        index: i,
        start: i * 48,
        size: 48,
      })),
    getTotalSize: () => count * 48,
    measureElement: () => {},
  }),
}));

const makeItems = (n: number): VirtualListItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i),
    label: `Item ${i + 1}`,
    description: i % 2 === 0 ? `Description ${i + 1}` : undefined,
  }));

describe("VirtualList", () => {
  it("renders the scroll container as a list", () => {
    render(<VirtualList items={[]} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("renders no rows for an empty items array", () => {
    render(<VirtualList items={[]} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("renders up to 10 virtualised rows for a large dataset", () => {
    render(<VirtualList items={makeItems(10_000)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });

  it("renders correct labels for the visible rows", () => {
    render(<VirtualList items={makeItems(20)} />);
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 10")).toBeInTheDocument();
  });

  it("renders description text when provided", () => {
    render(<VirtualList items={makeItems(2)} />);
    expect(screen.getByText("Description 1")).toBeInTheDocument();
  });

  it("omits description when not provided", () => {
    const items: VirtualListItem[] = [{ id: "1", label: "No desc" }];
    render(<VirtualList items={items} />);
    expect(screen.queryByText(/Description/)).not.toBeInTheDocument();
  });

  it("uses a custom renderItem when provided", () => {
    const items = makeItems(3);
    render(
      <VirtualList
        items={items}
        renderItem={(item) => <span data-testid="custom-row">{item.label}</span>}
      />,
    );
    const rows = screen.getAllByTestId("custom-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Item 1");
  });

  it("applies the height prop as an inline style", () => {
    render(<VirtualList items={makeItems(10)} height={600} />);
    expect(screen.getByRole("list")).toHaveStyle({ height: "600px" });
  });

  it("forwards a custom className to the scroll container", () => {
    render(<VirtualList items={makeItems(5)} className="my-custom-class" />);
    expect(screen.getByRole("list")).toHaveClass("my-custom-class");
  });

  it("sets the inner div height to the virtualiser total size", () => {
    render(<VirtualList items={makeItems(100)} />);
    const inner = screen.getByRole("list").firstElementChild as HTMLElement;
    // mock getTotalSize returns count * 48 = 4800
    expect(inner).toHaveStyle({ height: "4800px" });
  });

  it("positions each row with a translateY transform", () => {
    render(<VirtualList items={makeItems(3)} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveStyle({ transform: "translateY(0px)" });
    expect(rows[1]).toHaveStyle({ transform: "translateY(48px)" });
    expect(rows[2]).toHaveStyle({ transform: "translateY(96px)" });
  });
});
