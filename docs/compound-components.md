# Compound components with a typed slot API

`<Tabs>` is the worked example (`src/components/ui/Tabs.tsx`). The pattern it
demonstrates is a parent that owns state and a set of named child slots that
read it through context, rather than a single component driven by a props
object:

```tsx
const Tabs = createTabs<"overview" | "activity" | "settings">();

<Tabs defaultValue="overview" label="Project sections">
  <Tabs.List>
    <Tabs.Tab value="overview">Overview</Tabs.Tab>
    <Tabs.Tab value="activity">Activity</Tabs.Tab>
    <Tabs.Tab value="settings" disabled>
      Settings
    </Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel value="overview">…</Tabs.Panel>
  <Tabs.Panel value="activity">…</Tabs.Panel>
</Tabs>;
```

The reason to reach for this over `<Tabs items={[…]} />` is that the caller
keeps the markup. Wrapping a tab in a tooltip, putting a badge in one label,
rendering half the tabs from a list and half literally, dropping a divider into
the row — all of that is ordinary JSX here and all of it needs a new prop in
the items-array version.

What the slot form usually costs is type safety, and that is the part worth
explaining, because the obvious way to write it does not work.

## Statics on a generic component do not share its type parameter

The natural first attempt is a generic root with the slots hung off it:

```tsx
function Tabs<TValue extends string>(props: TabsProps<TValue>) {
  /* … */
}
Tabs.Tab = function Tab<TValue extends string>(props: TabProps<TValue>) {
  /* … */
};
```

`<Tabs<Section>>` instantiates `TValue` for the root. `<Tabs.Tab>` is a
different function with a type parameter of its own, and there is no
relationship between the two — nothing in TypeScript connects a child element's
generic to the instantiation of the JSX element it happens to be nested inside.
So `TValue` is inferred independently from each tab's own `value`:

```tsx
<Tabs<Section> defaultValue="overview" label="Sections">
  <Tabs.List>
    <Tabs.Tab value="typoo">Typo</Tabs.Tab> {/* TValue = "typoo". Compiles. */}
  </Tabs.List>
</Tabs>
```

That tab renders, never matches a panel, and clicking it selects a value no
panel answers to. The failure is silent at every level: it type-checks, it
renders, and the only symptom is a tab that shows nothing.

Closing over `TValue` in a factory is what fixes it. `createTabs<Section>()`
builds the root and all three slots inside one generic scope, so they are all
concrete `Section` components by the time they reach JSX and a wrong `value` is
an ordinary type error. `Tabs.test.tsx` pins this with `@ts-expect-error` on
each of the mistakes the API is meant to make unwritable — including two the
factory buys almost for free, since props can be a union rather than a bag of
optionals:

| Mistake                                       | Why it matters                            |
| --------------------------------------------- | ----------------------------------------- |
| `<Tabs.Tab value="typoo">`                    | tab that matches no panel                 |
| `<Tabs.Panel value="settings">` outside union | panel that no tab reaches                 |
| `value` with no `onValueChange`               | tabs that visibly do nothing when clicked |
| `value` and `defaultValue` together           | one of the two is being silently ignored  |
| neither `value` nor `defaultValue`            | nothing selected, no tab in the tab order |

Those assertions are checked by `pnpm typecheck` and `pnpm build`, not by
`pnpm test` — `tsc` is their assertion runner. If the factory regresses to
something that accepts a wrong `value`, the expected error stops being reported
and the build goes red.

### The factory has to be called at module scope

Each `createTabs()` call creates a fresh context and fresh component
identities. Called during render, it makes new ones every render, remounting
the subtree and losing tab state — the same hazard as declaring any component
inside another, and just as invisible.

This is not left to discipline. `react-hooks/static-components`, one of the
React Compiler diagnostics this repo lints with (see
[`react-compiler.md`](./react-compiler.md)), reports the call as an error, so
the footgun fails `pnpm lint`. The first draft of the type-assertion block in
`Tabs.test.tsx` built its `Tabs` inside the component and was rejected by that
rule before it was ever run.

The per-call context pays for itself elsewhere too: a `Tabs` built by one call
nests inside a panel of another without the inner slots reading the outer
selection, because they are reading different contexts entirely.

## Keyboard order comes from the DOM, not from a registry

Arrow-key navigation needs the tabs in order, and a compound component cannot
know that order statically — tabs can be conditional, mapped, reordered, or
wrapped in something else.

The obvious mechanism is a registry each `Tabs.Tab` writes itself into on
mount. It is wrong in a way that only appears later: mount order is not DOM
order once a tab is rendered conditionally. Reveal a tab that sits in the
middle of the row and it appends to the registry, so `ArrowRight` from the tab
to its left jumps to the end of the row instead. Nothing about that looks like
a registry bug when you hit it.

`Tabs.List` instead runs one `keydown` handler and reads the tabs out of the
DOM at the moment the key is pressed:

```ts
const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
```

Conditional rendering, reordering and disabled tabs all fall out of that for
free, and the selector is the whole implementation of "skip disabled tabs".
`Tabs.test.tsx` covers the case that separates the two designs: a tab revealed
into the middle of the row after first render, then arrowed onto.

Automatic activation then selects by calling `nextTab.click()` rather than by
reading a `data-value` back off the element. Pointer and keyboard end up on one
selection path, and nothing has to widen a DOM string back to `TValue` by hand.

## The roving tab stop follows focus, not selection

A tablist is one stop in the page's tab order: one tab has `tabIndex={0}` and
the rest have `-1`. Binding that to the selected tab is the obvious reading and
it is correct — until activation is manual.

Under `activation="manual"` the arrow keys move focus without selecting, so the
focused tab and the selected tab are different tabs, and that is the entire
point of the mode. If the tab stop stays on the selection, then arrowing to a
tab, tabbing away and tabbing back returns focus to the selected tab and throws
away where the user was, with no indication anything was discarded.

So the root tracks a `focused` value alongside the selection and each tab
computes `tabIndex={(focused ?? selected) === value ? 0 : -1}`. Focus leaving
the tablist resets `focused`, which returns the stop to the selection; moving
between tabs inside the list must not reset it, hence the `relatedTarget` check
in the list's `onBlur`. Under automatic activation the two values coincide and
none of this is observable, which is why it is easy to ship the broken version.

## `aria-controls` may not point at a panel that is not there

Inactive panels unmount by default, so a tab's `aria-controls` would reference
an id that is not in the document. A dangling IDREF is not a harmless leftover —
it advertises a relationship that cannot be followed, and assistive technology
is entitled to report it rather than ignore it. Only the tab whose panel is
actually rendered carries the attribute.

`keepMounted` flips this: panels stay in the tree with the `hidden` attribute,
every tab's `aria-controls` resolves, and panels keep state across switches.
That is the knob to reach for when a panel owns a part-filled form, a scroll
position, or an editor buffer. It is off by default because unmounting is what
most panels want — the subtree stops rendering, stops fetching, and stops
holding memory.
