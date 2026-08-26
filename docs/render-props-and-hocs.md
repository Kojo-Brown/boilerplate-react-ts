# Render props and HOCs, and what they became

One capability — "does this media query match?" — delivered three ways, so the
three can be compared on identical work rather than on paraphrase:

| Delivery               | File                                        | Shape                                  |
| ---------------------- | ------------------------------------------- | -------------------------------------- |
| Hook                   | `src/shared/hooks/useMediaQuery.ts`         | `const matches = useMediaQuery(query)` |
| Render prop            | `src/shared/ui/patterns/MediaQuery.tsx`     | `<MediaQuery query>{(matches) => …}`   |
| Higher-order component | `src/shared/ui/patterns/withMediaQuery.tsx` | `withMediaQuery(Banner, query)`        |

`/labs/render-props` renders all three subscribed to the same query. Resize the
window across the breakpoint and they flip together, because the second and
third are twelve-line adapters over the first. That is the shortest statement
of the argument: **a capability has one implementation, and a delivery
mechanism is how it reaches a caller.** Both older mechanisms are still real
things you can write; what changed is that neither is where the logic lives any
more.

## The translation

Every widely-copied render prop and HOC of the 2016–2019 era was a way to reach
something a function component could not reach for itself. Hooks reach all of
them directly:

| Then                                  | Now                          | Here                                        |
| ------------------------------------- | ---------------------------- | ------------------------------------------- |
| `withRouter(Component)`               | `useLocation`, `useNavigate` | throughout `src/pages/`                     |
| `connect(mapState)(Component)`        | `useSelector`                | `useAppSelector` in `src/store`             |
| `<Media query>{matches => …}</Media>` | `useMediaQuery(query)`       | `src/shared/hooks/useMediaQuery.ts`         |
| `<Downshift>{api => …}</Downshift>`   | a behaviour hook             | `useListbox`, `docs/headless-components.md` |
| `withAuth(Component)`                 | `useAuth()`                  | `src/features/auth/AuthContext.tsx`         |
| `<Formik>{form => …}</Formik>`        | a form hook                  | `useZodForm`                                |

The mechanical translation is always the same: whatever the wrapper computed
and passed down becomes what the hook returns, and the wrapper disappears. What
is worth being explicit about is why that is an improvement rather than a
rewrite for fashion's sake, because the reasons are the same three every time.

**Composition stops nesting.** Two hooks are two lines. Two render props are
two levels of indentation, and five is the shape people used to call the
pyramid of doom. Two HOCs are two anonymous nodes in the component tree with
the real one at the bottom.

**The argument moves from wrap time to call time.** `useMediaQuery(query)`
follows a piece of state for free. `withMediaQuery(Component, query)` binds the
query when the wrapper is built, so a query that varies means either
pre-enumerating every value it can take — `HOC_CARDS` in the lab page — or
rebuilding the component type, which is a remount (below). This is the
difference that has no workaround.

**Nothing is injected into the props.** A HOC's contract is invisible at the
call site: `<Banner />` renders something that receives a `matches` it was never
passed, and a caller who passes one of their own is silently overruled. A hook
call is right there in the body of the component that uses it.

## What did not translate

Three things survived, and they are not leftovers — they are jobs a hook
structurally cannot do.

**A boundary has to be outside.** `withBoundary` (`src/components/patterns/
withBoundary.tsx`) wraps a component in its Suspense and error boundary. A hook
runs _inside_ the component that calls it, and both halves of a boundary are
about what happens to that component from the outside: an error propagates up
past it, a suspension unwinds up past it. `try/catch` inside a hook does not
help either — the throw happens after the hook has returned, in JSX or in a
child. `withBoundary.test.tsx` pins the contrast directly: a component that
renders the same boundary _from inside itself_ and then throws does not catch
its own error, and the error lands on whatever ancestor happened to be there.

`React.memo` and `React.lazy` are the same category, which is a useful sanity
check on the rule. Both are HOCs, both survived hooks entirely, and both do
something to a component that nothing inside it can do.

**A render prop can hand back something that only exists inside.**
`ErrorBoundary`'s `fallback={({ error, reset }) => …}` is a render prop and
cannot be anything else: the error is caught by the boundary, and the component
that would call a hook for it is the one that threw. Same for the fallback slot
of `SectionBoundary`, and for a virtualiser's row renderer — the caller decides
the markup, the component owns the data and the moment it exists.

**Class components cannot call hooks.** Narrow, but not zero: an error boundary
is still a class, because `getDerivedStateFromError` has no hook equivalent.

## Three defects worth knowing by name

### A HOC created during render remounts everything below it

The one to know first, because it has no error message.

```tsx
function Parent() {
  const Wrapped = withMediaQuery(Counter, WIDE); // ✗ new function every render
  return <Wrapped />;
}
```

