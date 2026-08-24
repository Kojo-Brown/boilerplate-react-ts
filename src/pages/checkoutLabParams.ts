import { CheckoutRejectedError, type CartItem } from "@/lib/checkoutApi";

/**
 * Which fake server `/labs/checkout` runs against.
 *
 * Four modes rather than a "fail" boolean, because the three failures are
 * genuinely different shapes and the machine treats each one differently:
 * `declined` is final and belongs to the payment step, `undeliverable` is final
 * and belongs to shipping, and `outage` belongs to neither and is worth
 * retrying. A single failure switch would demonstrate one third of the design.
 */
export const CHECKOUT_SERVER_MODES = ["healthy", "declined", "undeliverable", "outage"] as const;

export type CheckoutServerMode = (typeof CHECKOUT_SERVER_MODES)[number];

export const SERVER_MODE_LABELS: Readonly<Record<CheckoutServerMode, string>> = {
  healthy: "Healthy",
  declined: "Card declined",
  undeliverable: "Outside delivery area",
  outage: "Gateway outage",
};

export const DECLINED_MESSAGE = "Your card was declined. Try a different one.";
export const UNDELIVERABLE_MESSAGE = "We do not deliver to that postcode yet.";
export const OUTAGE_MESSAGE = "The payment gateway is not responding.";

/** Latency used when `?latency=` is missing or unusable. */
export const DEFAULT_CHECKOUT_LATENCY_MS = 700;

/**
 * Upper bound on `?latency=`. Long enough to read the pending state and press
 * Cancel, short enough that the page is not a hang.
 */
export const MAX_CHECKOUT_LATENCY_MS = 10_000;

/** Anything unrecognised runs against the healthy server. */
export function parseCheckoutServerMode(raw: string | null): CheckoutServerMode {
  return CHECKOUT_SERVER_MODES.find((mode) => mode === raw) ?? "healthy";
}

/** Parses `?latency=`, falling back to the default and clamping to the maximum. */
export function parseCheckoutLatency(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_CHECKOUT_LATENCY_MS;
  }
  return Math.min(MAX_CHECKOUT_LATENCY_MS, Math.floor(parsed));
}

/**
 * The failure predicate for a mode, or `undefined` for the healthy server.
 *
 * Returning `undefined` rather than `() => null` matters at the call site: the
 * fake API's option is optional, and `exactOptionalPropertyTypes` is on.
 */
export function failureForMode(
  mode: CheckoutServerMode,
): (() => CheckoutRejectedError) | undefined {
  switch (mode) {
    case "declined":
      return () => new CheckoutRejectedError(DECLINED_MESSAGE, { step: "payment" });
    case "undeliverable":
      return () => new CheckoutRejectedError(UNDELIVERABLE_MESSAGE, { step: "shipping" });
    case "outage":
      return () => new CheckoutRejectedError(OUTAGE_MESSAGE, { retryable: true });
    case "healthy":
      return undefined;
  }
}

/** The basket the lab starts with. Prices are in minor units. */
export const DEMO_CART: readonly CartItem[] = [
  { id: "kbd", name: "Mechanical keyboard", unitPriceMinor: 8900, quantity: 1 },
  { id: "cbl", name: "Braided USB-C cable", unitPriceMinor: 1200, quantity: 2 },
  { id: "mat", name: "Desk mat", unitPriceMinor: 2400, quantity: 1 },
];
