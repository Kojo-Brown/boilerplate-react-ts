# The TDD kata

Every other component in this repository arrived with its tests. That proves
nothing about the order they were written in, and the order is the whole claim
of test-driven development: that a test written _before_ the code can ask for
something the code does not do, where a test written after it can only confirm
what the code already does.

So one component was built the other way round, deliberately and visibly, with
one commit per step of the cycle. `Pagination` and the `paginationRange`
function under it are that component. The artefact is not the code — the code
is unremarkable, which is partly the point — it is the sequence of commits on
the pull request, where four of the eight steps are commits whose tests fail.

|                                     |                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `src/shared/lib/paginationRange.ts` | Which page numbers to show, and where to elide. A pure function of two numbers.    |
| `src/shared/ui/Pagination.tsx`      | The control: a named landmark, a button per page, `aria-current`, the ends closed. |
| `src/pages/tdd-lab/TddLabPage.tsx`  | `/labs/tdd`. Two of the four properties are only visible while paging.             |

## The steps

Read top to bottom; the commit subjects are verbatim, so `git log --grep` finds
any of them on the pull request branch.

| #   | Commit                                                                               | What changed                                                                         |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1   | `test: a pagination range lists every page when they all fit (red)`                  | The test only. The module does not exist, so the red is a resolution failure.        |
| 2   | `feat: list every page (green)`                                                      | A loop from 1 to `pageCount`. Correct for the one test and wrong for 400 pages.      |
| 3   | `test: a long range elides its middle (red)`                                         | The windowing requirement — and the return type, which had to stop being `number[]`. |
| 4   | `feat: window the middle of a long range (green)`                                    | First page, gap, current ± 1, gap, last page. Green and still wrong.                 |
| 5   | `test: the control keeps its width as the page moves (red)`                          | The property, over all 100 pages, plus what fills the space at each end.             |
| 6   | `feat: spend every slot, so the width is constant (green)`                           | Three cases that each spend all seven slots, replacing four conditional pushes.      |
| 7   | `test: a gap must never stand for a single page (red)`                               | Page 4 of 100 and page 97 of 100 — the band no earlier expectation covered.          |
| 8   | `feat: a gap costs two pages or it is not worth a slot (green)`                      | Two thresholds move by one.                                                          |
| 9   | `refactor: name the arithmetic the three cases share`                                | `pagesFrom`, `EDGE_BLOCK`, item constructors. No test touched.                       |
| —   | `test: pin the degenerate inputs, which were already right`                          | Characterisation tests, labelled as such: they passed on arrival.                    |
| 10  | `test: the control is a landmark, the gap is not a target (red)`                     | The component's accessibility tree, before any of it exists.                         |
| 11  | `feat: render the window as a navigation landmark (green)`                           | `<nav>`, a list, `Button` per page, the gap `aria-hidden`. Ends left open.           |
| 12  | `test: the ends are closed, the current page is inert, one page is no control (red)` | Four requirements a parent would otherwise have to know.                             |
| 13  | `feat: close the ends and separate the two readings of "current" (green)`            | `disabled` at the ends, `null` under two pages, clamped display vs unclamped guard.  |
| 14  | `refactor: one list item and one button, three call sites`                           | `Control`, which takes the `<li>` with it. No test touched.                          |

## The two tests that could not have been written afterwards

Steps 5 and 7 are the kata's evidence, because both describe defects that are
invisible from inside the implementation.

**The width.** A window of "current page ± 1, with the ends and a gap either
side" is correct at every boundary and still produces a control four entries
wide on page 1 and seven entries wide on page 50. Every single expectation you
could write about it is self-consistent; the defect exists only _between_ two
pages, which is why the test is a property over all of them rather than a third
worked example:

```ts
const widths = new Set<number>();
for (let current = 1; current <= 100; current++) {
  widths.add(paginationRange({ page: current, pageCount: 100 }).length);
}
expect([...widths]).toEqual([7]);
```

Written after the fact, this test passes and teaches nothing. Written first, it
rejects the implementation anyone writes on the first attempt — and it also
forces the trade-off into the open, because a window that always centres the
current page _cannot_ have a constant width at the edges. The suite now records
which of the two this control gives up.