`withMediaQuery(...)` returns a new function each call, and React compares
element types by identity to decide between updating a fiber and replacing it.
So the subtree is unmounted and rebuilt on every render of `Parent`: state
discarded, effects re-run, DOM nodes replaced — and with them focus, scroll
position and any text selection. The component keeps rendering the right thing.
It just forgets.

`withMediaQuery.test.tsx` pins both halves — the same counter keeps its state
behind a module-scope wrapper and resets behind a render-scope one — and a
second test watches it from the subscription side, where each remount is
another subscribe/unsubscribe pair. `/labs/render-props` puts the two counters
side by side, since a screenshot cannot tell them apart.

There is now a lint rule for it. `react-hooks/static-components`, from the
React Compiler's diagnostics, rejects a component created inside another
component — the same rule that rejected an inline `createTabs()` call in
`docs/compound-components.md`. Every place this repo writes the mistake on
purpose needs an `eslint-disable` line to do it, which is the strongest
statement available that it is not writable by accident.

Worth knowing where that line goes: the rule reports at the **usage**, not at
the call that built the component. Nothing is wrong with calling
`withMediaQuery` during render — the defect is rendering a component type that
will not exist next time — so a disable comment placed on the assignment is
reported as unused and the error stays.

### The injected prop has to be subtracted, and the subtraction has to distribute

A HOC that injects `matches` must remove it from what the caller may pass:

```ts
export type WithMediaQueryProps<TProps> = DistributiveOmit<TProps, "matches">;
```

Without the subtraction, `<Banner matches={false} />` compiles and is silently
overruled by the spread inside the HOC. `DistributiveOmit` rather than `Omit`
for the reason recorded in `polymorphic.ts`: `Omit<A | B, K>` is built from the
keys `A` and `B` share, so a wrapped component whose props are a discriminated
union would come back with every prop unique to either branch missing.

The statics carry a related trap that is worth recording, because the error it
produces points somewhere else entirely. To keep a static hung off the wrapped
component visible on the wrapper, the return type intersects it back in — and
the obvious spelling is wrong:

```ts
): ComponentType<WithMediaQueryProps<TProps>> & TStatics            // ✗
): ComponentType<WithMediaQueryProps<TProps>> & HoistedStatics<TStatics> // ✓
```

`TStatics` is inferred from the whole argument, and a component's type includes
its **call signature**. Intersecting that back in gives JSX two signatures to
choose from — the wrapper's and the inner component's — and it picks the inner
one, so the injected prop reappears in the caller's props and every call site
errors on a tag that is correct. `HoistedStatics` is an `Omit`, and an omitted
object type has no call signature, which is precisely why it works. The
`@ts-expect-error` block at the bottom of `withMediaQuery.test.tsx` checks both
halves, because the wrong fix makes one of them look right on its own.

### Hooks inside a render prop belong to the component that calls it

```tsx
<OnlyWhenMatching query={WIDE}>
  {(matches) => {
    const [label] = useState("wide"); // ✗ this is OnlyWhenMatching's hook
    return <p>{label}</p>;
  }}
</OnlyWhenMatching>
```

The function is invoked during `OnlyWhenMatching`'s render, so the hook attaches
to that fiber — the caller has reached into a component it does not own and
added one. If the provider calls its children conditionally, the hook count
changes between renders and React throws `Rendered more hooks than during the
previous render`, naming a component from another file. No lint rule can see
it: `children` is an ordinary function argument, and whether it is invoked
unconditionally is a fact about the other file. `MediaQuery.test.tsx` pins the
throw, and the passing case beside it — `MediaQuery` always calls `children`,
so state inside it is stable.

### And the two chores every HOC owes its wrapper

`src/shared/lib/hoc.ts`: `wrapDisplayName` names the wrapper
`withMediaQuery(Banner)` instead of leaving four identical `WithMediaQuery`
nodes in devtools, and `copyStatics` hoists the wrapped component's own
statics, which otherwise stay behind on a component nobody holds a reference to
any more. Both losses are silent — the tree renders either way.

## Why the hook is a `useSyncExternalStore`

Not incidental, and the reason `useMediaQuery` is longer than the three-line
version everyone writes first. Holding `matches` in state and subscribing in an
effect has a gap: state is initialised during render, the listener attaches
after commit, and a change that lands in between is lost — the subscription
starts after the value it was watching has already moved.
`useMediaQuery.test.ts` reproduces exactly that by flipping the query at the
instant the listener is attached, and the naive implementation fails it. The
same suite counts `addEventListener` calls across re-renders, because an
unstable `subscribe` re-subscribes on every commit while reporting the correct
value throughout.

**Not done here:** `ThemeContext` still tracks `prefers-color-scheme` with its
own effect-and-state subscription, which has both of those defects. Converting
it is a behaviour change to the theme system rather than part of documenting
these patterns, but it is the obvious next caller for this hook.
