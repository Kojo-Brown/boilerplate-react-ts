import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTabs, type TabsActivation, type TabsOrientation } from "./Tabs";

type Section = "overview" | "activity" | "settings";

const Tabs = createTabs<Section>();

function BasicTabs({
  orientation,
  activation,
  keepMounted = false,
  disabledActivity = false,
  onValueChange,
}: {
  orientation?: TabsOrientation;
  activation?: TabsActivation;
  keepMounted?: boolean;
  disabledActivity?: boolean;
  onValueChange?: (value: Section) => void;
} = {}) {
  return (
    <Tabs
      defaultValue="overview"
      label="Project sections"
      orientation={orientation}
      activation={activation}
      onValueChange={onValueChange}
      keepMounted={keepMounted}
    >
      <Tabs.List>
        <Tabs.Tab value="overview">Overview</Tabs.Tab>
        <Tabs.Tab value="activity" disabled={disabledActivity}>
          Activity
        </Tabs.Tab>
        <Tabs.Tab value="settings">Settings</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="overview">Overview panel</Tabs.Panel>
      <Tabs.Panel value="activity">Activity panel</Tabs.Panel>
      <Tabs.Panel value="settings">Settings panel</Tabs.Panel>
    </Tabs>
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });

describe("Tabs — structure and ARIA", () => {
  it("renders a labelled tablist with one tab per slot", () => {
    render(<BasicTabs />);
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("aria-orientation", "horizontal");
    expect(within(list).getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByLabelText("Project sections")).toBeInTheDocument();
  });

  it("renders only the selected panel and marks only that tab selected", () => {
    render(<BasicTabs />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Overview panel");
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    expect(tab("Activity")).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText("Activity panel")).not.toBeInTheDocument();
  });

  it("wires the selected tab and its panel together by id", () => {
    render(<BasicTabs />);
    const panel = screen.getByRole("tabpanel");
    expect(tab("Overview")).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tab("Overview").id);
  });

  // An `aria-controls` pointing at an unmounted panel is a dangling IDREF, not
  // a harmless leftover: the relationship it advertises cannot be followed.
  it("omits aria-controls on tabs whose panel is not in the document", () => {
    render(<BasicTabs />);
    expect(tab("Activity")).not.toHaveAttribute("aria-controls");
  });

  it("keeps aria-controls on every tab when panels stay mounted", () => {
    render(<BasicTabs keepMounted />);
    for (const name of ["Overview", "Activity", "Settings"]) {
      const id = tab(name).getAttribute("aria-controls");
      expect(id).not.toBeNull();
      expect(document.getElementById(id!)).toBeInTheDocument();
    }
  });

  it("hides rather than unmounts inactive panels under keepMounted", () => {
    render(<BasicTabs keepMounted />);
    // `getByRole` skips `hidden`, so the presence of the text is the assertion.
    expect(screen.getByText("Activity panel")).not.toBeVisible();
    expect(screen.getByText("Overview panel")).toBeVisible();
  });
});

describe("Tabs — selection", () => {
  it("switches panels on click and reports the new value", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<BasicTabs onValueChange={onValueChange} />);

    await user.click(tab("Activity"));

    expect(screen.getByRole("tabpanel")).toHaveTextContent("Activity panel");
    expect(onValueChange).toHaveBeenCalledWith("activity");
  });

  it("follows the prop in controlled mode and does not move on its own", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Tabs value="overview" onValueChange={onValueChange} label="Project sections">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="activity">Activity</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview">Overview panel</Tabs.Panel>
        <Tabs.Panel value="activity">Activity panel</Tabs.Panel>
      </Tabs>,
    );

    await user.click(tab("Activity"));

    expect(onValueChange).toHaveBeenCalledWith("activity");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Overview panel");
  });

  it("moves when a controlled owner accepts the change", async () => {
    const user = userEvent.setup();

    function Controlled() {
      const [value, setValue] = useState<Section>("overview");
      return (
        <Tabs value={value} onValueChange={setValue} label="Project sections">
          <Tabs.List>
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            <Tabs.Tab value="activity">Activity</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="overview">Overview panel</Tabs.Panel>
          <Tabs.Panel value="activity">Activity panel</Tabs.Panel>
        </Tabs>
      );
    }

    render(<Controlled />);
    await user.click(tab("Activity"));

    expect(screen.getByRole("tabpanel")).toHaveTextContent("Activity panel");
  });
});

