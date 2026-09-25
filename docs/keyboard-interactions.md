# Keyboard interaction patterns

Four controls in this repository are composite widgets — one tab stop in the
page, with their own internal navigation. Three of them render a popup, three
of them use `role="listbox"` for something, and **their key maps disagree with
each other on purpose**.

That last part is the reason this file exists. The disagreements look like
inconsistency and are the patterns being right about what the user is doing,
and every one of them is invisible in a screenshot. The fastest way to break
one of these controls is to copy the key handling from the one next to it.

`/labs/keyboard` renders all four side by side.

## The key maps

| Key            | `Modal`        | `Menu`                                 | `Combobox`                         | `Tabs`                            | `OptionList` / `SelectMenu`    |
| -------------- | -------------- | -------------------------------------- | ---------------------------------- | --------------------------------- | ------------------------------ |
| Open           | —              | `ArrowDown` (first) · `ArrowUp` (last) | `ArrowDown` · `Alt+ArrowDown`      | —                                 | `ArrowDown` / `ArrowUp`        |
| Move           | —              | `ArrowUp` / `ArrowDown`, **wrapping**  | `ArrowUp` / `ArrowDown`, stops     | `ArrowLeft` / `ArrowRight`, wraps | `ArrowUp` / `ArrowDown`, stops |
| `Home` / `End` | —              | first / last item                      | **the text caret**                 | first / last tab                  | first / last option            |
| Commit         | —              | `Enter` · `Space`                      | `Enter` · `Tab`                    | `Enter` · `Space` (manual)        | `Enter` · `Space`              |
| `Escape`       | closes         | closes, focus back to trigger          | closes, then **clears the field**  | —                                 | closes (popup skin)            |
| `Tab`          | trapped inside | **closes**, order continues            | commits the highlight, then leaves | moves to the panel                | leaves                         |
| Typeahead      | —              | prefix, no spaces                      | — (the field _is_ the search)      | —                                 | prefix, spaces allowed         |
| Focus          | real, trapped  | real, roving                           | **stays in the textbox**           | real, roving                      | stays on the list              |

## Why they differ

**Wrapping.** `Menu` wraps at both ends; `Combobox` and the listboxes stop. A
menu is a handful of commands and nobody asks "have I seen them all?" of it. A
listbox is a set of values the user is choosing between, and a list that jumps
from the bottom back to the top makes that question unanswerable without
counting.

