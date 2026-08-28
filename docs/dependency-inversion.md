# Dependency inversion: swapping the API client

**Contract:** `src/shared/api/apiClient.ts`
**Implementation:** `src/shared/api/createFetchApiClient.ts`
**Test double:** `src/shared/api/createStubApiClient.ts`
**Seam:** `src/shared/api/apiClientContext.ts`, `src/shared/api/ApiClientProvider.tsx`
**Composition root:** `src/app/api/client.ts`, `src/app/api/storeSession.ts`, `src/app/main.tsx`
**Lab:** `/labs/dependency-inversion`

A component that fetches has to get its client from somewhere. Importing one is
the obvious answer and the one that ends the discussion — the client is now part
of the component, and every host that wants different behaviour has to intercept
something lower down: a service worker, a patched global, a module mock. This
document is about the other answer.

## What was wrong with the old client

`src/app/api/client.ts` used to be the client itself, and it imported two
singletons to do its job:

```ts
import { store } from "@/app/store";
const currentToken = store.getState().auth.token;
// …
store.dispatch(logout());
```

Three separate problems, none of them stylistic:

1. **Nothing below `app/` could use it.** `app` is the top layer, and an entity
   or feature importing upward is a lint error (`docs/feature-sliced-design.md`).
   The client was unreachable from every module that would want it. That is why
   it had no callers at all.
2. **No test could reach the refresh path** without mutating global store state,
   because "which token do I attach" was a question only Redux could answer.
3. **Two clients could not coexist.** `isRefreshing` and the array of queued
   resolvers were module-level, so a 401 raised through one client could be
   resumed by a refresh another client had started — a request sent with a token
   minted for a different session.

## The shape of the fix

The contract moves **down** to `shared/api`, and the instance stays **up** in
`app/`. Everything then depends on the interface, and exactly one module knows
the implementation:

```
shared/api/apiClient.ts          ApiClient, ApiError, SessionPort   ← everyone depends on this
shared/api/createFetchApiClient  the real one, given a SessionPort
shared/api/createStubApiClient   the double, given a table
shared/api/apiClientContext.ts   the seam: context + useApiClient()
app/api/storeSession.ts          SessionPort ⇒ Redux
app/api/client.ts                the one construction
app/main.tsx                     publishes it
```

`SessionPort` is the second inversion and the one that does the real work. The
client's only auth concerns are "what token do I attach" and "this one was
rejected, can I get another":

```ts
export interface SessionPort {
  getAccessToken(): string | null;
  refreshAccessToken(): Promise<string | null>;
  onSessionExpired(): void;
}
```

Redux answers those in `app/api/storeSession.ts`. A test answers them with three
closures. Neither knows the other exists.

## Using it

```tsx
function PostFeed() {
  const client = useApiClient();
  const { data } = useQuery({
    queryKey: POST_FEED_QUERY_KEY,
    queryFn: ({ signal }) => fetchPostFeed(client, { signal }),
  });
  // …
}
```

In a test:

```tsx
const apiClient = createStubApiClient({
  routes: { "GET /posts": [{ id: 1, title: "First", body: "…", userId: 1 }] },
});

renderWithProviders(<PostFeed />, { apiClient });

expect(await screen.findByText("First")).toBeInTheDocument();
expect(apiClient.calls).toEqual([{ method: "GET", path: "/posts" }]);
```

No MSW, no service worker, no module mock, and the assertion about _which_
requests were made comes for free — that is the part interception cannot give
you without a second mechanism.

## Five things that are not obvious

### The context default has to be `null`

A default of the real client would make a component rendered outside the
provider _work_. In a unit test that means a green suite quietly issuing
requests against `VITE_API_URL` — the exact failure the seam exists to remove,
now invisible. `useApiClient()` throws instead, and names the two providers that
exist rather than only the missing one.

`renderWithProviders` applies the same reasoning one level up: its default is a
stub with **no routes**, so a component that makes an unplanned request fails
with `No stub route for "GET /posts"` rather than hanging on a promise nobody
resolves.

### Swapping the client means swapping the cache

A query key names _what was asked for_, not _who was asked_. Two clients sharing
one `QueryClient` therefore share entries: switch the client and the first
render serves the previous one's rows. `renderWithProviders` builds a fresh
`QueryClient` per test, the lab page gives its stub subtree its own, and a
Storybook decorator would do the same per story.

The tempting fix — putting the client's identity in the query key — is worse
than the problem. It would also make a component that captured its client on
first render _look_ like it was swapping correctly.

### The global `fetch` must be resolved per call, not captured

MSW's browser worker and its Node `setupServer` both install themselves by
replacing `globalThis.fetch`, after modules are evaluated. A client that read
the global at construction would hold the original and bypass every handler —
silently, and only in the suites that depend on MSW. Hence:

```ts
const doFetch: typeof globalThis.fetch = (input, init) =>
  (fetchOverride ?? globalThis.fetch)(input, init);
```

### Single-flight is about overlap, and a test with an instant refresh proves nothing

The shared promise dedupes refreshes that overlap. A refresh mock that resolves
immediately is never in flight when the second 401 arrives, so a test built on
one passes against a client with no sharing whatsoever — that test was written,
it passed, and it was wrong. The suite holds the refresh open with a deferred
instead.

The promise is cleared when it settles rather than latching, so a 401 after a
failed refresh starts a new one. That is what lets the client recover after the
user logs in again: a permanent "session dead" flag would need clearing from
outside, and the only thing that could clear it is the state this client
deliberately no longer knows about.

### `unknown | ((call) => unknown)` collapses to `unknown`

The stub's route table wants to accept either a canned value or a handler. Typed
as `unknown`, the union absorbs the function member and every handler in every
test has to annotate its own parameter. `StubResponseBody` spells out the
JSON-shaped alternatives so the function member survives and a route written as
`(call) => …` gets its parameter typed.

## Storybook

**Storybook is not installed in this repository**, and nothing here pretends
otherwise. What the item asks for is that a story be able to swap the client the
same way a test does, and that is what the seam provides — a decorator is the
whole integration:

```tsx
// .storybook/preview.tsx, once Storybook is added
export const decorators = [
  (Story) => {
    const client = createStubApiClient({ routes: { "GET /posts": SAMPLE_POSTS } });
    // A QueryClient per story, for the reason in "Swapping the client means
    // swapping the cache" above.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client}>
          <Story />
        </ApiClientProvider>
      </QueryClientProvider>
    );
  },
];
```

`createStubApiClient` lives in `shared/api` rather than `src/test/` precisely so
this is possible: nothing that ships may import test scaffolding, and a story is
built by the same bundler as the app.

## What is not done

- **`baseApi` (RTK Query) is untouched.** It has its own `fetchBaseQuery` and
  reads the token from the store through `prepareHeaders`, which is RTK's own
  injection point rather than an import of a singleton. Rewriting the RTK
  endpoints on top of `ApiClient` would be a data-layer migration, not this
  item.
- **No response validation.** `client.get<Post[]>()` is the caller's claim about
  the response, not a check of it. Where the shape matters, parse the result at
  the call site.
- **The stub matches routes exactly.** No path patterns, no query-string
  matching. A stub that quietly answers a path you did not mean to stub is the
  same class of problem as a context default that quietly makes a real request.
