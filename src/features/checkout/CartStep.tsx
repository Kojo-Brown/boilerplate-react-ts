import { Button } from "@/shared/ui/Button";
import { Text } from "@/shared/ui/Text";
import { cartTotalMinor, formatMoney, type CartItem } from "@/features/checkout/checkoutApi";

interface CartStepProps {
  readonly cart: readonly CartItem[];
  /** The flow-level message, when the machine refused to leave this step. */
  readonly message: string | null;
  readonly onQuantityChange: (id: string, quantity: number) => void;
  readonly onRemove: (id: string) => void;
  readonly onNext: () => void;
}

/**
 * The basket.
 *
 * Note what this component does *not* do: it never asks whether the cart is
 * empty before letting the user continue. The button is always live and always
 * sends `next`; the machine decides. That is the split worth copying — a
 * presentational step that can express any intent, and one place that knows
 * which intents are currently legal.
 *
 * A disabled Continue button would look tidier and would be worse: it gives a
 * user with an empty basket a dead control and no sentence explaining it.
 */
export function CartStep({ cart, message, onQuantityChange, onRemove, onNext }: CartStepProps) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="cart-heading">
      <Text as="h2" id="cart-heading" size="xl" weight="semibold">
        Your basket
      </Text>

      {cart.length === 0 ? (
        <Text tone="muted" data-testid="cart-empty">
          Nothing here yet.
        </Text>
      ) : (
        <ul className="flex flex-col gap-3">
          {cart.map((item) => (
            <li
              key={item.id}
              data-testid={`cart-line-${item.id}`}
              className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
            >
              <span className="flex-1 font-medium">{item.name}</span>
              <span className="text-sm text-[var(--color-muted-fg)]">
                {formatMoney(item.unitPriceMinor)}
              </span>
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">Quantity of {item.name}</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={item.quantity}
                  aria-label={`Quantity of ${item.name}`}
                  onChange={(event) => {
                    onQuantityChange(item.id, Number(event.target.value));
                  }}
                  className="h-9 w-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[var(--color-fg)]"
                />
              </label>
              <span className="w-20 text-right font-mono text-sm">
                {formatMoney(item.unitPriceMinor * item.quantity)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${item.name}`}
                onClick={() => {
                  onRemove(item.id);
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3">
        <Text weight="semibold">Total</Text>
        <Text weight="semibold" data-testid="cart-total" className="font-mono">
          {formatMoney(cartTotalMinor(cart))}
        </Text>
      </div>

      {message !== null && (
        <Text tone="danger" role="alert" data-testid="cart-message">
          {message}
        </Text>
      )}

      <div className="flex justify-end">
        <Button onClick={onNext}>Continue to delivery</Button>
      </div>
    </section>
  );
}
