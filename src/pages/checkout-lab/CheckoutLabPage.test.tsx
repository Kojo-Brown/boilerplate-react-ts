import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DECLINED_MESSAGE } from "@/pages/checkout-lab/checkoutLabParams";
import { CheckoutLabPage } from "@/pages/checkout-lab/CheckoutLabPage";

function renderLab(search = "?latency=0") {
  const router = createMemoryRouter([{ path: "/labs/checkout", element: <CheckoutLabPage /> }], {
    initialEntries: [`/labs/checkout${search}`],
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

const state = (): string | undefined => screen.getByTestId("checkout-flow").dataset["state"];

async function reachReview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: /continue to delivery/i }));
  await user.type(screen.getByLabelText(/Full name/), "Grace Hopper");
  await user.type(screen.getByLabelText(/Address/), "12 Navy Yard");
  await user.type(screen.getByLabelText(/Town or city/), "Arlington");
  await user.type(screen.getByLabelText(/Postcode/), "SW1A 1AA");
  await user.click(screen.getByRole("button", { name: /continue to payment/i }));
  await user.type(screen.getByLabelText(/Name on card/), "G Hopper");
  await user.type(screen.getByLabelText(/Card number/), "4242424242424242");
  // Far enough out that the real clock this page uses will not reach it.
  await user.type(screen.getByLabelText(/Expiry/), "12/99");
  await user.type(screen.getByLabelText(/Security code/), "123");
  await user.click(screen.getByRole("button", { name: /review order/i }));
}

describe("CheckoutLabPage", () => {
  it("starts on the basket with the demo cart priced", () => {
    renderLab();

    expect(state()).toBe("cart");
    expect(screen.getByTestId("cart-total")).toHaveTextContent("137.00");
  });

  it("puts the server mode in the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderLab();

    await user.click(screen.getByTestId("server-declined"));

    expect(router.state.location.search).toContain("server=declined");
    expect(screen.getByTestId("server-declined")).toHaveAttribute("aria-pressed", "true");
  });

  it("rebuilds the actor when the knobs change", async () => {
    // `useMachine` reads its input once. The `key` on the flow is what turns a
    // new API object into a new actor; without it, this test would find the
    // flow still in `shipping` and still talking to the healthy server.
    const user = userEvent.setup();
    renderLab();

    await user.click(screen.getByRole("button", { name: /continue to delivery/i }));
    expect(state()).toBe("shipping");

    await user.click(screen.getByTestId("server-outage"));

    expect(state()).toBe("cart");
  });

  it("runs the declined server chosen from the URL", async () => {
    const user = userEvent.setup();
    renderLab("?latency=0&server=declined");

    await reachReview(user);
    await user.click(screen.getByTestId("place-order"));

    await waitFor(() => {
      expect(state()).toBe("payment");
    });
    expect(screen.getByTestId("step-message")).toHaveTextContent(DECLINED_MESSAGE);
  });

  it("puts the chosen latency in the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderLab();

    await user.selectOptions(screen.getByTestId("latency-select"), "4000");

    expect(router.state.location.search).toContain("latency=4000");
  });
});
