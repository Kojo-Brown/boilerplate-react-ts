import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Menu, type MenuItemDescriptor } from "@/shared/ui/Menu";

const ITEMS: readonly MenuItemDescriptor[] = [
  { id: "rename", label: "Rename" },
  { id: "duplicate", label: "Duplicate" },
  { id: "restore", label: "Restore from backup", disabled: true },
  { id: "download", label: "Download" },
  { id: "delete", label: "Delete" },
];

function renderMenu(onSelect = vi.fn()) {
  render(<Menu items={ITEMS} label="Row actions" onSelect={onSelect} />);
  return {
    onSelect,
    trigger: screen.getByRole("button", { name: /row actions/i }),
  };
}

const menuItems = (): HTMLElement[] => screen.getAllByRole("menuitem");

describe("<Menu>", () => {
  describe("opening", () => {
    it("is closed to begin with, and says so on the trigger", () => {
      const { trigger } = renderMenu();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("opens onto the first item with ArrowDown", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      trigger.focus();

      await user.keyboard("{ArrowDown}");

      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(menuItems()[0]).toHaveFocus();
    });

    it("opens onto the last item with ArrowUp", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      trigger.focus();

      await user.keyboard("{ArrowUp}");

      expect(menuItems().at(-1)).toHaveFocus();
    });

    it("opens onto the first item with Enter and with Space", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      trigger.focus();

      await user.keyboard("{Enter}");
      expect(menuItems()[0]).toHaveFocus();

      await user.keyboard("{Escape}");
      await user.keyboard(" ");
      expect(menuItems()[0]).toHaveFocus();
    });

    it("opens with focus on the menu itself when the pointer opens it", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();

      await user.click(trigger);

      // Nothing highlighted: the mouse is already where it wants to be, and a
      // highlighted item invites an Enter the user did not aim.
      expect(screen.getByRole("menu")).toHaveFocus();
    });

    it("points aria-controls at the menu only while it exists", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      expect(trigger).not.toHaveAttribute("aria-controls");

      await user.click(trigger);

      const menu = screen.getByRole("menu");
      expect(trigger).toHaveAttribute("aria-controls", menu.id);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });
  });

  describe("moving between items", () => {
    it("lands on disabled items rather than stepping over them", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowDown}{ArrowDown}");

      expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();

      await user.keyboard("{ArrowDown}");

      /*
       * The divergence from `useListbox`, which skips its disabled options.
       * Arriving on an unavailable *command* is the only way to learn it
       * exists — see the `aria-disabled` note in `Menu.tsx`.
       */
      expect(screen.getByRole("menuitem", { name: "Restore from backup" })).toHaveFocus();

      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Download" })).toHaveFocus();
    });

    it("wraps at both ends, unlike the listbox", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowUp}");

      expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();

      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();

      await user.keyboard("{ArrowUp}");
      expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    });

    it("jumps to the ends with Home and End", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowDown}");

      await user.keyboard("{End}");
      expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();

      await user.keyboard("{Home}");
      expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    });
  });

  describe("disabled items", () => {
    /*
     * The divergence from `useListbox`, pinned in both directions: a disabled
     * command stays in the menu's item count and stays reachable, because the
     * only way to learn that it exists-but-is-unavailable is to arrive on it.
     */
    it("marks them aria-disabled rather than disabled, so they keep their place", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      await user.click(trigger);

      const restore = screen.getByRole("menuitem", { name: "Restore from backup" });
      expect(restore).toHaveAttribute("aria-disabled", "true");
      expect(restore).not.toBeDisabled();
      expect(menuItems()).toHaveLength(ITEMS.length);
    });

    it("finds them with typeahead", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowDown}");

      await user.keyboard("res");

      expect(screen.getByRole("menuitem", { name: "Restore from backup" })).toHaveFocus();
    });

    it("does not invoke them", async () => {
      const user = userEvent.setup();
      const { trigger, onSelect } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowDown}");
      await user.keyboard("res");

      await user.keyboard("{Enter}");

      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });
  });

  describe("typeahead", () => {
    it("moves to the first item starting with the buffer", async () => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowDown}");

      await user.keyboard("du");

      expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    });

    it("cycles on a repeated character rather than looking for a doubled label", async () => {
      const user = userEvent.setup();
      const user2 = ITEMS; // keeps the fixture visible next to the expectation
      expect(user2.filter((item) => item.label.startsWith("D"))).toHaveLength(3);

      const { trigger } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowDown}");

      await user.keyboard("d");
      expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
      await user.keyboard("d");
      expect(screen.getByRole("menuitem", { name: "Download" })).toHaveFocus();
      await user.keyboard("d");
      expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    });
  });

  describe("invoking and dismissing", () => {
    it("invokes the focused item on Enter, closes, and returns focus to the trigger", async () => {
      const user = userEvent.setup();
      const { trigger, onSelect } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowDown}{ArrowDown}");

      await user.keyboard("{Enter}");

      expect(onSelect).toHaveBeenCalledExactlyOnceWith("duplicate");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it("invokes the focused item on Space", async () => {
      const user = userEvent.setup();
      const { trigger, onSelect } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowDown}");

      await user.keyboard(" ");

      expect(onSelect).toHaveBeenCalledExactlyOnceWith("rename");
    });

    it("closes on Escape without invoking anything, and restores focus", async () => {
      const user = userEvent.setup();
      const { trigger, onSelect } = renderMenu();
      trigger.focus();
      await user.keyboard("{ArrowDown}");

      await user.keyboard("{Escape}");

      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it("closes on Tab, leaving focus on the trigger for the browser to move on from", async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(
        <>
          <Menu items={ITEMS} label="Row actions" onSelect={onSelect} />
          <button type="button">After</button>
        </>,
      );
      const trigger = screen.getByRole("button", { name: /row actions/i });
      trigger.focus();
      await user.keyboard("{ArrowDown}");

      /*
       * `fireEvent`, not `user.tab()`, and the reason is worth the two lines
       * because it looks like a shortcut and is the opposite.
       *
       * The regression this test exists for is that closing the menu without
       * first restoring focus leaves the browser resolving Tab's default
       * action against an item that is being unmounted, so focus falls to
       * `<body>` and the next Tab restarts at the top of the document.
       * `user.tab()` cannot see the difference: it computes its destination
       * from the *event target* rather than from whatever holds focus when the
       * default action runs, so it lands on `<body>` whether or not the
       * component did its job. A real browser reads the focused element, which
       * is why the end-to-end half of this claim is in
       * `e2e/keyboard-patterns.spec.ts` and only the component's own
       * contribution — close, and put focus somewhere the browser can carry on
       * from — is asserted here.
       */
      fireEvent.keyDown(screen.getByRole("menuitem", { name: "Rename" }), { key: "Tab" });

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
      expect(trigger).toHaveFocus();
    });

    it("closes when a pointer goes down outside it", async () => {
      const user = userEvent.setup();
      render(
        <>
          <Menu items={ITEMS} label="Row actions" onSelect={vi.fn()} />
          <button type="button">Elsewhere</button>
        </>,
      );
      await user.click(screen.getByRole("button", { name: /row actions/i }));
      expect(screen.getByRole("menu")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Elsewhere" }));

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("invokes on click", async () => {
      const user = userEvent.setup();
      const { trigger, onSelect } = renderMenu();
      await user.click(trigger);

      await user.click(screen.getByRole("menuitem", { name: "Delete" }));

      expect(onSelect).toHaveBeenCalledExactlyOnceWith("delete");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  describe("the tab order", () => {
    it("contributes exactly one stop, whether open or closed", async () => {
      const user = userEvent.setup();
      renderMenu();
      const trigger = screen.getByRole("button", { name: /row actions/i });
      trigger.focus();
      await user.keyboard("{ArrowDown}");

      // The menu container and every item are -1: the trigger is the control.
      expect(screen.getByRole("menu")).toHaveAttribute("tabindex", "-1");
      for (const item of menuItems()) {
        expect(item).toHaveAttribute("tabindex", "-1");
      }
    });
  });
});
