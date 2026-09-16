# Request deduplication, cancellation and retry with jitter

Three behaviours that look like three features and are really one: what happens
to a request between the call site asking for it and the answer arriving. They
live together because they interact — a shared request cannot be cancelled by
one of its callers, and a retry that outlives every caller is a request nobody
is waiting for.

- `src/shared/lib/retrySchedule.ts` — the backoff arithmetic and `Retry-After`
- `src/shared/lib/abort.ts` — abort reasons, the abortable wait
- `src/shared/api/withRetry.ts` — the retry policy, as a decorator
- `src/shared/api/withDedupe.ts` — in-flight sharing, as a decorator
- `src/app/api/client.ts` — where the two are composed, in that order
- `src/shared/api/resilience.test.ts` — the composed stack over a real `fetch`

None of it is a new client. `ApiClient` is a five-verb interface
(`docs/dependency-inversion.md`), so a decorator that takes one and returns one
composes without anything below it knowing: the same components, the same stub
in tests, and a policy that can be swapped for one request or one test without
touching either end.

## Deduplication is not caching

The case is three components mounting in the same frame and each asking for
`/api/user`. A cache does not help: at the moment the second and third ask,
nothing has arrived yet, so there is nothing to hit. What is shared is not a
value, it is a **promise** — the window between "a request started" and "it
finished".

That window is also the whole lifetime of the entry. When the request settles,
the entry is deleted, whether it resolved or rejected. A `GET` a second later
goes to the network; freshness is TanStack Query's job, and an in-flight map
that outlived its request would be a second, invisible cache with its own
eviction rules and no way to invalidate it.

Subscribers resolve with the **same object**, not with copies. That matches
every cache in the application — TanStack Query hands one object to every
`useQuery` too — and carries the same rule: treat a response as immutable. A
caller that mutates what it gets back is mutating what the others got.

### Writes are not shared

Only `GET` is deduplicated by default. Two identical `POST /orders` calls are,
as far as a transport can tell, a user who clicked twice because they meant to.
Collapsing them silently discards one, and no layer this low has the standing to
decide that. Double-submit belongs to the form that owns the button.

### A request with custom headers opts out

The key has to name everything that can change the response, and headers can:
`Accept-Language`, `If-None-Match`, a tenant id. Rather than hash them into the
key — which invites the version of this bug where two requests with _equivalent_
headers spelled differently fail to share — `defaultDedupeKey` returns `null`
for any request carrying its own headers, and a `null` key means "never share
this one". The common case, a plain `GET` with the client's own `Authorization`,
is unaffected.

## Cancellation is why deduplication is hard

The naive in-flight map is four lines, and it breaks the moment any caller
passes an `AbortSignal`:

```ts
// Wrong, and wrong in the direction that is hardest to see.
const inFlight = new Map<string, Promise<unknown>>();
```

The first component unmounts, TanStack Query aborts its query, and the request
dies underneath two components that are still waiting for it. One caller's
cancellation, delivered to callers who never asked for one. The symptom is a
spinner that never resolves, on a component that did nothing wrong, in a
situation that only happens when two of them mount together.

So the shared request runs on an `AbortController` of its own and subscribers
are counted:

- a subscriber that aborts is **detached and rejected immediately**, and the
  shared request continues;
- when the **last** subscriber leaves, the shared controller is aborted and the
  underlying `fetch` is actually cancelled;
- a subscriber that passes **no signal never leaves**, which makes it exactly
  the right thing — one uncancellable caller keeps the request alive for
  everyone.

Two details are worth knowing because they are silent when wrong. An abort that
arrives _after_ the response must not abort anything: the entry it would reach
may already belong to a later request under the same key. And a shared request
whose subscribers have all gone has nobody left to observe its rejection, which
is an unhandled rejection — so the decorator keeps a `catch` of its own on the
shared promise.

### Each subscriber's promise is chained, not rebuilt

A subscriber's promise is `shared.promise.finally(…).then(…)` raced against its
own cancellation, rather than a `new Promise` that re-emits the outcome. A
rejection travels down a chain untouched, so the `catch` at the call site sees
the client's own `ApiError` — status, body and all — and not a copy of it.

## Retry, and why the jitter is the point

`withRetry` repeats a failed request on an exponential schedule with **full
jitter**: a uniform draw from `[0, min(cap, base × 2^attempt))`, defaulting to
250 ms doubling to a cap of 8 s, three retries.

Plain exponential backoff spaces one client's retries correctly and does nothing
about the problem that actually takes a backend down. When a service sheds load,
every client fails at the same instant and therefore retries at the same
instant, twice more at the same instant, and the recovery window is hit by the
same spike that caused the outage. Backoff without jitter preserves that
correlation exactly; it only stretches it out.

Drawing uniformly from the whole interval destroys the correlation: two clients
that failed in the same millisecond come back at two unrelated times. The
objection to it is that some retries land almost immediately, and the answer is
that the draw is uniform — the expected wait is still half the ceiling and the
aggregate rate across clients still halves per attempt. One unlucky client
retrying after 3 ms is not a load problem; ten thousand clients retrying after
exactly 250 ms is.

