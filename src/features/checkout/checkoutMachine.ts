import { assign, fromPromise, setup } from "xstate";
import {
  CheckoutRejectedError,
  cartTotalMinor,
  type CartItem,
  type CheckoutApi,
  type CheckoutInput,
  type Order,
  type PaymentDetails,
  type ShippingDetails,
} from "@/features/checkout/checkoutApi";
import {
  EMPTY_PAYMENT_DRAFT,
  EMPTY_SHIPPING_DRAFT,
  PAYMENT_FIELDS,
  SHIPPING_FIELDS,
  createPaymentSchema,
  shippingSchema,
  type PaymentDraft,
  type PaymentField,
  type ShippingDraft,
  type ShippingField,
} from "@/features/checkout/checkoutSchemas";
import { clearFieldError, fieldErrorsFromZod, type FieldErrors } from "@/shared/lib/formState";

/**
 * A multi-step checkout as a state machine.
 *
 * The argument for a machine here is not that the steps are numerous. It is
 * that the flow has rules which are *invariants*, and a machine is the only
 * shape that enforces an invariant instead of re-asserting it at every call
 * site:
 *
 * - You cannot pay for an empty cart. Not "the Next button is disabled" — the
 *   `next` event has no transition out of `cart` while the cart is empty, so
 *   there is no code path to the payment step at all, however the event
 *   arrives.
 * - You cannot submit the same order twice. `submitting` declares no
 *   `order.place` handler, so the second click is not ignored by a boolean that
 *   somebody has to remember to set and unset — it is not a transition.
 * - An order in flight is cancelled if you leave. XState stops an invoked actor
 *   when its state is exited, and hands that actor an `AbortSignal`, so leaving
 *   `submitting` aborts the request rather than letting it land on a screen
 *   that has moved on.
 *
 * The parts of this that were *not* obvious are called out in comments below
 * and pinned by tests; `docs/state-machines.md` collects them.
 */

export interface CheckoutContext {
  readonly cart: readonly CartItem[];
  /**
   * The cart the machine started with, kept so "Start another order" restores
   * it. Without it, restarting resets to an empty basket and the demo's next
   * act is the user re-adding what they just bought.
   */
  readonly initialCart: readonly CartItem[];
  /** What the inputs hold, including values that do not parse yet. */
  readonly shippingDraft: ShippingDraft;
  readonly paymentDraft: PaymentDraft;
  /** What parsed successfully, and therefore what the server will be sent. */
  readonly shipping: ShippingDetails | null;
  readonly payment: PaymentDetails | null;
  readonly shippingErrors: FieldErrors<ShippingField>;
  readonly paymentErrors: FieldErrors<PaymentField>;
  /**
   * The one message that belongs to the flow rather than to a control.
   *
   * Deliberately *not* cleared by an entry action on each step. Entry actions
   * run after the transition's own actions, so an entry-level `clearMessage`
   * would erase the very rejection that routed the user back to that step —
   * silently, and only for the server-error path, which is the path least
   * likely to be exercised by hand. Clearing is therefore explicit, on the
   * transitions where clearing is the right answer.
   */
  readonly message: string | null;
  readonly order: Order | null;
  /** Whether re-sending the same order unchanged could plausibly work. */
  readonly retryable: boolean;
  readonly submitAttempts: number;
  readonly api: CheckoutApi;
  /** Injected so "has this card expired?" does not depend on the wall clock. */
  readonly now: () => Date;
}

export interface CheckoutMachineInput {
  readonly cart: readonly CartItem[];
  readonly api: CheckoutApi;
  readonly now?: (() => Date) | undefined;
}

export type CheckoutEvent =
  | { readonly type: "cart.setQuantity"; readonly id: string; readonly quantity: number }
  | { readonly type: "cart.remove"; readonly id: string }
  | { readonly type: "next" }
  | { readonly type: "back" }
  | { readonly type: "shipping.change"; readonly field: ShippingField; readonly value: string }
  | { readonly type: "payment.change"; readonly field: PaymentField; readonly value: string }
  | { readonly type: "review.edit"; readonly step: EditableStep }
  | { readonly type: "order.place" }
  | { readonly type: "order.cancel" }
  | { readonly type: "order.retry" }
  | { readonly type: "checkout.restart" };

/** The step names, in the order they are visited. Exported for the stepper. */
export const CHECKOUT_STEPS = ["cart", "shipping", "payment", "review"] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];

