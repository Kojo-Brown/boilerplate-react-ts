import { describe, it, expect } from "vitest";
import { createActor, waitFor, type Actor } from "xstate";
import {
  CheckoutRejectedError,
  createInMemoryCheckoutApi,
  type CartItem,
  type CheckoutApi,
} from "@/features/checkout/checkoutApi";
import {
  CHECKOUT_STEPS,
  EMPTY_CART_MESSAGE,
  INCOMPLETE_DETAILS_MESSAGE,
  activeStep,
  checkoutMachine,
  checkoutTotalMinor,
  placeOrderActor,
  toCheckoutInput,
  type CheckoutContext,
} from "@/features/checkout/checkoutMachine";

const CART: readonly CartItem[] = [
  { id: "kbd", name: "Keyboard", unitPriceMinor: 8900, quantity: 1 },
  { id: "cbl", name: "Cable", unitPriceMinor: 1200, quantity: 2 },
];

/**
 * A clock frozen mid-2026, so `12/26` is a card that has not expired and
 * `01/26` is one that has. Both stay true in 2030.
 */
const NOW = (): Date => new Date("2026-06-15T00:00:00.000Z");

type CheckoutActor = Actor<typeof checkoutMachine>;

function start(
  api: CheckoutApi,
  cart: readonly CartItem[] = CART,
): { actor: CheckoutActor; stop: () => void } {
  const actor = createActor(checkoutMachine, { input: { cart, api, now: NOW } });
  actor.start();
  return {
    actor,
    stop: () => {
      actor.stop();
    },
  };
}

const value = (actor: CheckoutActor): string => actor.getSnapshot().value;
const context = (actor: CheckoutActor): CheckoutContext => actor.getSnapshot().context;

/** Drives the actor as far as the review step with valid details throughout. */
function fillToReview(actor: CheckoutActor): void {
  actor.send({ type: "next" });
  actor.send({ type: "shipping.change", field: "fullName", value: "Grace Hopper" });
  actor.send({ type: "shipping.change", field: "line1", value: "12 Navy Yard" });
  actor.send({ type: "shipping.change", field: "city", value: "Arlington" });
  actor.send({ type: "shipping.change", field: "postcode", value: "SW1A 1AA" });
  actor.send({ type: "next" });
  actor.send({ type: "payment.change", field: "cardholder", value: "G Hopper" });
  actor.send({ type: "payment.change", field: "cardNumber", value: "4242 4242 4242 4242" });
  actor.send({ type: "payment.change", field: "expiry", value: "12/26" });
  actor.send({ type: "payment.change", field: "cvc", value: "123" });
  actor.send({ type: "next" });
}

describe("checkout machine — cart step", () => {
  it("refuses to leave an empty cart and says why", () => {
    // The point of the assertion is the message, not the state. A guard on its
    // own would leave the actor in `cart` with no context change at all: the
    // event is dropped, the button appears dead, and there is nothing on
    // screen or in the snapshot to explain it.
    const { actor, stop } = start(createInMemoryCheckoutApi(), []);

    actor.send({ type: "next" });

    expect(value(actor)).toBe("cart");
    expect(context(actor).message).toBe(EMPTY_CART_MESSAGE);
    stop();
  });

  it("advances to shipping once the cart has something in it", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());

    actor.send({ type: "next" });

    expect(value(actor)).toBe("shipping");
    expect(context(actor).message).toBeNull();
    stop();
  });

  it("clamps a quantity to at least one and drops removed lines", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());

    actor.send({ type: "cart.setQuantity", id: "cbl", quantity: 0 });
    expect(context(actor).cart.find((item) => item.id === "cbl")?.quantity).toBe(1);

    actor.send({ type: "cart.remove", id: "cbl" });
    expect(context(actor).cart.map((item) => item.id)).toEqual(["kbd"]);
    stop();
  });

  it("falls back to refusing once the last line is removed", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());

    actor.send({ type: "cart.remove", id: "kbd" });
    actor.send({ type: "cart.remove", id: "cbl" });
    actor.send({ type: "next" });

    expect(value(actor)).toBe("cart");
    expect(context(actor).message).toBe(EMPTY_CART_MESSAGE);
    stop();
  });
});

