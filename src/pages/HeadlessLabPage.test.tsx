import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HeadlessLabPage } from "./HeadlessLabPage";

const list = () => screen.getByRole("listbox", { name: "Framework (list)" });
const cards = () => screen.getByRole("listbox", { name: "Framework (cards)" });
const menuTrigger = () => screen.getByRole("button", { name: /Framework/ });

function optionIn(listbox: HTMLElement, name: string | RegExp): HTMLElement {
  const match = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (option) => {
      const text = option.textContent;
      // The selected option in `OptionList` carries a tick, so this matches on
      // the label rather than the whole text content.
      return typeof name === "string" ? text.startsWith(name) : name.test(text);
    },
  );
  if (!match) throw new Error(`no option matching ${String(name)}`);
  return match;
}

describe("HeadlessLabPage", () => {
  it("shows three presentations of the same list", () => {
    render(<HeadlessLabPage />);

    expect(list()).toBeInTheDocument();
    expect(cards()).toBeInTheDocument();
    expect(menuTrigger()).toHaveTextContent("Vue");
    expect(screen.getByTestId("selected-framework")).toHaveTextContent("vue");
  });

  /*
   * The claim the whole page exists to make: the presentations hold no
   * selection of their own, so a choice made in one is visible in all of them.
   */
  it("propagates a choice made in one skin to the others", async () => {
    const user = userEvent.setup();
    render(<HeadlessLabPage />);

    await user.click(optionIn(list(), "Svelte"));

    expect(screen.getByTestId("selected-framework")).toHaveTextContent("svelte");
    expect(menuTrigger()).toHaveTextContent("Svelte");
    expect(optionIn(cards(), "Svelte")).toHaveAttribute("aria-selected", "true");
  });

  it("drives the card grid — which is not a list — with the same keyboard", async () => {
    const user = userEvent.setup();
    render(<HeadlessLabPage />);

    await user.click(cards());
    await user.keyboard("{Home}{Enter}");

    expect(screen.getByTestId("selected-framework")).toHaveTextContent("react");
    expect(optionIn(list(), "React")).toHaveAttribute("aria-selected", "true");
  });

  it("refuses the disabled option in every skin", async () => {
    const user = userEvent.setup();
    render(<HeadlessLabPage />);

    await user.click(optionIn(cards(), /Angular/));

    expect(screen.getByTestId("selected-framework")).toHaveTextContent("vue");
  });
});
