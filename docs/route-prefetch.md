# Route-level prefetch on hover and viewport, with an idle-time budget

Every route below `/` is a `React.lazy` chunk, so the first thing a click does
is start a download. Prefetching moves that download earlier — to the moment
the pointer settles on the link, or the moment the link comes into view — and
the entire difficulty is doing it without spending anything the user is
currently using. This is the part that is easy to get wrong quietly: a
prefetcher that fires too eagerly still works, still passes every test, and
costs a frame or a megabyte you will not see in development.

- `src/shared/lib/idlePrefetchQueue.ts` — the queue and the budget
- `src/shared/lib/dataSaver.ts` — the "do not spend my data" check
- `src/features/route-prefetch/` — the React seam: provider, hook, triggers
- `src/widgets/layout/PrefetchNavLink.tsx` — the link the nav uses
- `src/app/router/routeChunks.ts` — the one registry both consumers share
- `/labs/prefetch` — the live queue, plus a link below the fold

## Start here: React Router's own `prefetch` prop does nothing

`<NavLink prefetch="intent">` is in the types, and in this app it is inert.
`usePrefetchBehavior` reads `FrameworkContext` and returns early when there is
none:

```js
if (!frameworkContext) {
  return [false, ref, {}];
}
```

`FrameworkContext` is provided by the framework's `HydratedRouter`. This app
uses `createBrowserRouter` + `<RouterProvider>` — library mode — so there is no
such context, no handlers are returned, and `shouldPrefetch` is permanently
`false`. Even where it is live, what it does is render
`<link rel="prefetch">` tags for route module and data URLs read out of the
build manifest, and library mode has no manifest either.

Nothing warns about this. The prop type-checks, the app works, and the chunk
downloads on click exactly as it did before. `PrefetchNavLink` therefore
`Omit`s `prefetch` from its props and calls its own prop `prefetchOn`, so that
passing the inert one is a type error rather than a no-op.

## The idle budget

### `timeRemaining()` is a gate, not a budget

The obvious loop subtracts an estimated cost from `deadline.timeRemaining()`
and keeps dispatching until the estimate runs out. It cannot work here. The
work a prefetch causes is an `import()`, and `import()` **returns
immediately** — the network round trip, the parse and the module evaluation all
happen after the idle callback has returned, on a deadline that no longer
exists.

So `timeRemaining()` never decreases in response to anything the queue does. It
reports the same 45ms after five dispatches as before the first, and a loop
that trusts it will empty the queue in a single callback and put every chunk on
the wire at once — the exact network contention the idle callback was there to
avoid, reached through the API that exists to prevent it.

The budget that actually bounds anything is a count:

| Knob          | Default | What it bounds                     |
| ------------- | ------- | ---------------------------------- |
| `maxPerIdle`  | 2       | dispatches from one idle callback  |
| `maxInFlight` | 2       | chunk requests on the wire at once |
| `minIdleMs`   | 8       | slack required _before_ a dispatch |

`minIdleMs` keeps its job, which is the real one: a gate on "is now a calm
moment to start one". Below it the callback dispatches nothing and asks to be
woken again.

`idlePrefetchQueue.test.ts` pins this with a deadline that reports a constant
50ms and is never decremented. Four entries are queued; two are dispatched.

### No `timeout` option

`requestIdleCallback(cb, { timeout })` guarantees the callback runs _even if
the browser never goes idle_. For a speculative fetch that is precisely the
wrong guarantee: it turns "do this if it is free" into "do this, and if it is
not free, do it anyway during a busy frame". A route the user may never visit
is not worth one dropped frame.

So no timeout is passed, and on a permanently busy page nothing is prefetched
at all. That is the intended outcome, not a stall.

### When `requestIdleCallback` is missing

Absent in Safari before 16.4 and in jsdom. The fallback is
`setTimeout(…, 150)`, not `setTimeout(…, 0)`: zero would run the batch in the
very next task, competing with whatever input handling made the page busy in
the first place — an idle scheduler that is never idle. The fallback deadline
reports a flat 10ms, which is an assertion rather than a measurement, kept just
above `minIdleMs` so the gate passes.

The handle comes from `win.setTimeout` rather than the bare global: with
`@types/node` in the project, plain `setTimeout` is typed to return a `Timeout`
object instead of the `number` an `IdleScheduler` handle is.

## The queue is activated, not disposed

`createPrefetchQueue` returns an **inactive** queue: it accepts requests and
schedules nothing until `activate()` is called, and `activate()` returns the
function that stops it again. The provider's effect is one line —
`useEffect(() => queue.activate(), [queue])`.

The obvious shape is a `dispose()` called from the effect's cleanup, and it is
broken in development only. React StrictMode mounts, runs effects, runs their
cleanups, and mounts again — so a queue torn down by an unmount cleanup is torn
down on the very first commit and never revived. Nothing throws. Hovering a
link still calls `request`, the entry still queues, `schedule()` returns early
forever, and the app is indistinguishable from one where prefetching works and
the browser is simply never idle.

That is not hypothetical: it is what the first version of this feature did, and
what `e2e/route-prefetch.spec.ts` caught after the unit suite had gone green —
the unit tests mounted the provider without StrictMode, so they saw the queue
work. Deactivation is therefore reversible, and keeps both the queue and the
`loaded` set: the second mount picks up the same queue including everything the
first one had already fetched. Two tests pin it — one wrapping the provider in
`<StrictMode>`, one cycling the queue directly.