describe("checkout machine — shipping step", () => {
  it("reports one message per invalid field instead of doing nothing", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());
    actor.send({ type: "next" });

    actor.send({ type: "next" });

    expect(value(actor)).toBe("shipping");
    expect(Object.keys(context(actor).shippingErrors).sort()).toEqual([
      "city",
      "fullName",
      "line1",
      "postcode",
    ]);
    stop();
  });

  it("clears only the edited field's error", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());
    actor.send({ type: "next" });
    actor.send({ type: "next" });

    actor.send({ type: "shipping.change", field: "city", value: "Arlington" });

    expect(context(actor).shippingErrors.city).toBeUndefined();
    expect(context(actor).shippingErrors.fullName).toBeDefined();
    stop();
  });

  it("commits the parsed value, trimmed, on the way to payment", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());
    actor.send({ type: "next" });
    actor.send({ type: "shipping.change", field: "fullName", value: "  Grace Hopper  " });
    actor.send({ type: "shipping.change", field: "line1", value: "12 Navy Yard" });
    actor.send({ type: "shipping.change", field: "city", value: "Arlington" });
    actor.send({ type: "shipping.change", field: "postcode", value: "sw1a 1aa" });

    actor.send({ type: "next" });

    expect(value(actor)).toBe("payment");
    expect(context(actor).shipping).toEqual({
      fullName: "Grace Hopper",
      line1: "12 Navy Yard",
      city: "Arlington",
      postcode: "sw1a 1aa",
    });
    stop();
  });

  it("keeps the draft when the user goes back", () => {
    // Resetting a step on exit is the reflex, and it is what turns "let me
    // check the address" into "type all of that again".
    const { actor, stop } = start(createInMemoryCheckoutApi());
    actor.send({ type: "next" });
    actor.send({ type: "shipping.change", field: "city", value: "Arlington" });

    actor.send({ type: "back" });
    actor.send({ type: "next" });

    expect(context(actor).shippingDraft.city).toBe("Arlington");
    stop();
  });
});

describe("checkout machine — payment step", () => {
  it("rejects a card that expired before the injected clock", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());
    actor.send({ type: "next" });
    actor.send({ type: "shipping.change", field: "fullName", value: "Grace Hopper" });
    actor.send({ type: "shipping.change", field: "line1", value: "12 Navy Yard" });
    actor.send({ type: "shipping.change", field: "city", value: "Arlington" });
    actor.send({ type: "shipping.change", field: "postcode", value: "SW1A 1AA" });
    actor.send({ type: "next" });

    actor.send({ type: "payment.change", field: "cardholder", value: "G Hopper" });
    actor.send({ type: "payment.change", field: "cardNumber", value: "4242424242424242" });
    actor.send({ type: "payment.change", field: "expiry", value: "01/26" });
    actor.send({ type: "payment.change", field: "cvc", value: "123" });
    actor.send({ type: "next" });

    expect(value(actor)).toBe("payment");
    expect(context(actor).paymentErrors.expiry).toBe("That card has expired.");
    stop();
  });

  it("strips separators from the card number it commits", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());
    fillToReview(actor);

    expect(value(actor)).toBe("review");
    expect(context(actor).payment?.cardNumber).toBe("4242424242424242");
    stop();
  });
});