describe("Tabs — keyboard navigation", () => {
  it("selects as focus moves under automatic activation", async () => {
    const user = userEvent.setup();
    render(<BasicTabs />);

    await user.tab();
    expect(tab("Overview")).toHaveFocus();

    await user.keyboard("{ArrowRight}");

    expect(tab("Activity")).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Activity panel");
  });

  it("moves focus without selecting under manual activation", async () => {
    const user = userEvent.setup();
    render(<BasicTabs activation="manual" />);

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(tab("Activity")).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Overview panel");

    await user.keyboard("{Enter}");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Activity panel");
  });

  it("wraps at both ends and jumps with Home and End", async () => {
    const user = userEvent.setup();
    render(<BasicTabs activation="manual" />);

    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(tab("Settings")).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(tab("Overview")).toHaveFocus();

    await user.keyboard("{End}");
    expect(tab("Settings")).toHaveFocus();

    await user.keyboard("{Home}");
    expect(tab("Overview")).toHaveFocus();
  });

  it("uses the vertical arrow pair and ignores the horizontal one when vertical", async () => {
    const user = userEvent.setup();
    render(<BasicTabs orientation="vertical" activation="manual" />);

    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(tab("Overview")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(tab("Activity")).toHaveFocus();
  });

  it("steps over a disabled tab", async () => {
    const user = userEvent.setup();
    render(<BasicTabs activation="manual" disabledActivity />);

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(tab("Settings")).toHaveFocus();
  });

  /**
   * The reason arrow order is read from the DOM at keydown rather than from a
   * registry tabs write to on mount. A tab rendered later mounts last, so a
   * registry would put it at the end of the row however it sits on screen.
   */
  it("navigates in DOM order after a tab appears in the middle", async () => {
    const user = userEvent.setup();

    function LateTab() {
      const [showActivity, setShowActivity] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setShowActivity(true);
            }}
          >
            Reveal
          </button>
          <Tabs defaultValue="overview" label="Project sections" activation="manual">
            <Tabs.List>
              <Tabs.Tab value="overview">Overview</Tabs.Tab>
              {showActivity && <Tabs.Tab value="activity">Activity</Tabs.Tab>}
              <Tabs.Tab value="settings">Settings</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="overview">Overview panel</Tabs.Panel>
            <Tabs.Panel value="activity">Activity panel</Tabs.Panel>
            <Tabs.Panel value="settings">Settings panel</Tabs.Panel>
          </Tabs>
        </>
      );
    }

    render(<LateTab />);
    await user.click(screen.getByRole("button", { name: "Reveal" }));

    await user.click(tab("Overview"));
    await user.keyboard("{ArrowRight}");

    expect(tab("Activity")).toHaveFocus();
  });
});

describe("Tabs — roving tab stop", () => {
  it("gives the tab order a single stop, on the selected tab", () => {
    render(<BasicTabs />);
    expect(tab("Overview")).toHaveAttribute("tabindex", "0");
    expect(tab("Activity")).toHaveAttribute("tabindex", "-1");
    expect(tab("Settings")).toHaveAttribute("tabindex", "-1");
  });

  /**
   * Binding the tab stop to the selection alone looks right until manual
   * activation: arrowing to a tab without selecting it, tabbing away and
   * tabbing back would land on the *selected* tab and throw away the move.
   */
  it("follows focus, not selection, under manual activation", async () => {
    const user = userEvent.setup();
    render(<BasicTabs activation="manual" />);

    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(tab("Activity")).toHaveAttribute("tabindex", "0");
    expect(tab("Overview")).toHaveAttribute("tabindex", "-1");
  });

  it("returns the tab stop to the selection once focus leaves the tablist", async () => {
    const user = userEvent.setup();
    render(
      <>
        <BasicTabs activation="manual" />
        <button type="button">Outside</button>
      </>,
    );

    await user.tab();
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(tab("Overview")).toHaveAttribute("tabindex", "0");
    expect(tab("Activity")).toHaveAttribute("tabindex", "-1");
  });
});