"Equal jitter" (half fixed, half random) is the usual compromise and a
defensible alternative. It is not what is used, because the floor it buys is
something a server can ask for directly, and this client honours the ask.

### What is retried

| Failure                  | Retried | Why                                                              |
| ------------------------ | ------- | ---------------------------------------------------------------- |
| `TypeError` from `fetch` | yes     | The request never got an answer: DNS, reset, offline mid-flight. |
| 408, 425, 429            | yes     | The status _is_ "try again".                                     |
| 5xx                      | yes     | The server may not repeat itself.                                |
| 4xx otherwise            | no      | Will fail identically forever.                                   |
| `AbortError`             | no      | The caller asked for this to stop.                               |
| Anything else            | no      | A bug or a rejected parse. Repeating it is noise.                |

`TypeError` is the imprecise one and it is worth saying out loud: a genuine
`TypeError` thrown by a bug inside a response handler is also retried. That
costs three repeats of a request that is already broken. Not retrying it would
drop the single most common transient failure there is.

### Only idempotent verbs

`GET`, `PUT` and `DELETE` by default. `POST` and `PATCH` are absent because a
retry is indistinguishable from a second request: a `POST /orders` that fails
with a socket hang-up may or may not have created an order, and the client
cannot tell which. Where an endpoint takes an idempotency key — the offline
queue stamps one, see `docs/offline.md` — repeating it _is_ safe, and that
caller opts in with `withRetry(client, { methods: ["POST"] })`.

### `Retry-After` overrides the schedule, up to a point

Only the server knows when its rate-limit window resets, so a `Retry-After`
replaces the local schedule rather than being combined with it. This is why
`ApiError` carries the response `Headers`: the status alone cannot say _when_.

A `Retry-After` longer than 30 s is treated as "do not retry" rather than as an
instruction to wait. A rate limiter answering `Retry-After: 3600` is not asking a
foreground request to hold a spinner for an hour; it is telling this client to
go away. Failing now surfaces that to the user, who can act on it.

### The wait is abortable

A retry decorator that waited with a plain `setTimeout` would hold a cancelled
request open for the length of its backoff — the user has navigated away, the
component has unmounted, and there are still 4 seconds of politeness to observe
before anything can notice. `sleepWithAbort` rejects the moment the signal
aborts, so the loop leaves with the cancellation instead of the failure.

## The order of the decorators

```ts
// src/app/api/client.ts
export const api = withDedupe(withRetry(createFetchApiClient({ … })));
```

Dedupe outermost. Swapping the two gives a different and worse client:

- **Retry inside** (this order): a shared request carries _one_ retry schedule
  for all of its subscribers. Five components asking for `/posts` while the
  server is failing cost four attempts in total.
- **Retry outside**: each caller runs its own retry loop over the shared layer,
  the first failure clears the in-flight entry, and every attempt after it is
  made separately. Five callers, twenty requests, against a server that has just
  said it is overloaded.

It also settles cancellation: the signal `withRetry` waits on is the shared
controller's, so a backoff ends when the last subscriber leaves.

## TanStack Query's `retry` is off

`app/api/queryClient.ts` sets `retry: false`, and that is a consequence of this
work rather than an unrelated change. Two retry layers multiply rather than add:
TanStack's 3 attempts over the transport's 4 is 12 requests for one failing
query, on a schedule neither layer fully controls, and the outer one cannot see
the `Retry-After` the inner one is honouring.

The transport keeps the policy because it is the layer every caller goes
through — RTK Query endpoints, router loaders and imperative calls never touch a
`QueryClient`.

The consequence to know about: **a `queryFn` that does not go through the
`ApiClient` now gets no retry unless it sets its own.** That is the right
default — a query built on `navigator.geolocation` or a third-party SDK has
failure modes this project knows nothing about — but it is a change from
"everything is retried twice", so a new non-`ApiClient` query should decide
deliberately.

## Known gaps

- **RTK Query's `fetchBaseQuery` is untouched.** `shared/api/baseApi.ts` builds
  its own transport and gets none of this. Endpoints defined on it retry through
  RTK's own `retry()` wrapper or not at all. Moving it onto the `ApiClient` is a
  separate change.
- **No circuit breaker.** Every request retries on its own evidence; nothing
  remembers that the last twenty all failed. For a server that is down rather
  than flaky, the fleet still pays four attempts per request.
- **The dedupe key does not include the access token.** Two requests made either
  side of a token refresh could, in principle, share one in-flight request. The
  window is the length of one request and the response is the same either way
  unless the endpoint varies by user; a `keyOf` can add the subject claim where
  that matters.
- **No request timeout.** A `fetch` that hangs forever hangs forever; nothing
  here imposes an upper bound. `AbortSignal.timeout()` at the call site is the
  per-request answer, and a default belongs in `createFetchApiClient` rather
  than in a retry policy.
