import { useState } from "react";
import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createActor, type Actor } from "xstate";
import { createInMemoryCheckoutApi, type CartItem } from "@/lib/checkoutApi";
import { checkoutMachine } from "@/machines/checkoutMachine";
import { CheckoutTotal } from "./CheckoutTotal";

const cart: readonly CartItem[] = [
  { id: "kbd", name: "Keyboard", unitPriceMinor: 8900, quantity: 1 },
  { id: "cbl", name: "Cable", unitPriceMinor: 1200, quantity: 2 },
];

function startActor(): Actor<typeof checkoutMachine> {
  const actor = createActor(checkoutMachine, {
    input: { cart, api: createInMemoryCheckoutApi(), now: () => new Date("2026-06-15") },
  });
  actor.start();
  return actor;
}

const commits = (): number => Number(screen.getByTestId("live-total").dataset["commits"]);

describe("CheckoutTotal", () => {
  it("shows the total of the actor's cart", () => {
    render(<CheckoutTotal actor={startActor()} />);

    expect(screen.getByTestId("live-total")).toHaveTextContent("113.00");
  });

  it("ignores snapshots that do not move its slice", () => {
    // This is the claim `useSelector` is here to make. Every keystroke in the
    // address form produces a new snapshot; a component subscribed with
    // `useMachine` would re-render for all of them.
    const actor = startActor();
    render(<CheckoutTotal actor={actor} />);
    const before = commits();

    act(() => {
      actor.send({ type: "next" });
      actor.send({ type: "shipping.change", field: "city", value: "A" });
      actor.send({ type: "shipping.change", field: "city", value: "Ar" });
      actor.send({ type: "shipping.change", field: "city", value: "Arl" });
    });

    expect(commits()).toBe(before);
  });

  it("does not re-render because its parent did", async () => {
    // The half `useSelector` does not cover: a re-rendering parent re-renders
    // its children regardless of what they subscribe to, and `CheckoutFlow`
    // re-renders on every snapshot. Without `memo` the selector here would be
    // decoration.
    const user = userEvent.setup();
    const actor = startActor();

    function Parent() {
      const [tick, setTick] = useState(0);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              setTick((n) => n + 1);
            }}
          >
            re-render {tick}
          </button>
          <CheckoutTotal actor={actor} />
        </div>
      );
    }

    render(<Parent />);
    const before = commits();

    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("button"));

    expect(screen.getByRole("button")).toHaveTextContent("re-render 2");
    expect(commits()).toBe(before);
  });

  it("re-renders when the slice does move", () => {
    const actor = startActor();
    render(<CheckoutTotal actor={actor} />);
    const before = commits();

    act(() => {
      actor.send({ type: "cart.setQuantity", id: "cbl", quantity: 5 });
    });

    expect(screen.getByTestId("live-total")).toHaveTextContent("149.00");
    expect(commits()).toBeGreaterThan(before);
  });
});
