# Streaming Suspense boundaries

Where you put a `<Suspense>` boundary and where you start a request are two
different decisions. Conflating them is the reason so many Suspense pages feel
responsive and finish late.

The worked example is `/labs/streaming` (`StreamingLabPage`), which renders one
report — a header, a slow breakdown table, a quicker activity feed — under
every combination of the two.

## The two axes

|                                       | **`waterfall`** (each section starts its own request) | **`parallel`** (prefetched above the boundary) |
| ------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| **`flat`** (one boundary)             | 3 round trips in series. One long blank.              | 1 round trip. One long blank.                  |
| **`nested`** (a boundary per section) | 2 round trips. Progressive reveal.                    | 1 round trip. Progressive reveal.              |

Reading down a column shows what boundary placement buys; reading across a row
shows what prefetching buys. They are not substitutes for each other.

## What a boundary actually does

A boundary decides three things, and only the first two are about the screen.

**1. Reveal granularity.** Everything inside one boundary appears together,
when the slowest thing inside it is ready. Three boundaries turn one long blank
into three independent reveals.

**2. Blast radius.** Everything inside one boundary fails together. In the flat
layout a broken activity feed removes the header and the successfully-loaded
breakdown table from the page as well. That is the strongest everyday argument
for nesting.

**3. It fences a suspension.** This one is invisible on screen and shows up in
the network panel. When a component suspends, the render pass it was part of is
abandoned — the siblings after it never render, and a component that never
rendered has not requested anything. Under a single boundary the breakdown
suspending means the activity feed does not even ask for its data until the
breakdown has come back:

```
flat + waterfall:     summary → breakdown → activity      (three, in series)
nested + waterfall:   summary → breakdown ∥ activity      (two)
```

Same components, same data, same absent prefetch, one fewer round trip. This is
pinned by `StreamingReport.test.tsx` ("serialises sibling requests when they
share one boundary") rather than taken on trust, so a React upgrade that changes
it fails the suite instead of quietly changing the page's timing.

## What a boundary cannot do

No boundary placement starts a request before the boundary _above_ it has
resolved. The sections are `children` the page hands to `<ReportShell>`, and an
element is not a render: they cannot run until the shell commits, however many
boundaries they carry.

Crossing that line takes a prefetch, and it has to happen **above** the boundary
that would otherwise gate it:

```tsx
export function StreamingReport({ cache, boundaries, loading }) {
  if (loading === "parallel") {
    cache.prefetch("summary", "breakdown", "activity"); // above the boundary
  }

  return (
    <SectionBoundary name="report" fallback={<ReportShellSkeleton />}>
      <ReportShell cache={cache}>{sections}</ReportShell>
    </SectionBoundary>
  );
}
```

Calling `prefetch` inside `<ReportShell>` would be the same waterfall with extra
steps: that render is precisely the one being waited on. Calling it during
render is safe and deliberate — `prefetch` goes through the same per-section
entry `read` does, so StrictMode's double render and every re-render after it
start nothing twice.

## Reveal order is completion order

Sibling boundaries are independent, so sections appear in the order their data
arrives, not the order they appear in the markup. On `/labs/streaming` the
activity feed is second in the source and first on screen.

React 19 ships no stable way to hold a fast section back — `<SuspenseList>` is
still experimental and is not exported from `react`. If a page genuinely needs a
fixed reveal order, the way to get it is to put those sections in **one**
boundary and accept that they wait for each other. That is a real cost, and per
the fencing rule above it also serialises their requests unless they are
prefetched.

## Nested fallbacks are a sequence, not a stack

A nested fallback does not appear alongside the outer one. While the outer
boundary is showing its fallback, nothing inside it has rendered, so the inner
boundaries do not exist yet. The reveal is two stages:

1. the shell skeleton, alone;
2. the shell, with a skeleton per section;
3. each section, as its data lands.

This is why `ReportShellSkeleton` takes `children`. In the flat layout there are
no nested boundaries to supply section fallbacks, so they belong in the one
fallback that exists — otherwise the sections' space is simply blank for the
whole wait.

## Retrying

`SectionBoundary` pairs a `<Suspense>` with an error boundary, and the error
boundary has to be the **outer** of the two: a rejection unmounts anything
inside the boundary it escapes from, including an error boundary that was
supposed to catch it.

Resetting that boundary is not enough on its own. The section cache keeps
rejected promises deliberately (see `promiseCache.ts` for why dropping them
turns a visible error into an invisible hang), so a bare reset re-reads the same
rejected promise and rethrows in the same frame — a "Try again" button that
visibly does nothing. `onRetry` runs first and invalidates the entry, so the
reset renders against a fresh request.

## Testing this

Every claim on this page is a claim about a state _between two events_ — the
header is up and the breakdown is not; the activity feed has not been requested
yet. Reaching those states by choosing latencies far enough apart makes the test
a race against however loaded the machine is, and timers do not stop for jsdom.

So the tests state the ordering instead of arranging it. `createDeferredReportApi`
(`src/test/reportHarness.ts`) hands out requests that settle only when the test
says so:

```tsx
const api = createDeferredReportApi();
await renderAsync(<StreamingReport cache={createReportCache(api)} … />);

expect(api.requested()).toEqual(["summary"]);   // window is open indefinitely
await actAsync(() => api.resolve("summary"));
expect(api.requested()).toEqual(["summary", "breakdown", "activity"]);
```

Settling has to be awaited inside an act scope, since it is what pushes a
boundary out of its fallback. The initial render does too — see
`src/test/renderSuspense.tsx` for why a suspension inside a non-awaited `act`
scope strands its retry and leaves the fallback up until `waitFor` times out.

For assertions about overlap rather than order, `wereConcurrent(timeline, a, b)`
answers "were these two ever in flight at the same time" from the recorded event
sequence, with no timestamps involved.

## Files

| File                                               | What it is                                               |
| -------------------------------------------------- | -------------------------------------------------------- |
| `src/entities/report/sectionCache.ts`              | Typed multi-section promise cache, and `prefetch`        |
| `src/entities/report/reportApi.ts`                 | The demo service, its request timeline, `wereConcurrent` |
| `src/entities/report/reportCache.ts`               | Wires the service to the cache in one place              |
| `src/shared/ui/SectionBoundary.tsx`                | One streaming boundary: Suspense + error boundary        |
| `src/widgets/streaming-report/StreamingReport.tsx` | The report, assembled along both axes                    |
| `src/pages/streaming-lab/StreamingLabPage.tsx`     | `/labs/streaming`, with the live request timeline        |
| `src/test/reportHarness.ts`                        | Gated service for deterministic tests                    |
