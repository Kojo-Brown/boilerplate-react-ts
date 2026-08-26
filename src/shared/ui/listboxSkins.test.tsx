import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { ListboxOption } from "@/shared/hooks/useListbox";
import { OptionList } from "@/shared/ui/OptionList";
import { SelectMenu } from "@/shared/ui/SelectMenu";

/*
 * The evidence that the behaviour really is split from the presentation.
 *
 * `OptionList` and `SelectMenu` share no markup and no local state — one is a
 * list that is always on the page, the other a popup with an open flag, a
 * dismiss-on-outside-click listener and focus restoration. What they share is
 * `useListbox`, and this suite runs the same expectations against both. A
 * behaviour that lived in either component could not be asserted this way, and
 * a behaviour that drifted into one of them would fail here.
 */

type Fruit = "apple" | "apricot" | "banana" | "new-york";

const FRUITS: readonly ListboxOption<Fruit>[] = [
  { value: "apple", label: "Apple" },
  { value: "apricot", label: "Apricot" },
  { value: "banana", label: "Banana", disabled: true },
  { value: "new-york", label: "New York" },
];

interface SkinProps {
  options: readonly ListboxOption<Fruit>[];
  label: string;
  defaultValue?: Fruit | undefined;
  onValueChange?: ((value: Fruit) => void) | undefined;
}

interface Skin {
  name: string;
  render: (props: SkinProps) => void;
  /** Gets the listbox on screen and focused, however this skin does that. */
  reveal: (user: UserEvent) => Promise<void>;
}

const SKINS: readonly Skin[] = [
  {
    name: "OptionList",
    render: (props) => {
      render(<OptionList {...props} />);
    },
    // Always visible; the list is the page's only tab stop.
    reveal: async (user) => {
      await user.tab();
    },
  },
  {
    name: "SelectMenu",
    render: (props) => {
      render(<SelectMenu {...props} />);
    },
    reveal: async (user) => {
      await user.click(screen.getByRole("button", { name: /Fruit/ }));
    },
  },
];

describe.each(SKINS)("$name — shared listbox behaviour", (skin) => {
  const setup = (props: Partial<SkinProps> = {}) => {
    const user = userEvent.setup();
    skin.render({ options: FRUITS, label: "Fruit", ...props });
    return user;
  };

  it("renders one option per item", async () => {
    const user = setup();
    await skin.reveal(user);

    expect(screen.getAllByRole("option")).toHaveLength(FRUITS.length);
    expect(screen.getByRole("listbox", { name: "Fruit" })).toBeInTheDocument();
  });

  it("selects the option that was clicked", async () => {
    const onValueChange = vi.fn();
    const user = setup({ onValueChange });
    await skin.reveal(user);

    await user.click(screen.getByRole("option", { name: /Apricot/ }));

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("apricot");
  });

  it("ignores a click on a disabled option", async () => {
    const onValueChange = vi.fn();
    const user = setup({ onValueChange });
    await skin.reveal(user);

    await user.click(screen.getByRole("option", { name: /Banana/ }));

    expect(onValueChange).not.toHaveBeenCalled();
  });

  /*
   * Arriving on the list is itself an activation — APG puts the highlight on
   * the first option as soon as the listbox takes focus, so the first
   * ArrowDown is a move to the *second* option rather than the first.
   */
  it("activates the first option as soon as the list takes focus", async () => {
    const user = setup();
    await skin.reveal(user);

    expect(screen.getByRole("listbox", { name: "Fruit" })).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /Apple/ }).id,
    );
  });

  it("moves virtual focus with the arrow keys and commits on Enter", async () => {
    const onValueChange = vi.fn();
    const user = setup({ onValueChange });
    await skin.reveal(user);

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("apricot");
  });

  it("skips disabled options while arrowing", async () => {
    const onValueChange = vi.fn();
    const user = setup({ onValueChange });
    await skin.reveal(user);

    // Apple → Apricot → (Banana is disabled) → New York.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("new-york");
  });

  it("jumps to an option by typing its label", async () => {
    const onValueChange = vi.fn();
    const user = setup({ onValueChange });
    await skin.reveal(user);

    await user.keyboard("new {Enter}");

    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("new-york");
  });

  it("names the active option through aria-activedescendant, not focus", async () => {
    const user = setup();
    await skin.reveal(user);

    await user.keyboard("{ArrowDown}");

    const listbox = screen.getByRole("listbox", { name: "Fruit" });
    const active = screen.getByRole("option", { name: /Apricot/ });
    expect(listbox).toHaveAttribute("aria-activedescendant", active.id);
    // Real focus stays on the list itself the whole time.
    expect(document.activeElement).toBe(listbox);
  });

  it("starts from the option defaultValue names", async () => {
    const onValueChange = vi.fn();
    const user = setup({ defaultValue: "new-york", onValueChange });
    await skin.reveal(user);

    expect(screen.getByRole("option", { name: /New York/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowUp}{Enter}");
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("apricot");
  });
});
