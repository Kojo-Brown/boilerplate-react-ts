# Optimistic cache updates

Writing a change into the TanStack Query cache before the server has agreed to
it, taking it back off if the server refuses, and handing the cache back to the
server afterwards.

Live demo: `/labs/query-cache`. Implementation:
`src/shared/api/optimisticCache.ts` (the engine),
`src/shared/api/useOptimisticMutation.ts` (the hook you should use),
`src/features/tasks/useTaskMutations.ts` (a worked example).

## Not the same thing as `useOptimistic`

The repo has two optimistic patterns and they are not alternatives to each
other. `useOptimistic` (see `/labs/optimistic` and `docs/` note in
`src/shared/hooks/useOptimisticList.ts`) owns a list that **one component**
renders, in React state. Its rollback is the _absence_ of a commit: the
optimistic layer unwinds by itself when the action settles, so a failed request
simply never reaches committed state and there is nothing to undo.

This pattern is for rows that **several components read through a shared
cache** — on the lab page, three filtered lists and a counter. There is no
component state to fall back to, so the guess has to go into the cache, and
something has to take it back out again.

|                       | `useOptimistic`            | optimistic cache              |
| --------------------- | -------------------------- | ----------------------------- |
| Where the guess lives | component state            | the query cache               |
| Who sees it           | the component that owns it | every observer of the key     |
| Rollback              | not committing             | removing a patch, re-deriving |
| Ends when             | the action settles         | the invalidation refetches    |

## The recipe everyone starts from, and where it breaks

```ts
onMutate: async (next) => {
  await queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData(queryKey);
  queryClient.setQueryData(queryKey, (old) => patch(old, next));
  return { previous };
},
onError: (_err, _next, context) => {
  queryClient.setQueryData(queryKey, context.previous);
},
onSettled: () => queryClient.invalidateQueries({ queryKey }),
```

Three lines, and right for one mutation at a time against one cache entry. Four
things break it, all of them ordinary:

**1. A second mutation overlaps the first.** B snapshots a cache that already
contains A's guess, so rolling B back keeps A — fine. Rolling _A_ back writes a
snapshot taken before B existed, so B's row disappears while B is still in
flight and only comes back when B settles. The snapshot is a photograph of a
moment that has since been overwritten.

**2. Something refetches while the guess is up.** `cancelQueries` covers the
fetches already running at `onMutate`. Nothing covers the ones that start
afterwards — a window refocus, a component mounting, a `refetchInterval`,
another mutation's invalidation. That response lands as server truth and
silently erases the optimistic row.

**3. One key is not one entry.** `["tasks", "list", "open"]` and
`["tasks", "list", "done"]` are two cached answers about the same rows. A patch
that rewrites one and not the other has made the screen disagree with itself.

**4. The guess is dropped too early.** `onSettled` fires when the request
resolves; the refetch it starts lands some time later. In between, the cache has
neither the guess nor the server's version of it, and the row blinks out and
back.

## What this module does instead

It keeps the server's last word per entry (`base`) and an ordered list of the
guesses currently in flight (`patches`), and treats the cache as derived:

```
cache = patches.reduce(apply, base)
```

Every event re-derives rather than restores.

- **Rollback** removes one patch from the middle of the list and re-runs the
  rest. A concurrent mutation's row survives, because it is still in the list.
- **A refetch landing mid-flight** replaces `base` and the guesses are
  re-applied on top. The response updates everything the mutation did not touch
  without erasing what it did — which also means (2) above needs no special
  case: the engine subscribes to the query cache, so a fetch that starts _after_
  `onMutate` is handled the same as one that was already running.
- **Several entries** are the normal case, not an extension. A patch is handed
  the key of the entry it is rewriting, because the right guess differs between
  them.
- **Handing back** does not drop a successful guess when the request resolves.
  It marks it confirmed and keeps it applied until the scope's invalidation has
  refetched _that entry_, at which point `base` already contains the change and
  dropping the patch shows no movement.

