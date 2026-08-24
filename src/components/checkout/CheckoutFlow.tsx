import { useMachine } from "@xstate/react";
import { CartStep } from "@/components/checkout/CartStep";
import { CheckoutStepper } from "@/components/checkout/CheckoutStepper";
import { CheckoutTotal } from "@/components/checkout/CheckoutTotal";
import { ConfirmationStep } from "@/components/checkout/ConfirmationStep";
import { DetailsStep, type FieldDescriptor } from "@/components/checkout/DetailsStep";
import { ReviewStep } from "@/components/checkout/ReviewStep";
import { Text } from "@/components/ui/Text";
import type { CartItem, CheckoutApi } from "@/lib/checkoutApi";
import type { PaymentField, ShippingField } from "@/lib/checkoutSchemas";
import { activeStep, checkoutMachine } from "@/machines/checkoutMachine";

const SHIPPING_FIELD_DESCRIPTORS: readonly FieldDescriptor<ShippingField>[] = [
  { name: "fullName", label: "Full name", autoComplete: "name", placeholder: "Grace Hopper" },
  {
    name: "line1",
    label: "Address",
    autoComplete: "address-line1",
    placeholder: "12 Navy Yard",
  },
  { name: "city", label: "Town or city", autoComplete: "address-level2", placeholder: "Arlington" },
  { name: "postcode", label: "Postcode", autoComplete: "postal-code", placeholder: "SW1A 1AA" },
];

const PAYMENT_FIELD_DESCRIPTORS: readonly FieldDescriptor<PaymentField>[] = [
  { name: "cardholder", label: "Name on card", autoComplete: "cc-name", placeholder: "G Hopper" },
  {
    name: "cardNumber",
    label: "Card number",
    autoComplete: "cc-number",
    inputMode: "numeric",
    placeholder: "4242 4242 4242 4242",
  },
  {
    name: "expiry",
    label: "Expiry (MM/YY)",
    autoComplete: "cc-exp",
    inputMode: "numeric",
    placeholder: "12/29",
  },
  {
    name: "cvc",
    label: "Security code",
    autoComplete: "cc-csc",
    inputMode: "numeric",
    placeholder: "123",
  },
];

export interface CheckoutFlowProps {
  readonly cart: readonly CartItem[];
  readonly api: CheckoutApi;
  /** Injected so the expiry rule does not depend on the day the test runs. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The one component that talks to the machine.
 *
 * Every step below is presentational: it receives values and callbacks and has
 * no idea a machine exists. That is not ceremony — it is what makes the steps
 * testable without an actor, and it is what stops a step from growing its own
 * notion of what should happen next.
 *
 * Two things about `useMachine` are worth stating because they are easy to get
 * wrong:
 *
 * - `input` is read *once*, when the actor is created. Changing the `api` prop
 *   afterwards has no effect whatsoever, with no warning. The lab page handles
 *   that the only way that works — a `key` that remounts this component when
 *   the server knobs change — and any caller swapping the API at runtime must
 *   do the same.
 * - This component re-renders on every snapshot, which means every keystroke.
 *   That is correct here, because every step's props come out of the snapshot.
 *   {@link CheckoutTotal} is the counter-example: a component that needs one
 *   slice subscribes with `useSelector` instead.
 */
export function CheckoutFlow({ cart, api, now }: CheckoutFlowProps) {
  const [state, send, actor] = useMachine(checkoutMachine, { input: { cart, api, now } });
  const { context } = state;
  const stateValue = state.value;

  return (
    <div className="flex flex-col gap-6" data-testid="checkout-flow" data-state={stateValue}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CheckoutStepper current={activeStep(stateValue)} complete={state.matches("confirmed")} />
        <div className="flex items-center gap-2">
          <Text size="sm" tone="muted">
            Running total
          </Text>
          <CheckoutTotal actor={actor} />
        </div>
      </div>

      {state.matches("cart") && (
        <CartStep
          cart={context.cart}
          message={context.message}
          onQuantityChange={(id, quantity) => {
            send({ type: "cart.setQuantity", id, quantity });
          }}
          onRemove={(id) => {
            send({ type: "cart.remove", id });
          }}
          onNext={() => {
            send({ type: "next" });
          }}
        />
      )}

      {state.matches("shipping") && (
        <DetailsStep
          headingId="shipping-heading"
          heading="Where should it go?"
          fields={SHIPPING_FIELD_DESCRIPTORS}
          values={context.shippingDraft}
          errors={context.shippingErrors}
          message={context.message}
          nextLabel="Continue to payment"
          onChange={(field, value) => {
            send({ type: "shipping.change", field, value });
          }}
          onBack={() => {
            send({ type: "back" });
          }}
          onNext={() => {
            send({ type: "next" });
          }}
        />
      )}

      {state.matches("payment") && (
        <DetailsStep
          headingId="payment-heading"
          heading="How would you like to pay?"
          fields={PAYMENT_FIELD_DESCRIPTORS}
          values={context.paymentDraft}
          errors={context.paymentErrors}
          message={context.message}
          nextLabel="Review order"
          onChange={(field, value) => {
            send({ type: "payment.change", field, value });
          }}
          onBack={() => {
            send({ type: "back" });
          }}
          onNext={() => {
            send({ type: "next" });
          }}
        />
      )}

      {(state.matches("review") || state.matches("submitting") || state.matches("failure")) && (
        <ReviewStep
          cart={context.cart}
          shipping={context.shipping}
          payment={context.payment}
          message={context.message}
          phase={
            state.matches("submitting")
              ? "submitting"
              : state.matches("failure")
                ? "failure"
                : "review"
          }
          retryable={context.retryable}
          attempts={context.submitAttempts}
          onEdit={(step) => {
            send({ type: "review.edit", step });
          }}
          onBack={() => {
            send({ type: "back" });
          }}
          onPlaceOrder={() => {
            send({ type: "order.place" });
          }}
          onCancel={() => {
            send({ type: "order.cancel" });
          }}
          onRetry={() => {
            send({ type: "order.retry" });
          }}
        />
      )}

      {state.matches("confirmed") && context.order !== null && (
        <ConfirmationStep
          order={context.order}
          onRestart={() => {
            send({ type: "checkout.restart" });
          }}
        />
      )}
    </div>
  );
}
