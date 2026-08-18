# Headless components: behaviour hooks split from presentation

`useListbox` (`src/hooks/useListbox.ts`) is the worked example. It is a
single-select listbox — selection, virtual focus, arrow keys, Home/End,
typeahead, and the ARIA attributes that make all of it legible — and it renders
nothing at all. Three presentations in this repository are built on it:

| Skin                                  | What it adds                                                              |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `OptionList`                          | Nothing. A list that is on the page from the start.                       |
| `SelectMenu`                          | An open flag, dismiss-on-outside-click, focus into the list and back out. |
| `CardGrid` (in `HeadlessLabPage.tsx`) | A two-column grid of cards. Not a list at all.                            |

`/labs/headless` renders all three against one piece of state, so a choice made
in any of them shows up in the other two.

```tsx
const listbox = useListbox({
  options: FRAMEWORKS,
  label: "Framework",
  defaultValue: "react",
});

<ul {...listbox.getListboxProps({ className: "max-h-64 overflow-y-auto" })}>
  {FRAMEWORKS.map((option) => (
    <li key={option.value} {...listbox.getOptionProps(option.value)}>
      {option.label}
    </li>
  ))}
</ul>;
```

## Why not a `<Listbox>` component with props

Because the props never stop. A component that renders the list owns the
element, so every difference in markup has to be expressed as configuration:
`renderOption`, then `renderContainer`, then `optionClassName`, then `layout`,
and eventually a prop for the one thing the next caller needs that nobody
anticipated. `CardGrid` is the case that makes this concrete — it is a grid of
bordered cards with no `<ul>` anywhere, and it consumes exactly the same two
getters as the plain list does, because the hook never names an element.

The payoff that is easiest to overlook is the test suite.
`src/hooks/useListbox.test.ts` contains no JSX: the entire state machine is
driven through `renderHook` and plain objects standing in for keyboard events.
Behaviour that lives inside a component can only ever be asserted through
whatever DOM that component happens to render, which means every behaviour test
is also a markup test and breaks when the markup changes.

## Prop getters, and why they take an argument

`getListboxProps()` returns props to spread. The caller almost always has props
of their own for the same element, and spreading is not merging:

```tsx
<li {...getOptionProps(value)} onClick={track} />   // the hook's onClick is gone
<li onClick={track} {...getOptionProps(value)} />   // the caller's onClick is gone
```

Neither line is an error. The element renders, it looks right, and one of the
two behaviours is simply absent. So the getters take the caller's props as an
argument and `mergeProps` (`src/lib/mergeProps.ts`) composes what can be
composed: `on*` handlers chain, `className` goes through `cn`, `style` is
shallow-merged, `ref` goes through `mergeRefs`, and anything else the caller
sets wins.

### The opt-out is not `preventDefault()`

A caller sometimes needs one of the hook's behaviours _not_ to run — an option
that opens an editor instead of selecting, say. The tempting way to spell that
is to have the hook check `event.defaultPrevented`, and it is wrong: stopping
the page scrolling under an ArrowDown is the commonest thing a key handler
does, and a caller who calls `preventDefault()` for that reason has said
nothing about wanting the hook's key handling turned off. Reading the DOM flag
would leave the arrow keys dead with nothing to explain it. `preventHookDefault(event)`
is a separate marker for a separate intention, held in a `WeakSet` so nothing is
written onto the event.

The caller's handler runs **first**, which is what makes the veto possible: the
decision has to still be open when they see the event. The cost is that their
handler observes the state before the hook has acted on it — for "tell me what
was selected", use `onValueChange`.

### `mergeProps` cannot return `TBase & TCaller`

TypeScript reduces an intersection to `never` the moment one property has
incompatible types in the two halves. `getOptionProps(value, { onClick: undefined })`
would not merely mistype `onClick` — the whole returned object would become
`never` and every other prop on it an error. The return type is
`Omit<TBase, keyof TCaller> & TCaller`.

### React 19 changed what a merged ref owes you

A ref callback may now return a cleanup function, and React changes its own
behaviour when one does: it stops calling that callback a second time with
`null`. A merged callback has to return a cleanup, because some of the refs it
wraps have one — which makes it responsible for the ones that do not. It nulls
object refs and calls plain callback refs with `null` itself. Skip that and a
ref holds a detached node for as long as whatever holds the ref lives.

`SelectMenu` is where this is load-bearing rather than theoretical: the popup
needs a ref on the list element to focus it when it opens, and the hook needs a
ref on that same element to scroll the active option into view. Without merging,
whichever set `ref` last would win, and the loser would fail silently.

## Virtual focus, and what it costs

The listbox uses `aria-activedescendant` rather than a roving tab stop — the
opposite choice from `<Tabs>` (`docs/compound-components.md`). It has to: real
focus belongs on the list as a whole, so that a popup can hold focus in one
place while the highlight moves, and so that a future combobox can keep focus in
a text input while arrowing through suggestions.

Two things follow, and both are easy to miss because neither shows up in a
screenshot:

- **Nothing scrolls.** With a roving tab stop the browser scrolls the newly
  focused element into view for free. `aria-activedescendant` never moves real
  focus, so arrowing past the fold walks the highlight off the bottom of a
  scrollable list with the page perfectly still. The hook does the scrolling,
  which is the reason it needs a ref at all. jsdom has no layout and does not
  even define `scrollIntoView`, so the unit suite can only assert that a spy
  was called — `e2e/headless-listbox.spec.ts` presses End against a list taller
  than its container in a real browser and checks the option is on screen.
- **The attribute is an IDREF.** An option that is filtered out or disabled
  after being activated no longer has an element to point at, and a dangling
  IDREF is reported by assistive technology as a broken relationship. Virtual
  focus is therefore re-derived from the live options on every render rather
  than trusted from state.

## Behaviours worth knowing about

- **Focus is an activation.** Per APG, arriving on the listbox highlights the
  selected option, or the first enabled one. The first ArrowDown therefore moves
  to the _second_ option.
- **Arrows stop at the ends.** A tablist wraps; a listbox does not. Wrapping
  makes "have I reached the end?" unanswerable without counting.
- **Space is two keys wearing one hat.** With no typeahead in flight it commits
  the active option; mid-search it is a space _in the search_, because "New " is
  how you get past "New Hampshire" to "New York". Committing unconditionally
  makes every multi-word label unreachable by typing, and the symptom is a list
  that closes at random.
- **A repeated letter cycles.** A buffer of one character repeated ("aaa") walks
  through the options starting with that letter rather than looking for a label
  called "aaa".
- **`onRequestClose` is the whole popup contract.** It fires on Enter, Space, a
  click, and Escape. A skin with something to close passes a closer; an
  always-visible one does not.

## Controlled and uncontrolled are two shapes

`ListboxValueProps` is a union, not one shape with optional halves — the same
reasoning as `createTabs`. It makes `value` without `onValueChange` (a listbox
that visibly ignores clicks) and `value` alongside `defaultValue` (the default
silently discarded) unwritable.

One consequence to know before writing a fourth skin: forward `props` whole.

```tsx
const { className, ...rest } = props; // ✗ flattens the union
useListbox(rest);

useListbox(props); // ✓
useListbox({ ...props, onRequestClose }); // ✓
```

Object rest computes its type from the union's apparent type, which has already
lost the correlation between `value` and `onValueChange` that the two shapes
exist to state. Narrowing does not rescue it either: TypeScript will not use
`value` as a discriminant while its type mentions a type parameter, so inside a
generic helper the union stays unnarrowed. Spreading, and destructuring only
the presentation props by name, both keep it intact.
