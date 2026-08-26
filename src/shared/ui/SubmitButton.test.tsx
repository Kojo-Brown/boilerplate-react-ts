import { act, useActionState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubmitButton } from "@/shared/ui/SubmitButton";

interface Deferred {
  readonly promise: Promise<void>;
  readonly settle: () => Promise<void>;
}

/** A request that only finishes when the test says so. */
function createDeferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    settle: async () => {
      await act(async () => {
        release();
        await promise;
      });
    },
  };
}

interface HarnessProps {
  request: Promise<void>;
  /** Renders a second button *outside* the form, to prove the constraint. */
  withOutsideButton?: boolean;
  pendingLabel?: string;
}

function Harness({ request, withOutsideButton = false, pendingLabel }: HarnessProps) {
  const [count, formAction] = useActionState<number, FormData>(async (previous) => {
    await request;
    return previous + 1;
  }, 0);

  return (
    <div>
      <form action={formAction}>
        {pendingLabel === undefined ? (
          <SubmitButton>Send</SubmitButton>
        ) : (
          <SubmitButton pendingLabel={pendingLabel}>Send</SubmitButton>
        )}
      </form>
      {withOutsideButton && (
        <div data-testid="outside-form">
          <SubmitButton>Send from outside</SubmitButton>
        </div>
      )}
      <span data-testid="submissions">{count}</span>
    </div>
  );
}

describe("SubmitButton", () => {
  it("renders its label and is enabled at rest", () => {
    render(<Harness request={Promise.resolve()} />);

    expect(screen.getByTestId("submit-button")).toHaveTextContent("Send");
    expect(screen.getByTestId("submit-button")).toBeEnabled();
  });

  it("shows the pending label and disables itself while the form's action runs", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred();
    render(<Harness request={deferred.promise} pendingLabel="Sending…" />);

    await user.click(screen.getByTestId("submit-button"));

    expect(screen.getByTestId("submit-button")).toHaveTextContent("Sending…");
    expect(screen.getByTestId("submit-button")).toBeDisabled();

    await deferred.settle();

    await waitFor(() => {
      expect(screen.getByTestId("submit-button")).toHaveTextContent("Send");
    });
    expect(screen.getByTestId("submit-button")).toBeEnabled();
  });

  it("falls back to a default pending label", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred();
    render(<Harness request={deferred.promise} />);

    await user.click(screen.getByTestId("submit-button"));

    expect(screen.getByTestId("submit-button")).toHaveTextContent("Submitting…");

    await deferred.settle();
  });

  it("being disabled while pending is what stops a double submit", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred();
    render(<Harness request={deferred.promise} />);

    const button = screen.getByTestId("submit-button");
    await user.click(button);
    await user.click(button);

    await deferred.settle();

    await waitFor(() => {
      expect(screen.getByTestId("submissions")).toHaveTextContent("1");
    });
  });

  it("reports nothing when it is not inside a form", async () => {
    // The failure this pins is silent: `useFormStatus` reads the nearest form
    // *above* the component, so a button outside one — or, just as easily, in
    // the component that renders the form rather than under it — stays
    // permanently idle with no warning to say why.
    const user = userEvent.setup();
    const deferred = createDeferred();
    render(<Harness request={deferred.promise} withOutsideButton />);

    const [inside, outside] = screen.getAllByTestId("submit-button");
    await user.click(inside!);

    expect(inside).toHaveAttribute("data-pending", "true");
    expect(outside).toHaveAttribute("data-pending", "false");
    expect(outside).toBeEnabled();

    await deferred.settle();
  });
});
