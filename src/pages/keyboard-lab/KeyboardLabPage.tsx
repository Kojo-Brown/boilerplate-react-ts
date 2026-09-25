import { useState, type ReactNode } from "react";
import { Combobox } from "@/shared/ui/Combobox";
import { Menu } from "@/shared/ui/Menu";
import { Modal } from "@/shared/ui/Modal";
import { createTabs } from "@/shared/ui/Tabs";
import { SelectMenu } from "@/shared/ui/SelectMenu";
import type { ListboxOption } from "@/shared/hooks/useListbox";
import type { MenuItemDescriptor } from "@/shared/ui/Menu";

/**
 * Harness for the four keyboard interaction patterns, side by side.
 *
 * Side by side is the point. Each of these controls is a popup over a list,
 * three of them use `role="listbox"` for it, and their key maps disagree — a
 * menu wraps at the ends and a listbox stops, Home and End move the highlight
 * in a listbox and the caret in a combobox, `aria-selected` marks the chosen
 * value in one and the candidate Enter would take in another. Every one of
 * those disagreements is the pattern being right about what the user is doing,
 * and every one of them is invisible in a screenshot.
 *
 * `docs/keyboard-interactions.md` is the table; this is the page you can put
 * your hands on. The unit suites own the assertions, `e2e/keyboard-patterns.spec.ts`
 * owns the ones only a real browser can make, and `/labs/keyboard` is in the
 * WCAG sweep like every other route.
 */

type Section = "modal" | "menu" | "combobox";

const Tabs = createTabs<Section>();

const ROW_ACTIONS: readonly MenuItemDescriptor[] = [
  { id: "rename", label: "Rename" },
  { id: "duplicate", label: "Duplicate" },
  { id: "restore", label: "Restore from backup", disabled: true },
  { id: "download", label: "Download" },
  { id: "delete", label: "Delete" },
];

type City =
  | "amsterdam"
  | "berlin"
  | "boston"
  | "bristol"
  | "lisbon"
  | "new-york"
  | "new-hampshire"
  | "newcastle"
  | "york"
  | "zurich";

const CITIES: readonly ListboxOption<City>[] = [
  { value: "amsterdam", label: "Amsterdam" },
  { value: "berlin", label: "Berlin" },
  { value: "boston", label: "Boston (no flights today)", disabled: true },
  { value: "bristol", label: "Bristol" },
  { value: "lisbon", label: "Lisbon" },
  { value: "new-york", label: "New York" },
  { value: "new-hampshire", label: "New Hampshire" },
  { value: "newcastle", label: "Newcastle" },
  { value: "york", label: "York" },
  { value: "zurich", label: "Zürich" },
];

export function KeyboardLabPage() {
  const [tab, setTab] = useState<Section>("modal");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [city, setCity] = useState<City | null>(null);
  const [listValue, setListValue] = useState<City | null>("berlin");

  return (
    <main className="flex flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Keyboard Lab</h1>
        <p className="max-w-3xl text-[var(--color-muted-fg)]">
          Four APG patterns that look alike and answer to different keys. Put the mouse down: every
          control below is reachable, operable and dismissable from the keyboard alone, and the
          differences between them are the point rather than an inconsistency.
        </p>
      </header>

      <Tabs
        value={tab}
        onValueChange={setTab}
        label="Keyboard patterns"
        activation="manual"
        className="max-w-3xl"
      >
        <Tabs.List>
          <Tabs.Tab value="modal">Modal</Tabs.Tab>
          <Tabs.Tab value="menu">Menu</Tabs.Tab>
          <Tabs.Tab value="combobox">Combobox</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="modal">
          <Section
            title="Dialog"
            keys="Escape closes · Tab cycles inside and cannot leave · focus returns to the button that opened it"
          >
            <p className="text-sm text-[var(--color-muted-fg)]">
              Almost all of that is <code>&lt;dialog&gt;</code> and <code>showModal()</code> rather
              than this repository. What is ours is where focus lands on open: the title, not the
              close button, so the dialog announces what it is before it announces how to leave.
            </p>
            <button
              type="button"
              onClick={() => {
                setIsModalOpen(true);
              }}
              className="h-10 self-start rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            >
              Open dialog
            </button>
          </Section>
        </Tabs.Panel>

        <Tabs.Panel value="menu">
          <Section
            title="Menu button"
            keys="ArrowDown opens onto the first command, ArrowUp onto the last · arrows wrap · Escape and Tab both close"
          >
            <p className="text-sm text-[var(--color-muted-fg)]">
              “Restore from backup” is disabled and still reachable — a command you cannot run is
              worth knowing about, which is why it is <code>aria-disabled</code> and keeps its place
              in the count.
            </p>
            <Menu
              items={ROW_ACTIONS}
              label="Row actions"
              onSelect={(id) => {
                setLastCommand(id);
              }}
            />
            <p className="text-sm text-[var(--color-muted-fg)]">
              Last command: <strong data-testid="last-command">{lastCommand ?? "none yet"}</strong>
            </p>
          </Section>
        </Tabs.Panel>

        <Tabs.Panel value="combobox">
          <Section
            title="Combobox and listbox, together"
            keys="Combobox: arrows move the highlight, Home and End move the caret · Listbox: arrows move the highlight, Home and End jump to the ends"
          >
            <p className="text-sm text-[var(--color-muted-fg)]">
              The pair that makes the case for reading the pattern rather than copying the
              neighbour. Type <code>york</code> into the combobox — it matches New York as well as
              York, because a filter searches a list you cannot see. Press <code>y</code> in the
              select — it jumps to York and not to New York, because a typeahead is a shortcut
              through a list you can.
            </p>
            <div className="flex flex-wrap items-end gap-6">
              <Combobox
                options={CITIES}
                label="Destination (combobox)"
                value={city}
                onValueChange={setCity}
                placeholder="Start typing…"
              />
              <SelectMenu
                options={CITIES}
                label="Destination (listbox)"
                value={listValue}
                onValueChange={setListValue}
              />
            </div>
            <p className="text-sm text-[var(--color-muted-fg)]">
              Combobox: <strong data-testid="combobox-value">{city ?? "nothing"}</strong> · Listbox:{" "}
              <strong data-testid="listbox-value">{listValue ?? "nothing"}</strong>
            </p>
          </Section>
        </Tabs.Panel>
      </Tabs>

      <Modal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
        }}
        title="Rename this project"
        description="Escape closes without saving. Tab cannot leave this dialog."
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--color-fg)]">Project name</span>
            <input
              defaultValue="boilerplate-react-ts"
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setIsModalOpen(false);
            }}
            className="h-10 self-start rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            Save
          </button>
        </div>
      </Modal>
    </main>
  );
}

function Section({ title, keys, children }: { title: string; keys: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 pt-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-[var(--color-muted-fg)]">{keys}</p>
      </div>
      {children}
    </section>
  );
}
