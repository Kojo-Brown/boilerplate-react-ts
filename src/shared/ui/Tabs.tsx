import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/shared/lib/cn";

export type TabsOrientation = "horizontal" | "vertical";

/**
 * `automatic` — moving focus with the arrow keys selects as it goes.
 * `manual` — the arrow keys move focus only; Enter or Space selects.
 *
 * Manual is the right default when a panel is expensive to render, because
 * arrowing across five tabs under automatic activation mounts five panels.
 */
export type TabsActivation = "automatic" | "manual";

interface TabsBaseProps {
  /** Accessible name for the tablist. Required — a tablist without one is an unlabelled group. */
  label: string;
  orientation?: TabsOrientation | undefined;
  activation?: TabsActivation | undefined;
  /**
   * Keep inactive panels mounted (hidden) instead of unmounting them.
   *
   * Unmounting is the default because it is what most panels want: the panel's
   * subtree stops rendering, stops fetching and stops holding memory. Turn this
   * on when a panel owns state the user would be upset to lose — a part-filled
   * form, a scroll position, an editor buffer.
   */
  keepMounted?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * Controlled and uncontrolled are two shapes, not one shape with optional
 * halves. Spelling them as a union makes the two classic mistakes unwritable:
 * a `value` with no `onValueChange` (tabs that visibly do nothing when clicked)
 * and a `value` alongside a `defaultValue` (the default silently ignored).
 */
export type TabsProps<TValue extends string> = TabsBaseProps &
  (
    | { value: TValue; onValueChange: (value: TValue) => void; defaultValue?: undefined }
    | {
        defaultValue: TValue;
        onValueChange?: ((value: TValue) => void) | undefined;
        value?: undefined;
      }
  );

export interface TabsListProps {
  children: ReactNode;
  className?: string | undefined;
}

export interface TabsTabProps<TValue extends string> {
  value: TValue;
  children: ReactNode;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export interface TabsPanelProps<TValue extends string> {
  value: TValue;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * The set of slots a `createTabs` call produces, all bound to the same `TValue`.
 */
export interface TabsComponent<TValue extends string> {
  (props: TabsProps<TValue>): ReactNode;
  List: (props: TabsListProps) => ReactNode;
  Tab: (props: TabsTabProps<TValue>) => ReactNode;
  Panel: (props: TabsPanelProps<TValue>) => ReactNode;
}

interface TabsContextValue<TValue extends string> {
  baseId: string;
  selected: TValue | undefined;
  /** The tab focus currently sits on, which is not the selected one under manual activation. */
  focused: TValue | undefined;
  orientation: TabsOrientation;
  activation: TabsActivation;
  keepMounted: boolean;
  select: (value: TValue) => void;
  setFocused: (value: TValue | undefined) => void;
}

/** Arrow keys are orientation-dependent; the cross-axis pair must stay inert so the page can scroll. */
const STEP_KEYS: Record<TabsOrientation, Record<string, 1 | -1 | undefined>> = {
  horizontal: { ArrowRight: 1, ArrowLeft: -1 },
  vertical: { ArrowDown: 1, ArrowUp: -1 },
};

/**
 * Builds a `<Tabs>` compound component whose slots are typed to `TValue`.
 *
 * ```tsx
 * const Tabs = createTabs<"overview" | "activity">();
 *
 * <Tabs defaultValue="overview" label="Project sections">
 *   <Tabs.List>
 *     <Tabs.Tab value="overview">Overview</Tabs.Tab>
 *     <Tabs.Tab value="activity">Activity</Tabs.Tab>
 *   </Tabs.List>
 *   <Tabs.Panel value="overview">…</Tabs.Panel>
 *   <Tabs.Panel value="activity">…</Tabs.Panel>
 * </Tabs>
 * ```
 *
 * **Why a factory rather than a generic component with statics.** A generic
 * `function Tabs<TValue extends string>(…)` with `Tabs.Tab` hung off it does
 * not type the slots. `Tabs.Tab` is a separate function with its own type
 * parameter, and TypeScript has no way to relate it to the instantiation of
 * the enclosing JSX element — so `<Tabs.Tab value="typoo">` infers `"typoo"`
 * and compiles clean. Closing over `TValue` in a factory is what makes the
 * slots share one union. `Tabs.test.tsx` pins that with `@ts-expect-error`.
 *
 * **Call this at module scope.** Each call creates its own context and its own
 * component identities. Calling it during render creates new ones every render,
 * which remounts the whole subtree and loses tab state — the same hazard as
 * declaring any component inside another. That is not left to discipline:
 * `react-hooks/static-components` (one of the React Compiler diagnostics this
 * repo lints with, see `docs/react-compiler.md`) reports a `createTabs` call
 * inside a component as an error, so the footgun fails `pnpm lint`.
 *
 * The per-call context is also what lets a `Tabs` from one call nest inside a
 * panel of another without the inner slots reading the outer selection.
 */
export function createTabs<TValue extends string>(): TabsComponent<TValue> {
  const TabsContext = createContext<TabsContextValue<TValue> | null>(null);
  /** Presence of a `<Tabs.List>` ancestor. Keyboard navigation is delegated to the list. */
  const TabsListContext = createContext(false);

  function useTabsContext(slot: string): TabsContextValue<TValue> {
    const context = useContext(TabsContext);
    if (!context) {
      throw new Error(`<Tabs.${slot}> must be rendered inside <Tabs>`);
    }
    return context;
  }

  const tabId = (baseId: string, value: TValue): string => `${baseId}-tab-${value}`;
  const panelId = (baseId: string, value: TValue): string => `${baseId}-panel-${value}`;

  function TabsRoot(props: TabsProps<TValue>): ReactNode {
    const {
      label,
      orientation = "horizontal",
      activation = "automatic",
      keepMounted = false,
      children,
      className,
      value: controlledValue,
      defaultValue,
      onValueChange,
    } = props;

    const baseId = useId();
    const [uncontrolledValue, setUncontrolledValue] = useState<TValue | undefined>(defaultValue);
    const [focused, setFocused] = useState<TValue | undefined>(undefined);

    const selected = controlledValue ?? uncontrolledValue;

    const select = (next: TValue): void => {
      // An uncontrolled root owns the value; a controlled one only reports.
      if (controlledValue === undefined) {
        setUncontrolledValue(next);
      }
      onValueChange?.(next);
    };

    return (
      <TabsContext.Provider
        value={{
          baseId,
          selected,
          focused,
          orientation,
          activation,
          keepMounted,
          select,
          setFocused,
        }}
      >
        <div
          data-orientation={orientation}
          aria-label={label}
          className={cn(
            "flex gap-4",
            orientation === "horizontal" ? "flex-col" : "flex-row",
            className,
          )}
        >
          {children}
        </div>
      </TabsContext.Provider>
    );
  }

  function TabsList({ children, className }: TabsListProps): ReactNode {
    const { orientation, activation, setFocused } = useTabsContext("List");
    const listRef = useRef<HTMLDivElement>(null);

    /**
     * One handler on the tablist rather than one per tab, and the order it
     * navigates is read from the DOM at the moment the key is pressed.
     *
     * A registry that tabs write to on mount is the obvious alternative and it
     * is wrong in a way that only shows up later: mount order is not DOM order
     * once a tab is rendered conditionally. Insert a tab in the middle after
     * the first render and it appends to the registry, so ArrowRight jumps to
     * the end of the row. Reading `querySelectorAll` at keydown also gets
     * reordering and disabled tabs for free.
     */
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
      const list = listRef.current;
      if (!list) return;

      const tabs = Array.from(
        list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
      );
      if (tabs.length === 0) return;

      const activeIndex = tabs.findIndex((tab) => tab === document.activeElement);
      let nextIndex: number;

      if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = tabs.length - 1;
      } else {
        const step = STEP_KEYS[orientation][event.key];
        if (step === undefined || activeIndex === -1) return;
        nextIndex = (activeIndex + step + tabs.length) % tabs.length;
      }

      const nextTab = tabs[nextIndex];
      if (!nextTab) return;

      // Home/End with focus outside the list would otherwise scroll the page.
      event.preventDefault();
      nextTab.focus();
      if (activation === "automatic") {
        // Selecting through the tab's own click handler keeps one selection
        // path for pointer and keyboard, and avoids widening `string` back to
        // `TValue` by hand from a DOM attribute.
        nextTab.click();
      }
    };

    /**
     * Leaving the tablist entirely returns the roving tab stop to the selected
     * tab. Moving between tabs inside it must not, or the tab being focused
     * would lose its tab stop mid-move.
     */
    const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setFocused(undefined);
      }
    };

