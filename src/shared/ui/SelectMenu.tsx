import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { useListbox, type ListboxOption, type ListboxValueProps } from "@/shared/hooks/useListbox";

/**
 * The popup presentation of `useListbox`.
 *
 * Everything that makes this different from `OptionList` is presentation
 * state, and all of it lives here rather than in the hook: whether the popup
 * is open, that a click outside dismisses it, that focus moves into the list
 * on open and back to the trigger on close, and that the trigger shows the
 * chosen label.
 *
 * The hook's only contribution to any of it is `onRequestClose`, which reports
 * "the user is done with this list" — Enter, Space, a click on an option, or
 * Escape. What "done" means for the UI is this component's business.
 */
export type SelectMenuProps<TValue extends string> = {
  options: readonly ListboxOption<TValue>[];
  /** Accessible name, used for both the trigger and the popup list. */
  label: string;
  /** Trigger text when nothing is selected yet. */
  placeholder?: string | undefined;
  className?: string | undefined;
} & ListboxValueProps<TValue>;

export function SelectMenu<TValue extends string>(props: SelectMenuProps<TValue>): ReactNode {
  const { options, label, placeholder = "Select…", className } = props;
  const [isOpen, setIsOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /**
   * The list element, so the popup can put real focus on it when it opens.
   *
   * The hook needs a ref on this same element to scroll the active option into
   * view, so this is the case `mergeProps` exists for: passing `ref` through
   * `getListboxProps` merges the two instead of one quietly replacing the
   * other. Setting `ref` after the spread would leave the hook's ref null and
   * the list would stop scrolling — with nothing red anywhere.
   *
   * State rather than a ref, because the element is a *dependency* of the
   * focus effect: the popup mounts and the node arrives in two separate
   * commits, so an effect keyed on `isOpen` alone would run while the node is
   * still null. It also keeps a ref object out of a function call during
   * render, which `react-hooks/refs` rightly objects to.
   */
  const [listElement, setListElement] = useState<HTMLUListElement | null>(null);

  // Spread rather than destructured, so the controlled/uncontrolled union
  // survives the hand-off — see `ListboxValueProps`.
  const listbox = useListbox({
    ...props,
    onRequestClose: () => {
      setIsOpen(false);
    },
  });

  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen) {
      listElement?.focus();
    } else if (wasOpen.current) {
      // Closing without this leaves focus on `<body>`, which drops the user
      // back to the top of the tab order from wherever they were.
      triggerRef.current?.focus();
    }
    wasOpen.current = isOpen;
  }, [isOpen, listElement]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target) === true) return;
      setIsOpen(false);
    };
    // `pointerdown` rather than `click`: a click that starts inside the popup
    // and ends outside it never fires a `click` on the document, so a dismiss
    // bound to `click` can be defeated by dragging.
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isOpen]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        // Only while the list exists: an `aria-controls` naming an unmounted
        // popup is a dangling IDREF, the same trap `<Tabs.Tab>` avoids.
        aria-controls={isOpen ? listbox.listboxId : undefined}
        onClick={() => {
          setIsOpen((open) => !open);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "flex h-10 min-w-56 items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
        )}
      >
        <span className="truncate">
          <span className="text-[var(--color-muted-fg)]">{label}: </span>
          {listbox.selectedOption?.label ?? placeholder}
        </span>
        <span aria-hidden="true" className="text-[var(--color-muted-fg)]">
          ▾
        </span>
      </button>

      {isOpen ? (
        <ul
          {...listbox.getListboxProps({
            ref: setListElement,
            className: cn(
              "absolute z-10 mt-1 flex max-h-64 min-w-56 flex-col overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
            ),
          })}
        >
          {options.map((option) => (
            <li
              key={option.value}
              {...listbox.getOptionProps(option.value, {
                className: cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm",
                  "data-[active]:bg-[var(--color-muted)]",
                  listbox.selectedValue === option.value
                    ? "font-medium text-[var(--color-fg)]"
                    : "text-[var(--color-fg-subtle)]",
                  option.disabled === true && "cursor-not-allowed opacity-50",
                ),
              })}
            >
              <span>{option.label}</span>
              {listbox.selectedValue === option.value ? (
                <span aria-hidden="true" className="text-[var(--color-primary)]">
                  ✓
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
