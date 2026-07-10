import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoizedList } from "./MemoizedList";
import type { ListItem } from "./MemoizedList";

const ITEMS: ListItem[] = [
  { id: "1", label: "Charlie", meta: "c" },
  { id: "2", label: "Alice", meta: "a" },
  { id: "3", label: "Bob" },
];

describe("MemoizedList", () => {
  it("renders items sorted alphabetically", () => {
    render(<MemoizedList items={ITEMS} />);
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Alice");
    expect(options[1]).toHaveTextContent("Bob");
    expect(options[2]).toHaveTextContent("Charlie");
  });

  it("shows empty state when no items", () => {
    render(<MemoizedList items={[]} />);
    expect(screen.getByText("No items.")).toBeInTheDocument();
  });

  it("renders optional meta text", () => {
    render(<MemoizedList items={ITEMS} />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
  });

  it("toggles selection on click", async () => {
    const user = userEvent.setup();
    render(<MemoizedList items={ITEMS} />);
    const alice = screen.getByText("Alice").closest("li")!;
    expect(alice).toHaveAttribute("aria-selected", "false");
    await user.click(alice);
    expect(alice).toHaveAttribute("aria-selected", "true");
    await user.click(alice);
    expect(alice).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelectionChange with the current selected ids", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MemoizedList items={ITEMS} onSelectionChange={onChange} />);
    await user.click(screen.getByText("Bob").closest("li")!);
    expect(onChange).toHaveBeenCalledWith(["3"]);
  });

  it("respects initialSelectedIds", () => {
    render(<MemoizedList items={ITEMS} initialSelectedIds={["2"]} />);
    const alice = screen.getByText("Alice").closest("li")!;
    expect(alice).toHaveAttribute("aria-selected", "true");
    const bob = screen.getByText("Bob").closest("li")!;
    expect(bob).toHaveAttribute("aria-selected", "false");
  });

  it("supports selecting multiple items", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MemoizedList items={ITEMS} onSelectionChange={onChange} />);
    await user.click(screen.getByText("Alice").closest("li")!);
    await user.click(screen.getByText("Bob").closest("li")!);
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining(["2", "3"]));
  });
});