describe("checkout machine — submitting", () => {
  it("places the order and lands on the confirmation", async () => {
    const api = createInMemoryCheckoutApi({ idPrefix: "demo" });
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("confirmed"));

    expect(context(actor).order?.id).toBe("demo-1");
    expect(context(actor).order?.totalMinor).toBe(8900 + 1200 * 2);
    expect(api.callCount()).toBe(1);
    stop();
  });

  it("cannot be submitted twice", async () => {
    // Not "the second click is ignored" — `submitting` declares no
    // `order.place` transition, so there is nowhere for it to go. No flag to
    // set, and none to forget to unset.
    const api = createInMemoryCheckoutApi({ latencyMs: 20 });
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    actor.send({ type: "order.place" });
    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("confirmed"));

    expect(api.callCount()).toBe(1);
    expect(context(actor).submitAttempts).toBe(1);
    stop();
  });

  it("aborts the in-flight request when the user cancels", async () => {
    const api = createInMemoryCheckoutApi({ latencyMs: 200 });
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    expect(value(actor)).toBe("submitting");
    actor.send({ type: "order.cancel" });

    expect(value(actor)).toBe("review");
    // The abort is observed by the server, not merely by the machine: leaving
    // the state stops the invoked actor, and stopping it fires its signal. The
    // rejection is delivered on a microtask, so the assertion waits one turn.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(api.abortCount()).toBe(1);
    expect(context(actor).order).toBeNull();
    stop();
  });

  it("reads the actor's input at invoke time, not at machine-build time", async () => {
    const api = createInMemoryCheckoutApi();
    const { actor, stop } = start(api);
    fillToReview(actor);

    // A change made after the machine was created and after the earlier steps
    // committed. It is in the request because `input` is a function of context,
    // evaluated when `submitting` is entered.
    actor.send({ type: "review.edit", step: "cart" });
    actor.send({ type: "cart.setQuantity", id: "cbl", quantity: 5 });
    actor.send({ type: "next" });
    actor.send({ type: "next" });
    actor.send({ type: "next" });
    expect(value(actor)).toBe("review");
    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("confirmed"));

    expect(context(actor).order?.totalMinor).toBe(8900 + 1200 * 5);
    stop();
  });
});

describe("checkout machine — failures", () => {
  it("routes a rejection the server blamed on payment back to the payment step", async () => {
    const api = createInMemoryCheckoutApi({
      failWhen: () => new CheckoutRejectedError("Your card was declined.", { step: "payment" }),
    });
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("payment"));

    expect(context(actor).message).toBe("Your card was declined.");
    expect(context(actor).retryable).toBe(false);
    stop();
  });

  it("routes a rejection blamed on shipping back to the shipping step", async () => {
    const api = createInMemoryCheckoutApi({
      failWhen: () =>
        new CheckoutRejectedError("We do not deliver to that postcode.", { step: "shipping" }),
    });
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("shipping"));

    expect(context(actor).message).toBe("We do not deliver to that postcode.");
    stop();
  });

  it("retries a retryable failure and succeeds on the second attempt", async () => {
    let attempt = 0;
    const api = createInMemoryCheckoutApi({
      failWhen: () => {
        attempt += 1;
        return attempt === 1
          ? new CheckoutRejectedError("The payment gateway timed out.", { retryable: true })
          : null;
      },
    });
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("failure"));
    expect(context(actor).message).toBe("The payment gateway timed out.");
    expect(context(actor).retryable).toBe(true);

    actor.send({ type: "order.retry" });
    await waitFor(actor, (snapshot) => snapshot.matches("confirmed"));

    expect(context(actor).submitAttempts).toBe(2);
    expect(api.callCount()).toBe(2);
    stop();
  });

  it("refuses to retry a failure the server called final", async () => {
    const api = createInMemoryCheckoutApi({
      failWhen: () => new CheckoutRejectedError("This order has already been placed."),
    });
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("failure"));

    actor.send({ type: "order.retry" });

    expect(value(actor)).toBe("failure");
    expect(api.callCount()).toBe(1);
    stop();
  });

  it("treats an error that is not ours as retryable, with a fallback message", async () => {
    const api: CheckoutApi = {
      placeOrder: () => Promise.reject(new Error("")),
    };
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("failure"));

    expect(context(actor).message).toBe("The order could not be placed. Please try again.");
    expect(context(actor).retryable).toBe(true);
    stop();
  });

  it("lets the user edit either step from the failure screen", async () => {
    const api = createInMemoryCheckoutApi({
      failWhen: () => new CheckoutRejectedError("Something went wrong."),
    });
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("failure"));

    actor.send({ type: "review.edit", step: "shipping" });
    expect(value(actor)).toBe("shipping");
    expect(context(actor).message).toBeNull();
    stop();
  });

  it("goes back to review from the failure screen", async () => {
    const api = createInMemoryCheckoutApi({
      failWhen: () => new CheckoutRejectedError("Something went wrong."),
    });
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("failure"));

    actor.send({ type: "back" });

    expect(value(actor)).toBe("review");
    stop();
  });
});

