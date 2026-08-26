import { Button } from "@/shared/ui/Button";
import { Text } from "@/shared/ui/Text";
import { formatMoney, type Order } from "@/features/checkout/checkoutApi";

interface ConfirmationStepProps {
  readonly order: Order;
  readonly onRestart: () => void;
}

/**
 * The end of the flow — but not the end of the actor.
 *
 * "Start another order" is an ordinary event back to `cart`, which is only
 * possible because `confirmed` is not a final state. See the comment on it in
 * the machine: a final root state stops the actor for good, and a stopped
 * actor cannot be restarted.
 */
export function ConfirmationStep({ order, onRestart }: ConfirmationStepProps) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="confirmation-heading">
      <Text as="h2" id="confirmation-heading" size="xl" weight="semibold">
        Order placed
      </Text>

      {/*
        `role="status"` rather than a heading change alone: the flow moved on
        without a navigation, so a screen reader is otherwise given no event to
        announce.
      */}
      <div
        role="status"
        className="flex flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--color-primary)] p-4"
      >
        <Text data-testid="order-id">
          Order <code>{order.id}</code> is confirmed.
        </Text>
        <Text tone="muted" size="sm" data-testid="order-total">
          Total paid: {formatMoney(order.totalMinor)}
        </Text>
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" data-testid="restart-checkout" onClick={onRestart}>
          Start another order
        </Button>
      </div>
    </section>
  );
}
