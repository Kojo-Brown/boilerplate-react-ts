import { Button } from "@/shared/ui/Button";
import { Text } from "@/shared/ui/Text";
import {
  cartTotalMinor,
  formatMoney,
  type CartItem,
  type PaymentDetails,
  type ShippingDetails,
} from "@/features/checkout/checkoutApi";
import type { EditableStep } from "@/features/checkout/checkoutMachine";

interface ReviewStepProps {
  readonly cart: readonly CartItem[];
  readonly shipping: ShippingDetails | null;
  readonly payment: PaymentDetails | null;
  readonly message: string | null;
  /** `submitting` — the request is in flight. `failure` — it came back bad. */
  readonly phase: "review" | "submitting" | "failure";
  readonly retryable: boolean;
  readonly attempts: number;
  readonly onEdit: (step: EditableStep) => void;
  readonly onBack: () => void;
  readonly onPlaceOrder: () => void;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
}

/** Only the last four digits are ever shown back to the user. */
function maskCard(cardNumber: string): string {
  return `•••• ${cardNumber.slice(-4)}`;
}

/**
 * Review, submit, and the two things that can happen next.
 *
 * `submitting` and `failure` are rendered here rather than as separate screens
 * because they are the same page in three conditions — swapping the whole
 * screen for a spinner throws away the summary the user is in the middle of
 * checking, and throws away their scroll position with it.
 *
 * The Place order button is not disabled while the request is in flight. It is
 * *replaced*, by the pending state and a Cancel beside it, because a disabled
 * button with a spinner inside it tells the user to wait and gives them no way
 * to change their mind. The machine makes the safety half of that redundant:
 * `submitting` has no `order.place` transition, so a double click has nowhere
 * to go regardless of what this component renders.
 */
export function ReviewStep({
  cart,
  shipping,
  payment,
  message,
  phase,
  retryable,
  attempts,
  onEdit,
  onBack,
  onPlaceOrder,
  onCancel,
  onRetry,
}: ReviewStepProps) {
  const submitting = phase === "submitting";

  return (
    <section className="flex flex-col gap-4" aria-labelledby="review-heading">
      <Text as="h2" id="review-heading" size="xl" weight="semibold">
        Check your order
      </Text>

      {message !== null && (
        <Text tone="danger" role="alert" data-testid="review-message">
          {message}
        </Text>
      )}

      <dl className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div className="flex items-center justify-between">
            <Text as="dt" weight="semibold">
              Basket
            </Text>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onEdit("cart");
              }}
            >
              Edit basket
            </Button>
          </div>
          <Text as="dd" tone="muted" size="sm" data-testid="review-cart">
            {cart.map((item) => `${item.quantity} × ${item.name}`).join(", ")}
          </Text>
        </div>

        <div className="flex flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div className="flex items-center justify-between">
            <Text as="dt" weight="semibold">
              Delivery
            </Text>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onEdit("shipping");
              }}
            >
              Edit delivery
            </Button>
          </div>
          <Text as="dd" tone="muted" size="sm" data-testid="review-shipping">
            {shipping === null
              ? "Not provided"
              : `${shipping.fullName}, ${shipping.line1}, ${shipping.city} ${shipping.postcode}`}
          </Text>
        </div>

        <div className="flex flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div className="flex items-center justify-between">
            <Text as="dt" weight="semibold">
              Payment
            </Text>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onEdit("payment");
              }}
            >
              Edit payment
            </Button>
          </div>
          <Text as="dd" tone="muted" size="sm" data-testid="review-payment">
            {payment === null
              ? "Not provided"
              : `${payment.cardholder}, ${maskCard(payment.cardNumber)}, expires ${payment.expiry}`}
          </Text>
        </div>
      </dl>

      <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3">
        <Text weight="semibold">Total</Text>
        <Text weight="semibold" data-testid="review-total" className="font-mono">
          {formatMoney(cartTotalMinor(cart))}
        </Text>
      </div>

      {attempts > 1 && (
        <Text size="sm" tone="muted" data-testid="review-attempts">
          Attempt {attempts}.
        </Text>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>

        {submitting ? (
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" data-testid="cancel-order" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" loading data-testid="placing-order" onClick={onPlaceOrder}>
              Placing order…
            </Button>
          </div>
        ) : phase === "failure" ? (
          // A refusal the server called final gets no primary button at all.
          // "Try again" over a declined card is a control that cannot work, and
          // the machine agrees: `order.retry` is guarded by `retryable`, so
          // rendering the button anyway would produce a click with nowhere to
          // go. The way forward is the Edit buttons above.
          retryable ? (
            <Button type="button" data-testid="retry-order" onClick={onRetry}>
              Try again
            </Button>
          ) : (
            <Text size="sm" tone="muted" data-testid="final-failure">
              Change your details above to try a different card.
            </Text>
          )
        ) : (
          <Button type="button" data-testid="place-order" onClick={onPlaceOrder}>
            Place order
          </Button>
        )}
      </div>
    </section>
  );
}
