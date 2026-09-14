# Offline-first: a service worker, stale-while-revalidate, and a write queue

An application that fails on a dropped connection fails on a train, in a lift,
in a hospital basement, and on a phone whose signal came back two seconds after
the user pressed Save. None of those are edge cases; they are Tuesday. This is
what the repository does about it, what it deliberately does not do, and which
parts of it you will have to change for an application that is not this one.

- `src/app/sw/sw.ts` — the worker's entry point, and nothing but wiring
- `src/shared/offline/` — every strategy, policy and decision, with the tests
- `vite.sw.config.ts` + `tooling/serviceWorker/` — the second build that emits
  `/sw.js` and the precache list it carries
- `src/features/offline/` — what the user sees
- `e2e/offline.spec.ts` — the half only a real browser can prove

## What a user gets

| Situation                              | What happens                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Second visit, no network               | The application opens. Shell, scripts and stylesheet come from the precache.                          |
| Offline, navigating to a visited route | Works. The route chunk was cached when they first went there.                                         |
| Offline, navigating to a new route     | The shell renders; the route chunk is missing and its boundary reports it.                            |
| Offline, reading data                  | The last response for that URL, immediately. Nothing stored means a `503` the application can handle. |
| Offline, writing                       | Queued, with a `202` and a visible count. Sent when the network returns.                              |
| Back online                            | The page tells the worker to replay, oldest write first.                                              |
| A new build deployed                   | Announced, not applied: "a new version is ready — reload".                                            |

## Registration, and where it does not happen

`src/app/main.tsx` starts offline support only in a production build. Two
reasons, either sufficient:

- `/sw.js` is emitted by a **second Vite build** and does not exist under
  `vite dev`, so registering there is a guaranteed 404.
- MSW's worker occupies the same scope in development. A scope holds one
  worker, so registering ours would silently replace the one answering every
  mocked request.

`VITE_DISABLE_SW=true` turns it off in a production build. Use it for preview
deployments, where a worker installed from a branch outlives the branch.

Registration is progressive enhancement throughout: `getServiceWorkerContainer()`
returns `null` in a private Firefox window, on a plain-HTTP origin and in jsdom,
and a failed `register()` is reported and swallowed. The application works
without any of this, online and slower.

## What is precached, and what is not

The precache is **exactly the initial graph**: the entry chunk, everything it
statically imports, the stylesheets those pull in, and `index.html`. That is the
set the browser blocks on for a first render, which makes it the set that has to
be present for the application to open at all.

It is computed at build time by `tooling/serviceWorker/precacheManifest.ts`,
which reuses the graph walk from `tooling/bundleBudget/graph.ts` — deliberately,
so the budget and the worker cannot disagree about what "the initial graph"
means.

The twenty-odd lazy route chunks are **not** precached. Precaching them would
make the first visit download the whole application before it was usable, to
insure against a case the runtime cache already covers for every route the user
has actually been to. The visible consequence is in the table above, and it is
the one thing about this design a user can notice.

## The cache layout

Two caches, and the split matters:

- `boilerplate-react-ts-precache-<buildId>` — this build's own assets. The build
  id is in the **name**, so a deploy cannot half-apply: the new precache is
  invisible until it is complete, and the old one keeps working until the moment
  it is replaced. `activate` deletes every cache of ours that the current build
  does not use, and only ours — `caches` belongs to the origin, and something
  else may be living on it.
- `boilerplate-react-ts-runtime-v1` — API reads, lazy chunks, anything fetched at
  runtime. Not keyed by build, because its contents are not invalidated by a
  deploy. Capped at 60 entries, evicted oldest-first, because `Cache.keys()`
  returns insertion order and the Cache API offers no timestamps. It is a worse
  policy than LRU and a much smaller amount of machinery, and what it has to
  prevent is unbounded growth rather than a poor hit rate.

The build id is a hash of the URL list plus the shell's contents. A rebuild that
changes nothing reuses the cache; a rebuild that changes one chunk gets a new
one. A timestamp would invalidate a correct cache on every deploy, and a commit
SHA would fail to invalidate an incorrect one when a dependency bump changed the
assets without changing the commit.

## The routing table

`src/shared/offline/routing.ts` maps one request to one strategy, and the order
of its branches is the design:

| Request                                                | Strategy               |
| ------------------------------------------------------ | ---------------------- |
| Same-origin `POST`/`PUT`/`PATCH`/`DELETE` under `/api` | Send, or queue         |
| Navigation                                             | Cached app shell       |
| A precached asset                                      | Cache-first            |
| Any other same-origin `GET`                            | Stale-while-revalidate |
| Cross-origin, `HEAD`, ranged, unparseable              | Not handled at all     |

`passthrough` is the widest branch on purpose. Every other value commits the
worker to producing a `Response`, and a worker that answers a request it does
not understand has taken something the browser handled correctly and made it
this code's problem — failure modes included, now with no network stack
underneath to explain them.

Three of the exclusions are worth stating, because each is a bug in the obvious
version:

