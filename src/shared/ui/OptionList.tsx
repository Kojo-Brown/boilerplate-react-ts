import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { useListbox, type ListboxOption, type ListboxValueProps } from "@/shared/hooks/useListbox";

/**
 * The always-visible presentation of `useListbox`.
 *
 * It is one of two skins in the repository built on that hook, and it is the
 * plain one: a list that is on the page from the start, the way a plan picker
 * or a settings choice usually wants to be. It owns no state — not even the
 * selection, which the hook holds — and passes no `onRequestClose`, because
 * there is nothing here to close.
 *
 * `SelectMenu` is the other skin. Between them they share no markup and no
 * local state, and `listboxSkins.test.tsx` runs the same behaviour suite
 * against both.
 */
export type OptionListProps<TValue extends string> = {
  options: readonly ListboxOption<TValue>[];
  /** Accessible name for the list. */
  label: string;
  className?: string | undefined;
} & ListboxValueProps<TValue>;

export function OptionList<TValue extends string>(props: OptionListProps<TValue>): ReactNode {
  const { options, className } = props;
  // `props` is forwarded whole rather than destructured: object rest flattens
  // the controlled/uncontrolled union — see `ListboxValueProps`.
  const listbox = useListbox(props);

  return (
    <ul
      {...listbox.getListboxProps({
        className: cn(
          "flex max-h-64 flex-col overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
          className,
        ),
      })}
    >
      {options.map((option) => {
        const isSelected = listbox.selectedValue === option.value;
        return (
          <li
            key={option.value}
            {...listbox.getOptionProps(option.value, {
              className: cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm",
                // The highlight follows `data-active`, not `:focus`. Real focus
                // never leaves the list — see the virtual-focus note in the hook.
                "data-[active]:bg-[var(--color-muted)]",
                isSelected ? "font-medium text-[var(--color-fg)]" : "text-[var(--color-fg-subtle)]",
                option.disabled === true && "cursor-not-allowed opacity-50",
              ),
            })}
          >
            <span>{option.label}</span>
            {isSelected ? (
              <span aria-hidden="true" className="text-[var(--color-primary)]">
                ✓
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
