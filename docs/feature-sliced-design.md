# Feature-Sliced Design

**Source:** `src/` (the whole tree)
**Rule:** `tooling/eslint/fsdBoundaries.ts`, wired in as `fsd/layer-imports`
**Tests:** `tooling/eslint/fsdBoundaries.test.ts`

The layout is [Feature-Sliced Design](https://feature-sliced.design/). The short
version: a module may import from layers **below** its own, never above and
never sideways.

```
app        composition root — entry, router, store, query client
pages      one slice per route
widgets    composite blocks assembled from features and entities
features   user-facing capabilities
entities   domain models
shared     reusable and domain-free
```

`src/test/` sits outside that stack; see [Test scaffolding](#test-scaffolding).

## Why a lint rule and not a convention

A directory layout is a claim about which parts of the code can change
independently. Nothing about a directory enforces that claim. The failure is
not that someone writes a bad import — it is that a single import quietly
converts `shared/ui/Button` from a component anyone can use into one that only
works if the auth feature is present, and _nothing goes red_. It type-checks, it
tests green, it builds. The claim is now false and the directory names still
say otherwise.

That is what the rule is for: it moves the failure from "discovered a year later
during a rewrite" to "reported on the line that caused it".

## Layers

The order above is not alphabetical or aesthetic — it goes from the most
reusable to the most specific, and the import direction follows. `shared/lib/cn`
knows nothing about anything and everything may use it. `app/router` knows about
every page and nothing may use it.

```
app        may import  pages, widgets, features, entities, shared
pages      may import  widgets, features, entities, shared
widgets    may import  features, entities, shared
features   may import  entities, shared
entities   may import  shared
shared     may import  (nothing above it)
```

### Slices and segments

`pages`, `widgets`, `features` and `entities` are divided into **slices** — one
directory per feature, entity or page (`features/auth/`, `entities/session/`,
`pages/checkout-lab/`). A slice is the unit that can be deleted, moved or
extracted on its own, which is exactly what a sideways import takes away. So
slices in the same layer may not import each other; what two of them need goes
down a layer.

`shared` and `app` are **not** sliced. `shared` is divided into segments — `ui`,
`lib`, `api`, `hooks`, `config`, `routes`, `store`, `theme`, `styles`, `mocks` —
which describe what a module _is_ rather than what it is _about_, and segments
may freely reference each other. `app` is a single composition root.

The rule enforces the difference. It also enforces that no file sits loose in a
sliced layer: `pages/StrayPage.tsx` is an error, because a page that belongs to
no slice is a page nothing can own.

## The one exemption: `import type`

Type-only imports may cross upward and sideways. This is the line the rule is
actually drawing, so it is worth being precise about.

A type import is erased before a module graph exists. It cannot put a higher
layer into a lower layer's bundle, cannot create a runtime cycle, and cannot
make a slice fail to load because a sibling is missing. It is still coupling —
a `RootState` that changes shape still breaks whoever described it — but it is
coupling **the type checker reports in full, at every affected site**. That is
the opposite of the failure this rule exists to catch.

The exemption depends on a type-only import being _spelled_ as one, which is why
`@typescript-eslint/consistent-type-imports` is also on: without it, `import
{ RootState }` would be an ordinary value import that happens to be erasable,
and the two cases would be indistinguishable.

Two places use it deliberately:

- **`shared/store/hooks.ts`** imports `AppDispatch` and `RootState` from
  `app/store`. `RootState` can only be spelled where the reducers are combined,
  and combining reducers is what a composition root _is_. The alternative —
  restating the store's shape structurally in `shared/` — puts the same coupling
  back with the type checker no longer able to see it.
- **`features/auth/silentRefresh.ts`** imports `AppStore` as a type and takes
  the store as a parameter. The value comes from `app/main.tsx`.

## What the rule found

Three things in this codebase were structurally wrong and had been invisible.
Each is worth recording, because each is the shape of mistake the rule exists
for rather than a formatting quibble.

**`RootLayout` imported `RouteFallback`.** The shell rendered the app's one
Suspense boundary and imported the fallback that picks a per-page skeleton by
pathname — so the layout depended on every page it could host, backwards through
four layers. It now takes `fallback` as a required prop and `app/router` passes
`<RouteFallback />`. Required rather than defaulted to a spinner: a forgotten
fallback would still render, just without the per-route skeletons that boundary
exists to preserve (see `docs/route-transitions.md`), which is precisely the
kind of silent loss this document keeps complaining about.

**The query-error event contract lived on the query client.** `QUERY_ERROR_EVENT`
and `QueryErrorDetail` were exported from the module that constructs the
`QueryClient` singleton — an application-level object wired to a base URL and a
store. Any listener is ordinarily a `shared` hook or a feature's UI, so learning
the name of an event meant importing the singleton. The names and payloads moved
to `shared/api/queryEvents.ts`; the client did not.

**Test scaffolding was reachable from the entry point.** `app/main.tsx` starts
the MSW worker in dev, and the worker lived under `src/test/`. Dev mocking is not
test scaffolding — it is a development dependency of the running app — so the
handlers moved to `shared/mocks/`, which both the dev worker and the test server
consume.

## Test scaffolding

`src/test/` holds harnesses that exist to drive the application: they render it,
build a store, seed caches, hold a navigation open. Reaching into any layer is
their job, so they are not part of the stack and the rule does not restrict what
they import.

The restriction runs the other way, and it is the useful half: **nothing outside
`src/test/` may import from it.** Factories, fake stores and harnesses have no
business in a bundle, and an import that puts them there is one autocomplete
away at all times. Co-located `*.test.ts(x)` files count as test files, so they
may use the harnesses; they are otherwise judged as the layer they sit in, which
is deliberate — a test that has to reach up two layers to set itself up is
telling you about the subject, not about the test.

## Where things went

| Was                                                | Now                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `App.tsx`, `main.tsx`                              | `app/`                                                                                         |
| `api/`                                             | `app/api/` (singletons), `shared/api/` (base API, event names)                                 |
| `router/`                                          | `app/router/` (route table), `shared/routes/` (paths, hrefs)                                   |
| `layouts/`, `components/layout/`                   | `widgets/layout/` (shell), `shared/ui/layout/` (primitives)                                    |
| `components/ui/`                                   | `shared/ui/`                                                                                   |
| `components/auth/`, `context/AuthContext`          | `features/auth/`                                                                               |
| `components/checkout/`, `machines/`                | `features/checkout/`                                                                           |
| `components/navigation/`, `router/routeTransition` | `features/route-transition/`                                                                   |
| `components/suspense/`                             | `entities/report/`, `entities/user/`, `widgets/streaming-report/`, `shared/ui/SectionBoundary` |
| `store/authSlice`                                  | `entities/session/`                                                                            |
| `store/postsApi`                                   | `entities/post/`                                                                               |
| `store/api`                                        | `shared/api/baseApi`                                                                           |
| `store/index`                                      | `app/store/` (store), `shared/store/hooks` (typed hooks)                                       |
| `hooks/`, `lib/`                                   | `shared/hooks/`, `shared/lib/`, or the slice that owns them                                    |
| `pages/*.tsx`                                      | `pages/<slice>/`                                                                               |
| `components/skeletons/`                            | the page slice each one draws                                                                  |
| `env.ts`, `styles/`                                | `shared/config/`, `shared/styles/`                                                             |
| `test/mocks/`                                      | `shared/mocks/`                                                                                |

## Adding to the tree

1. **Is it domain-free and reusable?** `shared/`, in the segment that says what
   it is.
2. **Is it a thing the product has?** (a user, a session, an order) —
   `entities/<name>/`.
3. **Is it something a user does?** (log in, check out, invite) —
   `features/<name>/`.
4. **Is it a composite block a page drops in whole?** `widgets/<name>/`.
5. **Is it a route?** `pages/<slice>/`.
6. **Is it wiring that runs once at startup?** `app/`.

If step 2 and step 3 both fit, the data model is the entity and the interaction
is the feature; they are two slices, not one.

If the rule rejects the import you wanted, that is the answer to a design
question, not an obstacle. There are three fixes, in order of preference: move
the shared part down a layer; invert the dependency and pass the thing in (what
`RootLayout` does); or, last, reconsider which slice the code belongs to.

## Known limits

- **The rule reads paths, not the module graph.** It cannot see a cycle that
  stays within one layer, and it takes `src` to be the last path segment named
  `src`.
- **Slice public APIs are not enforced.** FSD asks that a slice be imported
  through an `index.ts` rather than by reaching at its internals. Nothing here
  checks that, so a cross-layer import can still name a file inside a slice. The
  layer and slice directions are enforced; the depth is not.
- **Cross-slice type imports are permitted** by the same erasure argument as
  upward ones. FSD's `@x` notation is the convention for making such an import
  explicit; it is not used here.
