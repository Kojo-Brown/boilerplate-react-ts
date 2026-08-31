# Windowed infinite scroll

Two techniques that are ordinary on their own, and awkward together.

**Windowing** renders only the rows in view, so a 5,000-row feed costs the same
DOM as a 20-row one. **Infinite scroll** loads the next page as the user nears
the end. Put them together and the second one's usual implementation stops
working, quietly.

The pieces:

| Module                                          | Responsibility                                    |
| ----------------------------------------------- | ------------------------------------------------- |
| `shared/hooks/useIntersection.ts`               | Observe one element, report whether it intersects |
| `shared/ui/performance/VirtualInfiniteList.tsx` | Windowing, the sentinel, and when to ask for more |
| `entities/post/infiniteFeed.ts`                 | The cursor-paginated request and page flattening  |
| `entities/post/useInfiniteFeed.ts`              | `useInfiniteQuery` over the above                 |
| `entities/post/InfiniteFeed.tsx`                | The two composed                                  |
| `/labs/infinite-scroll`                         | Both prefetch distances, side by side             |

## The sentinel cannot live among the rows

The standard infinite-scroll sentinel is an element rendered after the last
row. An `IntersectionObserver` watches it; when it comes into view, fetch.

Under virtualization the last row is not in the DOM. That is the entire point
of virtualization. A sentinel rendered as part of the row list therefore does
not exist to be observed until the user has already scrolled to where it would
be — at which moment there is nothing left to prefetch, because they have
arrived.

What a virtualized list does have is a **spacer**: one element as tall as the
whole scroll range, holding absolutely-positioned rows. The sentinel goes
_after the spacer_, where it is:

- always mounted, from the first render, whatever the scroll position;
- exactly at the end of the scroll range, with no arithmetic;
- 1px tall, so it contributes nothing to that range.

```tsx
<div ref={setScrollElement} style={{ height }} className="overflow-y-auto">
  <div role="list" style={{ height: virtualizer.getTotalSize() }} className="relative">
    {/* absolutely positioned rows */}
  </div>
  {hasNextPage && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
</div>
```

Distance ahead of the end then comes from `rootMargin`, which moves the trip
point without moving the element.

## The root must be the scroll container

```ts
useIntersection({ root: scrollElement, rootMargin: `0px 0px ${prefetchMargin}px 0px` });
```

`rootMargin` grows **the root's** box. Leave `root` as the default and the root
is the viewport, so a bottom margin asks "how far past the browser window is
this sentinel" — a question that never comes true for an element clipped inside
a 480px-tall inner scroller. The observer still fires, just at the moment the
sentinel enters the container, with the margin having bought nothing.

The failure is invisible in every way that matters. Nothing throws, nothing
logs, the list still loads more, and on a fast connection it still looks
instant. Only on a slow one does the spinner reappear, and by then the cause is
three abstractions away.

`VirtualInfiniteList.test.tsx` pins the root and the margin; the geometry —
that the eager arm fetches 400px short of the end and the zero-margin arm at
the same position does not — is in `e2e/windowed-infinite-scroll.spec.ts`,
because jsdom has no layout to measure.

## The element has to be state, not a ref

`useIntersection` holds the observed node in `useState`, and the scroll
container is held the same way:

```ts
const [node, setNode] = useState<T | null>(null);
useEffect(() => {
  if (node === null) return;
  /* observe */
}, [node, root, rootMargin, threshold]);
return { ref: setNode, isIntersecting };
```

The obvious alternative is a `useRef` read inside an effect. That effect runs
once, after the first commit — and the sentinel is generally not rendered on
that pass, because there is no `hasNextPage` until the first query resolves. So
`ref.current` is `null`, the effect returns early, and nothing re-runs it: a
ref assignment does not schedule a render, so the element's _arrival_ is not an
event React can react to. The observer is never created. The list loads its
first page, scrolls perfectly, and never loads a second.

Holding the node in state makes its arrival a render and the effect's
dependency on it makes attaching automatic. The same argument applies to the
scroll container, which two consumers wait for — the virtualizer and the
observer's root.

## The stall: intersection is state, not an event

This is the subtle one, and it is why `useIntersection` returns a boolean
rather than taking an `onEnter` callback.

`IntersectionObserver` reports **transitions**. Consider a page that is shorter
than the prefetch margin — a 5-row page against a 600px margin, or simply the
last few pages of most feeds. The sequence is:

1. The sentinel enters the margin. Callback fires. Fetch starts.
2. The page arrives. Rows are appended, the spacer grows by less than the
   margin, and the sentinel is **still inside it**.
3. No boundary was crossed, so no callback fires.

