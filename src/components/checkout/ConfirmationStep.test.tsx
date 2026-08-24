import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationStep } from "./ConfirmationStep";

const order = { id: "ord-1", totalMinor: 11300, placedAt: "1970-01-01T00:00:00.000Z" };

describe("ConfirmationStep", () => {
  it("names the order and what it cost", () => {
    render(<ConfirmationStep order={order} onRestart={vi.fn()} />);

    expect(screen.getByTestId("order-id")).toHaveTextContent("ord-1");
    expect(screen.getByTestId("order-total")).toHaveTextContent("113.00");
  });

  it("announces itself, since nothing navigated", () => {
    render(<ConfirmationStep order={order} onRestart={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("confirmed");
  });

  it("offers a restart", async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn();
    render(<ConfirmationStep order={order} onRestart={onRestart} />);

    await user.click(screen.getByTestId("restart-checkout"));

    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
