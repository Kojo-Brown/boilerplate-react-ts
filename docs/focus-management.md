# Focus management

Focus is the screen reader's cursor and the keyboard user's scroll position at
the same time. Nothing about losing it is visible to anyone testing with a
mouse: the page looks identical, the next Tab starts at the top of the
document, and the person who hit it has no way to report that they were on the
fourth item of a list a moment ago.

Three things in this app move focus, or exist so that something else can:

- `src/shared/lib/focusTrap.ts` — which elements Tab can reach, and where Tab
  goes next
- `src/shared/hooks/useFocusTrap.ts` — the hook that keeps focus inside one
  element
- `src/shared/ui/SkipLink.tsx` — the first thing in the tab order, and the id
  it sends focus to
- `src/features/route-announcement/` — what a navigation says, and where it
  leaves focus
- `e2e/focus-management.spec.ts` — the three of them in a real browser

## Route changes

A link in a multi-page site produces a document load. A screen reader responds
to one by announcing the new page's title, and the browser responds by moving
focus to the top of the document. A client-side router produces neither, so an
SPA that does nothing has made every navigation silent and left focus wherever
the click was — usually on a nav link that is still there, sometimes on a
button in content that has just been replaced, in which case focus falls to
`<body>` and the user's place in the page is gone.

`<RouteAnnouncer>` puts both back:

| What the browser used to do | What replaces it                                   |
| --------------------------- | -------------------------------------------------- |
| Announce the new page title | A polite live region reading "About, page loaded"  |
| Retitle the tab             | `document.title` from the matched route's `handle` |
| Move focus to the document  | `focus()` on `<main id="main-content">`            |

### Where the title comes from

Every leaf route in `src/app/router/index.tsx` carries `handle: { title }`, and
`useMatches` hands the deepest one back. The alternative is a `Record<path,
string>` somewhere in `shared/`, which is a second list of every route in the
app — correct on the day it is written — and which structurally cannot answer
for `/no-such-page`: that URL has no entry in any map but does match the `*`
route, whose handle says "Page not found". `router.test.tsx` fails on a leaf
that forgets one, because the symptom otherwise is silence.

### Why "the initial load" is `location.key`

The announcement and the focus move both have to be skipped on a document load,
where the screen reader is doing the announcing itself. The obvious
implementation is a `useRef(true)` first-render flag, and it is wrong in both
directions: `/login` sits outside `RootLayout`, so signing in mounts a _fresh_
announcer mid-session and the flag suppresses the one announcement the flow
most needs; and on a real first load the flag does fire, over the top of the
browser's own.

React Router already knows the answer. `location.key` is the literal string
`"default"` for the entry the history stack starts on, and a generated id for
every entry pushed after it. It survives remounts because it is a property of
the history stack rather than of any component.

### Why the focus move does not scroll

`target.focus({ preventScroll: true })`. Scrolling belongs to
`<ScrollRestoration>`, and the two disagree about the case that matters:
pressing Back should put the user where they were on the previous page, and a
`focus()` that scrolls would drag them to the top of it a frame later.

### Why the announcement is `polite`

Focus moving to `<main>` is itself announced — "main" — and it happens in the
effect immediately after the live region's text changes. A `polite` region
queues behind that; an `assertive` one would interrupt it, so the user would
hear the page name, then "main", with the second wiping the first.

`<RoutePendingBar>` announces the other end of the same event: it says a
navigation started and which href it is heading for, and this says which page
arrived. Both are polite, so they queue in that order.

## Skip links

One link, `Skip to main content`, first in the DOM. "Skip to navigation" is the
other half of the usual pair and is deliberately absent: both of this app's
navs are already above the main content, so a link to them would skip nothing,
and on a phone the header nav is `display: none`.

It is in the DOM from the first paint and hidden with `sr-only`, which is the
entire mechanism — `sr-only` keeps an element in the tab order, `display: none`
does not, and a link rendered only once focus arrives can never be focused
because there is nothing to focus until it renders.

It handles its own click rather than leaning on the anchor's default. The
default very nearly works — the browser scrolls to the target and, because the
target has `tabindex="-1"`, focuses it — but it also leaves `#main-content` in
the address bar, where it stays: through every later navigation, into a copied
URL, and into `<ScrollRestoration>`, which reads the location. The `href` stays
in place so the element is a link, which is what puts it in a screen reader's
links list.

`<main>` carries `tabIndex={-1}` because both the skip link and the route
announcer send focus to it, and `focus()` on a non-focusable element is
swallowed without error.

## Focus traps

### When not to use one

A `<dialog>` opened with `showModal()` already traps focus, in the browser,
better than any of this: the top layer makes the rest of the document inert,
Escape closes, and focus is restored on close. `Modal.tsx` uses that and
deliberately does **not** use `useFocusTrap` — two traps layered on each other
are two things racing to move focus after every keydown.

What the hook is for is the overlay that cannot be a `<dialog>`: the sidebar,
which is a modal drawer on a phone and an ordinary landmark on a desktop.
`showModal()` has no conditional form.

### The three parts

**Tab at the edges** is the part everyone implements, and on its own it is the
weakest of the three, because it only holds if focus was inside to begin with.
`nextTabStop` returns `null` for everything except the two edges: inside a
trap, most Tab presses are moving between adjacent controls, and the browser's
own sequential navigation is better at that than a re-implementation — it knows
about shadow roots and iframes.

**Focus arriving from outside** is the part that gets missed, and the ways in
have nothing in common with Tab: a click on the page behind, a screen reader's
virtual cursor, find-in-page, an `autofocus` in something that mounted late. A
`focusin` listener on the document catches all of them at once, which is why
there is one.

**Restoring focus** is what makes the trap survivable. Focus goes back to the
element that opened the drawer, not to `<body>`.

The keydown listener is on the document and in the **capture** phase. A
bubbling listener works right up until a control inside the trap stops
propagation on its own keydown — a listbox swallowing arrow keys, a library
text field — at which point the trap silently switches off for as long as that
control has focus.

### What the tabbable query does not do

It filters on `hidden`, `inert`, `display: none`, `visibility: hidden`,
`:disabled` and a negative `tabindex`, all of which are decidable without
layout. It does **not** try to detect elements that are merely off screen:
`offsetParent`, `getBoundingClientRect` and `checkVisibility` all need layout,
which jsdom does not do, so a filter built on them would pass everything in the
suite that is supposed to be pinning this behaviour.

That is the correct answer anyway, because it is also what the browser does: a
`transform` removes nothing from the tab order. A drawer that slides off screen
has to say so, which is why the closed sidebar carries `inert` — without it, a
phone user Tabbing out of the header falls into three nav links that are not on
the screen and cannot be scrolled to.

A positive `tabindex` is kept, in document order rather than its declared
order. Honouring it properly would mean sorting against elements outside the
container, which a trap cannot see; leaving it out would make that element
unreachable _and_ have the `focusin` guard push focus off it. Being visited in
the wrong order is the smaller failure, and it belongs to whoever wrote the
positive `tabindex`.

## What this does not cover

- **Keyboard interaction patterns inside components** — roving tabindex in a
  menu, type-ahead in a combobox, arrow keys in tabs. Those are the next spec
  item, not this one.
- **Focus after an async result.** A form that reveals an error summary, a list
  that loads a page of results — where focus should land is a question about
  what that page means, and no shared helper decides it.
- **Focus inside a route.** The announcer moves focus to the top of the page.
  A route that wants it somewhere more useful — the first field of a form, a
  search box — has to do that itself, after.
