import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ListboxOption } from "@/hooks/useListbox";
import { OptionList } from "./OptionList";

/*
 * Behaviour shared with the other skin is asserted once, in
 * `listboxSkins.test.tsx`. What is left here is what this presentation adds:
 * being on the page from the start, and how it marks the selection.
 */

type Plan = "free" | "pro" | "enterprise";

const PLANS: readonly ListboxOption<Plan>[] = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise", disabled: true },
];

describe("OptionList", () => {
  it("is on the page with no interaction at all", () => {
    render(<OptionList options={PLANS} label="Plan" />);

    expect(screen.getByRole("listbox", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("marks the selected option without putting a tick in its name", () => {
    render(<OptionList options={PLANS} label="Plan" defaultValue="pro" />);

    const selected = screen.getByRole("option", { name: "Pro" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Free" })).toHaveAttribute("aria-selected", "false");
  });

  it("marks a disabled option as such", () => {
    render(<OptionList options={PLANS} label="Plan" />);

    expect(screen.getByRole("option", { name: "Enterprise" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("keeps its own classes when the caller adds one", () => {
    render(<OptionList options={PLANS} label="Plan" className="w-96" />);

    const listbox = screen.getByRole("listbox", { name: "Plan" });
    expect(listbox).toHaveClass("w-96");
    expect(listbox).toHaveClass("overflow-y-auto");
  });

  it("leaves the value to its owner when controlled", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<OptionList options={PLANS} label="Plan" value="free" onValueChange={onValueChange} />);

    await user.click(screen.getByRole("option", { name: "Pro" }));

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("pro");
    expect(screen.getByRole("option", { name: "Free" })).toHaveAttribute("aria-selected", "true");
  });
});