describe("checkout machine — review and restart", () => {
  it("jumps to the step named by the edit event", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());
    fillToReview(actor);

    actor.send({ type: "review.edit", step: "payment" });
    expect(value(actor)).toBe("payment");

    actor.send({ type: "next" });
    actor.send({ type: "review.edit", step: "shipping" });
    expect(value(actor)).toBe("shipping");
    stop();
  });

  it("steps back from review to payment", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());
    fillToReview(actor);

    actor.send({ type: "back" });

    expect(value(actor)).toBe("payment");
    stop();
  });

  it("restores the starting cart on restart, and keeps running", async () => {
    // `confirmed` is not a final state on purpose: a final root state stops the
    // actor, and a stopped actor cannot be restarted.
    const api = createInMemoryCheckoutApi();
    const { actor, stop } = start(api);
    fillToReview(actor);
    actor.send({ type: "cart.setQuantity", id: "cbl", quantity: 9 });
    actor.send({ type: "order.place" });
    await waitFor(actor, (snapshot) => snapshot.matches("confirmed"));

    actor.send({ type: "checkout.restart" });

    expect(value(actor)).toBe("cart");
    expect(actor.getSnapshot().status).toBe("active");
    expect(context(actor).cart).toEqual(CART);
    expect(context(actor).shipping).toBeNull();
    expect(context(actor).payment).toBeNull();
    expect(context(actor).shippingDraft.city).toBe("");
    expect(context(actor).order).toBeNull();
    expect(context(actor).submitAttempts).toBe(0);
    stop();
  });
});

describe("toCheckoutInput", () => {
  it("returns null until both steps have been committed", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());

    expect(toCheckoutInput(context(actor))).toBeNull();

    fillToReview(actor);
    expect(toCheckoutInput(context(actor))).not.toBeNull();
    stop();
  });

  it("returns null for an empty cart even with details filled in", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());
    fillToReview(actor);

    // Spread rather than driven, because the machine will not produce this
    // combination: emptying the cart happens in the `cart` step, and `next`
    // refuses to leave it. That is the guarantee — this asserts the helper
    // agrees with it rather than relying on the machine to enforce it twice.
    expect(toCheckoutInput({ ...context(actor), cart: [] })).toBeNull();
    stop();
  });

  it("cannot be emptied on the way to submitting", () => {
    const api = createInMemoryCheckoutApi();
    const { actor, stop } = start(api);
    fillToReview(actor);

    actor.send({ type: "review.edit", step: "cart" });
    actor.send({ type: "cart.remove", id: "kbd" });
    actor.send({ type: "cart.remove", id: "cbl" });
    actor.send({ type: "next" });

    expect(value(actor)).toBe("cart");
    expect(api.callCount()).toBe(0);
    stop();
  });
});

describe("placeOrderActor", () => {
  it("rejects rather than calling the server with nothing", async () => {
    // Unreachable through the machine — `detailsComplete` guards it — which is
    // exactly why it is covered here instead. XState v5 has no typestates, so
    // "review implies these fields are set" is not a fact the compiler holds.
    const api = createInMemoryCheckoutApi();
    const actor = createActor(placeOrderActor, { input: { api, input: null } });
    const settled = new Promise<Error>((resolve) => {
      actor.subscribe({
        error: (error: unknown) => {
          resolve(error as Error);
        },
      });
    });
    actor.start();

    await expect(settled).resolves.toMatchObject({ message: INCOMPLETE_DETAILS_MESSAGE });
    expect(api.callCount()).toBe(0);
  });
});

describe("step helpers", () => {
  it("maps every machine state onto a visible step", () => {
    expect(activeStep("cart")).toBe("cart");
    expect(activeStep("shipping")).toBe("shipping");
    expect(activeStep("payment")).toBe("payment");
    expect(activeStep("review")).toBe("review");
    expect(activeStep("submitting")).toBe("review");
    expect(activeStep("failure")).toBe("review");
    expect(activeStep("confirmed")).toBe("review");
    expect(CHECKOUT_STEPS).toContain(activeStep("something-else"));
  });

  it("totals the cart from the cart itself", () => {
    const { actor, stop } = start(createInMemoryCheckoutApi());

    expect(checkoutTotalMinor(context(actor))).toBe(8900 + 1200 * 2);
    stop();
  });
});
