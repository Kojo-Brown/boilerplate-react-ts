import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CartItem } from "@/lib/checkoutApi";
import { CartStep } from "./CartStep";

const cart: readonly CartItem[] = [
  { id: "kbd", name: "Keyboard", unitPriceMinor: 8900, quantity: 1 },
  { id: "cbl", name: "Cable", unitPriceMinor: 1200, quantity: 2 },
];

function renderStep(overrides: Partial<Parameters<typeof CartStep>[0]> = {}) {
  const props = {
    cart,
    message: null,
    onQuantityChange: vi.fn(),
    onRemove: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
  render(<CartStep {...props} />);
  return props;
}

describe("CartStep", () => {
  it("totals the lines it was given", () => {
    renderStep();

    expect(screen.getByTestId("cart-total")).toHaveTextContent("113.00");
  });

  it("reports a quantity change with the line's id", async () => {
    const user = userEvent.setup();
    const props = renderStep();

    // Select-and-replace rather than clear-then-type: the input is controlled,
    // so an intermediate empty value would be reported as a quantity of its
    // own before the digit arrived.
    const input = screen.getByRole("spinbutton", { name: "Quantity of Cable" });
    await user.tripleClick(input);
    await user.keyboard("3");

    expect(props.onQuantityChange).toHaveBeenLastCalledWith("cbl", 3);
  });

  it("names the line in the remove button, not just in the row", async () => {
    const user = userEvent.setup();
    const props = renderStep();

    await user.click(screen.getByRole("button", { name: "Remove Keyboard" }));

    expect(props.onRemove).toHaveBeenCalledWith("kbd");
  });

  it("keeps Continue live for an empty basket", async () => {
    // The step has no opinion about whether continuing is allowed; the machine
    // decides and answers with a message. A disabled button here would be a
    // second, quieter copy of that rule.
    const user = userEvent.setup();
    const props = renderStep({ cart: [], message: null });

    expect(screen.getByTestId("cart-empty")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it("announces the refusal when one arrives", () => {
    renderStep({ cart: [], message: "Add something first." });

    expect(screen.getByRole("alert")).toHaveTextContent("Add something first.");
  });
});
