import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckoutStepper } from "./CheckoutStepper";

describe("CheckoutStepper", () => {
  it("marks the current step and everything before it", () => {
    render(<CheckoutStepper current="payment" />);

    expect(screen.getByTestId("step-cart")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("step-shipping")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("step-payment")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("step-review")).toHaveAttribute("data-state", "upcoming");
  });

  it("puts the position in the accessibility tree, not only in the colour", () => {
    render(<CheckoutStepper current="shipping" />);

    expect(screen.getByTestId("step-shipping")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("step-cart")).not.toHaveAttribute("aria-current");
  });

  it("marks every step done once the order is placed", () => {
    render(<CheckoutStepper current="review" complete />);

    for (const step of ["cart", "shipping", "payment", "review"]) {
      expect(screen.getByTestId(`step-${step}`)).toHaveAttribute("data-state", "done");
    }
    expect(screen.queryByRole("listitem", { current: "step" })).toBeNull();
  });
});