**The single-page gap.** Page 4 of 100 renders `1 … 3 4 5 … 100`, where the
leading gap stands for page 2 and nothing else: the same slot, not a target,
and two navigations to reach what one would have reached. The arithmetic says a
gap goes there and is right. Only the requirement — a gap exists to stand for a
_run_ — says it should not. It is reachable in a band of exactly one page at
each end of the range, which is why no example-based test written from the
implementation lands on it.

## Rules the sequence follows

**A red commit is a commit.** Four of these fail `pnpm test`, and two of those
fail `pnpm typecheck` as well because they import a module that does not exist
yet. That is the cheapest available proof that the runner is pointed at the
thing under test, and keeping them as commits is what makes the next commit's
green mean something. CI runs on the pull request's head, so the branch's
intermediate reds never gate anything.

**A test is never edited to make it pass.** Step 3 is the one commit that
changes an existing expectation, and it does it in the _red_ commit rather than
the green one that follows. The requirement in step 3 is what forces the return
type to stop being `number[]`, the representation is a decision, and a decision
belongs in the commit that states the reason for it. A green commit that edits
an older assertion on its way past is indistinguishable from a green commit
that weakened one. The five pages asserted in step 1 are the same five pages in
the same order afterwards.

**A refactor commit touches one file.** Steps 9 and 14 change implementation
and nothing else, which is the only evidence a refactor can offer that it was
one: `git show --stat` on either is a single file, and the suite that passed
before it passes after it unchanged.

**A test written after the code is labelled as such.** The commit between steps
9 and 10 adds four tests that passed the moment they were written — an empty
range, a one-page range, and a `page` outside the range in both directions.
They are worth having: a filter that matches nothing leaves `pageCount` at 0,
and a filter applied while the reader is on page 12 of 40 leaves `page` past
the end. But they are characterisation tests, not steps, and calling them steps
would inflate the cycle count with work the cycle did not do.

## What a squash merge does to this

`main` carries one commit per spec item, by convention, so the fifteen commits
above do not survive the merge. They remain readable on the pull request, which
GitHub keeps after the branch is deleted, and the table in this document names
each one so the sequence is legible from `main` without going looking.

That is a real cost and the alternative was considered: a merge commit would
put the steps in `main`'s history permanently. It was not taken because one
item's history is not worth making this repository's history inconsistent, and
because a kata's value is in having been done, which the pull request records.

## What this does not cover

- **Focus is dropped at the ends.** Pressing Previous until the range runs out
  leaves focus on a button that has just become `disabled`, and the browser
  moves focus to the document body. Pressing a page number is fine — list items
  are keyed by page number, so the button the reader pressed is the same DOM
  node afterwards — but the two end buttons change state under the pointer. The
  fix is to move focus to the current page's button when the control disables
  the button holding it, or to use `aria-disabled` and keep them focusable; the
  second trades a real `disabled` for a focusable control that does nothing,
  which is its own argument. Neither is here.
- **Nothing in the application paginates yet.** `Pagination` is mounted by
  `/labs/tdd` and nowhere else, so it is tree-shaken out of every other route's
  graph. The feed on `/` is an infinite list by design and `/labs/infinite-scroll`
  is a windowed one; a table is what wants this, and there is no table.
- **The labels are props with English defaults.** `label`, `previousLabel`,
  `nextLabel` and `pageLabel` all take a string or a formatter so the page that
  mounts the control can translate them, and `/labs/tdd` does not — it is one
  of the lab pages `docs/i18n.md` lists as still English.
- **The gap is silent.** It is `aria-hidden`, so a reader using a screen reader
  learns that pages were elided only from 5 being followed by 10. Announcing
  "pages 6 to 9 omitted" is possible and is a different design; "ellipsis" read
  aloud is not.
- **No E2E spec.** The control's behaviour is unit-tested and its rendered
  markup is audited on `/labs/tdd` by the WCAG 2.2 AA sweep in both themes, but
  no Playwright spec drives it in a real browser. The focus behaviour above is
  precisely what such a spec would catch, which is the honest reason to note
  both in the same document.
- **Nothing here measures how good these tests are.** That is the next item in
  `SPEC.md`: mutation testing reports whether a suite that passes would have
  noticed the code being wrong, and it is the only gate that can check the
  claim this document makes about its own tests.
