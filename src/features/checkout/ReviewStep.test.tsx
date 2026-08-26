import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CartItem, PaymentDetails, ShippingDetails } from "@/features/checkout/checkoutApi";
import { ReviewStep } from "@/features/checkout/ReviewStep";

const cart: readonly CartItem[] = [
  { id: "kbd", name: "Keyboard", unitPriceMinor: 8900, quantity: 1 },
  { id: "cbl", name: "Cable", unitPriceMinor: 1200, quantity: 2 },
];

const shipping: ShippingDetails = {
  fullName: "Grace Hopper",
  line1: "12 Navy Yard",
  city: "Arlington",
  postcode: "SW1A 1AA",
};

const payment: PaymentDetails = {
  cardholder: "G Hopper",
  cardNumber: "4242424242424242",
  expiry: "12/26",
  cvc: "123",
};

function renderStep(overrides: Partial<Parameters<typeof ReviewStep>[0]> = {}) {
  const props = {
    cart,
    shipping,
    payment,
    message: null,
    phase: "review" as const,
    retryable: false,
    attempts: 0,
    onEdit: vi.fn(),
    onBack: vi.fn(),
    onPlaceOrder: vi.fn(),
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  render(<ReviewStep {...props} />);
  return props;
}

describe("ReviewStep", () => {
  it("summarises what is about to be bought", () => {
    renderStep();

    expect(screen.getByTestId("review-cart")).toHaveTextContent("1 × Keyboard, 2 × Cable");
    expect(screen.getByTestId("review-shipping")).toHaveTextContent("Arlington");
    expect(screen.getByTestId("review-total")).toHaveTextContent("113.00");
  });

  it("shows only the last four digits of the card", () => {
    renderStep();

    const line = screen.getByTestId("review-payment");
    expect(line).toHaveTextContent("•••• 4242");
    expect(line.textContent).not.toContain("4242424242424242");
  });

  it("names the step each edit button goes to", async () => {
    const user = userEvent.setup();
    const props = renderStep();

    await user.click(screen.getByRole("button", { name: "Edit delivery" }));
    await user.click(screen.getByRole("button", { name: "Edit basket" }));

    expect(props.onEdit).toHaveBeenNthCalledWith(1, "shipping");
    expect(props.onEdit).toHaveBeenNthCalledWith(2, "cart");
  });

  it("replaces Place order with a pending state and a way out", () => {
    renderStep({ phase: "submitting" });

    expect(screen.queryByTestId("place-order")).toBeNull();
    expect(screen.getByTestId("placing-order")).toBeDisabled();
    expect(screen.getByTestId("cancel-order")).toBeEnabled();
  });

  it("offers a retry only for a failure the server called retryable", () => {
    renderStep({ phase: "failure", retryable: true, message: "The gateway timed out." });

    expect(screen.getByTestId("retry-order")).toBeInTheDocument();
    expect(screen.getByTestId("review-message")).toHaveTextContent("The gateway timed out.");
  });

  it("offers no button at all for a final refusal", () => {
    // A Try again over a declined card is a control that cannot work: the
    // machine guards `order.retry` on `retryable`, so the click would have
    // nowhere to go.
    renderStep({ phase: "failure", retryable: false, message: "Your card was declined." });

    expect(screen.queryByTestId("retry-order")).toBeNull();
    expect(screen.queryByTestId("place-order")).toBeNull();
    expect(screen.getByTestId("final-failure")).toBeInTheDocument();
  });

  it("counts attempts only once there has been more than one", () => {
    renderStep({ attempts: 1 });
    expect(screen.queryByTestId("review-attempts")).toBeNull();

    renderStep({ attempts: 2 });
    expect(screen.getByTestId("review-attempts")).toHaveTextContent("Attempt 2.");
  });

  it("copes with details that have not been committed", () => {
    renderStep({ shipping: null, payment: null });

    expect(screen.getByTestId("review-shipping")).toHaveTextContent("Not provided");
    expect(screen.getByTestId("review-payment")).toHaveTextContent("Not provided");
  });

  it("wires place, cancel, retry and back to their own callbacks", async () => {
    const user = userEvent.setup();
    const props = renderStep();

    await user.click(screen.getByTestId("place-order"));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(props.onPlaceOrder).toHaveBeenCalledTimes(1);
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("cancels from the pending state", async () => {
    const user = userEvent.setup();
    const props = renderStep({ phase: "submitting" });

    await user.click(screen.getByTestId("cancel-order"));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("retries from the failure state", async () => {
    const user = userEvent.setup();
    const props = renderStep({ phase: "failure", retryable: true });

    await user.click(screen.getByTestId("retry-order"));

    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
