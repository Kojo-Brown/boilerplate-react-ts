import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyboardLabPage } from "@/pages/keyboard-lab/KeyboardLabPage";

beforeEach(() => {
  // jsdom ships no `<dialog>` behaviour. `Modal.test.tsx` states the same
  // thing at more length; here it is only so the panel renders.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

const tab = (name: string) => screen.getByRole("tab", { name });

describe("KeyboardLabPage", () => {
  it("opens on the modal panel with the tablist under manual activation", async () => {
    const user = userEvent.setup();
    render(<KeyboardLabPage />);

    expect(tab("Modal")).toHaveAttribute("aria-selected", "true");
    tab("Modal").focus();

    await user.keyboard("{ArrowRight}");

    /*
     * Manual activation, which the page chooses deliberately: each panel
     * mounts a live control, and arrowing across three tabs under automatic
     * activation would mount all three on the way past.
     */
    expect(tab("Menu")).toHaveFocus();
    expect(tab("Menu")).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{Enter}");

    expect(tab("Menu")).toHaveAttribute("aria-selected", "true");
  });

  it("reaches the menu and runs a command from the keyboard alone", async () => {
    const user = userEvent.setup();
    render(<KeyboardLabPage />);
    tab("Modal").focus();
    await user.keyboard("{ArrowRight}{Enter}");

    const trigger = screen.getByRole("button", { name: /row actions/i });
    trigger.focus();
    await user.keyboard("{ArrowUp}{Enter}");

    expect(screen.getByTestId("last-command")).toHaveTextContent("delete");
    expect(trigger).toHaveFocus();
  });

  it("filters the combobox by substring and the listbox by prefix, from the same letters", async () => {
    const user = userEvent.setup();
    render(<KeyboardLabPage />);
    tab("Modal").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");

    const combobox = screen.getByRole("combobox", { name: /destination \(combobox\)/i });
    await user.click(combobox);
    await user.keyboard("york");

    /*
     * The comparison the panel is built around: the filter finds "York"
     * wherever it appears, because it searches a list the user cannot see.
     */
    expect(
      screen.getAllByRole("option").map((option) => option.textContent.replace("✓", "")),
    ).toEqual(["New York", "York"]);

    await user.keyboard("{Escape}{Escape}");

    const listTrigger = screen.getByRole("button", { name: /destination \(listbox\)/i });
    await user.click(listTrigger);
    await user.keyboard("y");

    // The typeahead anchors to the start, so "y" reaches York and not New York.
    const activeId = screen.getByRole("listbox").getAttribute("aria-activedescendant");
    expect(activeId).not.toBeNull();
    expect(document.getElementById(activeId ?? "")).toHaveTextContent("York");
  });

  it("opens the dialog with focus on its title rather than on Close", async () => {
    const user = userEvent.setup();
    render(<KeyboardLabPage />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    expect(screen.getByRole("heading", { name: "Rename this project" })).toHaveFocus();
  });
});
