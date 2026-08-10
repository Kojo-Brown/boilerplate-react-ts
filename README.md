# boilerplate-react-ts

> React 19 · TypeScript 6 · Vite 7 · TailwindCSS 4 · Redux Toolkit 2 · TanStack Query 5

Production-grade SPA starter. Clone, configure `.env`, and ship.

## Stack

| Layer        | Tech                                  | Version       |
| ------------ | ------------------------------------- | ------------- |
| UI           | React + TypeScript                    | 19.2 / 6.0    |
| Build        | Vite                                  | 7             |
| Styles       | TailwindCSS                           | 4.3           |
| Global state | Redux Toolkit                         | 2.12          |
| Server state | TanStack Query                        | 5.101         |
| Routing      | React Router                          | 7             |
| Forms        | React Hook Form + Zod                 | 8 / 4         |
| Testing      | Vitest + Testing Library + Playwright | 3 / 16 / 1.52 |
| Mocking      | MSW                                   | 2             |
| Linting      | ESLint 9 + Prettier 3                 |               |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Kojo-Brown/boilerplate-react-ts.git
cd boilerplate-react-ts
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Develop
pnpm dev        # http://localhost:3000

# 4. Test
pnpm test
pnpm test:e2e

# 5. Build
pnpm build
```

## Project Structure

```
src/
├── api/          # API client + TanStack Query queryClient
├── components/
│   └── ui/       # Design system primitives (Button, Input, Modal…)
├── hooks/        # Custom hooks
├── lib/          # Utilities (cn, etc.)
├── pages/        # Route-level components
├── store/        # Redux slices + typed hooks
├── styles/       # Global CSS + design tokens
├── test/         # MSW handlers, setup, test utilities
├── types/        # Shared TypeScript types
└── env.ts        # Typed + validated env vars (Zod)
```

## Design Tokens

All design tokens are CSS custom properties on `:root`. Override in `.dark` for dark mode:

```css
--color-primary   /* brand colour */
--color-bg        /* page background */
--color-fg        /* default text */
--color-muted     /* subtle backgrounds */
--color-border    /* borders and dividers */
--color-danger    /* error/destructive */
--color-success   /* success states */
--radius-sm/md/lg /* border radius scale */
```

## React 19 Concurrency

`<ConcurrentFilterList>` (`src/components/performance/`) filters a large list
without letting the render block typing:

- **`useDeferredValue`** splits the query into an urgent copy (what the input
  shows) and a lagging copy (what the list renders from). While the two
  disagree the list is marked stale — dimmed, `aria-busy`, `data-stale="true"`.
- **`useTransition`** marks the category change as interruptible, so the
  previous results stay on screen and interactive instead of flashing a
  spinner.
- **`memo` on the row subtree** is what makes deferring pay off. Without it the
  urgent keystroke render still rebuilds and reconciles every child, so the
  keypress keeps paying for the whole list. Because the filtered array is
  referentially stable until the deferred query catches up, React skips the
  subtree entirely while you are still typing.

Deferring schedules the work differently; it does not make it smaller. For a
list this size in a real screen, combine it with `<VirtualList>`.

### Jank benchmark

`/labs/concurrency` is a harness for the pattern — dataset size and scheduling
mode come from the URL (`?mode=blocking&n=15000`), and the page records real
frame timings with `src/lib/jankMeter.ts`. `e2e/concurrency-benchmark.spec.ts`
drives both arms and fails if the gap disappears:

```bash
pnpm test:e2e concurrency-benchmark --project=chromium
```

15,000 rows, typing `deferred` at 60ms/keystroke, Chromium, dev server
(StrictMode double-renders, so both arms are inflated — the comparison is what
matters, not the absolute numbers):

| Metric                      | Blocking (before) | Concurrent (after) |
| --------------------------- | ----------------- | ------------------ |
| Worst keypress → paint      | 824 ms            | 256 ms             |
| Time spent blocked on input | 3424 ms           | 1360 ms            |
| Longest frame               | 800 ms            | 317 ms             |

Absolute numbers move with the machine; across runs the ratio held at roughly
3× on worst keypress-to-paint. The spec asserts a 2× floor, so it fails on a
regression without failing on noise.

Frame numbers improve less than input numbers, and that is the honest result:
rendering becomes interruptible, but the commit that finally inserts the rows
does not. What concurrency buys is that the keystroke no longer waits for it.

## Optimistic Mutations

`useOptimisticList` (`src/hooks/`) draws a change before the request that makes
it real has come back, and takes it back off if that request fails.
`<OptimisticTaskList>` (`src/components/mutations/`) is the worked example.

The hook holds two lists. `committed` is what the server has confirmed;
`useOptimistic` layers the in-flight actions on top of it. Every mutation names
its change twice — once as a guess, once as a fact:

```tsx
mutate({
  optimistic: { type: "create", item: { id: draftId, title, done: false } },
  commit: async () => ({ type: "create", item: await api.create(title) }),
});
```

**Nothing ever undoes an optimistic action.** The rollback is the _absence_ of a
commit: a `commit()` that rejects leaves the committed list untouched, React
discards the optimistic layer when the transition settles, and the row is gone.
There is no snapshot to restore, so there is no window in which a half-applied
change can be observed. Both layers go through the same reducer
(`src/lib/optimisticList.ts`) — if the guess and the truth were computed by
different code they could disagree in ways no test would catch, because the
optimistic render is thrown away before anything can assert on it.

Three things about this were not obvious, and each one cost a debugging round:

- **The `await` has to happen inside the transition.** React holds the
  optimistic layer for exactly as long as the transition is pending. Awaiting
  outside it makes the provisional row flicker in and straight back out.
- **Ordinary state set inside an async transition does not land when you think.**
  An update made synchronously inside the transition, before the first `await`,
  is absorbed into it and never renders on its own — the UI keeps its old value
  until the action settles. Clearing the previous error in there left a stale
  "change reverted" banner up for the whole of the _next_ request. `mutate`
  clears it as an urgent update, outside the transition. Optimistic state is the
  exception; that is the entire reason `useOptimistic` exists.
- **Optimistic actions unwind as a group, not individually.** If two mutations
  overlap and the first fails, its row stays on screen alongside the error until
  the _last_ in-flight action settles, at which point the whole layer is
  discarded at once. The end state is always correct; the intermediate frame can
  briefly show a row already reported as reverted. This is React's model, not a
  choice the hook makes, and it is asserted in the hook's tests so it is
  documented rather than rediscovered.

Rollback is silent by default, which is the failure mode worth designing
against: on its own, a rejected mutation just removes the row the user added
with no explanation. `error` exists for that reason, and the component renders
it — an automatic rollback with no message is a bug report waiting to happen.

### Trying it

`/labs/optimistic` runs the list against a fake server whose behaviour comes
from the URL (`?server=failing&latency=1500`), so the failure path — the half of
the pattern that is hard to reach on a healthy backend — is one click away.

## Reading Promises with `use()`

`<UserProfileCard>` (`src/components/suspense/`) renders data that has not
arrived yet, with no loading flag and no `data === undefined` branch:

```tsx
const cache = propCache ?? use(ProfileCacheContext);
const profile = use(cache.read(userId));
```

Both halves of the API are in those two lines.

**`use(promise)` needs a cached promise.** React re-renders a suspended
component every time its boundary retries, so a promise created _during_ render
is a different promise each pass: the component suspends on it, React retries,
render makes another one, and the fallback never leaves. `createPromiseCache`
(`src/lib/promiseCache.ts`) is what makes `read(key)` return the identical
promise object every render. Rendering never calls the API directly.

**`use(Context)` can be called conditionally**, which nothing else hook-shaped
can. `propCache ?? use(ProfileCacheContext)` short-circuits, so a caller that
passes a cache explicitly never subscribes to the context and never re-renders
when the provider's value changes. That is also why the context is exported as
the context object rather than behind a `useProfileCache` hook — a hook would
put the rules-of-hooks constraint straight back.

**`use()` communicates by throwing**, so both boundaries are mandatory: a
pending promise suspends to the nearest `<Suspense>`, a rejected one throws to
the nearest error boundary, and the error boundary has to be _outside_ the
Suspense boundary. `<ProfilePanel>` wires up both per profile, so one card
failing leaves its siblings on screen. Hoisting them to wrap a group is a real
trade — the slowest request then decides when any of them appears, and one
failure blanks all of them.

Three things cost a debugging round each:

- **Rejected cache entries are sticky, and have to be.** Dropping an entry when
  its promise rejects looks like free retry-on-error and is actually an
  invisible hang: React re-renders the suspended component after the rejection,
  a dropped entry hands it a fresh _pending_ promise, so it suspends instead of
  throwing and the boundary falls back forever without the error ever
  surfacing. The entry stays, and retrying is explicit — `<ProfilePanel>`'s
  "Try again" calls `invalidate(userId)` _before_ resetting the boundary. Reset
  alone re-reads the same rejection and visibly does nothing.
- **Replacing the cache is an update, and updates can be transitions.** React
  Router runs navigations inside a transition, and a transition that suspends
  holds the _previous_ UI until the new data is ready — so handing the same
  subtree a new cache leaves the old server's cards under the new server's
  controls. `/labs/use` remounts the subtree with a `key` instead, which is the
  honest read: different source, fresh fallback.
- **A cached rejection nobody reads is an unhandled rejection.** The entry is
  created during render and `use()` only observes it on the retry pass, so the
  cache attaches a no-op `catch` at store time. It stores the original promise,
  not the one `catch` returns, so `use()` still sees the rejection.

### Testing components that `use()`

Testing Library's `render` wraps the initial render in a **synchronous** `act()`.
A component that suspends inside a non-awaited act scope leaves its retry queued
in a scope that closes before anything can flush it: the promise resolves, React
marks it fulfilled, and the fallback stays up until `waitFor` times out.
`lazy()` does not hit this — which is why the router tests never needed it —
and `use()` hits it every time.

`src/test/renderSuspense.tsx` is the fix. `renderAsync` renders inside an
awaited act scope, and `actAsync` does the same for an interaction that pushes
the tree back into a fallback:

```tsx
await renderAsync(<ProfilePanel userId="u-1" />);
await actAsync(() => user.click(screen.getByTestId("retry-profile")));
```

Awaiting the act scope does not wait out a pending request, so a fallback is
still observable afterwards and resolved UI is still asserted with
`findBy*`/`waitFor`.

### Trying it

`/labs/use` runs two profile cards against a fake service configured from the
URL (`?server=failing&latency=2000`). Slow it down to read the fallback, or
break it to watch one card land in its error boundary while the other carries
on.

## Forms with the Actions API

`<InviteTeammateForm>` (`src/components/forms/`) has no `isSubmitting`, no
`setError`, and no `try/finally` resetting a flag — the three things a
hand-rolled form spends most of its code on. The action is an ordinary async
function that takes the `FormData` and returns the next state:

```tsx
const [state, formAction] = useActionState(async (_previous, formData) => {
  const values = readFormValues(formData, INVITE_FIELDS);
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) {
    return formFailed(values, { fieldErrors: fieldErrorsFromZod(parsed.error, INVITE_FIELDS) });
  }
  // …
}, IDLE_STATE);
```

`src/lib/formState.ts` is the reusable half: one `FormState<Field>` shape that
both a schema failure and a server rejection resolve to, so the form renders one
thing rather than branching on where the problem came from. Compare
`<LoginForm>`, which wires the same concerns up by hand through React Hook Form
— both are valid; this one is the smaller surface when validation is
server-authoritative.

**React resets the form once the action settles.** That is right for a success
and actively hostile on a failure: the user is handed an empty form and asked to
retype the value that was just rejected. The action echoes the submitted values
back in `state.values`, every control reads its `defaultValue` from there, and
the reset restores what was typed instead of wiping it. On success the echo is
empty, so the same mechanism clears the form — one behaviour, both outcomes, no
imperative reset call anywhere.

**`useFormStatus` only reports to descendants of the `<form>`.** Calling it in
the component that _renders_ the form returns `pending: false` forever, with no
warning and no error — just a button that never looks busy. That is why
`<SubmitButton>` is a separate component, and it is what the constraint buys:
any form can drop it in and get a correct pending state with nothing threaded
down. `useFormStatus().data` carries the in-flight `FormData` too, which is how
`<SubmittingNotice>` names the address being sent without the form passing it
anything.

Two more things cost a debugging round each:

- **`<select>` is the one control the echo does not reach.** React keeps an
  `<input>`/`<textarea>`'s `defaultValue` in sync after mount, so the reset
  restores the echoed value. It never propagates a changed `defaultValue` onto
  an already-mounted `<select>`'s options, so the reset restores whichever
  option was selected at _mount_ and the user's choice disappears — silently,
  and only on the failure path. The select is keyed on the echoed value so it
  remounts, which is the only point at which React applies it.
- **Focus has to key on the state object, not on `status`.** Moving focus to the
  first invalid control is what makes a server-validated form usable without a
  mouse, and the effect that does it fires on `state`. Narrowing the dependency
  to `state.status` is the tempting simplification and breaks the second
  identical submission, because `status` is already `"error"` and never changes.
  `useActionState` returns a fresh object per submission; that is the signal.

Server errors decide their own placement. `InviteRejectedError.field` says
whether a rejection belongs under a control (`ada@example.com` is already on the
team) or at the top of the form (the service is down), so that judgement is made
once, by the side that can actually make it, rather than being guessed at from a
message string in the UI.

### Trying it

`/labs/actions` runs the form against a fake invitation service configured from
the URL (`?server=failing&latency=2000`). Three failures are reachable and
deliberately different: a malformed address never leaves the browser,
`ada@example.com` is rejected by the server and still lands under the field, and
the failing server produces a form-level message with no field to blame.

## Spec Progress

See [SPEC.md](./SPEC.md) for the full feature roadmap and implementation status.

## Docker

```bash
docker build -t my-app .
docker run -p 80:80 my-app
```