The inactive-until-activated start has a second, smaller payoff: a link can
request during the render pass, before the provider's effect has run, and those
entries wait rather than being dropped.

## Hover is a dwell, not an event

`onPointerEnter` requests after ~65ms of the pointer resting on the link.
Without the dwell, a pointer crossing a nav bar on its way somewhere else
enters and leaves every item in it, and each of those is a chunk bought with a
gesture that meant nothing. 65ms is comfortably shorter than the ~200ms it
takes to notice a link and press it, so a real hover still starts the fetch
well before the click.

`onFocus` and `onTouchStart` request **immediately**, with no dwell:

- a keyboard user who has tabbed to a link is at it; there is no hover to
  measure;
- touch produces no hover at all — the pointer events fire as part of the tap,
  a few milliseconds ahead of the click, so a dwell would spend the entire
  window it had.

Leaving the link calls `cancel`, which **only unqueues**. A dispatched
`import()` cannot be aborted — the module loader has no abort signal, and the
bytes are already moving. The dwell is what does the real work of not fetching;
`cancel` covers the window between the timer firing and the browser going idle.

## Viewport is the weaker signal

A link scrolling into view is a guess, not a commitment, so viewport requests
queue _behind_ every hover. A route already queued as a guess and then hovered
is promoted rather than queued twice.

The observer's root is `null` — the viewport — with a 200px `rootMargin`. That
is not interchangeable with passing a scroll container: the margin grows _the
root's_ box, so it has to be the box the link is approaching. See
`docs/windowed-infinite-scroll.md` for the version of this mistake that costs
a page load.

`prefetchOn="hover"` constructs **no** `IntersectionObserver`. The hook is
still called — hooks cannot be conditional — but it is handed a no-op ref
instead of the real one, and `useIntersection` only observes once it has a
node. A nav of hover-only links therefore carries no observers at all.

## One registry, two consumers

`React.lazy` exposes no `preload`. A prefetcher therefore has to issue an
`import()` of its own, and if it writes that specifier itself, nothing
connects the two. Rename a page and the router follows it while the prefetcher
keeps warming a module nothing renders: no type error (the string still
resolves), no failing test, no visible symptom.

`src/app/router/routeChunks.ts` is the single source. The router builds its
`lazy()` components from those thunks and `<RoutePrefetchProvider>` prefetches
through the same ones, so the two are the same expression by construction.
`routeChunks.test.ts` additionally checks that every entry in `ROUTES` has a
loader — a missing one is invisible, because the queue correctly drops hrefs it
has no loader for (not every link points at a lazy route).

The registry lives in `app/` because `fsd/layer-imports` checks dynamic
`import()` too: `@/pages/…` may only be named from the composition root. It is
handed down to the provider as a prop, which is the same dependency-inversion
seam as `ApiClientProvider` — and the reason a test can register a loader it
watches instead of a real chunk.

## Failures

A rejected prefetch is **forgotten, not remembered as loaded**, so a transient
failure is retried on the next hover, and the real navigation — which goes
through `lazy()`, never through this queue — is unaffected either way.

Attempts are capped at 2. Without the cap, a chunk that is genuinely gone (the
usual cause being a redeploy that renamed it under an open tab) would be
re-requested on every hover for the life of the tab.

The rejection is handled by supplying both arms of `.then`, so a speculative
fetch that failed never reaches `window.onunhandledrejection` and never gets
reported as a page error.

## Respecting the user's data

`prefersReducedData()` is consulted on **every** request, not once at mount, so
a phone moving from wifi to a metered cell connection stops prefetching without
the tree remounting. It reads two Chromium-only signals:

- `navigator.connection.saveData` — an explicit request;
- `navigator.connection.effectiveType` of `2g` or `slow-2g`, where a prefetch
  takes bandwidth from the request the user is actually waiting on.

`3g` is deliberately allowed. It is the modal connection in much of the world,
and it is where arriving with the chunk already fetched helps most.

Neither field exists in Firefox or Safari. Absent means _no preference
expressed_, so the answer is `false` — defaulting to "reduce" would silently
disable prefetching in two engines out of three and look exactly like the
feature being broken.

## Testing

jsdom implements neither `requestIdleCallback` nor `IntersectionObserver`, so
both are seams:

- `src/test/prefetch.ts` — a manual scheduler that lets a test say when the
  browser goes idle _and_ how much slack it reports, plus a registry of loaders
  it settles by hand. Its `flush()` snapshots the waiting callbacks first: a
  callback that dispatches schedules the next one synchronously, and running
  that in the same flush would let one call drain the whole queue, hiding the
  budget behind the harness.
- `src/test/intersection.ts` — the existing observer harness.

`e2e/route-prefetch.spec.ts` carries what a harness cannot: that a hover
produces a real request for the destination's module, that a sweep across the
nav produces none, and that a link below the fold is fetched from scrolling
alone.

## Not done

- **No `<link rel="modulepreload">`.** The queue issues `import()`, which
  fetches _and evaluates_. A preload link would fetch without evaluating,
  which is cheaper on the main thread and would need the built chunk URLs —
  i.e. a manifest, which library mode does not have.
- **No data prefetching.** These routes have no loaders; only the code is
  warmed. A route that fetched on mount would still fetch on arrival.
- **No `prefers-reduced-data` media query.** It is behind a flag in Chromium
  and unimplemented elsewhere; `saveData` is the signal that actually ships.
- **The queue is not persisted.** It lives as long as the shell, which is the
  whole session in a SPA, but a full reload starts empty.