/**
 * The steps `review.edit` can jump back to.
 *
 * `cart` is in here because a review screen that lists the basket and offers no
 * way to change it is the commonest reason people abandon one. Editing goes
 * through the step rather than through an event handled everywhere: quantities
 * must not be editable while the order is in flight, and the way a machine says
 * that is by not accepting the event in `submitting` at all.
 */
export const EDITABLE_STEPS = ["cart", "shipping", "payment"] as const;
export type EditableStep = (typeof EDITABLE_STEPS)[number];

export const EMPTY_CART_MESSAGE = "Add something to the basket before continuing.";
export const INCOMPLETE_DETAILS_MESSAGE =
  "Shipping and payment details are incomplete. Go back and finish them.";

/**
 * Gathers the committed details into the shape the server takes, or `null` if
 * either step has not been completed.
 *
 * This function exists because XState v5 removed typestates: a snapshot in the
 * `review` state is not a *type* that knows `context.shipping` is non-null,
 * even though reaching `review` is the only way to set it. Narrowing is the
 * caller's job, and doing it in one exported function — rather than with a
 * non-null assertion at the `invoke` — is what makes the impossible branch
 * something a test can actually cover.
 */
export function toCheckoutInput(context: CheckoutContext): CheckoutInput | null {
  const { cart, shipping, payment } = context;
  if (shipping === null || payment === null || cart.length === 0) return null;
  return { cart, shipping, payment };
}

export interface PlaceOrderInput {
  readonly api: CheckoutApi;
  readonly input: CheckoutInput | null;
}

/**
 * The submission actor.
 *
 * `signal` is the reason this is a `fromPromise` rather than a `useEffect`:
 * XState aborts it when `submitting` is exited, so a cancelled checkout
 * cancels the request. The fake API honours the signal, so that is a testable
 * claim rather than a comforting one.
 */
export const placeOrderActor = fromPromise<Order, PlaceOrderInput>(
  async ({ input: { api, input }, signal }) => {
    if (input === null) {
      throw new CheckoutRejectedError(INCOMPLETE_DETAILS_MESSAGE, { retryable: false });
    }
    return api.placeOrder(input, { signal });
  },
);

/** The rejection behind an `onError` event, or `null` for anything else. */
function asRejection(error: unknown): CheckoutRejectedError | null {
  return error instanceof CheckoutRejectedError ? error : null;
}

/** Every failure gets a message, including the ones that are not ours. */
function messageFor(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return "The order could not be placed. Please try again.";
}