Loading stops. The user is looking at a list that has more to give, sitting
idle, and the only way out is a scroll gesture they have no reason to make. A
callback-driven implementation cannot see step 3, because nothing happened.

Driving the fetch from an effect over the _state_ fixes it, because the effect
has other dependencies:

```ts
useEffect(() => {
  if (isIntersecting && hasNextPage && !isFetchingNextPage) loadMore();
}, [isIntersecting, hasNextPage, isFetchingNextPage, loadMore]);
```

`isIntersecting` never changed, but `isFetchingNextPage` went `true → false`,
which re-runs the effect and continues the chain.

The chain does not run away. It stops when the loaded rows are taller than the
window plus the margin, because at that point the sentinel really is out of
range and there is nothing left to prefetch until the user moves — which is the
difference between stopping for a reason and not stopping at all. Against
five-row pages and a 600px margin, that is five pages in and then quiet, with
the next scroll picking it straight back up.

Both halves are pinned, and both were checked against the failure they name.
`VirtualInfiniteList.test.tsx` re-renders with the page landed and no new
intersection, and expects a second call; removing `isFetchingNextPage` from the
dependency array fails it. The E2E spec loads that 40-row feed without a scroll
gesture and expects at least four pages; the same edit takes it to exactly two
— the first page, and the one page the single transition bought.

`onLoadMore` goes through `useStableCallback` for the same reason the effect
exists: the effect depends on it, so an inline `onLoadMore={() => fetchNextPage()}`
would re-run it on every commit and turn one prefetch into a fetch per render.

## Keys are per item, never per index

`VirtualInfiniteList` requires `getItemKey`. It is not defaulted to the index,
because the virtualizer caches a measured height _per key_. With index keys
that cache is a claim about positions rather than rows: correct while pages
only ever append, wrong the moment anything is prepended, filtered or removed,
and wrong in the way hardest to notice — rows inherit their old neighbours'
heights and the scroll range is off by the difference.

`flattenFeedPages` de-duplicates by `id` for the other half of the same
problem. A cursor is a position in a feed that is still being written to, so an
insert between two requests re-serves the row that was last on the previous
page. Two rows sharing an id is a duplicate React key, which React reports, and
a duplicate virtualizer key, which nothing reports: two indices reading and
writing one cache entry.

## Cursors, not offsets

```
GET /feed?limit=50          → { items, nextCursor: "50", total: 5000 }
GET /feed?cursor=50&limit=50 → { items, nextCursor: "100", total: 5000 }
…
GET /feed?cursor=4950&limit=50 → { items, nextCursor: null, total: 5000 }
```

`nextCursor: null` is how the server says there is no more; TanStack Query
reads that as `hasNextPage === false`, which unmounts the sentinel and
disconnects the observer.

An offset (`?page=3`) would work for a static list and is wrong for a feed:
rows inserted while the user scrolls shift every offset after them, so the same
row is served twice or skipped. The cursor is opaque to the client by contract
— `useInfiniteFeed` only echoes it back — which is what lets it be an index in
the mock server and a keyset predicate against a real database without the
client changing.

## What is not tested where

jsdom implements neither `IntersectionObserver` nor `ResizeObserver`, and has
no layout for either to report on. That is a hard boundary, not an
inconvenience:

- **Unit tests** use `src/test/intersection.ts` (records what each observer was
  constructed with; the test says what the answer is) and
  `src/test/virtualizerMock.ts` (a fixed window over the item list). They pin
  every decision that is not geometric: which rows were rendered, what key they
  got, which root and margin the observer was given, and when the next page was
  requested.
- **E2E** owns everything geometric: the DOM row count staying flat across 300+
  loaded rows, the scroll range covering the whole dataset, and the two
  prefetch distances behaving differently at the identical scroll position.

`useIntersection` deliberately does not feature-detect `IntersectionObserver`.
A fallback reporting "never intersecting" would convert a missing API into
exactly the silent never-loads this design is written to avoid; a unit test
that forgets the harness fails loudly instead of passing vacuously.

## Not done

- **Scroll restoration.** Returning to the feed re-runs from page one. Doing it
  properly needs the cursor _and_ the scroll offset persisted, and a
  virtualizer told to skip to an index before its rows have been measured.
- **Prepending.** The feed only grows at the end. New rows arriving at the top
  need scroll anchoring, or the user's position jumps by the height of whatever
  was inserted above them.
- **`useInfiniteFeed` never drops pages.** Memory grows with the number of rows
  loaded even though the DOM does not. TanStack Query's `maxPages` would bound
  it, at the cost of re-fetching on scroll-up.