describe("Tabs — misuse", () => {
  it("names the slot when one is used outside its root", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<Tabs.Panel value="overview">Orphan</Tabs.Panel>)).toThrow(
      "<Tabs.Panel> must be rendered inside <Tabs>",
    );

    consoleError.mockRestore();
  });

  // Outside a list a tab still renders and still selects; only the keyboard
  // navigation and the tablist role are missing, which nothing else surfaces.
  it("rejects a tab rendered outside the list", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() =>
      render(
        <Tabs defaultValue="overview" label="Project sections">
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
        </Tabs>,
      ),
    ).toThrow("<Tabs.Tab> must be rendered inside <Tabs.List>");

    consoleError.mockRestore();
  });
});

describe("Tabs — independence between factory calls", () => {
  it("keeps a nested Tabs from reading the outer selection", async () => {
    const user = userEvent.setup();
    const Inner = createTabs<"a" | "b">();

    render(
      <Tabs defaultValue="overview" label="Outer">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="activity">Activity</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview">
          <Inner defaultValue="a" label="Inner">
            <Inner.List>
              <Inner.Tab value="a">A</Inner.Tab>
              <Inner.Tab value="b">B</Inner.Tab>
            </Inner.List>
            <Inner.Panel value="a">Inner A</Inner.Panel>
            <Inner.Panel value="b">Inner B</Inner.Panel>
          </Inner>
        </Tabs.Panel>
        <Tabs.Panel value="activity">Activity panel</Tabs.Panel>
      </Tabs>,
    );

    await user.click(tab("B"));

    expect(screen.getByText("Inner B")).toBeInTheDocument();
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  });
});

/**
 * Type-level assertions.
 *
 * These are the point of the factory, and nothing at runtime can check them —
 * a wrong `value` renders a tab that simply never matches a panel. `tsc` is
 * the assertion runner: each `@ts-expect-error` fails `pnpm typecheck` and
 * `pnpm build` if the error it expects stops being reported.
 *
 * They are deliberately never rendered. `describe.skip` would still construct
 * the elements; a function that is only type-checked will not.
 *
 * `Typed` is built at module scope rather than inside the function below, and
 * that is not a style choice: `react-hooks/static-components` rejects a
 * `createTabs` call inside a component, which is exactly the "call this at
 * module scope" rule in `Tabs.tsx` being enforced by lint. The first draft of
 * this block put the call inside and failed the gate.
 */
const Typed = createTabs<"overview" | "activity">();

export function TypeAssertions() {
  const noop = (): void => undefined;

  return (
    <>
      {/* @ts-expect-error — a value outside the union is the whole point of typing the slots. */}
      <Typed.Tab value="typoo">Typo</Typed.Tab>
      {/* @ts-expect-error — panels are constrained to the same union as tabs. */}
      <Typed.Panel value="settings">Settings</Typed.Panel>
      {/* @ts-expect-error — a controlled root without a change handler is tabs that cannot move. */}
      <Typed value="overview" label="Sections">
        c
      </Typed>
      {/* @ts-expect-error — `value` with `defaultValue` means one of the two is being ignored. */}
      <Typed value="overview" defaultValue="activity" onValueChange={noop} label="Sections">
        c
      </Typed>
      {/* @ts-expect-error — neither `value` nor `defaultValue` leaves nothing selected. */}
      <Typed label="Sections">c</Typed>
      {/* @ts-expect-error — a tablist without an accessible name is an unnamed group. */}
      <Typed defaultValue="overview">c</Typed>
    </>
  );
}
