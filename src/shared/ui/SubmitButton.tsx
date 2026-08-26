import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/shared/ui/Button";

export interface SubmitButtonProps {
  children: ReactNode;
  /** Label shown while the form's action is running. */
  pendingLabel?: string;
  className?: string | undefined;
}

/**
 * A submit button that knows whether its form is busy without being told.
 *
 * `useFormStatus` reads the submission state of the nearest `<form>` **above**
 * this component, which is the whole reason this is a separate component
 * rather than three lines inside the form. A `useFormStatus()` call in the
 * component that *renders* the `<form>` reports `pending: false` forever — the
 * form is not its ancestor, it is its child — and the failure is silent: no
 * warning, no error, just a button that never shows a busy state. Only a
 * descendant sees the truth, so the button has to be one.
 *
 * That constraint buys something in return: no prop threading. Any form can
 * drop this in and get a correct pending state, with no `isSubmitting` to pass
 * down and no chance of the button and the form disagreeing about whether a
 * request is in flight.
 *
 * Usage:
 *   <form action={formAction}>
 *     …
 *     <SubmitButton pendingLabel="Sending…">Send invite</SubmitButton>
 *   </form>
 */
export function SubmitButton({
  children,
  pendingLabel = "Submitting…",
  className,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      loading={pending}
      className={className}
      data-testid="submit-button"
      data-pending={pending ? "true" : "false"}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