    return (
      <TabsListContext.Provider value={true}>
        <div
          ref={listRef}
          role="tablist"
          aria-orientation={orientation}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={cn(
            "flex gap-1",
            orientation === "horizontal"
              ? "border-b border-[var(--color-border)]"
              : "flex-col border-r border-[var(--color-border)] pr-1",
            className,
          )}
        >
          {children}
        </div>
      </TabsListContext.Provider>
    );
  }

  function TabsTab({
    value,
    children,
    disabled = false,
    className,
  }: TabsTabProps<TValue>): ReactNode {
    const { baseId, selected, focused, keepMounted, select, setFocused } = useTabsContext("Tab");
    const insideList = useContext(TabsListContext);

    if (!insideList) {
      // Outside a list the tab still renders and still selects, so the loss —
      // arrow-key navigation, and the tablist role that names the group — is
      // invisible in a screenshot. Fail loudly instead.
      throw new Error("<Tabs.Tab> must be rendered inside <Tabs.List>");
    }

    const isSelected = selected === value;

    return (
      <button
        type="button"
        role="tab"
        id={tabId(baseId, value)}
        // `aria-controls` must reference an element that exists. An unmounted
        // inactive panel makes it a dangling IDREF, which some screen readers
        // report as a broken relationship rather than ignoring, so only the
        // tab whose panel is actually in the document points at one.
        aria-controls={isSelected || keepMounted ? panelId(baseId, value) : undefined}
        aria-selected={isSelected}
        // Roving tab stop. It follows *focus*, falling back to the selection —
        // binding it to the selection alone breaks manual activation: arrow to
        // a tab without selecting it, tab away, tab back, and focus returns to
        // the selected tab instead, discarding where the user was.
        tabIndex={(focused ?? selected) === value ? 0 : -1}
        disabled={disabled}
        onClick={() => {
          select(value);
        }}
        onFocus={() => {
          setFocused(value);
        }}
        className={cn(
          "-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          isSelected
            ? "border-[var(--color-primary)] text-[var(--color-fg)]"
            : "border-transparent text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
          className,
        )}
      >
        {children}
      </button>
    );
  }

  function TabsPanel({ value, children, className }: TabsPanelProps<TValue>): ReactNode {
    const { baseId, selected, keepMounted } = useTabsContext("Panel");
    const isSelected = selected === value;

    if (!isSelected && !keepMounted) return null;

    return (
      <div
        role="tabpanel"
        id={panelId(baseId, value)}
        aria-labelledby={tabId(baseId, value)}
        hidden={!isSelected}
        // A panel whose content holds nothing focusable is otherwise
        // unreachable from the tab the user just activated.
        tabIndex={0}
        className={cn(
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  return Object.assign(TabsRoot, {
    List: TabsList,
    Tab: TabsTab,
    Panel: TabsPanel,
  });
}
