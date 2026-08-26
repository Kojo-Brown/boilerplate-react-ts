import { describe, it, expect } from "vitest";
import { CheckoutRejectedError } from "@/features/checkout/checkoutApi";
import {
  CHECKOUT_SERVER_MODES,
  DECLINED_MESSAGE,
  DEFAULT_CHECKOUT_LATENCY_MS,
  DEMO_CART,
  MAX_CHECKOUT_LATENCY_MS,
  OUTAGE_MESSAGE,
  SERVER_MODE_LABELS,
  UNDELIVERABLE_MESSAGE,
  failureForMode,
  parseCheckoutLatency,
  parseCheckoutServerMode,
} from "@/pages/checkout-lab/checkoutLabParams";

describe("parseCheckoutServerMode", () => {
  it("accepts every declared mode", () => {
    for (const mode of CHECKOUT_SERVER_MODES) {
      expect(parseCheckoutServerMode(mode)).toBe(mode);
    }
  });

  it("falls back to the healthy server for anything else", () => {
    expect(parseCheckoutServerMode(null)).toBe("healthy");
    expect(parseCheckoutServerMode("")).toBe("healthy");
    expect(parseCheckoutServerMode("catastrophe")).toBe("healthy");
  });
});

describe("parseCheckoutLatency", () => {
  it("uses the default for a missing or unusable value", () => {
    expect(parseCheckoutLatency(null)).toBe(DEFAULT_CHECKOUT_LATENCY_MS);
    expect(parseCheckoutLatency("  ")).toBe(DEFAULT_CHECKOUT_LATENCY_MS);
    expect(parseCheckoutLatency("soon")).toBe(DEFAULT_CHECKOUT_LATENCY_MS);
    expect(parseCheckoutLatency("-1")).toBe(DEFAULT_CHECKOUT_LATENCY_MS);
  });

  it("floors and clamps what it accepts", () => {
    expect(parseCheckoutLatency("0")).toBe(0);
    expect(parseCheckoutLatency("750.9")).toBe(750);
    expect(parseCheckoutLatency("999999")).toBe(MAX_CHECKOUT_LATENCY_MS);
  });
});

describe("failureForMode", () => {
  it("has nothing to fail on the healthy server", () => {
    expect(failureForMode("healthy")).toBeUndefined();
  });

  it("attributes a decline to the payment step and calls it final", () => {
    const error = failureForMode("declined")?.();
    expect(error).toBeInstanceOf(CheckoutRejectedError);
    expect(error?.message).toBe(DECLINED_MESSAGE);
    expect(error?.step).toBe("payment");
    expect(error?.retryable).toBe(false);
  });

  it("attributes an undeliverable postcode to the shipping step", () => {
    const error = failureForMode("undeliverable")?.();
    expect(error?.message).toBe(UNDELIVERABLE_MESSAGE);
    expect(error?.step).toBe("shipping");
  });

  it("blames nobody for an outage and calls it retryable", () => {
    const error = failureForMode("outage")?.();
    expect(error?.message).toBe(OUTAGE_MESSAGE);
    expect(error?.step).toBeNull();
    expect(error?.retryable).toBe(true);
  });
});

describe("lab constants", () => {
  it("labels every mode", () => {
    for (const mode of CHECKOUT_SERVER_MODES) {
      expect(SERVER_MODE_LABELS[mode]).toBeTruthy();
    }
  });

  it("starts with a basket worth buying", () => {
    expect(DEMO_CART.length).toBeGreaterThan(1);
    expect(DEMO_CART.every((item) => item.quantity >= 1 && item.unitPriceMinor > 0)).toBe(true);
  });
});
