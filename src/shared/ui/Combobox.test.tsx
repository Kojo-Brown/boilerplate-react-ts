import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "@/shared/ui/Combobox";
import { announcer } from "@/shared/a11y/announcer";
import { observeAnnouncements } from "@/test/announcer";
import type { ListboxOption } from "@/shared/hooks/useListbox";

type City = "new-york" | "new-hampshire" | "newcastle" | "york" | "boston" | "berlin";

const CITIES: readonly ListboxOption<City>[] = [
  { value: "new-york", label: "New York" },
  { value: "new-hampshire", label: "New Hampshire" },
  { value: "newcastle", label: "Newcastle" },
  { value: "york", label: "York" },
  { value: "boston", label: "Boston (closed for repairs)", disabled: true },
  { value: "berlin", label: "Berlin" },
];

function Harness({
  onValueChange,
  initial = null,
}: {
  onValueChange?: (value: City | null) => void;
  initial?: City | null;
}) {
  const [value, setValue] = useState<City | null>(initial);
  return (
    <>
      <Combobox
        options={CITIES}
        label="City"
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValueChange?.(next);
        }}
      />
      <button
        type="button"
        onClick={() => {
          setValue(null);
        }}
      >
        Clear from outside
      </button>
    </>
  );
}

const input = (): HTMLInputElement => screen.getByRole("combobox", { name: "City" });
const optionLabels = (): (string | null)[] =>
  screen.getAllByRole("option").map((option) => option.textContent);