- **Cross-origin `GET`.** Without CORS the response is opaque: status `0`,
  headers empty, indistinguishable from a failure, and padded to a multiple of
  32MB against the origin's storage quota. Caching one is how a worker fills a
  user's disk with a 404 it cannot read.
- **Ranged requests.** `Cache.put` rejects a `206`, and answering from a whole
  cached body returns more bytes than were asked for — which is how a `<video>`
  that seeks stops playing.
- **Navigation detection reads `mode` _and_ `destination`.** Safari reported
  `mode: "navigate"` on the main resource only, for years. The two agree in
  current engines and disagree on exactly the browser that needs the shell most.

## Stale-while-revalidate is a trade, not a default

The cached response is returned without waiting for the network; the network
result updates the cache for next time. The user sees the last-known answer
immediately and the fresh one on their next visit to the view.

That is right for a feed, a profile, a report. It is **wrong for a balance, a
stock level, a price, or anything a user will act on financially** — showing a
number that was true five minutes ago, with no indication it is old, is worse
than showing a spinner. The strategy cannot tell those apart. The routing table
can: give such endpoints their own branch returning `passthrough`, and they will
behave exactly as they did before this feature existed.

`no-store` is honoured, and is the mechanism for saying so from the server: it
is the one cache directive that is a prohibition rather than a freshness hint,
and a cache that ignores it leaks one user's data to the next person on the
device. `no-cache` is deliberately _not_ treated as "do not store" — it means
"revalidate before use", which is what this strategy does.

## The write queue

A write that fails because there is no network is stored in IndexedDB and sent
later. The page gets `202 Accepted` with an `x-offline-queued: 1` header.

**`202`, not `200`, and not a rethrown error.** The request is valid, it has
been accepted for processing, and the processing has not happened. A `200` tells
optimistic UI the write succeeded and leaves the user with a receipt for
something that may never be sent; rethrowing tells them it failed while the
worker quietly sends it anyway. Application code still has to handle it: a `202`
here means _pending_, and the interface should say so rather than claiming a
save.

**Only a thrown `fetch` queues.** A response — any response, including a `500` —
means the server was reached and had an opinion. The line the worker can draw
without knowing what an endpoint means is "did this request get an answer", not
"was the answer good".

**An idempotency key is stamped once, at enqueue time.** A replayed request is by
definition one whose response was never seen: the bytes may well have arrived. A
key generated per attempt would buy nothing; the same key on every attempt is
what lets the server recognise the duplicate. **This only works against an API
that honours `Idempotency-Key`.** If yours does not, that is the thing to fix
before turning queueing on for endpoints that are not naturally idempotent — a
`PUT` of a whole resource is safe to replay, a `POST` that appends is not.

**Replay is FIFO and stops at the first failure.** These are writes by one user
against one API, issued in an order they meant: a `PATCH` that renames a report
and a `DELETE` that removes it do not commute. Skipping a failed entry to send a
later one is how a queue produces a server state that never existed on the
client. The cost is head-of-line blocking, which is why the policy has both an
attempt limit (5, with exponential backoff, `Retry-After` honoured over it) and
an age limit (24 hours): the head is always eventually dropped.

An entry leaves the queue in one of four ways, and they mean different things:

| Outcome     | Cause                      | What it means                                                            |
| ----------- | -------------------------- | ------------------------------------------------------------------------ |
| `sent`      | 2xx                        | Done.                                                                    |
| `rejected`  | 4xx other than 408/425/429 | The server understood and refused. Retrying only takes longer to say so. |
| `exhausted` | Five failed attempts       | Never delivered.                                                         |
| `expired`   | Older than 24 hours        | Never delivered, and no longer worth delivering.                         |

The last two are the ones that need surfacing: they are the cases where the user
believes something was saved and nothing was. `QUEUE_REPLAYED` carries the
dropped count to every open page for exactly that reason.

### Why IndexedDB

A service worker is terminated whenever the browser judges it idle and started
again by an event — possibly hours later, with no page open. In-memory state
does not survive that. `localStorage` is not available in a worker at all (it is
synchronous). The Cache API could hold the requests but not their attempt
counts, and a queue whose retry state lives elsewhere replays from zero after
every restart.

Rows are validated on the way out. The database outlives the code that wrote it:
a user who opens the application after a deploy may hold rows shaped by an older
build, and an unvalidated read is a `TypeError` inside a `sync` event, where
nothing is watching and the whole queue stops.

### Background Sync is a hint, not the mechanism

`registration.sync.register()` is best-effort: it is unimplemented in Safari and
Firefox, and refused in Chromium when the user has blocked background
synchronisation. Where it works, the browser wakes the worker when connectivity
returns — including after the tab is closed, which nothing else can do.

Where it does not, the queue drains because **the page asks**: `offlineClient`
listens for `online` and posts `REPLAY_QUEUE`. That path exists in every browser
and is the one `e2e/offline.spec.ts` drives.

## Updates

A new worker installs while the old one still controls every open tab, and stays
`waiting` until all of them close — which, for an application people leave open,
is never. The update path is three pieces:

1. `registerServiceWorker` notices the waiting worker — both the one that
   installs while the page is open and the one left over from a previous visit,
   which is the commoner case in practice.
