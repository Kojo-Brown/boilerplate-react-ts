import { describe, it, expect } from "vitest";
import {
  CheckoutRejectedError,
  cartTotalMinor,
  createInMemoryCheckoutApi,
  formatMoney,
  type CartItem,
  type CheckoutInput,
} from "@/lib/checkoutApi";

const cart: readonly CartItem[] = [
  { id: "kbd", name: "Keyboard", unitPriceMinor: 8900, quantity: 1 },
  { id: "cbl", name: "Cable", unitPriceMinor: 1200, quantity: 2 },
];

const input: CheckoutInput = {
  cart,
  shipping: {
    fullName: "Grace Hopper",
    line1: "12 Navy Yard",
    city: "Arlington",
    postcode: "SW1A 1AA",
  },
  payment: {
    cardholder: "G Hopper",
    // Obviously fake: the number every payment gateway documents as a test card.
    cardNumber: "4242424242424242",
    expiry: "12/26",
    cvc: "123",
  },
};

describe("cartTotalMinor", () => {
  it("multiplies by quantity and sums in minor units", () => {
    expect(cartTotalMinor(cart)).toBe(8900 + 1200 * 2);
  });

  it("is zero for an empty cart", () => {
    expect(cartTotalMinor([])).toBe(0);
  });
});

describe("formatMoney", () => {
  it("renders minor units as pounds", () => {
    // Non-breaking space handling differs between ICU builds; assert on digits.
    expect(formatMoney(11300)).toContain("113.00");
    expect(formatMoney(5)).toContain("0.05");
  });
});

describe("CheckoutRejectedError", () => {
  it("defaults to belonging to no step and to being final", () => {
    const error = new CheckoutRejectedError("Nope.");
    expect(error.step).toBeNull();
    expect(error.retryable).toBe(false);
    expect(error.name).toBe("CheckoutRejectedError");
    expect(error).toBeInstanceOf(Error);
  });

  it("carries the step and retryability it was given", () => {
    const error = new CheckoutRejectedError("Gateway timed out.", {
      step: "payment",
      retryable: true,
    });
    expect(error.step).toBe("payment");
    expect(error.retryable).toBe(true);
  });
});

describe("createInMemoryCheckoutApi", () => {
  it("returns an order totalled from the cart it was sent", async () => {
    const api = createInMemoryCheckoutApi({ idPrefix: "demo" });

    const order = await api.placeOrder(input);

    expect(order).toEqual({
      id: "demo-1",
      totalMinor: 11300,
      placedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(api.callCount()).toBe(1);
  });

  it("numbers orders sequentially", async () => {
    const api = createInMemoryCheckoutApi();

    await api.placeOrder(input);
    const second = await api.placeOrder(input);

    expect(second.id).toBe("ord-2");
  });

  it("stamps the injected clock", async () => {
    const api = createInMemoryCheckoutApi({ now: () => new Date("2026-06-15T09:30:00.000Z") });

    await expect(api.placeOrder(input)).resolves.toMatchObject({
      placedAt: "2026-06-15T09:30:00.000Z",
    });
  });

  it("throws whatever the failure predicate returns", async () => {
    const api = createInMemoryCheckoutApi({
      failWhen: () => new CheckoutRejectedError("Card declined.", { step: "payment" }),
    });

    await expect(api.placeOrder(input)).rejects.toMatchObject({
      message: "Card declined.",
      step: "payment",
    });
    // The call still counted: a rejection is a round trip, and that is what
    // makes "the machine only sent one" a meaningful assertion.
    expect(api.callCount()).toBe(1);
  });

  it("lets the predicate decide per call", async () => {
    let calls = 0;
    const api = createInMemoryCheckoutApi({
      failWhen: () => {
        calls += 1;
        return calls === 1 ? new CheckoutRejectedError("Timed out.", { retryable: true }) : null;
      },
    });

    await expect(api.placeOrder(input)).rejects.toThrow("Timed out.");
    await expect(api.placeOrder(input)).resolves.toMatchObject({ id: "ord-2" });
  });

  it("rejects when the signal aborts mid-flight, and counts it", async () => {
    const api = createInMemoryCheckoutApi({ latencyMs: 1_000 });
    const controller = new AbortController();

    const pending = api.placeOrder(input, { signal: controller.signal });
    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
    expect(api.abortCount()).toBe(1);
  });

  it("rejects immediately for a signal that has already aborted", async () => {
    const api = createInMemoryCheckoutApi({ latencyMs: 1_000 });
    const controller = new AbortController();
    controller.abort(new Error("already gone"));

    await expect(api.placeOrder(input, { signal: controller.signal })).rejects.toThrow(
      "already gone",
    );
    expect(api.abortCount()).toBe(1);
  });

  it("settles without a timer when there is no latency and no signal", async () => {
    const api = createInMemoryCheckoutApi();

    await expect(api.placeOrder(input)).resolves.toMatchObject({ id: "ord-1" });
    expect(api.abortCount()).toBe(0);
  });
});
