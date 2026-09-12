# Error boundaries per route

Every route in this application renders inside its own `<RouteErrorBoundary>`.
When a route throws, that route is replaced by a fallback and nothing else is:
the shell, the navigation and every sibling route keep working. The boundary
reports the error with enough context to find it, offers a recovery that can
actually work, and gets out of the way as soon as the user navigates.

Three things make that harder than it sounds, and each one has a section below.

- A per-route boundary sits at a **shared position** in the tree, so without
  reset keys it holds one route's error over every route the user visits next.
- "Try again" is a **promise the most common route error cannot keep**.
- React 19 reports a caught error **twice**, so the obvious wiring doubles
  every number in the dashboard.

Run `/labs/errors` to see all of it, or read
`src/features/route-errors/RouteErrorBoundary.test.tsx`, where each claim below
is a test.

---

## Why per-route, when Suspense is hoisted

`RootLayout` holds **one** `<Suspense>` above `<Outlet>` for every route, and
that is deliberate — a held transition can only keep the previous page on
screen where React has already-revealed content to keep, and "already revealed"
belongs to a boundary _instance_. Per-route Suspense boundaries mount a new
instance on arrival, which has nothing revealed, so React commits the fallback
and the previous page vanishes. See `docs/route-transitions.md`.

Error boundaries are placed the opposite way, and for the mirror-image reason.
Hoisting a Suspense boundary buys **shared revealed content**, which is what you
want. Hoisting an error boundary buys **shared blast radius**, which is not: one
route's throw would replace every route, the user would lose the navigation
along with the page, and the report would have nothing to name but the layout.

So: one Suspense boundary for all routes, one error boundary each.

```
RootLayout
└── <Suspense fallback={<RouteFallback/>}>      ← one, shared
    └── <Outlet/>
        └── <RouteErrorBoundary route="/dashboard">   ← one per route
            └── <DashboardPage/>
```

The router's `errorElement` (`<ErrorPage>`) stays wired for what a per-route
boundary cannot see: a throw in the layout itself, above all of them.

---

## Reset keys, and the bug they remove

React reconciles by position and type. Every route's boundary is rendered at
the same `<Outlet>` slot and they are all `RouteErrorBoundary`, so React treats
them as **one instance** whose props changed — not as one unmounting and
another mounting. A class component keeps its state across that.

The consequence is a bug that looks nothing like a boundary bug:

1. `/a` throws. The boundary shows its fallback. Correct so far.
2. The user clicks a link to `/b`.
3. The URL changes, `/b` matches, and the user is still looking at `/a`'s error
   screen. `/b` never rendered.

No warning, no failed test, and from the outside it reads as "the link is
broken". `RouteErrorBoundary` passes `resetKeys={[location.key]}`, and
`ErrorBoundary` clears its error whenever a key changes.

Two details of the comparison are load-bearing.

**Element-wise, with `Object.is` — never array identity.** Callers write
`resetKeys={[location.key]}`, which allocates a new array every render. An
identity check would clear the error on _every_ render: the children re-render,
throw the same error, the boundary catches and clears it again. Either the
fallback never appears at all, or React gives up with a maximum-update-depth
error. `Object.is` rather than `===` so that a `NaN` key is not a permanent
change.

**In `getDerivedStateFromProps`, not `componentDidUpdate`.** Most examples
compare in `componentDidUpdate`, because that is where a callback can be called
directly. It also clears the error one commit _later_, so the navigation that
was supposed to resolve the error paints the previous route's fallback for a
frame first. Deriving it means the fallback is never committed.

**Why `location.key` and not `pathname`.** The key changes on same-path
navigations too. A page broken by its own query string — a bad filter, a
malformed id — is fixed by changing that query string, and a `pathname` key
would leave the user staring at the error they just fixed.

### What React Router's `errorElement` gets right and wrong

Worth knowing, because it looks like it should have been the answer:

|                            | `errorElement`         | React error boundary  |
| -------------------------- | ---------------------- | --------------------- |
| Cleared by navigating away | **yes**, automatically | no — needs reset keys |
| Can be reset in place      | **no**                 | **yes**               |
| Knows which route it is    | yes                    | yes (via a prop)      |

The router clears route errors on the next navigation, which is the half this
boundary has to buy back with reset keys. But it exposes no way to clear one in
place, so a "Try again" inside an `errorElement` has to be a navigation to the
same path — which discards the rest of the app's state. `useRevalidator`, the
API that looks like the answer, revalidates _loaders_; on routes that have none
(all of them here) it returns without clearing the error, and the button does
nothing. Both behaviours are pinned in
`src/features/route-errors/RouteErrorBoundary.test.tsx`.

---

## Retry, and when it is a lie

A reset re-renders the children. That fixes a **transient** failure — a
rejected request, a race that lost — and does nothing at all for a
deterministic one. The fallback therefore does not offer the same button in
every case.

### Retries are budgeted

Two by default. A retry against a deterministic error re-throws inside the same
update; nothing changes on screen, and the user has no way to tell a button
that failed from a button that did not fire. After the budget is spent the
fallback stops offering it, says so, and offers a reload instead. A navigation
refills the budget.