2. The banner offers a reload. Nothing is applied automatically: taking an
   update means reloading, and a reload the user did not ask for can discard
   what they were typing.
3. On "reload", the page posts `SKIP_WAITING`, the new worker calls
   `skipWaiting()` and `clients.claim()`, and `controllerchange` triggers one
   reload.

Two guards on that last step, each a bug without it:

- **Only reload if the page was already controlled.** `clients.claim()` takes
  control of the page that caused the _first_ install, and that is a
  `controllerchange` too. Reloading on it makes every first visit reload itself
  once, halfway through rendering. `e2e/offline.spec.ts` found this the hard way
  — by failing to evaluate anything in a page that kept navigating out from
  under it.
- **Reload at most once.** A reload can produce another `controllerchange`, and
  the result is a tab that flashes forever.

`updateViaCache: "none"` is what makes updates visible at all. By default the
browser may serve `sw.js` from the HTTP cache, so a worker behind a CDN's
year-long `Cache-Control` can pin an application to one build for as long as
that header says.

## How it is built

`pnpm build` runs two Vite builds:

```
tsc -b && vite build && vite build --config vite.sw.config.ts
```

The worker is a second program and needs three things the application build
cannot give it at the same time:

- **An unhashed filename at the root.** A worker's scope is capped by the
  directory it is served from, so `/assets/sw-B4kQ1x.js` could only control
  `/assets/`. It has to be `/sw.js` — which is also what lets the browser
  recognise an update as an update rather than as a different worker.
- **Not an ES module.** `type: "module"` workers are supported in current
  engines and fail outright on one that is not, and there is nothing to gain:
  the worker is one self-contained bundle either way.
- **The application build to already exist**, because what it precaches is that
  build's hashed output. `readPrecachePlan` throws rather than emitting a worker
  with an empty precache — a worker that installs, activates, controls every
  page and serves nothing offline is a feature switched off with no error
  anywhere.

`sw.js` is ~3.6kB gzipped and lands in the bundle budget's `unattributed`
bucket, along with the CSV worker and `mockServiceWorker.js`, because Vite's
manifest cannot see any of them.

## Why no Workbox

Workbox is good, and this is a repository whose point is that the mechanism is
readable. What it would have added here is a build plugin, a runtime dependency,
and a layer of configuration between a bug and its cause; what it would have
saved is about four hundred lines that are each about one decision. For an
application with a large surface — background sync with its own retry
semantics, precache manifests across several entry points, navigation
preload — that trade goes the other way, and `workbox-build` is the right
answer.

## Types, and the one cast

`lib.webworker.d.ts` has every type the worker needs and this project cannot
have it: `tsconfig.json` compiles against `DOM`, and adding `WebWorker` does not
add worker types alongside the DOM ones, it redefines `self`, `addEventListener`
and about thirty other names for every file in the program. A second tsconfig
for one directory costs a second ESLint project and a second `tsc -b` node.

So `src/shared/offline/swScope.ts` writes out the subset the worker actually
uses, and `sw.ts` asserts `globalThis` to it once.
`src/shared/workers/csvParser.worker.ts` makes the same trade for a dedicated
worker. The cost is real and worth naming: those declarations are not checked
against the platform, so if the subset is wrong the type checker will agree with
it. That is why it stays a subset, and why `e2e/offline.spec.ts` runs the result
in a real browser.

## Testing

Unit tests cover every strategy, the routing table, the replay policy and the
queue's storage — against a `Map`-backed cache, a `fetch` that rejects on
demand, and `fake-indexeddb` for the real IndexedDB adapter. `sw.ts` itself is
excluded from coverage, on the same grounds as `main.tsx`, and earns it by
holding no decisions.

`e2e/offline.spec.ts` runs the worker in Chromium against a preview of a real
build: it installs, takes control, opens the application with the network cut,
answers a navigation to a route that has no file behind it, queues a write, and
drains that queue when the network returns. The replayed write is answered by
`e2e/offlineApiServer.ts` — a real server, because a replayed write is issued by
the worker after the page may be gone, and `page.route` never sees it.

## Known gaps

- **A route the user has not visited does not work offline.** Discussed above;
  the fix, if you need it, is to add specific route chunks to `extraUrls` in the
  precache plan, at the cost of a slower first visit.
- **The queue is not bound in size.** Only in age and attempts. A user who
  writes continuously for an hour offline will accumulate an hour of writes, and
  a per-user cap belongs here if your writes are large.
- **Nothing reconciles a dropped write with the user's own view.** The banner
  says how many were abandoned; it does not say which, and the application's
  cache still shows the optimistic result. Wiring `QUEUE_REPLAYED`'s dropped
  count into a TanStack Query invalidation is the obvious next step and is
  deliberately not done here, because what it should invalidate depends on the
  application.
- **Bodies are stored as bytes, headers as pairs.** A `Request` carrying a
  `ReadableStream` body cannot be queued; nothing in this application makes one.
- **`sync` rejection semantics are the browser's.** When Background Sync does
  fire and the queue is still not empty, the handler rejects to ask for another
  attempt; how many of those a browser grants is not specified and not
  observable from here.