**`Home` and `End`.** They are list keys in a listbox, a menu and a tablist,
and they are _text_ keys in a combobox — the two keys a keyboard user reaches
for to get to the start or the end of what they have typed. A combobox that
steals them to jump to the first or last option breaks text editing in a field
that exists to be typed in. (APG does bind them in _select-only_ comboboxes,
where there is no text to move through. This repository's is the editable one.)

**`aria-selected`.** In `OptionList` it marks the chosen value. In `Combobox`
it marks the option the highlight is on — the one `Enter` would take — because
the popup there is a transient list of candidates rather than a display of
state. The committed value is already on screen: it is the text in the box.

**Real focus or virtual focus.** `Menu` and `Tabs` move DOM focus between
their items, because each item is a control. `useListbox` and `Combobox` keep
focus on one element and move `aria-activedescendant`, because the list (or the
textbox) _is_ the control. The cost of virtual focus is that nothing scrolls on
its own, so both of them call `scrollIntoView` by hand; the cost of real focus
is that Tab means something, which is why `Menu` has an opinion about it.

**`Tab` out of a popup.** `Menu` closes — it is transient, over the page rather
than part of it, and a user who Tabs is leaving. `Combobox` commits the
highlighted candidate on the way out, because arrowing onto an option is the
user saying "this one" and leaving the field reading something they did not
choose is the worse of the two surprises. `Modal` does neither: `<dialog>`
traps it.

**Disabled entries.** `useListbox` skips them; `Menu` lands on them. A disabled
_option_ is a value you cannot pick and can still read, because the list is on
screen. A disabled _command_ only ever lives in a popup, and the only way to
learn that "Restore from backup" exists but is unavailable right now is to
arrive on it. So a menu item uses `aria-disabled` rather than `disabled`, which
keeps it in the item count screen readers announce — `disabled` would make the
same menu "5 items" to one user and "6 items" to another.

**Substring or prefix.** `Combobox` filters on a substring; the listbox and menu
typeaheads match a prefix. A typeahead is a shortcut through a list you can
already see, so it matches the way you would read down it. A filter is a search
over a list you cannot, and "york" failing to find "New York" is the single most
common complaint about a filter that anchors to the start. `/labs/keyboard`
puts the two side by side over the same cities.

## What the platform gives you

`Modal` is a `<dialog>` opened with `showModal()`, and six of its behaviours
are the browser's rather than this repository's: the focus trap, `Escape`,
focus restored to whatever opened it, the rest of the document made inert, the
top layer, and the backdrop. A `<div role="dialog">` has to reimplement all six
and gets a different one wrong every time.

What is left for the component is where focus lands _inside_ the dialog. The
platform's answer is "the first focusable element", which for any dialog with a
close button in its header is the close button — so a screen-reader user opens
a dialog and is told "Close dialog, button", with the title and description
they were opened for sitting above them unread. `Modal` focuses the title
instead (`tabIndex={-1}`: focusable on purpose, never a tab stop), and
`initialFocusRef` overrides that when the dialog has one obvious first action.
Never point it at a destructive button — the `Enter` that opened the dialog can
then confirm it.

`useFocusTrap` exists for the one overlay that cannot be a `<dialog>`: the
sidebar drawer, which is modal on a phone and an ordinary landmark on a desktop,
and `showModal()` has no conditional form. It is deliberately **not** used in
`Modal`, where it would be a second trap racing the native one after every
keydown. See `docs/focus-management.md`.

## The tab stop a panel should not have

`<Tabs.Panel>` takes `tabIndex={0}` only when it holds nothing focusable. The
unconditional version — which this repository shipped until the keyboard pass —
is right about the panel it was written for: a panel of plain text is otherwise
unreachable from the tab that activated it. It is wrong about every other
panel, where it adds a second, redundant stop in front of the content, so `Tab`
out of the tablist announces the whole panel and `Tab` again reaches the link
the user was going for.

It has to be measured rather than declared, because the answer is a property of
the children and changes with them: a panel whose list of links arrives with a
fetch is unreachable before and doubly-stopped after.

## Writing direction

"Next" in a horizontal tablist is rightwards in English and leftwards in
Arabic, because the tabs are laid out that way — so a fixed `ArrowRight: 1`
sends an RTL user backwards through a row they are reading forwards. `Tabs`
reads the direction off the rendered tablist with `getComputedStyle`, not from
a prop: `dir` is inherited, so a tablist inside an Arabic section is RTL without
anyone passing it anything, and a prop would have to be threaded through every
caller and would disagree with the CSS the first time someone forgot.

Vertical tabs stack downwards in every writing direction this supports, so
`ArrowDown` is always "next" and the vertical pair is never flipped.

Full RTL layout — mirrored spacing, logical properties, the rest of it — is a
later item in `SPEC.md`. This is the keyboard half only.

## Where each claim is checked

| Claim                                                       | Where                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Key maps, ARIA wiring, what commits and what does not       | `Menu.test.tsx`, `Combobox.test.tsx`, `Tabs.test.tsx`, `Modal.test.tsx` |
| The `<dialog>` trap, `Escape`, focus restored to the opener | `e2e/keyboard-patterns.spec.ts`                                         |
| `Tab` out of a menu continuing the page's tab order         | `e2e/keyboard-patterns.spec.ts`                                         |
| `Space` running a focused command rather than typing        | `e2e/keyboard-patterns.spec.ts`                                         |
| A virtual-focus highlight scrolling into view               | `e2e/keyboard-patterns.spec.ts`, `e2e/headless-listbox.spec.ts`         |
| Roles, names and contrast on `/labs/keyboard`               | `e2e/a11y.spec.ts` (the WCAG 2.2 AA sweep)                              |

Two of those are in a browser rather than in jsdom for reasons worth knowing
before writing the next one:

- **jsdom has no `<dialog>` behaviour.** `showModal()` does not exist;
  `Modal.test.tsx` stubs it into an attribute change. Asserting the trap there
  would be asserting the stub.
- **`user-event` computes `Tab`'s destination from the event target**, not from
  whatever holds focus when the default action runs. A menu that closes on
  `Tab` unmounts that target, so `user.tab()` lands on `<body>` whether or not
  the component restored focus first — which is the exact bug it would be there
  to catch. A browser reads the focused element.

## What this does not cover

Automated checks reach the mechanics: which key does what, which attribute
points where. They cannot judge whether the _order_ a keyboard user meets
things in makes sense, whether a dialog's initial focus is the right element
for what that dialog is for, or whether a label reads as anything. Those stay
human work — `docs/accessibility.md` says what the WCAG gate does and does not
see, and this file is the keyboard corner of the same boundary.
