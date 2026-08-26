# Route transitions

Navigating to a code-split route used to blank the page: the route you were
reading disappeared, a skeleton took its place, and the new page arrived when
its chunk did. The fix is usually described as "wrap the navigation in
`startTransition`". That description is wrong in a way that costs an afternoon,
because the transition was already there.

The worked example is `/labs/navigation` (`NavigationLabPage`), which navigates
to a deliberately slow route under both boundary placements.

## React Router is already running one

`RouterProvider` wraps its own state updates in `React.startTransition`
(react-router 7.18, `RouterProvider`'s `setState`). Every `<Link>` click in
this app has always been a transition. Adding another one around `navigate()`
changes nothing about whether the previous page survives.

So the interesting question is not "is this a transition" but "why did the
transition not hold anything".

## The boundary decides, not the navigation

A transition holds **already-revealed content**, and "already revealed" is a
property of a `<Suspense>` boundary _instance_. A boundary that is mounted for
the first time by this navigation has nothing revealed in it yet, so there is
nothing for React to keep showing — it commits that boundary's fallback
immediately, transition or no transition.

Every route in this app used to carry its own boundary:

```tsx
{ path: "about", element: <Suspense fallback={<AboutPageSkeleton />}><LazyAboutPage /></Suspense> }
```

Which meant the outcome depended on something the route config does not show:
whether React happened to reconcile the two route elements onto the same
boundary. Two routes that both rendered `<Suspense>` at the same position under
`<Outlet>` shared one instance and held the previous page; a route whose element
was shaped differently — `/dashboard` behind `<ProtectedRoute>`, the `*`
fallback, anything not wrapped — got a new instance and flashed. Same app, same
navigation code, two different behaviours, and nothing to read that would tell
you which one you were about to get.

|                                       | previous page            | pending state                               |
| ------------------------------------- | ------------------------ | ------------------------------------------- |
| boundary inside the route element     | replaced by its fallback | none — the transition has already committed |
| one boundary hoisted above `<Outlet>` | held, and interactive    | `isPending` for the whole load              |

`RootLayout` now holds one boundary above `<Outlet>` and the route elements
under `/` carry none. That makes the answer the same for every route.

`/login` and `/auth/callback` keep theirs: they render outside the layout, so
there is no shared parent boundary and no previous page to hold — their
skeleton is the only thing that can be shown.

### Hoisting does not cost the per-route skeletons

One boundary can only have one fallback, which would normally mean one generic
spinner for the whole app. `RouteFallback` picks the skeleton by pathname
instead. Reading `useLocation()` there is safe precisely because of _when_ it
runs: a fallback only ever renders when the boundary is new — a cold load or a
reload — and then the committed location already is the route being waited on.
During an in-app navigation the boundary is not new, React holds the previous
page, and `RouteFallback` does not render at all.

## The `await` is load-bearing

```tsx
startTransition(() => navigate(to)); // silently reports nothing
startTransition(async () => {
  await navigate(to);
}); // correct
```

`navigate()` returns before the router has touched any React state. In the
synchronous form the transition's scope has already closed by the time the
update arrives, so the update never joins it and `isPending` is never true.

With this app's routes — lazy elements, no loaders — the sync form still
_navigates_, and still holds the page, because the router runs its own
transition internally. It just never reports pending, so the progress bar never
appears. Add a loader to any route and that is the whole symptom: navigation
works, the indicator is simply missing, and nothing fails.

Both halves are pinned in `routeTransition.behaviour.test.tsx`.

## Why `useNavigation()` cannot drive the indicator

React Router's `useNavigation().state` tracks **loaders**. These routes have
none — code splitting is `React.lazy`, which the router knows nothing about —
so as far as the router is concerned the navigation finished the moment it
started. `state` reads `idle` for the entire chunk download.

`<NavLink>`'s `isPending` render prop has the same source and the same problem:
a nav item that dimmed on it would never dim. `TransitionNavLink` passes it
through untouched and adds `isPendingTarget` beside it rather than shadowing it,
because two flags with the same name and different answers is worse than one
long name.

## What holding costs

A held page is still on screen and, unlike a frozen one, still **live** — it is
mounted and still processing events. `NavigationLabPage`'s click counter exists
to demonstrate that, since a held page and a hung page look identical in a
screenshot.

The cost is that a click on a slow route produces _no visible change at all_,
which reads as the app having ignored it. That is a worse failure than the
skeleton flash it replaces, so the hold is not shippable on its own:
`RoutePendingBar` is the other half of the feature, not decoration.

## The pieces

| file                                                  | role                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/features/route-transition/routeTransition.tsx`   | `RouteTransitionProvider` + `useRouteTransition()` — one transition for the whole tree |
| `src/features/route-transition/useTransitionLink.ts`  | click handling shared by both link components                                          |
| `src/features/route-transition/TransitionLink.tsx`    | drop-in for `<Link>`                                                                   |
| `src/features/route-transition/TransitionNavLink.tsx` | drop-in for `<NavLink>`                                                                |
| `src/features/route-transition/RoutePendingBar.tsx`   | the only sign a held navigation is happening                                           |
| `src/app/router/RouteFallback.tsx`                    | per-route skeleton for the one hoisted boundary                                        |

One transition for the tree rather than one per link, because the pending state
has more than one consumer: the bar renders it, and each link asks whether it is
the destination being waited on. Separate transitions would each be pending for
their own click and blind to every other.

### Links stay real links

Both components render a real `<a href>` and only take over a plain primary
click. Modifier clicks, middle clicks and non-`_self` targets are requests for a
_document_ load; the handler leaves the event un-prevented and the browser keeps
them. Declining is exactly this — React Router composes a link's `onClick` ahead
of its own and skips its own when the event was default-prevented, so leaving
the event alone lets the router navigate normally, and calling `preventDefault`
is what claims the click.

## Adding a route

Put the element in the route config with no `<Suspense>` of its own:

```tsx
{ path: "reports", element: <LazyReportsPage /> }
```

Add a skeleton to `PAGE_SKELETONS` in `RouteFallback.tsx` if the cold-load
experience deserves one; otherwise it gets `<PageLoader>`. Re-adding a boundary
inside a route element re-introduces the flash for that route alone, silently —
which is the regression `routeTransition.behaviour.test.tsx` pins.

## Testing

A transitioned link does not update the location within `fireEvent`: the
navigation is awaited inside the transition and resolves on a microtask, so an
assertion straight after the click reads the old location. Click through an
awaited `act` scope. `src/test/heldNavigation.tsx` builds a two-route app whose
destination can be held open indefinitely, which is the only way to observe
pending UI — a real chunk settles far too fast to catch.