describe("<Combobox>", () => {
  describe("the popup", () => {
    it("starts closed, and says so", () => {
      render(<Harness />);
      expect(input()).toHaveAttribute("aria-expanded", "false");
      expect(input()).toHaveAttribute("aria-autocomplete", "list");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("opens onto the first option with ArrowDown", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());

      await user.keyboard("{ArrowDown}");

      expect(input()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("option", { name: "New York" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("opens without a highlight on Alt+ArrowDown", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());

      await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

      expect(screen.getByRole("listbox")).toBeInTheDocument();
      expect(input()).not.toHaveAttribute("aria-activedescendant");
    });

    it("closes on Alt+ArrowUp, keeping the text", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());
      await user.keyboard("new");
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      await user.keyboard("{Alt>}{ArrowUp}{/Alt}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(input()).toHaveValue("new");
    });

    it("points aria-controls at the popup only while it exists", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      expect(input()).not.toHaveAttribute("aria-controls");

      await user.click(input());
      await user.keyboard("{ArrowDown}");

      expect(input()).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    });
  });

  describe("filtering", () => {
    it("matches anywhere in the label, not just the start", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());

      await user.keyboard("york");

      // The point of substring matching: "York" is a prefix of one option and
      // a suffix of another, and a filter should find both.
      expect(optionLabels()).toEqual(["New York", "York"]);
    });

    it("ignores case and surrounding space", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());

      await user.keyboard("  BERL ");

      expect(optionLabels()).toEqual(["Berlin"]);
    });

    it("collapses the popup and explains itself when nothing matches", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());

      await user.keyboard("zzz");

      // An expanded combobox controlling an empty list is a promise of
      // something to arrow through that is not there.
      expect(input()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      const empty = screen.getByText(/no matches for/i);
      expect(input()).toHaveAttribute("aria-describedby", empty.id);
    });

    it("clears the highlight as the filter changes", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());
      await user.keyboard("{ArrowDown}");
      expect(input()).toHaveAttribute("aria-activedescendant");

      await user.keyboard("new");

      /*
       * A highlight that survives a keystroke means Enter commits whatever is
       * at the top of a list that is changing under the user between
       * keystrokes — a fast typist's Enter selecting something they never saw.
       */
      expect(input()).not.toHaveAttribute("aria-activedescendant");
    });
  });

  describe("moving the highlight", () => {
    it("skips disabled options", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());
      await user.keyboard("o{ArrowDown}");
      expect(optionLabels()).toContain("Boston (closed for repairs)");

      const labels = optionLabels();
      const bostonIndex = labels.indexOf("Boston (closed for repairs)");
      for (let i = 0; i < bostonIndex; i += 1) await user.keyboard("{ArrowDown}");

      expect(screen.getByRole("option", { name: /boston/i })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });

    it("stops at the ends rather than wrapping, unlike the menu", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());
      await user.keyboard("york{ArrowDown}");

      await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");

      expect(screen.getByRole("option", { name: "New York" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("leaves Home and End to the text cursor", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());
      await user.keyboard("new{ArrowDown}");
      const highlighted = input().getAttribute("aria-activedescendant");

      await user.keyboard("{Home}");
      await user.keyboard("X");

      /*
       * The keys a listbox and a menu both bind, and a combobox must not: they
       * are how a keyboard user gets to the start of what they have typed.
       * Home moved the caret, so the character landed at the front.
       */
      expect(input()).toHaveValue("Xnew");
      expect(input().getAttribute("aria-activedescendant")).not.toBe(highlighted);
    });

    it("marks the highlighted option selected, not the committed one", async () => {
      const user = userEvent.setup();
      render(<Harness initial="berlin" />);
      await user.click(input());
      await user.clear(input());
      await user.keyboard("e{ArrowDown}");

      const selected = screen
        .getAllByRole("option")
        .filter((option) => option.getAttribute("aria-selected") === "true");

      /*
       * Backwards next to `OptionList`, and right for a combobox: the popup is
       * a list of candidates rather than a display of state, so "selected"
       * there means "the one Enter would take". The committed value is already
       * on screen — it is the text in the box.
       */
      expect(selected).toHaveLength(1);
      expect(selected[0]).toHaveAccessibleName("New York");
    });
  });

  describe("committing", () => {
    it("commits the highlighted option on Enter and closes", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);
      await user.click(input());

      await user.keyboard("newc{ArrowDown}{Enter}");

      expect(onValueChange).toHaveBeenCalledExactlyOnceWith("newcastle");
      expect(input()).toHaveValue("Newcastle");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("swallows Enter with nothing highlighted rather than letting it submit", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
        event.preventDefault();
      });
      render(
        <form onSubmit={onSubmit}>
          <Harness />
        </form>,
      );
      await user.click(input());
      await user.keyboard("new");

      await user.keyboard("{Enter}");

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("commits the highlighted option on the way out with Tab", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);
      await user.click(input());
      await user.keyboard("berl{ArrowDown}");

      await user.tab();

      expect(onValueChange).toHaveBeenCalledExactlyOnceWith("berlin");
      expect(input()).toHaveValue("Berlin");
    });

    it("commits nothing on Tab when nothing is highlighted", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);
      await user.click(input());
      await user.keyboard("berl");

      await user.tab();

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it("commits on click without the blur unmounting the option first", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);
      await user.click(input());
      await user.keyboard("york");

      await user.click(screen.getByRole("option", { name: "York" }));

      expect(onValueChange).toHaveBeenCalledExactlyOnceWith("york");
      expect(input()).toHaveValue("York");
      expect(input()).toHaveFocus();
    });

    it("does not commit a disabled option", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);
      await user.click(input());
      await user.keyboard("boston");

      await user.click(screen.getByRole("option", { name: /boston/i }));

      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe("Escape", () => {
    it("closes the popup first and leaves the text alone", async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(input());
      await user.keyboard("new");

      await user.keyboard("{Escape}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(input()).toHaveValue("new");
    });

    it("clears the field only once the popup is out of the way", async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} initial="york" />);
      await user.click(input());
      expect(input()).toHaveValue("York");

      await user.keyboard("{ArrowDown}{Escape}");
      expect(input()).toHaveValue("York");

      await user.keyboard("{Escape}");

      expect(input()).toHaveValue("");
      expect(onValueChange).toHaveBeenCalledExactlyOnceWith(null);
    });
  });

  describe("the text and the value", () => {
    it("shows the committed option's label on mount", () => {
      render(<Harness initial="berlin" />);
      expect(input()).toHaveValue("Berlin");
    });

    it("follows a value changed from outside the component", async () => {
      const user = userEvent.setup();
      render(<Harness initial="berlin" />);
      expect(input()).toHaveValue("Berlin");

      await user.click(screen.getByRole("button", { name: "Clear from outside" }));

      /*
       * The case that a never-sync implementation gets wrong and that nothing
       * on screen would flag: something else on the page resets the state and
       * the combobox goes on displaying the choice it no longer holds.
       */
      expect(input()).toHaveValue("");
    });

    it("does not overwrite what is being typed while the value is unchanged", async () => {
      const user = userEvent.setup();
      render(<Harness initial="berlin" />);
      await user.clear(input());

      await user.keyboard("new h");

      expect(input()).toHaveValue("new h");
      expect(optionLabels()).toEqual(["New Hampshire"]);
    });
  });
  /*
   * The count is what a listening user cannot see from where they are: whether
   * narrowing the query helped, and whether pressing Down is worth it. It goes
   * to the app's live regions rather than to a `role="status"` this component
   * owns — one region per control is how announcements end up competing.
   */
  describe("suggestion count announcements", () => {
    const DEBOUNCE_MS = 500;

    /*
     * `fireEvent` and not `userEvent`, for the reason `Toast.test.tsx` gives:
     * `userEvent` awaits internal delay timers of its own, which deadlocks
     * against a fake clock. One `change` per keystroke is what the component
     * sees either way — its `onChange` is the only thing that opens the popup or
     * moves the filter.
     */
    function typeQuery(text: string): void {
      act(() => {
        fireEvent.change(input(), { target: { value: text } });
      });
    }

    function pass(ms: number): void {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("announces where the count ended up, not every count on the way", () => {
      const recorder = observeAnnouncements(announcer);
      render(<Harness />);

      // 5 matches, then 3, then 1.
      for (const query of ["n", "ne", "new y"]) {
        typeQuery(query);
        pass(DEBOUNCE_MS - 1);
      }

      // Three counts and nothing said yet: each announcement would interrupt the
      // one before it, and only the last is the answer the user was typing
      // towards.
      expect(recorder.spoken).toEqual([]);

      pass(1);
      expect(recorder.texts()).toEqual(["1 suggestion available"]);
      recorder.stop();
    });

    it("does not postpone an announcement the next keystroke leaves true", () => {
      const recorder = observeAnnouncements(announcer);
      render(<Harness />);

      // Both queries leave the same three matches, so the wait is not restarted:
      // the count has been continuously true for the whole delay, and there is
      // nothing to be gained by withholding a fact that is not changing.
      typeQuery("ne");
      pass(DEBOUNCE_MS - 1);
      typeQuery("new");
      pass(1);

      expect(recorder.texts()).toEqual(["3 suggestions available"]);
      recorder.stop();
    });

    it("counts plural suggestions", () => {
      const recorder = observeAnnouncements(announcer);
      render(<Harness />);

      typeQuery("new");
      pass(DEBOUNCE_MS);

      expect(recorder.texts()).toEqual(["3 suggestions available"]);
      recorder.stop();
    });

    it("announces the empty case, without reading the query back", () => {
      const recorder = observeAnnouncements(announcer);
      render(<Harness />);

      typeQuery("zzz");
      pass(DEBOUNCE_MS);

      // The user typed the query; repeating it costs them the words that say what
      // happened to it. The visible empty state carries it instead.
      expect(recorder.texts()).toEqual(["No suggestions"]);
      recorder.stop();
    });

    it("says nothing when the popup closes before the debounce elapses", () => {
      const recorder = observeAnnouncements(announcer);
      render(<Harness />);

      typeQuery("new");
      act(() => {
        fireEvent.keyDown(input(), { key: "Escape" });
      });
      pass(DEBOUNCE_MS * 2);

      expect(recorder.spoken).toEqual([]);
      recorder.stop();
    });

    it("keeps the visible empty state as a description rather than a region", () => {
      render(<Harness />);
      typeQuery("zzz");

      const empty = screen.getByText(/No matches for/);
      // Not a live region: the announcement above is the news, and this is the
      // state — `aria-describedby`, re-readable, and carrying the query that the
      // announcement leaves out.
      expect(empty).not.toHaveAttribute("role");
      expect(empty).not.toHaveAttribute("aria-live");
      expect(input()).toHaveAttribute("aria-describedby", empty.id);
    });
  });
});
