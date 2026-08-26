/**
 * The demo domain for the state-machine pattern.
 *
 * A checkout is the standard example for a reason: it is a sequence with real
 * ordering rules (you cannot pay for an empty cart), a step whose outcome only
 * the server knows, and a window during which the user must not be allowed to
 * press the button again. Those three together are what a `useState` flag soup
 * gets wrong, and what a machine gets right by construction.
 *
 * Everything here is deliberately in-memory. The pattern being demonstrated is
 * the machine, not the transport, and a fake server whose latency and failure
 * modes are arguments is the only way an automated test can drive the pending
 * and rejected states without racing a real one.
 */

/** Which step a server-side rejection belongs to, or `null` for the order itself. */
export type CheckoutStepName = "shipping" | "payment";

export interface CartItem {
  readonly id: string;
  readonly name: string;
  /** Minor units (pence/cents). Money is never a float here. */
  readonly unitPriceMinor: number;
  readonly quantity: number;
}

export interface ShippingDetails {
  readonly fullName: string;
  readonly line1: string;
  readonly city: string;
  readonly postcode: string;
}

export interface PaymentDetails {
  readonly cardholder: string;
  /** Digits only, already stripped of spaces by the schema. */
  readonly cardNumber: string;
  /** `MM/YY`. */
  readonly expiry: string;
  readonly cvc: string;
}

export interface CheckoutInput {
  readonly cart: readonly CartItem[];
  readonly shipping: ShippingDetails;
  readonly payment: PaymentDetails;
}

export interface Order {
  readonly id: string;
  readonly totalMinor: number;
  readonly placedAt: string;
}

/**
 * A refusal from the fake server.
 *
 * `step` is what makes this worth a class rather than a string. A server can
 * reject an order for a reason the user can fix in one specific step — the card
 * was declined, the postcode is outside the delivery area — and the only useful
 * response is to put them back in *that* step with the message attached, not on
 * a generic error screen with a "try again" button that will fail identically.
 *
 * `retryable` is the orthogonal question: a payment gateway timing out is worth
 * re-sending the same order unchanged; a declined card is not. The machine
 * reads both, which is why the distinction is made once, here, by the side that
 * actually knows.
 */
export class CheckoutRejectedError extends Error {
  readonly step: CheckoutStepName | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { step?: CheckoutStepName | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "CheckoutRejectedError";
    this.step = options.step ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export interface PlaceOrderOptions {
  /**
   * Aborts the in-flight order.
   *
   * This is the whole reason the fake server takes an options bag. XState stops
   * an invoked actor when its state is exited and passes the actor's signal
   * down, so "the user pressed Back while the order was in flight" cancels the
   * request instead of leaving it to land on a screen that has moved on. A fake
   * server that ignored the signal would make that untestable.
   */
  readonly signal?: AbortSignal | undefined;
}

export interface CheckoutApi {
  placeOrder(input: CheckoutInput, options?: PlaceOrderOptions): Promise<Order>;
}

export interface InMemoryCheckoutApiOptions {
  /** Simulated round-trip time in ms. Defaults to 0 (settles on a microtask). */
  readonly latencyMs?: number | undefined;
  /**
   * Return an error to reject the order, or `null` to let it through. A
   * predicate rather than a failure rate, so a demo of the error path is
   * reproducible instead of flaky.
   */
  readonly failWhen?: ((input: CheckoutInput) => CheckoutRejectedError | null) | undefined;
  /** Order ids are sequential so an assertion can name one. */
  readonly idPrefix?: string | undefined;
  /** Fixed timestamp for `placedAt`, so snapshots do not move. */
  readonly now?: (() => Date) | undefined;
}

/** Total in minor units. Exported because the review step and the server must agree. */
export function cartTotalMinor(cart: readonly CartItem[]): number {
  return cart.reduce((total, item) => total + item.unitPriceMinor * item.quantity, 0);
}

/** `1234` → `£12.34`. Formatting lives with the money, not in a component. */
export function formatMoney(minor: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
}

/**
 * Waits `ms`, rejecting early if the signal aborts.
 *
 * The listener is removed on both paths: a settled promise holding a reference
 * to an `AbortSignal` that outlives it is the ordinary way this leaks.
 */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(signal.reason as Error);
  if (ms <= 0 && signal === undefined) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A fake checkout server.
 *
 * `placeOrder` is not idempotent on purpose: every accepted call increments the
 * order counter, which is what lets a test assert that a double-click produced
 * one order rather than two. If the machine ever stopped preventing the second
 * submit, this counter is where it would show.
 */
export function createInMemoryCheckoutApi(options: InMemoryCheckoutApiOptions = {}): CheckoutApi & {
  /** How many calls reached the server, accepted or not. */
  readonly callCount: () => number;
  /** How many calls were aborted before they settled. */
  readonly abortCount: () => number;
} {
  const { latencyMs = 0, failWhen, idPrefix = "ord", now = () => new Date(0) } = options;
  let calls = 0;
  let aborts = 0;

  return {
    callCount: () => calls,
    abortCount: () => aborts,

    async placeOrder(input, placeOptions = {}): Promise<Order> {
      calls += 1;
      try {
        await delay(latencyMs, placeOptions.signal);
      } catch (error) {
        aborts += 1;
        throw error;
      }

      const rejection = failWhen?.(input) ?? null;
      if (rejection !== null) throw rejection;

      return {
        id: `${idPrefix}-${calls}`,
        totalMinor: cartTotalMinor(input.cart),
        placedAt: now().toISOString(),
      };
    },
  };
}