### A stale chunk is never offered a retry

This is the single most common route error in a deployed SPA, and the one
retry provably cannot fix. When a build replaces the hashed chunks on the CDN
while a user has the old `index.html` open, the next route they visit fails its
dynamic `import()` with a 404.

`React.lazy` memoises the promise it created. Resetting the boundary re-reads
the **same rejected promise** and rethrows the identical error in the same
frame, forever. (`SectionBoundary` documents the same shape for
`promiseCache.ts`; there the cure is invalidating the cache, and here there is
no cache to invalidate — `React.lazy` exposes none.)

What works is a document reload, because the thing that is stale is not the
chunk, it is the `index.html` naming it. So `classifyRouteError` splits the two
and the fallback offers only what can work:

| kind         | Try again             | Reload page |
| ------------ | --------------------- | ----------- |
| `render`     | yes, up to the budget | yes         |
| `chunk-load` | **never**             | yes         |

Detection is by message, which is unpleasant and is what every SDK does: no
engine gives this rejection a distinguishable `name` or `code`. All three
engine spellings are matched, plus webpack's `ChunkLoadError` name for migrated
projects. The engine-composed message is asserted against a _real_ aborted
import in `e2e/route-error-boundary.spec.ts` — the unit tests can only assert
against strings someone typed.

### Reloads are guarded

A reload for a stale chunk is a bet that the server will serve a newer
document. When the bet loses — a CDN still caching the old one, a service
worker answering from its own cache — the fresh document fails the same import
and reloads again: a tab that loops and never shows the user the error
explaining why. `tryClaimReload` records the attempt in `sessionStorage` and
refuses another inside 30 seconds, replacing the second reload with an
explanation. A timestamp rather than a flag, so a genuinely new failure later
in a long session still gets its one reload.

---

## Reporting

The envelope is shaped like Sentry's, because the shape is the useful part. **No
Sentry SDK is a dependency.** `ErrorTransport` is the seam; pointing this at a
real backend means writing one function.

```ts
interface ErrorEvent {
  eventId: string; // 32 hex chars
  timestamp: number;
  level: "fatal" | "error" | "warning";
  exception: { type; value; stack? }[]; // thrown value first, root cause last
  fingerprint: string[]; // grouping key
  tags: Record<string, string>; // route, error.kind, retry.attempt, release…
  contexts: { react?: { componentStack }; route?: { path; key } };
  breadcrumbs: Breadcrumb[];
  mechanism: { type: string; handled: boolean };
}
```

Configure with `VITE_ERROR_REPORT_URL` (blank sends nothing; a dev build then
logs to the console) and `VITE_RELEASE`.

### `throw` accepts any value

`error.message` is a property access on something that is only an `Error` by
convention. `throw "nope"` is legal, `throw { code: 500 }` is common, and React
Router's own `throw new Response(...)` is idiomatic. Reading `.message` off
those yields `undefined`, so an unguarded fallback renders an empty paragraph
under "Something went wrong" — the error screen and the error report degrade
together, at the moment both are all anyone has. `normalizeThrown` covers
`Error`, `Response`, strings, cross-realm errors that fail `instanceof`, plain
objects, `null`, `undefined`, numbers and symbols.

### Grouping is on the root cause, normalized

Two decisions, each of which is wrong in the obvious version:

**The root cause, not the wrapper.** Fingerprinting on the outermost error
groups by whoever rethrew last, which is usually one wrapper shared by every
call site — so a database timeout and a malformed response arrive as the same
issue, both titled after the wrapper. `fingerprintOf` uses the last entry in
the chain and keeps the outermost _type_ as a second component, so two
different call paths into one root cause stay distinguishable.

**Normalized, not verbatim.** A message carrying an id (`Failed to load user
8f21c3`) produces a distinct group per occurrence: the loudest bug in the app
arrives as ten thousand issues of one event each, which is indistinguishable
from noise. `normalizeForGrouping` replaces UUIDs, long hex runs and digit runs
— in that order, since the digit rule would otherwise chew a UUID into rubble
no two occurrences agree on.

Cause chains are walked with both a depth cap and an identity set: `err.cause =
err` is one line and `a.cause = b; b.cause = a` is two, and either turns a
plain `while` into a hang inside the error path, where nothing is left to catch
it.

### React 19 reports a caught error twice

`createRoot` accepts `onCaughtError`, and boundaries still have
`componentDidCatch`. For **one** throw React calls `onCaughtError` and then the
boundary's `componentDidCatch`, both carrying a component stack. Wiring the
reporter into both — the natural thing to do, since the root option reads like
the React 19 replacement for the lifecycle — doubles every count.

The boundary is the one that reports, because it is the only one that knows
which route broke. `src/app/main.tsx` therefore wires **only**:

- `onUncaughtError` → `level: "fatal"`, `handled: false`. What no boundary
  caught, i.e. the errors that leave the user on a blank document.
- `onRecoverableError` → `level: "warning"`. Not an application error at all;
  React recovered on its own, hydration mismatches chief among them. Reported
  because it is otherwise invisible, at a level that never pages anyone.

