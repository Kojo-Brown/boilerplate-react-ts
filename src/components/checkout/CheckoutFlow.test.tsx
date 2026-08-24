import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CheckoutRejectedError,
  createInMemoryCheckoutApi,
  type CartItem,
  type CheckoutApi,
} from "@/lib/checkoutApi";
import { CheckoutFlow } from "./CheckoutFlow";

const cart: readonly CartItem[] = [
  { id: "kbd", name: "Keyboard", unitPriceMinor: 8900, quantity: 1 },
  { id: "cbl", name: "Cable", unitPriceMinor: 1200, quantity: 2 },
];

/** Frozen mid-2026, so `12/26` stays a card that has not expired. */
const NOW = (): Date => new Date("2026-06-15T00:00:00.000Z");

function renderFlow(api: CheckoutApi = createInMemoryCheckoutApi()) {
  render(<CheckoutFlow cart={cart} api={api} now={NOW} />);
  return userEvent.setup();
}

const state = (): string | undefined => screen.getByTestId("checkout-flow").dataset["state"];

async function fillShipping(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/Full name/), "Grace Hopper");
  await user.type(screen.getByLabelText(/Address/), "12 Navy Yard");
  await user.type(screen.getByLabelText(/Town or city/), "Arlington");
  await user.type(screen.getByLabelText(/Postcode/), "SW1A 1AA");
}

async function fillPayment(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/Name on card/), "G Hopper");
  await user.type(screen.getByLabelText(/Card number/), "4242424242424242");
  await user.type(screen.getByLabelText(/Expiry/), "12/26");
  await user.type(screen.getByLabelText(/Security code/), "123");
}

async function reachReview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: /continue to delivery/i }));
  await fillShipping(user);
  await user.click(screen.getByRole("button", { name: /continue to payment/i }));
  await fillPayment(user);
  await user.click(screen.getByRole("button", { name: /review order/i }));
}

describe("CheckoutFlow", () => {
  it("walks the whole flow and confirms the order", async () => {
    const api = createInMemoryCheckoutApi({ idPrefix: "demo" });
    const user = renderFlow(api);

    await reachReview(user);
    expect(state()).toBe("review");

    await user.click(screen.getByTestId("place-order"));
    await waitFor(() => {
      expect(screen.getByTestId("order-id")).toHaveTextContent("demo-1");
    });
    expect(state()).toBe("confirmed");
    expect(api.callCount()).toBe(1);
  });

  it("refuses an empty basket with a sentence rather than a dead button", async () => {
    const user = renderFlow();

    await user.click(screen.getByRole("button", { name: "Remove Keyboard" }));
    await user.click(screen.getByRole("button", { name: "Remove Cable" }));
    await user.click(screen.getByRole("button", { name: /continue to delivery/i }));

    expect(state()).toBe("cart");
    expect(screen.getByTestId("cart-message")).toBeInTheDocument();
  });

  it("shows every field's error at once when the address form is empty", async () => {
    const user = renderFlow();

    await user.click(screen.getByRole("button", { name: /continue to delivery/i }));
    await user.click(screen.getByRole("button", { name: /continue to payment/i }));

    expect(state()).toBe("shipping");
    expect(screen.getAllByRole("alert")).toHaveLength(4);
  });

  it("keeps what was typed when the user steps back and forward", async () => {
    const user = renderFlow();

    await user.click(screen.getByRole("button", { name: /continue to delivery/i }));
    await fillShipping(user);
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: /continue to delivery/i }));

    expect(screen.getByLabelText(/Town or city/)).toHaveValue("Arlington");
  });

  it("lands back on the payment step when the server blames the card", async () => {
    const api = createInMemoryCheckoutApi({
      failWhen: () => new CheckoutRejectedError("Your card was declined.", { step: "payment" }),
    });
    const user = renderFlow(api);

    await reachReview(user);
    await user.click(screen.getByTestId("place-order"));

    await waitFor(() => {
      expect(state()).toBe("payment");
    });
    expect(screen.getByTestId("step-message")).toHaveTextContent("Your card was declined.");
    // The card is still in the form: the user has to change one field, not
    // retype all four.
    expect(screen.getByLabelText(/Card number/)).toHaveValue("4242424242424242");
  });

  it("offers a retry for a failure that belongs to no step", async () => {
    let attempt = 0;
    const api = createInMemoryCheckoutApi({
      failWhen: () => {
        attempt += 1;
        return attempt === 1
          ? new CheckoutRejectedError("The gateway timed out.", { retryable: true })
          : null;
      },
    });
    const user = renderFlow(api);

    await reachReview(user);
    await user.click(screen.getByTestId("place-order"));
    await waitFor(() => {
      expect(state()).toBe("failure");
    });

    await user.click(screen.getByTestId("retry-order"));
    await waitFor(() => {
      expect(state()).toBe("confirmed");
    });
    expect(api.callCount()).toBe(2);
  });

  it("cancels an order that is still in flight", async () => {
    const api = createInMemoryCheckoutApi({ latencyMs: 5_000 });
    const user = renderFlow(api);

    await reachReview(user);
    await user.click(screen.getByTestId("place-order"));
    expect(state()).toBe("submitting");

    await user.click(screen.getByTestId("cancel-order"));

    expect(state()).toBe("review");
    await waitFor(() => {
      expect(api.abortCount()).toBe(1);
    });
  });

  it("edits the basket from the review screen and re-prices the order", async () => {
    const api = createInMemoryCheckoutApi();
    const user = renderFlow(api);

    await reachReview(user);
    await user.click(screen.getByRole("button", { name: "Edit basket" }));
    expect(state()).toBe("cart");

    const quantity = screen.getByRole("spinbutton", { name: "Quantity of Cable" });
    await user.tripleClick(quantity);
    await user.keyboard("5");

    await user.click(screen.getByRole("button", { name: /continue to delivery/i }));
    await user.click(screen.getByRole("button", { name: /continue to payment/i }));
    await user.click(screen.getByRole("button", { name: /review order/i }));

    expect(screen.getByTestId("review-total")).toHaveTextContent("149.00");
  });

  it("restarts from the confirmation with the basket it started with", async () => {
    const user = renderFlow();

    await reachReview(user);
    await user.click(screen.getByTestId("place-order"));
    await waitFor(() => {
      expect(state()).toBe("confirmed");
    });

    await user.click(screen.getByTestId("restart-checkout"));

    expect(state()).toBe("cart");
    expect(screen.getByTestId("cart-total")).toHaveTextContent("113.00");
  });

  it("moves the stepper from the machine's state alone", async () => {
    const user = renderFlow();

    expect(screen.getByTestId("step-cart")).toHaveAttribute("data-state", "active");
    await user.click(screen.getByRole("button", { name: /continue to delivery/i }));
    expect(screen.getByTestId("step-shipping")).toHaveAttribute("data-state", "active");
  });
});