Telling our own writes from the server's is what makes the subscription safe:
`setQueryData` tags its dispatch `manual: true` and a resolved fetch does not.

## Patch, or invalidate?

Both, and the split is the design decision worth making deliberately:

- **Patch** what this client can compute. It knows what adding a row does to a
  list of rows, so it can draw the answer immediately.
- **Invalidate** what only the server can answer — an aggregate, a ranking, a
  permission set, anything derived from rows this client has never loaded.

`useTaskMutations` patches `["tasks", "list"]` and invalidates `["tasks"]`. The
wider key is on purpose: it covers the lists _and_ `["tasks", "stats"]`, which
is never patched. The counts are over every row the server holds, while the
lists on screen are a filtered view of some of them — a client that decremented
`open` from what it can see would be extrapolating from a sample. On the lab
page you can watch the rows move instantly and the counts follow a beat later.
That lag is the honest answer.

## Using it

```tsx
const addTask = useOptimisticMutation<readonly Task[], NewTask, Task>({
  queryKey: TASK_LIST_SCOPE, // patched: every entry under this prefix
  invalidateKeys: [TASK_ROOT_KEY], // refetched once the scope goes quiet
  mutationFn: ({ title }) => api.create(title),
  patch: (tasks, { draft }, queryKey) =>
    applyTaskChange(tasks, taskFilterFromKey(queryKey) ?? "all", {
      type: "create",
      task: draft,
    }),
});

const draft = draftTask(title);
addTask.mutate({ title: draft.title, draft });
```

Three rules for the `patch` function:

1. **Pure.** It is re-applied on every re-derive, which is every rollback and
   every refetch that lands while it is in flight.
2. **Idempotent against its own output where that is possible.** `create`
   checks for the row before appending, because a re-derive over a base that
   already grew would otherwise append twice.
3. **Nothing minted inside it.** A draft id invented in the patch would differ
   between the `open` list and the `done` list, and a rollback keyed on the id
   would remove neither. Mint it before `mutate()` and pass it as a variable —
   that is what `NewTask.draft` is for.

## Reading "is this settled?"

Not `mutation.isPending` — the rows are already on screen, so no single
request describes what the user is waiting for. `useOptimisticMutation` sets
the scope as the mutation key, so:

```ts
const isSettling = useIsMutating({ mutationKey: TASK_LIST_SCOPE }) > 0;
```

is reactive and scoped. Because `onSettled` returns the settle promise, TanStack
keeps the mutation pending until the invalidation has refetched — so this drops
to zero when the screen is telling the truth, not when the socket closed.

## Two cases that are deliberately not symmetrical

**An entry nothing is observing.** `invalidateQueries` refetches _active_
queries and only marks the rest stale — TanStack's default, and the right one.
So an entry can reach the end of a successful mutation with no fresh value to
hand back to. It keeps the guess and stays stale, rather than being rewritten to
the pre-mutation value: the guess is the best answer available, and the next
fetch replaces it. Writing the old value back would make the next component to
mount render a list without the new row for a frame.

**A failed invalidation.** `invalidateQueries` rejects when a refetch it
triggered rejects, and that is the _query's_ failure — it has an error state, a
boundary and a retry of its own. It is swallowed here rather than allowed to
reach `onSettled`, which TanStack reads as the mutation failing. Otherwise a
write the server accepted would announce itself as reverted because a GET
afterwards timed out.

## Testing it

`src/shared/api/optimisticCache.test.ts` drives a real `QueryClient` with no
React at all, which is what makes the concurrency cases legible. Two things to
know if you extend it:

- A test about what the server says next needs a **real observer**
  (`new QueryObserver(...).subscribe(...)`), because `invalidateQueries` only
  refetches active queries. Seed the data first and mount with
  `staleTime: Infinity`, so the only fetch in the test is the one the
  invalidation causes.
- Hold the request open (a promise you resolve by hand) rather than rejecting up
  front. Otherwise the mutation settles before the overlap you meant to test
  ever exists.