The double-fire, its ordering, and the doubling it causes are pinned in
`src/shared/observability/errorReporter.dedupe.test.tsx`. A note from writing
it: `onUncaughtError` cannot be tested through `act()` — `act` intercepts an
error no boundary caught and rethrows it at the caller _instead of_ handing it
to the hook, so a test that wraps it asserts nothing about the handler.

### Deduplication is a time window

Identical events (same fingerprint, same outermost stack, same mechanism)
inside one second are dropped. Two reasons, neither cosmetic: it absorbs an
accidental double wiring of the above, and it stops a human holding down "Try
again" from inflating an issue's count with presses rather than failures.

A _window_, rather than Sentry's compare-with-previous, because
compare-with-previous drops the second of two genuinely different failures that
alternate — in an A/B/A/B sequence each event's predecessor differs, so B is
reported never. Time-bounding means a repeated failure seconds apart still
reports, which is the signal that a retry loop is underway.

`captureException` returns the event id, or `null` when the event was dropped.
The fallback shows the id as a reference the user can quote, and shows nothing
when it is `null` — handing someone a reference to an event that was never sent
is worse than handing them none.

---

## Breadcrumbs

A stack says where the app was; breadcrumbs say how it got there. That matters
most for the errors a stack cannot explain — a render that throws because of
state set three interactions ago names only the component that read it.

`<ErrorBreadcrumbs>` sits in the shell, renders nothing, and records
navigations and clicks. Three decisions:

**A bounded ring, evicting rather than flushing.** This collects for as long as
the tab is open. An unbounded array is a leak with a friendly name, and it
grows fastest in the sessions most likely to hit a bug. Writes are O(1); the
reordering is paid once, when an error is actually being reported.

**Strings only — never a node or an event.** The tempting version of a click
crumb keeps `event.target` to derive a selector at send time. That pins a DOM
element, and its entire subtree, inside a buffer designed to outlive both —
exactly the detached-node retention `docs/memory-leaks.md` sets a gate against.
The label is derived at record time and the node dropped on the spot.

**Registered in the capture phase.** Menus, dialogs and dropdowns call
`stopPropagation()` routinely, and a bubbling listener would silently lose
precisely the interactions most worth having in a trail.

---

## Redaction

Credentials reach a reporter as _substrings of paths the app already handles_,
not as something anyone passed deliberately. An OAuth redirect is
`/auth/callback?code=…`; a password reset is `/reset?token=…`; a failed request
is `Failed to fetch https://api/me?access_token=…`. So redaction happens on the
recording side, in `redact.ts`, and applies to breadcrumbs, messages **and
stacks**.

The stack matters and forgetting it was a real leak the test suite caught: V8
puts the message on the first line of `stack`, so an event whose `value` was
scrubbed still carried the untouched original one field over.

Sensitive query keys are matched as case-insensitive substrings, so `token`
covers `access_token`, `refreshToken`, `id_token` and `csrf-token` in one rule.
`code` is on the list for the OAuth authorization code and is the one rule that
costs something — a `?code=US` country filter is redacted too. A redacted facet
is recoverable from the route; a leaked authorization code is not. URL
fragments are dropped entirely rather than parsed, the implicit flow returning
`#access_token=…` there.

**What this cannot do** is find a secret inside a path segment
(`/invite/abc123`), because nothing distinguishes that from a slug. Routes that
put a secret in a path are the caller's problem.

---

## Wiring a real backend

1. Write an `ErrorTransport` that posts an `ErrorEvent` to your collector, or
   maps it onto an SDK call.
2. Swap it into `pickTransport` in `src/app/observability/reporter.ts`. Nothing
   else changes — every consumer reads the reporter from context.
3. If you adopt a real SDK, turn **its** error-boundary integration and its own
   dedupe off. The double-reporting problem above is exactly what an SDK that
   also patches `componentDidCatch` reintroduces.

`beforeSend` is the hook for a team's own PII rules; returning `null` drops the
event. A throw inside it is treated as "no opinion" rather than "drop", so a
broken hook cannot silently disable reporting.

---

## Not done

- **No `window.onerror` / `unhandledrejection` handler.** Errors outside React
  — a listener registered by hand, a rejected promise nothing awaited — are not
  reported. React's three root hooks cover errors React knows about, and that
  is where this stops.
- **No sampling or rate limit beyond the dedupe window.** An app throwing in a
  `setInterval` will report once per window indefinitely. A real collector
  charges for that.
- **No source maps.** Stacks are reported as the browser gives them, which
  after minification means frames naming built chunks. Uploading a map to the
  backend is what makes them readable, and this repository has no upload step.
- **No session or user context.** `tags` carries route, kind, attempt, release
  and environment; nothing identifies who hit the error, which is deliberate
  here and is the first thing most teams add.
- **Errors caught by boundaries this app does not own** — a third-party
  component with its own boundary — go unreported. `onCaughtError` would see
  them, and wiring it is what causes the double-count above; catching both
  without doubling needs an identity marker this does not implement.
- **The reload guard is per tab.** `sessionStorage` deliberately, so it cannot
  outlive the tab and suppress a legitimate reload later. Two tabs open on a
  broken deploy each get their own reload.