export const checkoutMachine = setup({
  types: {
    context: {} as CheckoutContext,
    events: {} as CheckoutEvent,
    input: {} as CheckoutMachineInput,
  },
  actors: {
    placeOrder: placeOrderActor,
  },
  guards: {
    cartHasItems: ({ context }) => context.cart.length > 0,
    /*
     * A guard is a predicate and cannot write to context, so the draft is
     * parsed here to decide the transition and parsed again in the action that
     * commits it. That duplication is intrinsic to the shape rather than an
     * oversight: the alternative is a single action that both parses and picks
     * the next state, which XState does not let an action do — choosing the
     * target is the guard's entire job. The parse is a few microseconds on a
     * four-field object, and paying it twice is cheaper than the state slot a
     * "last parse result" cache would add to context.
     */
    shippingValid: ({ context }) => shippingSchema.safeParse(context.shippingDraft).success,
    paymentValid: ({ context }) =>
      createPaymentSchema(context.now()).safeParse(context.paymentDraft).success,
    detailsComplete: ({ context }) => toCheckoutInput(context) !== null,
    retryable: ({ context }) => context.retryable,
  },
  actions: {
    setQuantity: assign({
      cart: ({ context }, params: { id: string; quantity: number }) =>
        context.cart.map((item) =>
          item.id === params.id ? { ...item, quantity: Math.max(1, params.quantity) } : item,
        ),
    }),
    removeItem: assign({
      cart: ({ context }, params: { id: string }) =>
        context.cart.filter((item) => item.id !== params.id),
    }),
    setShippingField: assign({
      shippingDraft: ({ context }, params: { field: ShippingField; value: string }) => ({
        ...context.shippingDraft,
        [params.field]: params.value,
      }),
      // The error under a control goes away as soon as the control changes.
      // Leaving it until the next submit means the user fixes the field and is
      // still told it is wrong, which reads as the form having ignored them.
      shippingErrors: ({ context }, params: { field: ShippingField; value: string }) =>
        clearFieldError(context.shippingErrors, params.field),
    }),
    setPaymentField: assign({
      paymentDraft: ({ context }, params: { field: PaymentField; value: string }) => ({
        ...context.paymentDraft,
        [params.field]: params.value,
      }),
      paymentErrors: ({ context }, params: { field: PaymentField; value: string }) =>
        clearFieldError(context.paymentErrors, params.field),
    }),
    /*
     * One action for both outcomes, on both `next` transitions.
     *
     * Splitting this into a `commitShipping` for the valid path and a
     * `showShippingErrors` for the invalid one reads better and is worse: each
     * half then carries a branch for the case the guard already ruled out,
     * which is dead code that no test can reach and that quietly becomes wrong
     * if the guard is ever changed. The guard picks the target; this decides
     * what the context should say either way.
     *
     * The refusal half is the one that matters. XState *drops* an event with no
     * eligible transition — no error, no snapshot change, nothing in a devtools
     * timeline — so a `next` guarded only by `shippingValid` gives a Continue
     * button that does nothing at all on an invalid form, with nothing on
     * screen and nothing in the actor to explain it. The unguarded transition
     * that runs this is what turns "refused" into something the user can read,
     * and it has to be listed last: transitions are evaluated in array order,
     * so a catch-all placed first wins every time.
     */
    applyShippingParse: assign(({ context }) => {
      const parsed = shippingSchema.safeParse(context.shippingDraft);
      return parsed.success
        ? { shipping: parsed.data, shippingErrors: {}, message: null }
        : { shippingErrors: fieldErrorsFromZod(parsed.error, SHIPPING_FIELDS), message: null };
    }),
    applyPaymentParse: assign(({ context }) => {
      const parsed = createPaymentSchema(context.now()).safeParse(context.paymentDraft);
      return parsed.success
        ? { payment: parsed.data, paymentErrors: {}, message: null }
        : { paymentErrors: fieldErrorsFromZod(parsed.error, PAYMENT_FIELDS), message: null };
    }),
    explainEmptyCart: assign({ message: EMPTY_CART_MESSAGE }),
    clearMessage: assign({ message: null }),
    countAttempt: assign({ submitAttempts: ({ context }) => context.submitAttempts + 1 }),
    recordOrder: assign({
      order: (_, params: { order: Order }) => params.order,
      message: null,
      retryable: false,
    }),
    recordFailure: assign({
      message: (_, params: { error: unknown }) => messageFor(params.error),
      retryable: (_, params: { error: unknown }) => asRejection(params.error)?.retryable ?? true,
    }),
    /*
     * A rejection the server attributed to a step lands under that step's
     * form-level message, not on a generic error screen. "Card declined" with a
     * Retry button that will decline identically is the failure mode this
     * avoids.
     */
    attributeRejectionToStep: assign({
      message: (_, params: { error: unknown }) => messageFor(params.error),
      retryable: false,
    }),
    resetCheckout: assign(({ context }) => ({
      cart: context.initialCart,
      shippingDraft: EMPTY_SHIPPING_DRAFT,
      paymentDraft: EMPTY_PAYMENT_DRAFT,
      shipping: null,
      payment: null,
      shippingErrors: {},
      paymentErrors: {},
      message: null,
      order: null,
      retryable: false,
      submitAttempts: 0,
    })),
  },
}).createMachine({
  id: "checkout",
  initial: "cart",
  context: ({ input }) => ({
    cart: input.cart,
    initialCart: input.cart,
    shippingDraft: EMPTY_SHIPPING_DRAFT,
    paymentDraft: EMPTY_PAYMENT_DRAFT,
    shipping: null,
    payment: null,
    shippingErrors: {},
    paymentErrors: {},
    message: null,
    order: null,
    retryable: false,
    submitAttempts: 0,
    api: input.api,
    now: input.now ?? (() => new Date()),
  }),
  states: {
    cart: {
      on: {
        "cart.setQuantity": {
          actions: {
            type: "setQuantity",
            params: ({ event }) => ({ id: event.id, quantity: event.quantity }),
          },
        },
        "cart.remove": {
          actions: { type: "removeItem", params: ({ event }) => ({ id: event.id }) },
        },
        next: [
          { guard: "cartHasItems", target: "shipping", actions: "clearMessage" },
          { actions: "explainEmptyCart" },
        ],
      },
    },

    shipping: {
      on: {
        "shipping.change": {
          actions: {
            type: "setShippingField",
            params: ({ event }) => ({ field: event.field, value: event.value }),
          },
        },
        // `back` keeps the draft. Resetting a step on the way out is the
        // reflex, and it is what makes "go back and check the address" throw
        // away everything the user typed on the next screen.
        back: { target: "cart", actions: "clearMessage" },
        next: [
          { guard: "shippingValid", target: "payment", actions: "applyShippingParse" },
          { actions: "applyShippingParse" },
        ],
      },
    },

    payment: {
      on: {
        "payment.change": {
          actions: {
            type: "setPaymentField",
            params: ({ event }) => ({ field: event.field, value: event.value }),
          },
        },
        back: { target: "shipping", actions: "clearMessage" },
        next: [
          { guard: "paymentValid", target: "review", actions: "applyPaymentParse" },
          { actions: "applyPaymentParse" },
        ],
      },
    },

    review: {
      on: {
        back: { target: "payment", actions: "clearMessage" },
        "review.edit": [
          {
            guard: ({ event }) => event.step === "cart",
            target: "cart",
            actions: "clearMessage",
          },
          {
            guard: ({ event }) => event.step === "shipping",
            target: "shipping",
            actions: "clearMessage",
          },
          { target: "payment", actions: "clearMessage" },
        ],
        // Guarded even though `review` is unreachable without both steps
        // committed: the guard is what lets the actor's input be typed without
        // a non-null assertion standing in for a proof.
        "order.place": { guard: "detailsComplete", target: "submitting" },
      },
    },

    submitting: {
      entry: ["countAttempt", "clearMessage"],
      invoke: {
        id: "placeOrder",
        src: "placeOrder",
        // Read at invoke time from context, not closed over at machine-build
        // time: an edit made in `review` before pressing Place order is in the
        // request precisely because this is a function.
        input: ({ context }) => ({ api: context.api, input: toCheckoutInput(context) }),
        onDone: {
          target: "confirmed",
          actions: { type: "recordOrder", params: ({ event }) => ({ order: event.output }) },
        },
        onError: [
          {
            guard: ({ event }) => asRejection(event.error)?.step === "shipping",
            target: "shipping",
            actions: {
              type: "attributeRejectionToStep",
              params: ({ event }) => ({ error: event.error }),
            },
          },
          {
            guard: ({ event }) => asRejection(event.error)?.step === "payment",
            target: "payment",
            actions: {
              type: "attributeRejectionToStep",
              params: ({ event }) => ({ error: event.error }),
            },
          },
          {
            target: "failure",
            actions: { type: "recordFailure", params: ({ event }) => ({ error: event.error }) },
          },
        ],
      },
      // No `order.place` here, which is the point: a second click during the
      // request is not "ignored", it has nowhere to go. Nothing has to remember
      // to set a flag, and nothing can forget to unset it.
      on: {
        "order.cancel": { target: "review", actions: "clearMessage" },
      },
    },

    failure: {
      on: {
        "order.retry": { guard: "retryable", target: "submitting" },
        back: { target: "review", actions: "clearMessage" },
        "review.edit": [
          {
            guard: ({ event }) => event.step === "cart",
            target: "cart",
            actions: "clearMessage",
          },
          {
            guard: ({ event }) => event.step === "shipping",
            target: "shipping",
            actions: "clearMessage",
          },
          { target: "payment", actions: "clearMessage" },
        ],
      },
    },

    /*
     * Not `type: "final"`.
     *
     * A final root state stops the actor, and a stopped actor cannot be
     * restarted — `actor.start()` on one is a no-op, so "Start another order"
     * would need the page to throw the machine away and build a new one, taking
     * the cart with it. The flow genuinely does end here; what does not end is
     * the actor that models it, and conflating the two is the mistake this
     * comment exists to name.
     */
    confirmed: {
      on: {
        "checkout.restart": { target: "cart", actions: "resetCheckout" },
      },
    },
  },
});

/** The step the stepper should highlight for a given state value. */
export function activeStep(state: string): CheckoutStep {
  switch (state) {
    case "shipping":
      return "shipping";
    case "payment":
      return "payment";
    case "review":
    case "submitting":
    case "failure":
    case "confirmed":
      return "review";
    default:
      return "cart";
  }
}

/** The order total, recomputed from the cart rather than stored beside it. */
export function checkoutTotalMinor(context: CheckoutContext): number {
  return cartTotalMinor(context.cart);
}
