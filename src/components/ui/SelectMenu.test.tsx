import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ListboxOption } from "@/hooks/useListbox";
import { SelectMenu } from "./SelectMenu";

/*
 * Behaviour shared with the other skin is asserted once, in
 * `listboxSkins.test.tsx`. What is left here is everything that makes this a
 * popup — none of which the hook knows about.
 */

type Framework = "react" | "vue" | "svelte";

const FRAMEWORKS: readonly ListboxOption<Framework>[] = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
  { value: "svelte", label: "Svelte" },
];

const trigger = () => screen.getByRole("button", { name: /Framework/ });

interface MenuProps {
  placeholder?: string | undefined;
  defaultValue?: Framework | undefined;
}

function renderMenu(props: MenuProps = {}) {
  const user = userEvent.setup();
  render(<SelectMenu options={FRAMEWORKS} label="Framework" {...props} />);
  return user;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("SelectMenu — the popup", () => {
  it("starts closed, showing the placeholder", () => {
    renderMenu({ placeholder: "Pick one" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger()).toHaveTextContent("Pick one");
  });

  /*
   * `aria-controls` may only name an element that exists. While the popup is
   * unmounted the attribute would be a dangling IDREF — a relationship
   * assistive technology is told about and then cannot follow.
   */
  it("only claims to control the list while the list exists", async () => {
    const user = renderMenu();
    expect(trigger()).not.toHaveAttribute("aria-controls");

    await user.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
  });

  it("opens on ArrowDown from the trigger", async () => {
    const user = renderMenu();
    trigger().focus();

    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("moves focus into the list when it opens", async () => {
    const user = renderMenu();

    await user.click(trigger());

    expect(document.activeElement).toBe(screen.getByRole("listbox"));
  });

  /*
   * Closing without restoring focus leaves it on `<body>`, which drops the
   * user back to the top of the tab order from wherever they had got to.
   */
  it("returns focus to the trigger when Escape closes it", async () => {
    const user = renderMenu();
    await user.click(trigger());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes and shows the choice once an option is picked", async () => {
    const user = renderMenu();
    await user.click(trigger());

    await user.click(screen.getByRole("option", { name: "Vue" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("Vue");
    expect(document.activeElement).toBe(trigger());
  });

  it("dismisses on a click outside itself", async () => {
    const user = renderMenu();
    await user.click(trigger());

    await user.click(document.body);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("toggles shut when the trigger is clicked again", async () => {
    const user = renderMenu();
    await user.click(trigger());

    await user.click(trigger());

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  /*
   * The popup needs a ref on the list to focus it; the hook needs one on the
   * same element to scroll the active option into view. Whichever set `ref`
   * last would win if the getter did not merge them — and the loser fails
   * silently, so this asserts both survived: focus landed (the skin's ref) and
   * the active option was scrolled to (the hook's).
   */
  it("keeps both the skin's ref and the hook's when they share an element", async () => {
    // jsdom implements no layout and so defines no `scrollIntoView` at all,
    // which is the reason the hook feature-detects it before calling.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const user = renderMenu();

    await user.click(trigger());
    expect(document.activeElement).toBe(screen.getByRole("listbox"));

    await user.keyboard("{ArrowDown}");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(screen.getByRole("option", { name: "Vue" }));
  });
});
