# The accessibility gate

An accessibility bug is not like other bugs. Nobody reports it, because the
people it stops cannot use the form that would report it, and everyone who can
report things did not notice. It is found in an audit, months later, as a list
of two hundred items with no commit to point at — which is the same shape as
the bundle-size problem, and takes the same answer: put the number in front of
the person who changed it, in the pull request where they changed it.

- `e2e/a11y.spec.ts` — the browser sweep: every route, both themes, zero
  tolerated violations
- `e2e/a11yAudit.ts` — the route inventory and the axe wiring
- `playwright.a11y.config.ts` — its server and its own Playwright run
- `tooling/a11y/` — the token contrast gate, in `pnpm test`
- `pnpm test:a11y` — run the sweep locally
- CI: the **Accessibility** job
- `docs/focus-management.md` — skip links, focus traps and what a route change
  announces, none of which either gate above can see
- `docs/keyboard-interactions.md` — the key maps for Modal, Menu, Combobox and
  Tabs, and why they deliberately disagree with each other

## Two gates, and why neither is redundant

**The browser sweep** loads every route in a real Chromium, in light mode and
dark, and runs axe-core over what renders. It is the one that can see what a
_page_ does: a heading level skipped, a button with no accessible name, a
scrollable list nothing can reach with a keyboard, a colour combination that
arose from composing two tokens nobody paired on purpose.

**The token gate** reads `globals.css`, resolves every semantic colour through
its `var()` chain in both themes, and scores the pairings the design system
promises. It runs in `pnpm test`, takes about a millisecond, and sees something
the sweep structurally cannot: a pairing no route renders _today_. A `danger`
toast on a raised surface is a real combination the system offers and no page
currently shows, which makes it exactly the one that ships broken — the first
page to use it is written long after the audit.

The difference also shows up in how a failure reads. Dropping `--color-muted-fg`
one step fails the token gate as one assertion naming the token, the ratio and
the theme. Without that gate the same edit is caught a job later as a hundred
and eighty axe violations across twenty-one routes, each pointing at an element
rather than at the line that caused it.

## What "zero violations" means, exactly

The sweep runs axe's `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`
tags. It does **not** run `best-practice`, and that omission is deliberate:
those rules are opinions rather than the standard — `region` wants every byte
of the page inside a landmark, `page-has-heading-one` wants an `<h1>` on a
dialog — and a zero-violation gate whose first failure is not in the WCAG
document spends its authority on an argument it cannot win.

There is no allow-list, no disabled rule and no excused route. That absolutism
is the only version worth having: the moment one violation is parked as
"known", the count stops being a signal and the suite's job quietly becomes
keeping a ledger. If something here fails, the answer is to fix the page.

## What it cannot tell you

Automated rules reach something like a third of the AA criteria. They are
strong on the mechanical half — contrast, names, roles, structure, and the 2.2
additions for target size and obscured focus — and silent on everything that
requires reading the page:

- **Is the alt text right?** axe checks that an image has one. It cannot tell
  `alt="image"` from a description.
- **Does the focus order make sense?** axe checks that things are focusable. The
  order they arrive in is a judgement about the page's meaning.
- **Does the error message explain anything?** "Invalid input" passes every rule
  in the set.
- **Is a colour the _only_ thing carrying the difference?** 1.4.1 is a question
  about what a state means, not about the value of a CSS property.
- **Accessible authentication, redundant entry, consistent help** — the three
  criteria 2.2 added that no scanner decides.

The honest claim of this gate is that the machine-checkable part of AA holds on
every route. The rest is a keyboard, a screen reader and half an hour, and it
belongs in review rather than in CI.

## The token system after the audit

The first run found 255 contrast violations across 21 routes, and almost all of
them were one line: `--color-muted-fg`, the app's most-used foreground, sat at
`neutral-500` — 3.71:1 against every light surface, where text needs 4.5:1.

Fixing it turned up the structural version of the same problem, which is worth
understanding before adding a colour:

> **A colour used as a fill and a colour used as a foreground answer to
> different thresholds, so they cannot be the same token.**

A fill is a graphic: 1.4.11 asks 3:1 of it where it identifies a control, and
4.5:1 of the label printed _on_ it. The same value used as text or as an icon
answers to 4.5:1 against the surface _behind_ it — a different comparison, and
for every ramp in this palette a stricter one. `primary-500` carries white at
4.74:1 as a button and fails at 4.48:1 as text. Amber is not close: `warning-500`
as a toast's icon on `warning-subtle` is 2.12:1.

Hence the `-strong` family — `--color-primary-strong`, `--color-danger-strong`,
`--color-success-strong`, `--color-warning-strong`. Each is its colour _as a
foreground_: text, an icon glyph, a border that carries meaning. The bare token
stays the fill.

| Use                                   | Token                    |
| ------------------------------------- | ------------------------ |
| Button background, badge fill         | `--color-primary`        |
| Label on that background              | `--color-primary-fg`     |
| Text, icon glyph, a meaningful border | `--color-primary-strong` |
| Focus ring, control outline           | `--color-primary`        |

Nothing mechanically enforces the split — a new `text-[var(--color-danger)]`
would pass lint. What catches it is the token gate, the moment that colour
lands on a surface where it does not clear 4.5:1, which for `--color-danger` in
dark mode is every surface there is.

## Adding a route

Add it to `AUDIT_TARGETS` in `e2e/a11yAudit.ts`. You do not have to remember
to: the sweep compares its inventory against the paths `ROUTES` declares and
fails in both directions — a route added to the app without an entry here is a
red build in the pull request that adds it, and an entry here matching nothing
the app registers is a red build too, which is what catches a typo pretending
to be coverage.

It compares against the _file_, parsed, rather than an imported `ROUTES`.
`e2e/` belongs to `tsconfig.node.json` and `src/` to `tsconfig.json`, which
references it; a module imported across that line joins both programs and
`tsc --noEmit` then fails on a clean checkout with TS6305, before the
referenced project has emitted anything. Reading the source keeps the check
against the real registry without moving a file into two projects — the same
move the token gate makes on `globals.css`.

Each entry names a `ready` selector — something that proves the page finished
rendering. Auditing a skeleton passes trivially and means nothing, which is
also why this suite runs against a dev server with MSW left on rather than
sharing the E2E server, where mocks are disabled so `page.route()` can own the
network.

One entry carries a query string: the concurrency lab is audited at `?n=50`
rather than its default 15,000 rows. axe walks the accessibility tree of
everything rendered, so at full size that one route takes longer than the other
twenty put together and finds exactly the same thing — the rows are one
component repeated, and fifty of them contain all the markup there is.

## Running it

```bash
pnpm test:a11y                  # the whole sweep
pnpm test:a11y --grep dashboard # one route, both themes
pnpm test                       # includes the token contrast gate
```

A failure prints the rule, the element, the selector and axe's own explanation
of why it failed, plus a link to the rule's documentation. The HTML report
lands in `playwright-report-a11y/`, and CI uploads it as an artefact on every
run, pass or fail.
