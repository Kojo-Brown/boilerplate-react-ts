import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { OptionList } from "@/components/ui/OptionList";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { useListbox, type ListboxOption } from "@/hooks/useListbox";

/**
 * Harness for the headless component pattern.
 *
 * Three presentations of one behaviour, wired to a single piece of state, so
 * the claim can be checked rather than believed: drive any of them with the
 * mouse or the keyboard and the other two follow, because none of them owns
 * the selection, the virtual focus or the key handling. `useListbox` does.
 *
 * The third one is the point of the exercise. It is not a list at all — it is
 * a grid of cards, built here in the page out of the same prop getters — which
 * is the thing a `<Listbox>` component could not have allowed without growing
 * a `renderOption` prop, then a `renderContainer` prop, then a `layout` prop.
 */

type Framework =
  | "react"
  | "vue"
  | "svelte"
  | "solid"
  | "angular"
  | "preact"
  | "qwik"
  | "lit"
  | "alpine"
  | "ember"
  | "marko"
  | "astro";

/**
 * Long enough to overflow the list skin's `max-h-64`, on purpose: virtual
 * focus does not scroll on its own, so a list that fits on screen cannot
 * demonstrate the one thing `aria-activedescendant` costs you.
 * `e2e/headless-listbox.spec.ts` presses End against this list in a real
 * browser, which is the only place that claim can be checked — jsdom has no
 * layout and does not even define `scrollIntoView`.
 */
const FRAMEWORKS: readonly ListboxOption<Framework>[] = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
  { value: "svelte", label: "Svelte" },
  { value: "solid", label: "Solid" },
  { value: "angular", label: "Angular (this demo is React-only)", disabled: true },
  { value: "preact", label: "Preact" },
  { value: "qwik", label: "Qwik" },
  { value: "lit", label: "Lit" },
  { value: "alpine", label: "Alpine" },
  { value: "ember", label: "Ember" },
  { value: "marko", label: "Marko" },
  { value: "astro", label: "Astro" },
];

export function HeadlessLabPage() {
  const [framework, setFramework] = useState<Framework | null>("vue");

  return (
    <main className="flex flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Headless Lab</h1>
        <p className="max-w-2xl text-[var(--color-muted-fg)]">
          Three presentations, one behaviour hook. Every one of them is controlled by the same
          state, so a choice made in any panel shows up in the other two. Arrow keys, Home, End,
          Enter and typeahead work identically in all three, and not one of them implements any of
          it — <code>useListbox</code> does, and it renders nothing.
        </p>
        <p className="text-sm text-[var(--color-muted-fg)]">
          Selected: <strong data-testid="selected-framework">{framework ?? "nothing"}</strong>
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        <Panel
          title="OptionList"
          description="The always-visible skin. No local state of any kind."
        >
          <OptionList
            options={FRAMEWORKS}
            label="Framework (list)"
            value={framework}
            onValueChange={setFramework}
          />
        </Panel>

        <Panel
          title="SelectMenu"
          description="The popup skin. Adds an open flag, dismiss-on-outside-click and focus restoration — all of it presentation, none of it in the hook."
        >
          <SelectMenu
            options={FRAMEWORKS}
            label="Framework"
            value={framework}
            onValueChange={setFramework}
          />
        </Panel>

        <Panel
          title="CardGrid"
          description="Built in this page from the same prop getters. A listbox that is not a list."
        >
          <CardGrid
            options={FRAMEWORKS}
            label="Framework (cards)"
            value={framework}
            onValueChange={setFramework}
          />
        </Panel>
      </div>
    </main>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-[var(--color-muted-fg)]">{description}</p>
      </div>
      {children}
    </section>
  );
}

interface CardGridProps {
  options: readonly ListboxOption<Framework>[];
  label: string;
  value: Framework | null;
  onValueChange: (value: Framework) => void;
}

/**
 * A third skin, deliberately nothing like a list: a two-column grid of cards.
 *
 * It reaches for exactly the same two getters as the other two skins. The only
 * reason this is possible is that the hook never names an element — it hands
 * back attributes and handlers and lets the caller decide what carries them.
 */
function CardGrid({ options, label, value, onValueChange }: CardGridProps) {
  const listbox = useListbox({ options, label, value, onValueChange });

  return (
    <div
      {...listbox.getListboxProps({
        className: cn(
          "grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
        ),
      })}
    >
      {options.map((option) => (
        <div
          key={option.value}
          {...listbox.getOptionProps(option.value, {
            className: cn(
              "flex cursor-pointer flex-col gap-1 rounded-[var(--radius-sm)] border p-3 text-sm",
              "data-[active]:border-[var(--color-primary)]",
              listbox.selectedValue === option.value
                ? "border-[var(--color-primary)] bg-[var(--color-muted)] font-medium"
                : "border-[var(--color-border)] text-[var(--color-fg-subtle)]",
              option.disabled === true && "cursor-not-allowed opacity-50",
            ),
          })}
        >
          <span>{option.label}</span>
        </div>
      ))}
    </div>
  );
}
