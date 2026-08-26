import { cn } from "@/shared/lib/cn";
import { CHECKOUT_STEPS, type CheckoutStep } from "@/features/checkout/checkoutMachine";

const STEP_LABELS: Readonly<Record<CheckoutStep, string>> = {
  cart: "Basket",
  shipping: "Delivery",
  payment: "Payment",
  review: "Review",
};

interface CheckoutStepperProps {
  readonly current: CheckoutStep;
  /** `true` once the order is placed, so the last step reads as done. */
  readonly complete?: boolean | undefined;
}

/**
 * The progress indicator, derived entirely from the machine's state value.
 *
 * There is no "current step" number anywhere in the app. A second source of
 * truth for where the user is, kept in sync by hand, is precisely what the
 * machine exists to remove — and it is the thing that goes wrong first when a
 * flow gains a branch, because the branch updates the state and forgets the
 * counter.
 *
 * `aria-current="step"` rather than a colour change alone: the visual position
 * is the whole content of this component, so it has to be in the accessibility
 * tree too.
 */
export function CheckoutStepper({ current, complete = false }: CheckoutStepperProps) {
  const currentIndex = CHECKOUT_STEPS.indexOf(current);

  return (
    <ol className="flex flex-wrap items-center gap-2" data-testid="checkout-stepper">
      {CHECKOUT_STEPS.map((step, index) => {
        const done = complete || index < currentIndex;
        const active = !complete && step === current;

        return (
          <li key={step} className="flex items-center gap-2">
            <span
              data-testid={`step-${step}`}
              data-state={done ? "done" : active ? "active" : "upcoming"}
              aria-current={active ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-2 rounded-[var(--radius-full)] border px-3 py-1 text-sm",
                active && "border-[var(--color-primary)] font-semibold text-[var(--color-primary)]",
                done && "border-[var(--color-border)] text-[var(--color-muted-fg)]",
                !active && !done && "border-[var(--color-border)] text-[var(--color-muted-fg)]",
              )}
            >
              <span aria-hidden="true" className="font-mono text-xs">
                {done ? "✓" : index + 1}
              </span>
              {STEP_LABELS[step]}
            </span>
            {index < CHECKOUT_STEPS.length - 1 && (
              <span aria-hidden="true" className="text-[var(--color-muted-fg)]">
                →
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
